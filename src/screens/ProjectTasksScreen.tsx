import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  RefreshControl,
  Modal,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/taskStore';
import { SwipeableTaskItem } from '../components/SwipeableTaskItem';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { QuickAddBar } from '../components/QuickAddBar';
import { MoveListModal } from '../components/MoveListModal';
import { QuickLabelModal } from '../components/QuickLabelModal';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { LabelManagementModal } from '../components/LabelManagementModal';
import { ProjectEditorModal } from '../components/ProjectEditorModal';
import { ProjectSharingModal } from '../components/ProjectSharingModal';
import { sortTasks, SortOption } from '../utils/sorting';
import { isShoppingList } from '../utils/smartClassifier';
import { isAICoreSupported, classifyTaskWithAI } from '../utils/aiCore';
import { MY_TASKS_PROJECT_ID, MY_TASKS_PROJECT, isTaskAssignedToUser } from '../utils/taskFilters';
import { useFilteredSortedTasks, FilterType } from '../hooks/useFilteredSortedTasks';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles } from '../utils/colors';
import { useAppTheme } from '../utils/theme';
import { Task, Project } from '../types/vikunja';

interface ProjectTasksScreenProps {
  onOpenDrawer?: () => void;
  onSelectTask?: (task: Task) => void;
  hideDrawerButton?: boolean;
}

const SORT_LABELS: Record<SortOption, string> = {
  default: 'Default Order',
  manual: 'Custom Order',
  aiSmart: '✨ Smart AI Grouping',
  department: 'Department / Aisle',
  name: 'Name (A-Z)',
  label: 'Label / Store',
  dueDate: 'Due Date',
  priority: 'Priority',
};

export const ProjectTasksScreen: React.FC<ProjectTasksScreenProps> = ({
  onOpenDrawer,
  onSelectTask,
  hideDrawerButton = false,
}) => {
  const theme = useAppTheme();
  const {
    projects,
    tasks,
    labels: storeLabels,
    cachedUsers,
    currentUser,
    selectedProjectId,
    syncStatus,
    pendingSyncCount,
    reenableStaples,
    largeTaskItems,
    taskItemScale = 100,
    taskItemTextScale = 100,
    toggleTask,
    reenableTask,
    updateTaskLabels,
    updateTaskDetails,
    addTask,
    moveTask,
    reorderTasks,
    deleteTask,
    fetchTasks,
    fetchProjects,
    retrySync,
    syncAll,
    fetchAllTasks,
    toggleProjectFavorite,
  } = useTaskStore();

  const [filter, setFilter] = useState<FilterType>('active');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [showSortModal, setShowSortModal] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [showLabelManagementModal, setShowLabelManagementModal] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<number | null>(null);
  const [editingLabelsTask, setEditingLabelsTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [actionSheetProject, setActionSheetProject] = useState<Project | null>(null);
  const [editorProject, setEditorProject] = useState<Project | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [sharingProject, setSharingProject] = useState<Project | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const safeProjects = Array.isArray(projects) ? projects.filter((p) => p.id > 0) : [];

  // Fetch tasks on mount & when active project changes (Regression Issue #1)
  useEffect(() => {
    if (selectedProjectId && selectedProjectId > 0) {
      fetchTasks(selectedProjectId);
    } else {
      fetchAllTasks();
    }
  }, [selectedProjectId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await syncAll();
    setRefreshing(false);
  };

  const {
    activeProject,
    isAllTasksView,
    isMyTasksView,
    isShopping,
    availableLabels,
    projectTasks,
    doneTasks,
    filteredTasks,
    sortedTasks,
    activeCount,
  } = useFilteredSortedTasks({
    projects,
    tasks,
    labels: storeLabels,
    selectedProjectId,
    currentUser,
    filter,
    selectedLabel,
    sortBy,
  });

  const hasAICore = isAICoreSupported();

  const handleMoveTaskPosition = (taskId: number, direction: 'up' | 'down') => {
    safeHaptics.selection();
    const currentList = [...sortedTasks];
    const currentIndex = currentList.findIndex((t) => t.id === taskId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentList.length) return;

    // Swap tasks
    const [moved] = currentList.splice(currentIndex, 1);
    currentList.splice(targetIndex, 0, moved);

    const projectId = moved.project_id || activeProject.id;
    reorderTasks(projectId, currentList.map((t) => t.id));
    if (sortBy !== 'manual') {
      setSortBy('manual');
    }
  };

  const handleLongPressTask = (_task: Task) => {
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    setIsReordering(true);
    if (sortBy !== 'manual') {
      setSortBy('manual');
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      edges={hideDrawerButton ? ['top', 'bottom', 'right'] : ['top', 'bottom', 'left', 'right']}
    >
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header Bar with Live Sync Status Indicator */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.colors.cardBackground,
              borderBottomColor: theme.colors.cardBorder,
            },
          ]}
        >
          {!hideDrawerButton && (
            <TouchableOpacity
              testID="drawer-toggle-btn"
              style={styles.drawerBtn}
              onPress={onOpenDrawer}
              activeOpacity={0.7}
            >
              <Text style={[styles.drawerIcon, { color: theme.colors.text }]}>☰</Text>
            </TouchableOpacity>
          )}

        <TouchableOpacity
          testID="project-header-title-btn"
          style={styles.projectInfo}
          disabled={!activeProject || activeProject.id <= 0}
          onPress={() => {
            if (activeProject && activeProject.id > 0) {
              safeHaptics.selection();
              setActionSheetProject(activeProject);
            }
          }}
          activeOpacity={activeProject && activeProject.id > 0 ? 0.7 : 1}
        >
          <View style={styles.projectTitleRow}>
            {activeProject?.hex_color ? (
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: activeProject.hex_color },
                ]}
              />
            ) : null}
            <Text style={[styles.projectTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {activeProject?.is_favorite ? '⭐ ' : ''}
              {activeProject?.title || 'Tasks'}
            </Text>
            {activeProject && activeProject.id > 0 && (
              <Text style={[styles.projectTitleChevron, { color: theme.colors.textSecondary }]}> ▾</Text>
            )}
          </View>
          <Text style={[styles.taskCountSubtitle, { color: theme.colors.textSecondary }]}>
            {activeCount} active {activeCount === 1 ? 'task' : 'tasks'}
            {activeProject && activeProject.id > 0 ? ' • Tap to edit list' : ''}
          </Text>
        </TouchableOpacity>

        {activeProject && activeProject.id > 0 && (
          <TouchableOpacity
            testID="project-header-options-btn"
            style={styles.headerOptionsBtn}
            onPress={() => {
              safeHaptics.selection();
              setActionSheetProject(activeProject);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={`Options for ${activeProject.title}`}
          >
            <Text style={[styles.headerOptionsIcon, { color: theme.colors.text }]}>⋯</Text>
          </TouchableOpacity>
        )}

        {/* Live Sync Status Indicator */}
        <TouchableOpacity
          testID="sync-indicator-btn"
          style={[
            styles.syncIndicatorPill,
            syncStatus === 'syncing' && styles.syncIndicatorSyncing,
            syncStatus === 'offline' && styles.syncIndicatorOffline,
          ]}
          onPress={() => {
            if (syncStatus === 'offline') {
              retrySync();
            }
          }}
          activeOpacity={syncStatus === 'offline' ? 0.7 : 1}
        >
          <Text
            style={[
              styles.syncIndicatorText,
              syncStatus === 'syncing' && styles.syncIndicatorSyncingText,
              syncStatus === 'offline' && styles.syncIndicatorOfflineText,
            ]}
          >
            {syncStatus === 'synced'
              ? '● Synced'
              : syncStatus === 'syncing'
              ? '◌ Syncing...'
              : `⚡ Offline (${pendingSyncCount})`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filter Selector Pills, Label Filter & Sort Button */}
      <View style={styles.filterBar}>
        <View style={styles.filterPillsGroup}>
          {(['active', 'done', 'all'] as FilterType[]).map((f) => (
            <TouchableOpacity
              key={f}
              testID={`filter-${f}`}
              style={[
                styles.filterPill,
                {
                  backgroundColor:
                    filter === f
                      ? theme.colors.accent
                      : theme.isDark
                      ? '#1C1C1E'
                      : '#E5E5EA',
                },
              ]}
              onPress={() => {
                safeHaptics.selection();
                setFilter(filter === f && (f === 'done' || f === 'all') ? 'active' : f);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterPillText,
                  {
                    color: filter === f ? '#FFFFFF' : theme.colors.textSecondary,
                  },
                ]}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sort Trigger Button */}
        <TouchableOpacity
          testID="sort-trigger-btn"
          style={[
            styles.sortBtn,
            {
              backgroundColor:
                sortBy !== 'default'
                  ? theme.isDark
                    ? 'rgba(10, 132, 255, 0.2)'
                    : 'rgba(0, 122, 255, 0.12)'
                  : theme.isDark
                  ? '#1C1C1E'
                  : '#E5E5EA',
              borderColor:
                sortBy !== 'default' ? theme.colors.accent : theme.colors.border,
            },
          ]}
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.sortBtnText,
              {
                color:
                  sortBy !== 'default' ? theme.colors.accent : theme.colors.text,
              },
            ]}
          >
            ⇅ {sortBy === 'default' ? 'Sort' : SORT_LABELS[sortBy]}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Active Filter Label Chip */}
      {selectedLabel && (() => {
        const matchingDef = (storeLabels || []).find(
          (l) => l.title.toLowerCase() === selectedLabel.toLowerCase()
        );
        const badgeStyle = getLabelBadgeStyles(selectedLabel, matchingDef?.hex_color);
        return (
          <View style={styles.activeLabelRow}>
            <View
              style={[
                styles.activeLabelChip,
                {
                  backgroundColor: badgeStyle.backgroundColor,
                  borderColor: badgeStyle.textColor,
                },
              ]}
            >
              <Text style={[styles.activeLabelText, { color: badgeStyle.textColor }]}>
                #{selectedLabel}
              </Text>
              <TouchableOpacity
                testID="clear-label-filter"
                style={styles.clearLabelBtn}
                onPress={() => setSelectedLabel(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.clearLabelText, { color: badgeStyle.textColor }]}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })()}

      {/* Reorder Mode Banner */}
      {/* Reorder Mode Banner */}
      {isReordering && (
        <View
          style={[
            styles.reorderBanner,
            {
              backgroundColor: theme.isDark ? '#1C1C1E' : '#F2F2F7',
              borderColor: '#007AFF',
            },
          ]}
        >
          <Text style={[styles.reorderBannerText, { color: theme.colors.text }]}>
            ↕ Drag items by ☰ to reorder
          </Text>
          <TouchableOpacity
            testID="reorder-done-btn"
            style={styles.reorderDoneBtn}
            onPress={() => {
              safeHaptics.selection();
              setIsReordering(false);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.reorderDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Quick Add Bar with Suggestions at TOP */}
      <QuickAddBar
        activeProjectId={activeProject.id > 0 ? activeProject.id : (safeProjects[0]?.id || 1)}
        availableProjects={safeProjects}
        availableUsers={cachedUsers}
        doneTasks={doneTasks}
        historyTasks={projectTasks}
        availableLabels={availableLabels}
        reenableStaples={reenableStaples}
        onAddTask={(taskInput) => {
          if (isMyTasksView && currentUser) {
            const hasAssignees = taskInput.assignees && taskInput.assignees.length > 0;
            return addTask({
              ...taskInput,
              assignees: hasAssignees ? taskInput.assignees : [currentUser],
            });
          }
          return addTask(taskInput);
        }}
        onReenableTask={(taskId) => reenableTask(taskId)}
        placeholder={`Add a task to ${activeProject.title}...`}
      />

      {/* Tasks List */}
      <DraggableFlatList
        data={sortedTasks}
        keyExtractor={(item) => item.id.toString()}
        onDragBegin={() => {
          safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        }}
        onDragEnd={({ data }) => {
          safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
          const projectId = activeProject.id;
          reorderTasks(projectId, data.map((t) => t.id));
          if (sortBy !== 'manual') {
            setSortBy('manual');
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#007AFF"
          />
        }
        renderItem={({ item, getIndex, drag, isActive }: RenderItemParams<Task>) => {
          const index = getIndex ? getIndex() : 0;
          const isAiGrouped = sortBy === 'aiSmart' || sortBy === 'department';
          const currentCategory = isAiGrouped ? classifyTaskWithAI(item, activeProject?.title) : null;
          const prevCategory =
            index !== undefined && index > 0 && isAiGrouped
              ? classifyTaskWithAI(sortedTasks[index - 1], activeProject?.title)
              : null;
          const showCategoryHeader = currentCategory && currentCategory !== prevCategory;

          const headerScale = (taskItemScale || 100) / 100;

          return (
            <View>
              {showCategoryHeader ? (
                <View
                  style={[
                    styles.categorySectionHeader,
                    largeTaskItems && styles.categorySectionHeaderLarge,
                    headerScale > 1 && {
                      paddingHorizontal: Math.round(12 * (1 + (headerScale - 1) * 0.7)),
                      paddingTop: Math.round(14 * headerScale),
                      paddingBottom: Math.round(4 * headerScale),
                    },
                  ]}
                  testID={`category-header-${currentCategory}`}
                >
                  <Text
                    style={[
                      styles.categorySectionText,
                      largeTaskItems && styles.categorySectionTextLarge,
                      headerScale > 1 && {
                        fontSize: Math.round(11 * headerScale),
                        letterSpacing: headerScale > 1.2 ? 1 : 0.8,
                      },
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {currentCategory.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              <ScaleDecorator activeScale={1.03}>
                <SwipeableTaskItem
                  task={item}
                  scale={taskItemScale}
                  textScale={taskItemTextScale}
                  isLarge={largeTaskItems}
                  labelDefinitions={storeLabels}
                  onToggle={toggleTask}
                  onMove={(taskId) => setMovingTaskId(taskId)}
                  onDelete={deleteTask}
                  onPress={(task) => {
                    if (isReordering) return;
                    setSelectedTask(task);
                    onSelectTask?.(task);
                  }}
                  onLongPress={() => {
                    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                    setIsReordering(true);
                    if (sortBy !== 'manual') {
                      setSortBy('manual');
                    }
                    drag();
                  }}
                  drag={drag}
                  isDragging={isActive}
                  isReordering={isReordering}
                  onSelectLabel={(label) => setSelectedLabel(label)}
                  onEditLabels={(task) => setEditingLabelsTask(task)}
                />
              </ScaleDecorator>
            </View>
          );
        }}
        contentContainerStyle={
          sortedTasks.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.emptyView}>
            <Text style={styles.emptyEmoji}>✨</Text>
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
              {filter === 'done' ? 'No completed tasks yet' : 'All clear!'}
            </Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
              {filter === 'active'
                ? 'Enjoy your free time or add a new task below.'
                : 'Tap above to quickly capture what is on your mind.'}
            </Text>
          </View>
        }
      />
      </KeyboardAvoidingView>

      {/* Green Floating Action Button (+) for Detailed Task Add */}
      <TouchableOpacity
        testID="green-add-task-fab"
        style={[styles.fabBtn, { backgroundColor: '#30D158' }]}
        onPress={() => {
          safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
          setShowCreateTaskModal(true);
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>＋</Text>
      </TouchableOpacity>

      {/* Move Task Modal */}
      <MoveListModal
        visible={movingTaskId !== null}
        currentProjectId={activeProject?.id}
        projects={safeProjects}
        onSelectProject={(targetProjectId) => {
          if (movingTaskId !== null) {
            moveTask(movingTaskId, targetProjectId);
            setMovingTaskId(null);
          }
        }}
        onClose={() => setMovingTaskId(null)}
      />

      {/* Quick Label / Store Editor Modal */}
      <QuickLabelModal
        visible={editingLabelsTask !== null}
        task={editingLabelsTask}
        availableLabels={availableLabels}
        labelDefinitions={storeLabels}
        onSave={(taskId, labels) => {
          updateTaskLabels(taskId, labels);
          setEditingLabelsTask(null);
        }}
        onClose={() => setEditingLabelsTask(null)}
        onOpenManageLabels={() => setShowLabelManagementModal(true)}
      />

      {/* Rich Task Detail / Editor Modal */}
      <TaskDetailModal
        visible={selectedTask !== null || showCreateTaskModal}
        task={selectedTask}
        availableLabels={availableLabels}
        labelDefinitions={storeLabels}
        availableUsers={cachedUsers}
        availableProjects={safeProjects}
        defaultProjectId={activeProject.id > 0 ? activeProject.id : (safeProjects[0]?.id || 1)}
        onClose={() => {
          setSelectedTask(null);
          setShowCreateTaskModal(false);
        }}
        onSave={(taskId, updates) => {
          updateTaskDetails(taskId, updates);
        }}
        onDelete={(taskId) => {
          deleteTask(taskId);
        }}
        onCreateTask={(newTaskData) => {
          const assignees =
            isMyTasksView && currentUser && (!newTaskData.assignees || newTaskData.assignees.length === 0)
              ? [currentUser]
              : newTaskData.assignees;
          addTask({
            title: newTaskData.title || '',
            description: newTaskData.description,
            due_date: newTaskData.due_date,
            priority: newTaskData.priority,
            project_id:
              newTaskData.project_id ||
              (activeProject.id > 0 ? activeProject.id : (safeProjects[0]?.id || 1)),
            assignees,
          });
        }}
        onMoveTask={(taskId, newProjectId) => {
          moveTask(taskId, newProjectId);
        }}
      />

      {/* Global Label Management Modal */}
      <LabelManagementModal
        visible={showLabelManagementModal}
        onClose={() => setShowLabelManagementModal(false)}
      />

      {/* Sort Options Modal */}
      <Modal
        visible={showSortModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSortModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowSortModal(false)}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <SafeAreaView
            style={[
              styles.sortModalCard,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.cardBorder,
              },
            ]}
          >
            <View style={styles.sortModalHeader}>
              <Text style={[styles.sortModalTitle, { color: theme.colors.text }]}>Sort Tasks</Text>
              <TouchableOpacity
                onPress={() => setShowSortModal(false)}
                style={styles.sortCloseBtn}
              >
                <Text style={[styles.sortCloseText, { color: theme.colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {([
              'default',
              'manual',
              ...(hasAICore ? (['aiSmart'] as SortOption[]) : []),
              ...(isShopping && !hasAICore ? (['department'] as SortOption[]) : []),
              'name',
              'label',
              'dueDate',
              'priority',
            ] as SortOption[]).map((option) => {
              const isSelected = sortBy === option;
              return (
                <TouchableOpacity
                  key={option}
                  testID={`sort-option-${option}`}
                  style={[
                    styles.sortOptionItem,
                    isSelected && {
                      backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                    },
                  ]}
                  onPress={() => {
                    safeHaptics.selection();
                    setSortBy(option);
                    setShowSortModal(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.sortOptionText,
                      {
                        color: isSelected
                          ? theme.colors.text
                          : theme.colors.textSecondary,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {SORT_LABELS[option]}
                  </Text>
                  {isSelected ? <Text style={styles.sortOptionCheckmark}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              testID="sort-option-reorder"
              style={[
                styles.sortOptionItem,
                { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 8 },
              ]}
              onPress={() => {
                safeHaptics.selection();
                setSortBy('manual');
                setIsReordering(true);
                setShowSortModal(false);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortOptionText, { color: theme.colors.accent, fontWeight: '700' }]}>
                ↕ Reorder Tasks Manually
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Project Editor Modal */}
      <ProjectEditorModal
        visible={showEditor}
        project={editorProject}
        allProjects={projects}
        onClose={() => {
          setShowEditor(false);
          setEditorProject(null);
        }}
      />

      {/* Project Sharing Modal */}
      <ProjectSharingModal
        visible={Boolean(sharingProject)}
        project={sharingProject}
        onClose={() => setSharingProject(null)}
      />

      {/* Project Options Action Sheet */}
      {actionSheetProject && (
        <Modal
          visible={Boolean(actionSheetProject)}
          transparent
          animationType="fade"
          onRequestClose={() => setActionSheetProject(null)}
        >
          <TouchableWithoutFeedback onPress={() => setActionSheetProject(null)}>
            <View style={styles.actionSheetBackdrop}>
              <TouchableWithoutFeedback>
                <View
                  style={[
                    styles.actionSheetCard,
                    {
                      backgroundColor: theme.colors.card,
                      borderColor: theme.colors.cardBorder,
                    },
                  ]}
                >
                  <Text style={[styles.actionSheetTitle, { color: theme.colors.text }]}>
                    {actionSheetProject.title}
                  </Text>

                  <TouchableOpacity
                    testID="project-option-edit"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      const p = actionSheetProject;
                      setActionSheetProject(null);
                      setEditorProject(p);
                      setShowEditor(true);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      ✏️ Edit List
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="project-option-share"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      const p = actionSheetProject;
                      setActionSheetProject(null);
                      setSharingProject(p);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      👥 Share List
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="project-option-favorite"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      toggleProjectFavorite(actionSheetProject.id);
                      setActionSheetProject(null);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      {actionSheetProject.is_favorite ? '⭐ Remove Favorite' : '☆ Mark as Favorite'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionSheetCancel}
                    onPress={() => setActionSheetProject(null)}
                  >
                    <Text style={[styles.actionSheetCancelText, { color: theme.colors.textSecondary }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D0D0E',
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E',
  },
  drawerBtn: {
    padding: 6,
    marginRight: 8,
  },
  drawerIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  projectInfo: {
    flex: 1,
  },
  projectTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  projectTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taskCountSubtitle: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 1,
  },
  syncIndicatorPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
  },
  syncIndicatorSyncing: {
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderColor: 'rgba(10, 132, 255, 0.3)',
  },
  syncIndicatorOffline: {
    backgroundColor: 'rgba(255, 149, 0, 0.2)',
    borderColor: '#FF9500',
  },
  syncIndicatorText: {
    fontSize: 10.5,
    color: '#30D158',
    fontWeight: '700',
  },
  syncIndicatorSyncingText: {
    color: '#0A84FF',
  },
  syncIndicatorOfflineText: {
    color: '#FF9500',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterPillsGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  filterPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
  },
  filterPillActive: {
    backgroundColor: '#007AFF',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  sortBtn: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  sortBtnActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    borderColor: '#0A84FF',
  },
  sortBtnText: {
    fontSize: 11,
    color: '#E5E5EA',
    fontWeight: '600',
  },
  activeLabelRow: {
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  activeLabelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#0A84FF20',
    borderWidth: 1,
    borderColor: '#0A84FF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  activeLabelText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '700',
  },
  clearLabelBtn: {
    padding: 2,
  },
  clearLabelText: {
    color: '#0A84FF',
    fontSize: 11,
    fontWeight: '800',
  },
  listContent: {
    paddingVertical: 4,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyView: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
  },
  sortModalCard: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  sortModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sortModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sortCloseBtn: {
    padding: 6,
  },
  sortCloseText: {
    fontSize: 16,
    color: '#8E8E93',
    fontWeight: '600',
  },
  sortOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 4,
  },
  sortOptionItemSelected: {
    backgroundColor: '#2C2C2E',
  },
  sortOptionText: {
    fontSize: 15,
    color: '#8E8E93',
    fontWeight: '500',
  },
  sortOptionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sortOptionCheckmark: {
    color: '#0A84FF',
    fontSize: 16,
    fontWeight: '800',
  },
  fabBtn: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#30D158',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 100,
  },
  fabIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: '300',
    lineHeight: 34,
  },
  reorderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  reorderBannerText: {
    fontSize: 13,
    fontWeight: '700',
  },
  reorderDoneBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  reorderDoneBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  categorySectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  categorySectionHeaderLarge: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  categorySectionText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  categorySectionTextLarge: {
    fontSize: 16,
    letterSpacing: 0.8,
  },
  projectTitleChevron: {
    fontSize: 13,
    fontWeight: '600',
  },
  headerOptionsBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerOptionsIcon: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 20,
  },
  actionSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  actionSheetCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: 8,
  },
  actionSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  actionSheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionSheetOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  actionSheetCancel: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionSheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
