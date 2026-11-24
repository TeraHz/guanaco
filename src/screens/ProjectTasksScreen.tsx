import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  RefreshControl,
  Modal,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  LayoutAnimation,
  UIManager,
  Alert,
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
import { SortOption } from '../utils/sorting';
import { isAICoreSupported, classifyTaskWithAI } from '../utils/aiCore';
import {
  useFilteredSortedTasks,
  FilterType,
  DueFilterType,
} from '../hooks/useFilteredSortedTasks';
import { MY_TASKS_PROJECT_ID } from '../utils/taskFilters';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles, hexToRgba, normalizeHexColor } from '../utils/colors';
import { useAppTheme } from '../utils/theme';
import { CreateTaskInput, Task, Project } from '../types/vikunja';
import { localizeCategoryName, TranslationKey, useTranslation } from '../i18n';
import { syncAllTaskReminders, syncAppBadgeCount } from '../services/localNotifications';

interface ProjectTasksScreenProps {
  onOpenDrawer?: () => void;
  onSelectTask?: (task: Task) => void;
  hideDrawerButton?: boolean;
}

const SORT_LABEL_KEYS: Record<SortOption, TranslationKey> = {
  default: 'sort.default',
  manual: 'sort.manual',
  aiSmart: 'sort.aiSmart',
  department: 'sort.department',
  name: 'sort.name',
  label: 'sort.label',
  dueDate: 'sort.dueDate',
  priority: 'sort.priority',
};

interface TrackedTaskRef {
  id: number;
  title: string;
  project_id: number;
  done?: boolean;
}

/**
 * Resolves a tracked task against the live `tasks` array in `useTaskStore`.
 * If an optimistic negative `tempId` was replaced with a positive server ID while a modal or Undo window was open,
 * seamlessly resolves to the newest matching live server task!
 */
function resolveLiveTask(tasks: Task[], ref: TrackedTaskRef | null): Task | null {
  if (!ref) return null;
  const safe = Array.isArray(tasks) ? tasks : [];
  const exact = safe.find((t) => t.id === ref.id);
  if (exact) return exact;

  if (ref.id < 0) {
    const candidates = safe.filter(
      (t) => t.id > 0 && t.title === ref.title && t.project_id === ref.project_id
    );
    if (candidates.length > 0) {
      const sameDone =
        ref.done !== undefined
          ? candidates.filter((t) => Boolean(t.done) === Boolean(ref.done))
          : [];
      const pool = sameDone.length > 0 ? sameDone : candidates;
      return pool.reduce((best, cur) => (cur.id > best.id ? cur : best), pool[0]);
    }
  }

  return null;
}

/**
 * Splices a reordered subset (`newSubsetIds`) into the full project task list (`allProjectTasks`)
 * at the exact positions originally occupied by that subset, preventing position collisions/corruption
 * on filtered-out tasks (e.g. completed tasks or other labels)!
 */
function buildCollisionFreeProjectOrder(
  allProjectTasks: Task[],
  newSubsetIds: number[]
): number[] {
  const subsetSet = new Set(newSubsetIds);
  const sortedFull = [...allProjectTasks].sort((a, b) => {
    const posA = a.position ?? Number.MAX_SAFE_INTEGER;
    const posB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    return a.id - b.id;
  });

  let subsetCursor = 0;
  return sortedFull.map((task) => {
    if (subsetSet.has(task.id) && subsetCursor < newSubsetIds.length) {
      return newSubsetIds[subsetCursor++];
    }
    return task.id;
  });
}

export const ProjectTasksScreen: React.FC<ProjectTasksScreenProps> = ({
  onOpenDrawer,
  onSelectTask,
  hideDrawerButton = false,
}) => {
  const theme = useAppTheme();
  const { t, locale } = useTranslation();
  const getSortLabel = (option: SortOption): string =>
    Object.prototype.hasOwnProperty.call(SORT_LABEL_KEYS, option)
      ? t(SORT_LABEL_KEYS[option])
      : t('sort.button');
  const {
    client,
    isLocalMode = false,
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
    weekStartDay = 1,
    savedFilterTaskIds = {},
    localDataVersion = 0,
    isLoading = false,
    isSyncingAll = false,
    pendingOpenTaskId = null,
    setPendingOpenTaskId,
    toggleTask,
    reenableTask,
    updateTaskLabels,
    updateTaskDetails,
    addTask,
    addSubtask,
    unlinkSubtask,
    duplicateTask,
    moveTask,
    reorderTasks,
    deleteTask,
    fetchTasks,
    fetchSavedFilterTasks,
    retrySync,
    syncAll,
    fetchAllTasks,
    toggleProjectFavorite,
    archiveProject,
    deleteProject,
  } = useTaskStore();

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      const h = e?.endCoordinates?.height || 0;
      if (Platform.OS === 'android' && h > 0) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setKeyboardHeight(h);
    };

    const onHide = () => {
      if (Platform.OS === 'android') {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [filter, setFilter] = useState<FilterType>('active');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAllLists, setSearchAllLists] = useState(false);
  const [dueFilter, setDueFilter] = useState<DueFilterType>('all');
  const [minPriority, setMinPriority] = useState<number>(0);
  const [isReordering, setIsReordering] = useState(false);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);
  const reorderNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [duplicatedTaskRef, setDuplicatedTaskRef] = useState<TrackedTaskRef | null>(null);
  const duplicatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal states — strictly mutually exclusive so two <Modal>s are NEVER visible simultaneously!
  const [showSortModal, setShowSortModal] = useState(false);
  const [showLabelManagementModal, setShowLabelManagementModal] = useState(false);
  const [movingTaskRef, setMovingTaskRef] = useState<TrackedTaskRef | null>(null);
  const [editingLabelsRef, setEditingLabelsRef] = useState<TrackedTaskRef | null>(null);
  const [selectedTaskRef, setSelectedTaskRef] = useState<TrackedTaskRef | null>(null);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [actionSheetProjectId, setActionSheetProjectId] = useState<number | null>(null);
  const [confirmingProjectDelete, setConfirmingProjectDelete] = useState(false);
  const [editorProjectId, setEditorProjectId] = useState<number | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [sharingProjectId, setSharingProjectId] = useState<number | null>(null);
  const [noProjectWarning, setNoProjectWarning] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  // Undo Delete safety state (tracks tempId -> serverId remap and cancels cleanly on logout/reset)
  const [pendingDeleteTaskRef, setPendingDeleteTaskRef] = useState<TrackedTaskRef | null>(null);
  const pendingDeleteRef = useRef<{
    ref: TrackedTaskRef;
    timer: ReturnType<typeof setTimeout>;
    hadActiveSession: boolean;
  } | null>(null);

  const flushPendingDelete = useCallback(() => {
    if (!pendingDeleteRef.current) return;
    const { ref, timer, hadActiveSession } = pendingDeleteRef.current;
    clearTimeout(timer);
    pendingDeleteRef.current = null;
    setPendingDeleteTaskRef(null);

    const storeState = useTaskStore.getState();
    if (hadActiveSession && !storeState.client && !storeState.isLocalMode) {
      return;
    }
    const live = resolveLiveTask(storeState.tasks, ref);
    if (!live) {
      return;
    }
    deleteTask(live.id);
  }, [deleteTask]);

  useEffect(() => {
    return () => {
      if (reorderNoticeTimerRef.current) {
        clearTimeout(reorderNoticeTimerRef.current);
      }
      if (duplicatedTimerRef.current) {
        clearTimeout(duplicatedTimerRef.current);
      }
      if (pendingDeleteRef.current) {
        const { ref, timer } = pendingDeleteRef.current;
        clearTimeout(timer);
        pendingDeleteRef.current = null;
        const storeState = useTaskStore.getState();
        if (storeState.client !== null || storeState.isLocalMode) {
          const live = resolveLiveTask(storeState.tasks, ref);
          if (live) {
            deleteTask(live.id);
          }
        }
      }
    };
  }, [deleteTask]);

  const closeAllModals = () => {
    setShowSortModal(false);
    setShowLabelManagementModal(false);
    setMovingTaskRef(null);
    setEditingLabelsRef(null);
    setSelectedTaskRef(null);
    setShowCreateTaskModal(false);
    setActionSheetProjectId(null);
    setConfirmingProjectDelete(false);
    setEditorProjectId(null);
    setShowEditor(false);
    setSharingProjectId(null);
  };

  const commitDeleteProject = (projectId: number) => {
    setConfirmingProjectDelete(false);
    setActionSheetProjectId(null);
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    deleteProject(projectId).catch(() => {});
  };

  const handleRequestDeleteProject = (proj: Project) => {
    const message = t('drawer.deleteListConfirm', { title: proj.title });
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`${t('drawer.deleteList')}\n\n${message}`)) {
          commitDeleteProject(proj.id);
        }
      } else {
        setConfirmingProjectDelete(true);
      }
      return;
    }

    Alert.alert(t('drawer.deleteList'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => commitDeleteProject(proj.id),
      },
    ]);
  };

  const safeProjects = useMemo(
    () => (Array.isArray(projects) ? projects.filter((p) => p.id > 0 && !p.is_archived) : []),
    [projects]
  );

  const allPositiveProjects = useMemo(
    () => (Array.isArray(projects) ? projects.filter((p) => p.id > 0) : []),
    [projects]
  );

  // Live resolved entities from store (prevents stale task/project snapshots & dead negative tempIds)
  const liveSelectedTask = useMemo(
    () => resolveLiveTask(tasks, selectedTaskRef),
    [tasks, selectedTaskRef]
  );
  const liveEditingLabelsTask = useMemo(
    () => resolveLiveTask(tasks, editingLabelsRef),
    [tasks, editingLabelsRef]
  );
  const liveMovingTask = useMemo(
    () => resolveLiveTask(tasks, movingTaskRef),
    [tasks, movingTaskRef]
  );
  const livePendingDeleteTask = useMemo(
    () => resolveLiveTask(tasks, pendingDeleteTaskRef),
    [tasks, pendingDeleteTaskRef]
  );
  const liveDuplicatedTask = useMemo(
    () => resolveLiveTask(tasks, duplicatedTaskRef),
    [tasks, duplicatedTaskRef]
  );

  const lastObservedLocalDataVersionRef = useRef(localDataVersion);
  useEffect(() => {
    if (lastObservedLocalDataVersionRef.current === localDataVersion) return;
    lastObservedLocalDataVersionRef.current = localDataVersion;
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      pendingDeleteRef.current = null;
    }
    setPendingDeleteTaskRef(null);
  }, [localDataVersion]);

  useEffect(() => {
    if (!pendingDeleteTaskRef) return;

    // Cancel staged delete without mutating if session cleared (`!client && !isLocalMode` when staged in an active session)
    // or if the task was removed from store (e.g. `resetAndSyncFromServer`, `clearSession`, `deleteProject`).
    if (
      (pendingDeleteRef.current?.hadActiveSession && !client && !isLocalMode) ||
      !livePendingDeleteTask
    ) {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timer);
        pendingDeleteRef.current = null;
      }
      setPendingDeleteTaskRef(null);
      return;
    }

    if (livePendingDeleteTask.id !== pendingDeleteTaskRef.id) {
      const updatedRef: TrackedTaskRef = {
        id: livePendingDeleteTask.id,
        title: livePendingDeleteTask.title,
        project_id: livePendingDeleteTask.project_id,
        done: Boolean(livePendingDeleteTask.done),
      };
      if (pendingDeleteRef.current) {
        pendingDeleteRef.current.ref = updatedRef;
      }
      setPendingDeleteTaskRef(updatedRef);
    }
  }, [pendingDeleteTaskRef, livePendingDeleteTask, client, isLocalMode]);

  useEffect(() => {
    if (selectedTaskRef && liveSelectedTask && liveSelectedTask.id !== selectedTaskRef.id) {
      setSelectedTaskRef({
        id: liveSelectedTask.id,
        title: liveSelectedTask.title,
        project_id: liveSelectedTask.project_id,
        done: Boolean(liveSelectedTask.done),
      });
    }
  }, [selectedTaskRef, liveSelectedTask]);

  useEffect(() => {
    if (editingLabelsRef && liveEditingLabelsTask && liveEditingLabelsTask.id !== editingLabelsRef.id) {
      setEditingLabelsRef({
        id: liveEditingLabelsTask.id,
        title: liveEditingLabelsTask.title,
        project_id: liveEditingLabelsTask.project_id,
        done: Boolean(liveEditingLabelsTask.done),
      });
    }
  }, [editingLabelsRef, liveEditingLabelsTask]);

  useEffect(() => {
    if (movingTaskRef && liveMovingTask && liveMovingTask.id !== movingTaskRef.id) {
      setMovingTaskRef({
        id: liveMovingTask.id,
        title: liveMovingTask.title,
        project_id: liveMovingTask.project_id,
        done: Boolean(liveMovingTask.done),
      });
    }
  }, [movingTaskRef, liveMovingTask]);

  const actionSheetProject: Project | null = useMemo(
    () =>
      actionSheetProjectId !== null
        ? allPositiveProjects.find((p) => p.id === actionSheetProjectId) || null
        : null,
    [allPositiveProjects, actionSheetProjectId]
  );

  const editorProject: Project | null = useMemo(
    () =>
      editorProjectId !== null
        ? allPositiveProjects.find((p) => p.id === editorProjectId) || null
        : null,
    [allPositiveProjects, editorProjectId]
  );

  const sharingProject: Project | null = useMemo(
    () =>
      sharingProjectId !== null
        ? allPositiveProjects.find((p) => p.id === sharingProjectId) || null
        : null,
    [allPositiveProjects, sharingProjectId]
  );

  // Fetch tasks on mount & when active project changes (Regression Issue #1)
  useEffect(() => {
    setIsReordering(false);
    if (selectedProjectId && selectedProjectId > 0) {
      fetchTasks(selectedProjectId);
    } else if (
      selectedProjectId !== null &&
      selectedProjectId < 0 &&
      selectedProjectId !== MY_TASKS_PROJECT_ID
    ) {
      fetchSavedFilterTasks?.(selectedProjectId);
    } else {
      fetchAllTasks();
    }
  }, [selectedProjectId]);

  // Open task detail modal when user taps a local reminder notification (placed AFTER mount fetch effect)
  useEffect(() => {
    if (pendingOpenTaskId === null || pendingOpenTaskId === undefined) return;
    const found = (Array.isArray(tasks) ? tasks : []).find((t) => t.id === pendingOpenTaskId);
    if (found) {
      setPendingOpenTaskId?.(null);
      closeAllModals();
      setSelectedTaskRef({
        id: found.id,
        title: found.title,
        project_id: found.project_id,
        done: Boolean(found.done),
      });
    } else if (!isLoading && !isSyncingAll) {
      setPendingOpenTaskId?.(null);
    }
  }, [pendingOpenTaskId, tasks, isLoading, isSyncingAll, setPendingOpenTaskId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (isLocalMode && !client) {
      const snap = useTaskStore.getState();
      await syncAllTaskReminders(snap.tasks || []).catch(() => {});
      await syncAppBadgeCount(snap.tasks || [], snap.appBadgeMode).catch(() => {});
      setRefreshing(false);
      return;
    }
    await syncAll();
    if (
      selectedProjectId !== null &&
      selectedProjectId < 0 &&
      selectedProjectId !== MY_TASKS_PROJECT_ID
    ) {
      await fetchSavedFilterTasks?.(selectedProjectId);
    }
    setRefreshing(false);
  };

  const {
    activeProject,
    isAllTasksView,
    isMyTasksView,
    isSavedFilterView,
    isShopping,
    availableLabels,
    projectTasks,
    doneTasks,
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
    savedFilterTaskIds,
    searchQuery: showSearch ? searchQuery : '',
    searchAllLists: showSearch ? searchAllLists : false,
    minPriority: showSearch ? minPriority : 0,
    dueFilter: showSearch ? dueFilter : 'all',
    isLocalMode,
  });

  useEffect(() => {
    if (
      selectedLabel &&
      !availableLabels.some((lbl) => lbl.toLowerCase() === selectedLabel.toLowerCase())
    ) {
      setSelectedLabel(null);
    }
  }, [localDataVersion, availableLabels, selectedLabel]);

  const visibleTasks = useMemo(
    () =>
      livePendingDeleteTask
        ? sortedTasks.filter((t) => t.id !== livePendingDeleteTask.id)
        : sortedTasks,
    [sortedTasks, livePendingDeleteTask]
  );

  const hasAICore = isAICoreSupported();
  const isVirtualView =
    isAllTasksView ||
    isMyTasksView ||
    isSavedFilterView ||
    (showSearch && searchAllLists) ||
    !activeProject ||
    activeProject.id <= 0;

  const showTemporaryNotice = (msg: string) => {
    setReorderNotice(msg);
    if (reorderNoticeTimerRef.current) {
      clearTimeout(reorderNoticeTimerRef.current);
    }
    reorderNoticeTimerRef.current = setTimeout(() => {
      setReorderNotice(null);
    }, 3500);
  };

  const applySafeProjectReorder = useCallback(
    (projectId: number, orderedVisibleIds: number[]) => {
      if (projectId <= 0) return;
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const fullProjectTasks = safeTasks.filter((t) => t.project_id === projectId);
      const collisionFreeIds = buildCollisionFreeProjectOrder(fullProjectTasks, orderedVisibleIds);
      reorderTasks(projectId, collisionFreeIds);
    },
    [tasks, reorderTasks]
  );

  const handleMoveTaskPosition = useCallback(
    (taskId: number, direction: 'up' | 'down') => {
      if (isVirtualView) {
        showTemporaryNotice(t('tasks.openSpecificListToReorder'));
        return;
      }
      safeHaptics.selection();
      const currentList = [...visibleTasks];
      const currentIndex = currentList.findIndex((t) => t.id === taskId);
      if (currentIndex === -1) return;

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= currentList.length) return;

      const [moved] = currentList.splice(currentIndex, 1);
      currentList.splice(targetIndex, 0, moved);

      const projectId = moved.project_id || activeProject.id;
      applySafeProjectReorder(
        projectId,
        currentList.map((t) => t.id)
      );
      if (sortBy !== 'manual') {
        setSortBy('manual');
      }
    },
    [isVirtualView, visibleTasks, activeProject.id, applySafeProjectReorder, sortBy]
  );

  const handleStageDeleteTask = useCallback(
    (taskId: number) => {
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const target = safeTasks.find((t) => t.id === taskId);
      if (!target) {
        deleteTask(taskId);
        return;
      }

      // Flush any previous staged delete first
      if (pendingDeleteRef.current) {
        flushPendingDelete();
      }

      const nextRef: TrackedTaskRef = {
        id: target.id,
        title: target.title,
        project_id: target.project_id,
        done: Boolean(target.done),
      };
      const curStore = useTaskStore.getState();
      const hadActiveSession = Boolean(curStore.client || curStore.isLocalMode);

      const timer = setTimeout(() => {
        flushPendingDelete();
      }, 5000);

      pendingDeleteRef.current = { ref: nextRef, timer, hadActiveSession };
      setPendingDeleteTaskRef(nextRef);
    },
    [tasks, deleteTask, flushPendingDelete]
  );

  const handleUndoDelete = () => {
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      pendingDeleteRef.current = null;
    }
    setPendingDeleteTaskRef(null);
    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
  };

  const defaultTargetProjectId =
    activeProject && activeProject.id > 0
      ? activeProject.id
      : safeProjects[0]?.id || 0;

  const handleOpenMoveModal = useCallback(
    (taskId: number) => {
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const found = safeTasks.find((t) => t.id === taskId);
      closeAllModals();
      setMovingTaskRef(
        found
          ? {
              id: found.id,
              title: found.title,
              project_id: found.project_id,
              done: Boolean(found.done),
            }
          : { id: taskId, title: '', project_id: defaultTargetProjectId }
      );
    },
    [tasks, defaultTargetProjectId]
  );

  const handleOpenEditLabels = useCallback((task: Task) => {
    closeAllModals();
    setEditingLabelsRef({
      id: task.id,
      title: task.title,
      project_id: task.project_id,
      done: Boolean(task.done),
    });
  }, []);

  const handleOpenTaskDetails = useCallback(
    (task: Task) => {
      if (isReordering) return;
      closeAllModals();
      setSelectedTaskRef({
        id: task.id,
        title: task.title,
        project_id: task.project_id,
        done: Boolean(task.done),
      });
      onSelectTask?.(task);
    },
    [isReordering, onSelectTask]
  );

  const handleSelectLabelFilter = useCallback((label: string) => {
    setSelectedLabel(label);
  }, []);

  const isKeyboardVisible = keyboardHeight > 0;
  const activeProjectDotColor = activeProject?.hex_color
    ? normalizeHexColor(activeProject.hex_color, true) ?? null
    : null;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      edges={
        hideDrawerButton
          ? isKeyboardVisible
            ? ['top', 'right']
            : ['top', 'bottom', 'right']
          : isKeyboardVisible
          ? ['top', 'left', 'right']
          : ['top', 'bottom', 'left', 'right']
      }
    >
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />

      <KeyboardAvoidingView
        testID="keyboard-avoiding-container"
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
              accessibilityRole="button"
              accessibilityLabel={t('drawer.openA11y')}
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
                closeAllModals();
                setActionSheetProjectId(activeProject.id);
              }
            }}
            activeOpacity={activeProject && activeProject.id > 0 ? 0.7 : 1}
            accessibilityRole={activeProject && activeProject.id > 0 ? 'button' : 'header'}
          >
            <View style={styles.projectTitleRow}>
              {activeProjectDotColor ? (
                <View
                  testID="active-project-color-dot"
                  style={[
                    styles.colorDot,
                    { backgroundColor: activeProjectDotColor },
                  ]}
                />
              ) : null}
              <Text style={[styles.projectTitle, { color: theme.colors.text }]} numberOfLines={1}>
                {activeProject?.is_favorite ? '★ ' : ''}
                {activeProject?.title || t('tasks.defaultTitle')}
              </Text>
              {activeProject && activeProject.id > 0 && (
                <Text style={[styles.projectTitleChevron, { color: theme.colors.textSecondary }]}>
                  {' '}
                  ▾
                </Text>
              )}
            </View>
            <Text style={[styles.taskCountSubtitle, { color: theme.colors.textSecondary }]}>
              {t('tasks.openCount', { count: activeCount })}
            </Text>
          </TouchableOpacity>

          {activeProject && activeProject.id > 0 && (
            <TouchableOpacity
              testID="project-header-options-btn"
              style={styles.headerOptionsBtn}
              onPress={() => {
                safeHaptics.selection();
                closeAllModals();
                setActionSheetProjectId(activeProject.id);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('drawer.optionsForA11y', { title: activeProject.title })}
            >
              <Text style={[styles.headerOptionsIcon, { color: theme.colors.text }]}>⋯</Text>
            </TouchableOpacity>
          )}

          {/* Search Toggle Button */}
          <TouchableOpacity
            testID="header-search-btn"
            style={[
              styles.headerSearchBtn,
              showSearch && {
                backgroundColor: hexToRgba(theme.colors.accent, 0.16),
                borderColor: theme.colors.accent,
              },
            ]}
            onPress={() => {
              safeHaptics.selection();
              setShowSearch((prev) => {
                if (prev) {
                  setSearchQuery('');
                  setSearchAllLists(false);
                  setDueFilter('all');
                  setMinPriority(0);
                }
                return !prev;
              });
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showSearch ? t('tasks.searchCloseA11y') : t('tasks.searchOpenA11y')}
          >
            <Text
              style={[
                styles.headerSearchIcon,
                { color: showSearch ? theme.colors.accent : theme.colors.text },
              ]}
            >
              ⌕
            </Text>
          </TouchableOpacity>

          {/* Live Sync Status Indicator */}
          {!isLocalMode && (
            <TouchableOpacity
              testID="sync-indicator-btn"
              style={[
                styles.syncIndicatorPill,
                {
                  backgroundColor:
                    syncStatus === 'syncing'
                      ? hexToRgba(theme.colors.accent, 0.14)
                      : syncStatus === 'offline' || (syncStatus as string) === 'auth_required'
                      ? hexToRgba(theme.colors.warning, 0.16)
                      : hexToRgba(theme.colors.success, 0.14),
                  borderColor:
                    syncStatus === 'syncing'
                      ? hexToRgba(theme.colors.accent, 0.35)
                      : syncStatus === 'offline' || (syncStatus as string) === 'auth_required'
                      ? hexToRgba(theme.colors.warning, 0.45)
                      : hexToRgba(theme.colors.success, 0.35),
                },
              ]}
              onPress={() => {
                if (syncStatus === 'offline') {
                  retrySync();
                }
              }}
              activeOpacity={syncStatus === 'offline' ? 0.7 : 1}
              accessibilityRole="button"
              accessibilityLabel={
                syncStatus === 'synced'
                  ? t('tasks.syncSyncedA11y')
                  : syncStatus === 'syncing'
                  ? t('tasks.syncSyncingA11y')
                  : (syncStatus as string) === 'auth_required'
                  ? t('tasks.syncReauthA11y')
                  : t('tasks.syncOfflineA11y', { count: pendingSyncCount })
              }
            >
              <Text
                style={[
                  styles.syncIndicatorText,
                  {
                    color:
                      syncStatus === 'syncing'
                        ? theme.colors.accent
                        : syncStatus === 'offline' || (syncStatus as string) === 'auth_required'
                        ? theme.colors.warning
                        : theme.colors.success,
                  },
                ]}
              >
                {syncStatus === 'synced'
                  ? t('tasks.syncSynced')
                  : syncStatus === 'syncing'
                  ? t('tasks.syncSyncing')
                  : (syncStatus as string) === 'auth_required'
                  ? t('tasks.syncSignIn', { count: pendingSyncCount })
                  : t('tasks.syncOffline', { count: pendingSyncCount })}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Collapsible Search & Multi-Facet Filter Bar */}
        {showSearch && (
          <View
            testID="search-panel"
            style={[
              styles.searchPanel,
              {
                backgroundColor: theme.colors.cardBackground,
                borderBottomColor: theme.colors.cardBorder,
              },
            ]}
          >
            <View
              style={[
                styles.searchInputWrap,
                {
                  backgroundColor: theme.colors.inputBg,
                  borderColor: theme.colors.borderStrong,
                },
              ]}
            >
              <TextInput
                testID="task-search-input"
                style={[styles.searchInput, { color: theme.colors.text }]}
                placeholder={
                  searchAllLists
                    ? isLocalMode
                      ? t('tasks.searchAllLocalPlaceholder')
                      : t('tasks.searchAllPlaceholder')
                    : activeProject?.title
                    ? t('tasks.searchInListPlaceholder', { title: activeProject.title })
                    : t('tasks.searchInListFallback')
                }
                placeholderTextColor={theme.colors.placeholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  testID="clear-search-btn"
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('tasks.searchClearA11y')}
                >
                  <Text style={[styles.clearLabelText, { color: theme.colors.textSecondary }]}>
                    ✕
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.searchFilterChipsRow}>
              <TouchableOpacity
                testID="search-scope-all-lists"
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: searchAllLists
                      ? theme.colors.accent
                      : theme.colors.surfaceSecondary,
                  },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  setSearchAllLists((v) => !v);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: searchAllLists }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: searchAllLists ? '#FFFFFF' : theme.colors.textSecondary },
                  ]}
                >
                  {t('tasks.scopeAllLists')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="search-due-overdue"
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      dueFilter === 'overdue'
                        ? theme.colors.danger
                        : theme.colors.surfaceSecondary,
                  },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  setDueFilter((d) => (d === 'overdue' ? 'all' : 'overdue'));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: dueFilter === 'overdue' }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: dueFilter === 'overdue' ? '#FFFFFF' : theme.colors.textSecondary },
                  ]}
                >
                  {t('tasks.filterOverdue')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="search-due-today"
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      dueFilter === 'today'
                        ? theme.colors.accent
                        : theme.colors.surfaceSecondary,
                  },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  setDueFilter((d) => (d === 'today' ? 'all' : 'today'));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: dueFilter === 'today' }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: dueFilter === 'today' ? '#FFFFFF' : theme.colors.textSecondary },
                  ]}
                >
                  {t('tasks.filterToday')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="search-due-no_due"
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      dueFilter === 'no_due'
                        ? theme.colors.accent
                        : theme.colors.surfaceSecondary,
                  },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  setDueFilter((d) => (d === 'no_due' ? 'all' : 'no_due'));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: dueFilter === 'no_due' }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: dueFilter === 'no_due' ? '#FFFFFF' : theme.colors.textSecondary },
                  ]}
                >
                  {t('tasks.filterNoDate')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="search-priority-high"
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      minPriority >= 3
                        ? theme.colors.accent
                        : theme.colors.surfaceSecondary,
                  },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  setMinPriority((p) => (p >= 3 ? 0 : 3));
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: minPriority >= 3 }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    { color: minPriority >= 3 ? '#FFFFFF' : theme.colors.textSecondary },
                  ]}
                >
                  {t('tasks.filterHighPlus')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Filter Selector Pills & Sort Button */}
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
                        : theme.colors.surfaceSecondary,
                  },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  setFilter(filter === f && (f === 'done' || f === 'all') ? 'active' : f);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f }}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    {
                      color: filter === f ? '#FFFFFF' : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {f === 'active'
                    ? t('tasks.tabActive')
                    : f === 'done'
                    ? t('tasks.tabDone')
                    : t('tasks.tabAll')}
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
                    ? hexToRgba(theme.colors.accent, 0.16)
                    : theme.colors.surfaceSecondary,
                borderColor:
                  sortBy !== 'default' ? theme.colors.accent : theme.colors.borderStrong,
              },
            ]}
            onPress={() => {
              closeAllModals();
              setShowSortModal(true);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('sort.buttonA11y')}
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
              ⇅ {sortBy === 'default' ? t('sort.button') : getSortLabel(sortBy)}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Active Filter Label Chip */}
        {selectedLabel &&
          (() => {
            const matchingDef = (storeLabels || []).find(
              (l) => l.title.toLowerCase() === selectedLabel.toLowerCase()
            );
            const badgeStyle = getLabelBadgeStyles(
              selectedLabel,
              matchingDef?.hex_color,
              theme.isDark
            );
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
                    accessibilityRole="button"
                    accessibilityLabel={t('tasks.clearLabelFilterA11y', { label: selectedLabel })}
                  >
                    <Text style={[styles.clearLabelText, { color: badgeStyle.textColor }]}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

        {/* No-List Warning Banner */}
        {noProjectWarning && (
          <View
            testID="no-project-warning-banner"
            style={[
              styles.warningBanner,
              {
                backgroundColor: hexToRgba(theme.colors.danger, 0.12),
                borderColor: theme.colors.danger,
              },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[styles.warningBannerText, { color: theme.colors.danger }]}>
              {noProjectWarning}
            </Text>
            <TouchableOpacity
              testID="create-first-list-btn"
              style={[styles.warningActionBtn, { backgroundColor: theme.colors.accent }]}
              onPress={() => {
                setNoProjectWarning(null);
                closeAllModals();
                setEditorProjectId(null);
                setShowEditor(true);
              }}
            >
              <Text style={styles.warningActionBtnText}>{t('tasks.createListBtn')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Reorder Notice (for virtual views) */}
        {reorderNotice && (
          <View
            testID="reorder-notice-banner"
            style={[
              styles.reorderBanner,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.reorderBannerText, { color: theme.colors.textSecondary }]}>
              {reorderNotice}
            </Text>
          </View>
        )}

        {/* Reorder Mode Banner */}
        {isReordering && !isVirtualView && (
          <View
            style={[
              styles.reorderBanner,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.accent,
              },
            ]}
          >
            <Text style={[styles.reorderBannerText, { color: theme.colors.text }]}>
              {selectedLabel
                ? t('tasks.dragToReorderFiltered', { label: selectedLabel })
                : t('tasks.dragToReorder')}
            </Text>
            <View style={styles.reorderBannerActions}>
              {selectedLabel && (
                <TouchableOpacity
                  testID="reorder-clear-filter-btn"
                  style={[
                    styles.reorderSecondaryBtn,
                    {
                      backgroundColor: theme.colors.surfaceSecondary,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                  onPress={() => setSelectedLabel(null)}
                >
                  <Text style={[styles.reorderSecondaryBtnText, { color: theme.colors.text }]}>
                    {t('tasks.showAll')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                testID="reorder-done-btn"
                style={[styles.reorderDoneBtn, { backgroundColor: theme.colors.accent }]}
                onPress={() => {
                  safeHaptics.selection();
                  setIsReordering(false);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.reorderDoneBtnText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Tasks List */}
        <View style={styles.listContainer}>
          <DraggableFlatList
            data={visibleTasks}
            keyExtractor={(item) => item.id.toString()}
            containerStyle={styles.draggableContainer}
            style={styles.taskList}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onDragBegin={() => {
              safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
            }}
            onDragEnd={({ data }) => {
              if (isVirtualView) return;
              safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
              applySafeProjectReorder(
                activeProject.id,
                data.map((t) => t.id)
              );
              if (sortBy !== 'manual') {
                setSortBy('manual');
              }
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={theme.colors.accent}
              />
            }
            renderItem={({ item, getIndex, drag, isActive }: RenderItemParams<Task>) => {
              const index = getIndex ? getIndex() : 0;
              const isAiGrouped = sortBy === 'aiSmart' || sortBy === 'department';
              const currentCategory = isAiGrouped
                ? classifyTaskWithAI(item, activeProject?.title)
                : null;
              const prevCategory =
                index !== undefined && index > 0 && isAiGrouped && visibleTasks[index - 1]
                  ? classifyTaskWithAI(visibleTasks[index - 1], activeProject?.title)
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
                        {localizeCategoryName(currentCategory, locale).toUpperCase()}
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
                      onMove={handleOpenMoveModal}
                      onDelete={handleStageDeleteTask}
                      onPress={handleOpenTaskDetails}
                      onLongPress={() => {
                        safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                        if (isVirtualView) {
                          showTemporaryNotice(t('tasks.openSpecificListToReorder'));
                          return;
                        }
                        const hasPositions = visibleTasks.some(
                          (t) => t.position !== undefined && t.position > 0
                        );
                        if (!hasPositions && visibleTasks.length > 0) {
                          applySafeProjectReorder(
                            activeProject.id,
                            visibleTasks.map((t) => t.id)
                          );
                        }
                        setIsReordering(true);
                        if (sortBy !== 'manual') {
                          setSortBy('manual');
                        }
                        drag();
                      }}
                      drag={isVirtualView ? undefined : drag}
                      isDragging={isActive}
                      isReordering={isReordering && !isVirtualView}
                      onMoveUp={() => handleMoveTaskPosition(item.id, 'up')}
                      onMoveDown={() => handleMoveTaskPosition(item.id, 'down')}
                      canMoveUp={index !== undefined && index > 0}
                      canMoveDown={index !== undefined && index < visibleTasks.length - 1}
                      onSelectLabel={handleSelectLabelFilter}
                      onEditLabels={handleOpenEditLabels}
                    />
                  </ScaleDecorator>
                </View>
              );
            }}
            contentContainerStyle={
              visibleTasks.length === 0 ? styles.emptyContainer : styles.listContent
            }
            ListEmptyComponent={
              <View style={styles.emptyView}>
                <Text style={[styles.emptyTitle, { color: theme.colors.textSecondary }]}>
                  {selectedLabel
                    ? t('tasks.emptyMatchingLabel', { label: selectedLabel })
                    : filter === 'done'
                    ? t('tasks.emptyCompleted')
                    : t('tasks.emptyOpen')}
                </Text>
              </View>
            }
          />
        </View>

        {/* Duplicated Task Quick-Open Toast Banner */}
        {liveDuplicatedTask && !livePendingDeleteTask && (
          <View
            testID="duplicated-task-banner"
            style={[
              styles.undoBanner,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.borderStrong,
              },
            ]}
            accessibilityRole="alert"
          >
            <Text
              style={[styles.undoBannerText, { color: theme.colors.text }]}
              numberOfLines={1}
            >
              {t('tasks.duplicatedToast', { title: liveDuplicatedTask.title })}
            </Text>
            <View style={styles.undoBannerActions}>
              <TouchableOpacity
                testID="open-duplicated-task-btn"
                style={[styles.undoBtn, { backgroundColor: theme.colors.accent }]}
                onPress={() => {
                  const target = liveDuplicatedTask;
                  if (duplicatedTimerRef.current) {
                    clearTimeout(duplicatedTimerRef.current);
                    duplicatedTimerRef.current = null;
                  }
                  setDuplicatedTaskRef(null);
                  closeAllModals();
                  setSelectedTaskRef({
                    id: target.id,
                    title: target.title,
                    project_id: target.project_id,
                    done: Boolean(target.done),
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={t('tasks.openDuplicatedA11y')}
              >
                <Text style={styles.undoBtnText}>{t('common.open')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.undoDismissBtn}
                onPress={() => {
                  if (duplicatedTimerRef.current) {
                    clearTimeout(duplicatedTimerRef.current);
                    duplicatedTimerRef.current = null;
                  }
                  setDuplicatedTaskRef(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('tasks.dismissDuplicatedA11y')}
              >
                <Text style={[styles.undoDismissText, { color: theme.colors.textSecondary }]}>
                  ✕
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Undo Task Delete Toast Banner */}
        {livePendingDeleteTask && (
          <View
            testID="undo-delete-banner"
            style={[
              styles.undoBanner,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.borderStrong,
              },
            ]}
            accessibilityRole="alert"
          >
            <Text
              style={[styles.undoBannerText, { color: theme.colors.text }]}
              numberOfLines={1}
            >
              {t('tasks.deletedToast', { title: livePendingDeleteTask.title })}
            </Text>
            <View style={styles.undoBannerActions}>
              <TouchableOpacity
                testID="undo-delete-btn"
                style={[styles.undoBtn, { backgroundColor: theme.colors.accent }]}
                onPress={handleUndoDelete}
                accessibilityRole="button"
                accessibilityLabel={t('tasks.undoDeleteA11y')}
              >
                <Text style={styles.undoBtnText}>{t('common.undo')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="undo-commit-btn"
                style={styles.undoDismissBtn}
                onPress={flushPendingDelete}
                accessibilityRole="button"
                accessibilityLabel={t('tasks.dismissUndoA11y')}
              >
                <Text style={[styles.undoDismissText, { color: theme.colors.textSecondary }]}>
                  ✕
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Permanent Bottom Dock: Quick Add Bar + Detailed Add (+) Button */}
        <View
          testID="bottom-dock-container"
          style={[
            styles.bottomDock,
            {
              backgroundColor: theme.colors.cardBackground,
              borderTopColor: theme.colors.cardBorder,
            },
          ]}
        >
          <QuickAddBar
            activeProjectId={defaultTargetProjectId}
            availableProjects={safeProjects}
            availableUsers={isLocalMode ? [] : cachedUsers}
            hideAssignees={isLocalMode}
            doneTasks={doneTasks}
            historyTasks={projectTasks}
            availableLabels={availableLabels}
            reenableStaples={reenableStaples}
            onAddTask={(taskInput) => {
              const targetPid =
                taskInput.project_id && taskInput.project_id > 0
                  ? taskInput.project_id
                  : defaultTargetProjectId;
              if (!targetPid || targetPid <= 0) {
                safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
                setNoProjectWarning(t('tasks.createListFirstWarning'));
                return;
              }
              setNoProjectWarning(null);
              const assignees =
                isMyTasksView &&
                currentUser &&
                (!taskInput.assignees || taskInput.assignees.length === 0)
                  ? [currentUser]
                  : taskInput.assignees;
              return addTask({
                ...taskInput,
                project_id: targetPid,
                assignees,
              });
            }}
            onReenableTask={(taskId) => reenableTask(taskId)}
            placeholder={t('quickAdd.placeholderToProject', { title: activeProject.title })}
            onDetailedAdd={() => {
              safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
              if (defaultTargetProjectId <= 0 && safeProjects.length === 0) {
                setNoProjectWarning(t('tasks.createListFirstWarning'));
                closeAllModals();
                setEditorProjectId(null);
                setShowEditor(true);
                return;
              }
              setNoProjectWarning(null);
              closeAllModals();
              setShowCreateTaskModal(true);
            }}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Move Task Modal */}
      <MoveListModal
        visible={liveMovingTask !== null}
        currentProjectId={liveMovingTask?.project_id ?? activeProject?.id}
        projects={safeProjects}
        onSelectProject={(targetProjectId) => {
          if (liveMovingTask !== null) {
            moveTask(liveMovingTask.id, targetProjectId);
            setMovingTaskRef(null);
          }
        }}
        onClose={() => setMovingTaskRef(null)}
      />

      {/* Quick Label / Store Editor Modal */}
      <QuickLabelModal
        visible={liveEditingLabelsTask !== null}
        task={liveEditingLabelsTask}
        availableLabels={availableLabels}
        labelDefinitions={storeLabels}
        onSave={(taskId, labels) => {
          updateTaskLabels(taskId, labels);
          setEditingLabelsRef(null);
        }}
        onClose={() => setEditingLabelsRef(null)}
        onOpenManageLabels={() => {
          closeAllModals();
          setShowLabelManagementModal(true);
        }}
      />

      {/* Rich Task Detail / Editor Modal */}
      <TaskDetailModal
        visible={liveSelectedTask !== null || showCreateTaskModal}
        task={liveSelectedTask}
        availableLabels={availableLabels}
        labelDefinitions={storeLabels}
        availableUsers={cachedUsers}
        availableProjects={safeProjects}
        defaultProjectId={defaultTargetProjectId}
        weekStartDay={weekStartDay}
        hideAssignees={isLocalMode}
        onClose={() => {
          setSelectedTaskRef(null);
          setShowCreateTaskModal(false);
        }}
        onSave={(taskId, updates) => {
          updateTaskDetails(taskId, updates);
        }}
        onDelete={(taskId) => {
          deleteTask(taskId);
        }}
        onAddSubtask={(parentId, subTitle) => addSubtask?.(parentId, subTitle)}
        onToggleSubtask={(subId) => toggleTask(subId)}
        onDeleteSubtask={(parentId, subId) => {
          unlinkSubtask?.(parentId, subId);
          deleteTask(subId);
        }}
        onSelectSubtask={(sub) => {
          const live = (Array.isArray(tasks) ? tasks : []).find((t) => t.id === sub.id) || sub;
          setSelectedTaskRef({
            id: live.id,
            title: live.title,
            project_id: live.project_id,
            done: Boolean(live.done),
          });
        }}
        onDuplicateTask={(taskId) => {
          const copy = duplicateTask?.(taskId);
          if (copy) {
            if (duplicatedTimerRef.current) {
              clearTimeout(duplicatedTimerRef.current);
            }
            setDuplicatedTaskRef({
              id: copy.id,
              title: copy.title,
              project_id: copy.project_id,
              done: Boolean(copy.done),
            });
            duplicatedTimerRef.current = setTimeout(() => {
              duplicatedTimerRef.current = null;
              setDuplicatedTaskRef(null);
            }, 5000);
          }
        }}
        onCreateTask={(newTaskData, initialSubtaskTitles) => {
          const resolvedProjectId =
            newTaskData.project_id && newTaskData.project_id > 0
              ? newTaskData.project_id
              : defaultTargetProjectId;

          if (!resolvedProjectId || resolvedProjectId <= 0) {
            setNoProjectWarning(t('tasks.createListFirstWarning'));
            return;
          }

          setNoProjectWarning(null);
          const assignees =
            isMyTasksView &&
            currentUser &&
            (!newTaskData.assignees || newTaskData.assignees.length === 0)
              ? [currentUser]
              : newTaskData.assignees;

          // Forward ALL fields (including hex_color & done_at) directly to addTask (which schedules notifications once)
          const resolvedHexColor = newTaskData.hex_color ?? newTaskData.color;
          const fullCreateInput: CreateTaskInput = {
            title: newTaskData.title || '',
            description: newTaskData.description,
            done: newTaskData.done,
            done_at: newTaskData.done_at,
            priority: newTaskData.priority,
            percent_done: newTaskData.percent_done,
            color: newTaskData.color ?? resolvedHexColor,
            hex_color: resolvedHexColor,
            repeat_after: newTaskData.repeat_after,
            repeat_mode: newTaskData.repeat_mode,
            due_date: newTaskData.due_date,
            start_date: newTaskData.start_date,
            end_date: newTaskData.end_date,
            reminders: newTaskData.reminders,
            labels: newTaskData.labels,
            assignees,
            project_id: resolvedProjectId,
          };

          const created = addTask(fullCreateInput);
          if (created && Array.isArray(initialSubtaskTitles)) {
            for (const st of initialSubtaskTitles) {
              if (st.trim()) {
                addSubtask?.(created.id, st.trim());
              }
            }
          }
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
              <Text style={[styles.sortModalTitle, { color: theme.colors.text }]}>
                {t('sort.title')}
              </Text>
              <TouchableOpacity
                onPress={() => setShowSortModal(false)}
                style={styles.sortCloseBtn}
                accessibilityRole="button"
                accessibilityLabel={t('sort.closeA11y')}
              >
                <Text style={[styles.sortCloseText, { color: theme.colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {(
              [
                'default',
                'manual',
                ...(hasAICore ? (['aiSmart'] as SortOption[]) : []),
                ...(isShopping && !hasAICore ? (['department'] as SortOption[]) : []),
                'name',
                'label',
                'dueDate',
                'priority',
              ] as SortOption[]
            ).map((option) => {
              const isSelected = sortBy === option;
              return (
                <TouchableOpacity
                  key={option}
                  testID={`sort-option-${option}`}
                  style={[
                    styles.sortOptionItem,
                    isSelected && {
                      backgroundColor: theme.colors.surfaceSecondary,
                    },
                  ]}
                  onPress={() => {
                    safeHaptics.selection();
                    if (option === 'manual' && !isVirtualView) {
                      const hasPositions = visibleTasks.some(
                        (t) => t.position !== undefined && t.position > 0
                      );
                      if (!hasPositions && visibleTasks.length > 0) {
                        applySafeProjectReorder(
                          activeProject.id,
                          visibleTasks.map((t) => t.id)
                        );
                      }
                    }
                    setSortBy(option);
                    setShowSortModal(false);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
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
                    {getSortLabel(option)}
                  </Text>
                  {isSelected ? (
                    <Text style={[styles.sortOptionCheckmark, { color: theme.colors.accent }]}>
                      ✓
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}

            {!isVirtualView && (
              <TouchableOpacity
                testID="sort-option-reorder"
                style={[
                  styles.sortOptionItem,
                  { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 8 },
                ]}
                onPress={() => {
                  safeHaptics.selection();
                  const hasPositions = visibleTasks.some(
                    (t) => t.position !== undefined && t.position > 0
                  );
                  if (!hasPositions && visibleTasks.length > 0) {
                    applySafeProjectReorder(
                      activeProject.id,
                      visibleTasks.map((t) => t.id)
                    );
                  }
                  setSortBy('manual');
                  setIsReordering(true);
                  setShowSortModal(false);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    { color: theme.colors.accent, fontWeight: '700' },
                  ]}
                >
                  {t('sort.reorderManually')}
                </Text>
              </TouchableOpacity>
            )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* Project Editor Modal */}
      <ProjectEditorModal
        visible={showEditor}
        project={editorProject}
        allProjects={allPositiveProjects}
        onClose={() => {
          setShowEditor(false);
          setEditorProjectId(null);
        }}
      />

      {/* Project Sharing Modal */}
      <ProjectSharingModal
        visible={Boolean(sharingProject)}
        project={sharingProject}
        onClose={() => setSharingProjectId(null)}
      />

      {/* Unified List Options Action Sheet */}
      {actionSheetProject && (
        <Modal
          visible={Boolean(actionSheetProject)}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setConfirmingProjectDelete(false);
            setActionSheetProjectId(null);
          }}
        >
          <TouchableWithoutFeedback
            onPress={() => {
              setConfirmingProjectDelete(false);
              setActionSheetProjectId(null);
            }}
          >
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
                  <Text
                    style={[
                      styles.actionSheetTitle,
                      {
                        color: theme.colors.text,
                        borderBottomColor: theme.colors.border,
                      },
                    ]}
                  >
                    {actionSheetProject.title}
                  </Text>

                  {confirmingProjectDelete ? (
                    <View style={styles.inlineConfirmContainer}>
                      <Text style={[styles.inlineConfirmText, { color: theme.colors.text }]}>
                        {t('drawer.deleteListInlineConfirm', { title: actionSheetProject.title })}
                      </Text>
                      <View style={styles.inlineConfirmActions}>
                        <TouchableOpacity
                          testID="project-confirm-cancel-btn"
                          style={[
                            styles.inlineConfirmBtn,
                            {
                              backgroundColor: theme.colors.secondaryButtonBg,
                              borderColor: theme.colors.borderStrong,
                              borderWidth: 1,
                            },
                          ]}
                          onPress={() => setConfirmingProjectDelete(false)}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.inlineConfirmBtnText, { color: theme.colors.text }]}>
                            {t('common.cancel')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          testID="project-confirm-delete-btn"
                          style={[
                            styles.inlineConfirmBtn,
                            { backgroundColor: theme.colors.danger },
                          ]}
                          onPress={() => commitDeleteProject(actionSheetProject.id)}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.inlineConfirmBtnText, { color: '#FFFFFF' }]}>
                            {t('common.delete')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        testID="project-option-edit"
                        style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                        onPress={() => {
                          const pid = actionSheetProject.id;
                          closeAllModals();
                          setEditorProjectId(pid);
                          setShowEditor(true);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                          {t('drawer.editList')}
                        </Text>
                      </TouchableOpacity>

                      {!isLocalMode && (
                        <TouchableOpacity
                          testID="project-option-share"
                          style={[
                            styles.actionSheetOption,
                            { borderBottomColor: theme.colors.border },
                          ]}
                          onPress={() => {
                            const pid = actionSheetProject.id;
                            closeAllModals();
                            setSharingProjectId(pid);
                          }}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                            {t('drawer.shareList')}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        testID="project-option-favorite"
                        style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                        onPress={() => {
                          toggleProjectFavorite(actionSheetProject.id).catch(() => {});
                          setActionSheetProjectId(null);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                          {actionSheetProject.is_favorite
                            ? t('drawer.removeFavorite')
                            : t('drawer.addFavorite')}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        testID="project-option-archive"
                        style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                        onPress={() => {
                          archiveProject(
                            actionSheetProject.id,
                            !actionSheetProject.is_archived
                          ).catch(() => {});
                          setActionSheetProjectId(null);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                          {actionSheetProject.is_archived
                            ? t('drawer.unarchiveList')
                            : t('drawer.archiveList')}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        testID="project-option-delete"
                        style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                        onPress={() => handleRequestDeleteProject(actionSheetProject)}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.actionSheetOptionText, { color: theme.colors.danger }]}>
                          {t('drawer.deleteList')}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.actionSheetCancel}
                        onPress={() => setActionSheetProjectId(null)}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.actionSheetCancelText, { color: theme.colors.textSecondary }]}>
                          {t('common.cancel')}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
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
  },
  drawerBtn: {
    padding: 6,
    marginRight: 8,
  },
  drawerIcon: {
    fontSize: 20,
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
  },
  taskCountSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  syncIndicatorPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  syncIndicatorText: {
    fontSize: 10.5,
    fontWeight: '700',
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
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sortBtn: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  sortBtnText: {
    fontSize: 11,
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
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  activeLabelText: {
    fontSize: 12,
    fontWeight: '700',
  },
  clearLabelBtn: {
    padding: 2,
  },
  clearLabelText: {
    fontSize: 11,
    fontWeight: '800',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  warningBannerText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  warningActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  warningActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  listContainer: {
    flex: 1,
  },
  draggableContainer: {
    flex: 1,
  },
  taskList: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: 4,
    paddingBottom: 20,
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
  emptyTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  undoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  undoBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  undoBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  undoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  undoBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  undoDismissBtn: {
    padding: 4,
  },
  undoDismissText: {
    fontSize: 14,
    fontWeight: '700',
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    borderWidth: 1,
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
  },
  sortCloseBtn: {
    padding: 6,
  },
  sortCloseText: {
    fontSize: 16,
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
  sortOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  sortOptionCheckmark: {
    fontSize: 16,
    fontWeight: '800',
  },
  bottomDock: {
    borderTopWidth: 1,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 6 : 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 4,
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
    gap: 8,
  },
  reorderBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  reorderBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reorderSecondaryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  reorderSecondaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reorderDoneBtn: {
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
  headerSearchBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSearchIcon: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 19,
  },
  searchPanel: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  searchFilterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
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
  inlineConfirmContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  inlineConfirmText: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  inlineConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  inlineConfirmBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  inlineConfirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
