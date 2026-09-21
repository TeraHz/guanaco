import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { useTaskStore } from '../store/taskStore';
import { SwipeableTaskItem } from '../components/SwipeableTaskItem';
import { QuickAddBar } from '../components/QuickAddBar';
import { MoveListModal } from '../components/MoveListModal';
import { QuickLabelModal } from '../components/QuickLabelModal';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { sortTasks, SortOption } from '../utils/sorting';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles } from '../utils/colors';
import { useAppTheme } from '../utils/theme';
import { Task } from '../types/vikunja';

interface ProjectTasksScreenProps {
  onOpenDrawer?: () => void;
  onSelectTask?: (task: Task) => void;
}

type FilterType = 'all' | 'active' | 'done';

const SORT_LABELS: Record<SortOption, string> = {
  default: 'Default Order',
  name: 'Name (A-Z)',
  label: 'Label / Store',
  dueDate: 'Due Date',
  priority: 'Priority',
};

export const ProjectTasksScreen: React.FC<ProjectTasksScreenProps> = ({
  onOpenDrawer,
  onSelectTask,
}) => {
  const theme = useAppTheme();
  const {
    projects,
    tasks,
    labels: storeLabels,
    cachedUsers,
    selectedProjectId,
    syncStatus,
    pendingSyncCount,
    reenableStaples,
    toggleTask,
    reenableTask,
    updateTaskLabels,
    updateTaskDetails,
    addTask,
    moveTask,
    deleteTask,
    fetchTasks,
    fetchProjects,
    retrySync,
    syncAll,
    fetchAllTasks,
  } = useTaskStore();

  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [showSortModal, setShowSortModal] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<number | null>(null);
  const [editingLabelsTask, setEditingLabelsTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const safeProjects = Array.isArray(projects) ? projects.filter((p) => p.id > 0) : [];
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  const isAllTasksView = selectedProjectId === null;
  const activeProject = isAllTasksView
    ? { id: 0, title: 'All Tasks', hex_color: '#007AFF' }
    : safeProjects.find((p) => p.id === selectedProjectId) ||
      safeProjects[0] ||
      { id: 0, title: 'All Tasks', hex_color: '#007AFF' };

  // Fetch tasks on mount & when active project changes (Regression Issue #1)
  useEffect(() => {
    if (selectedProjectId) {
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

  // Extract all available labels across tasks and store labels
  const availableLabels = Array.from(
    new Set([
      ...(storeLabels || []).map((l) => l.title),
      ...safeTasks.flatMap((t) => (t.labels || []).map((l) => l.title)),
    ].filter(Boolean))
  );

  // Filter tasks belonging to current active project (or all tasks in All Tasks view)
  const projectTasks = isAllTasksView
    ? safeTasks
    : safeTasks.filter((t) => t.project_id === activeProject.id);

  // Done tasks for quick add suggestions & re-enabling
  const doneTasks = projectTasks.filter((t) => t.done);

  // Apply filters
  const filteredTasks = projectTasks.filter((task) => {
    if (filter === 'active' && task.done) return false;
    if (filter === 'done' && !task.done) return false;
    if (selectedLabel) {
      const hasLabel = task.labels?.some(
        (l) => l.title.toLowerCase() === selectedLabel.toLowerCase()
      );
      if (!hasLabel) return false;
    }
    return true;
  });

  // Apply intelligent sorting with priority preserved
  const sortedTasks = sortTasks(filteredTasks, sortBy);

  const activeCount = projectTasks.filter((t) => !t.done).length;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />

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
        <TouchableOpacity
          testID="drawer-toggle-btn"
          style={styles.drawerBtn}
          onPress={onOpenDrawer}
          activeOpacity={0.7}
        >
          <Text style={[styles.drawerIcon, { color: theme.colors.text }]}>☰</Text>
        </TouchableOpacity>

        <View style={styles.projectInfo}>
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
              {activeProject?.title || 'Tasks'}
            </Text>
          </View>
          <Text style={[styles.taskCountSubtitle, { color: theme.colors.textSecondary }]}>
            {activeCount} active {activeCount === 1 ? 'task' : 'tasks'}
          </Text>
        </View>

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
          {(['all', 'active', 'done'] as FilterType[]).map((f) => (
            <TouchableOpacity
              key={f}
              testID={`filter-${f}`}
              style={[styles.filterPill, filter === f && styles.filterPillActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterPillText,
                  filter === f && styles.filterPillTextActive,
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
            sortBy !== 'default' && styles.sortBtnActive,
          ]}
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.sortBtnText}>
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
                🏷️ #{selectedLabel}
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

      {/* Tasks List */}
      <FlatList
        data={sortedTasks}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#007AFF"
          />
        }
        renderItem={({ item }) => (
          <SwipeableTaskItem
            task={item}
            labelDefinitions={storeLabels}
            onToggle={toggleTask}
            onMove={(taskId) => setMovingTaskId(taskId)}
            onDelete={deleteTask}
            onPress={(task) => {
              setSelectedTask(task);
              onSelectTask?.(task);
            }}
            onSelectLabel={(label) => setSelectedLabel(label)}
            onEditLabels={(task) => setEditingLabelsTask(task)}
          />
        )}
        contentContainerStyle={
          sortedTasks.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.emptyView}>
            <Text style={styles.emptyEmoji}>✨</Text>
            <Text style={styles.emptyTitle}>
              {filter === 'done' ? 'No completed tasks yet' : 'All clear!'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {filter === 'active'
                ? 'Enjoy your free time or add a new task below.'
                : 'Tap below to quickly capture what is on your mind.'}
            </Text>
          </View>
        }
      />

      {/* Docked TickTick-style Quick Add Bar with Suggestions & Staple Re-enabling */}
      <QuickAddBar
        activeProjectId={activeProject.id > 0 ? activeProject.id : (safeProjects[0]?.id || 1)}
        availableProjects={safeProjects}
        availableUsers={cachedUsers}
        doneTasks={doneTasks}
        availableLabels={availableLabels}
        reenableStaples={reenableStaples}
        onAddTask={addTask}
        onReenableTask={(taskId) => reenableTask(taskId)}
        placeholder={`Add a task to ${activeProject.title}...`}
      />

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
      />

      {/* Rich Task Detail / Editor Modal */}
      <TaskDetailModal
        visible={selectedTask !== null}
        task={selectedTask}
        availableLabels={availableLabels}
        labelDefinitions={storeLabels}
        availableUsers={cachedUsers}
        onClose={() => setSelectedTask(null)}
        onSave={(taskId, updates) => {
          updateTaskDetails(taskId, updates);
        }}
        onDelete={(taskId) => {
          deleteTask(taskId);
        }}
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

          <SafeAreaView style={styles.sortModalCard}>
            <View style={styles.sortModalHeader}>
              <Text style={styles.sortModalTitle}>Sort Tasks</Text>
              <TouchableOpacity
                onPress={() => setShowSortModal(false)}
                style={styles.sortCloseBtn}
              >
                <Text style={styles.sortCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {(['default', 'name', 'label', 'dueDate', 'priority'] as SortOption[]).map(
              (option) => {
                const isSelected = sortBy === option;
                return (
                  <TouchableOpacity
                    key={option}
                    testID={`sort-option-${option}`}
                    style={[
                      styles.sortOptionItem,
                      isSelected && styles.sortOptionItemSelected,
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
                        isSelected && styles.sortOptionTextSelected,
                      ]}
                    >
                      {SORT_LABELS[option]}
                    </Text>
                    {isSelected ? <Text style={styles.sortOptionCheckmark}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D0D0E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E',
  },
  drawerBtn: {
    padding: 8,
    marginRight: 10,
  },
  drawerIcon: {
    fontSize: 22,
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
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  projectTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taskCountSubtitle: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  syncIndicatorPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
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
    fontSize: 11,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterPillsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
  },
  filterPillActive: {
    backgroundColor: '#007AFF',
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  sortBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  sortBtnActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    borderColor: '#0A84FF',
  },
  sortBtnText: {
    fontSize: 12,
    color: '#E5E5EA',
    fontWeight: '600',
  },
  activeLabelRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  activeLabelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#0A84FF20',
    borderWidth: 1,
    borderColor: '#0A84FF',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 16,
    gap: 6,
  },
  activeLabelText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '700',
  },
  clearLabelBtn: {
    padding: 2,
  },
  clearLabelText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '800',
  },
  listContent: {
    paddingVertical: 8,
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
});
