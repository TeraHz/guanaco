import { create } from 'zustand';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppBadgeMode,
  CreateProjectInput,
  CreateTaskInput,
  Label,
  LanguagePreference,
  Project,
  Task,
  ThemeMode,
  UpdateProjectInput,
  UpdateTaskInput,
  User,
  WeekStartDay,
} from '../types/vikunja';
import { VikunjaApiError, VikunjaClient } from '../api/client';
import { SyncQueue, SyncStatus, SYNC_QUEUE_STORAGE_KEY } from './syncQueue';
import { safeHaptics } from '../utils/haptics';
import { MY_TASKS_PROJECT_ID } from '../utils/taskFilters';
import { setActiveThemeMode } from '../utils/theme';
import {
  getStoredAuth,
  setStoredAuth,
  setStoredRefreshToken,
  isPersonalApiToken,
  STORAGE_KEY_USERNAME,
  STORAGE_KEY_SAVED_USERNAME,
  LEGACY_STORAGE_KEY_PASSWORD,
} from '../utils/biometrics';
import {
  initNotifications,
  scheduleTaskReminders,
  cancelTaskReminders,
  clearAllNotifications,
  syncAllTaskReminders,
  syncAppBadgeCount,
} from '../services/localNotifications';
import { clearAICoreCache } from '../utils/aiCore';
import { normalizeHexColor } from '../utils/colors';
import { normalizeVikunjaDate } from '../utils/dates';
import { buildProjectTree, flattenProjectTree, wouldCreateProjectCycle } from '../utils/projectTree';
import { computeNextRecurringTaskState, isTaskRecurring } from '../utils/repeat';
import {
  mergeBackupIntoLocalState,
  parseAndValidateBackup,
  serializeLocalBackup,
} from '../utils/localBackup';
import {
  clearMigrationCheckpoint,
  DeferredMigrationFollowUp,
  DeferredMigrationRelation,
  DeferredMigrationTask,
  isUntouchedEmptyStarterProject,
  MIGRATION_CHECKPOINT_STORAGE_KEY,
} from '../services/localMigration';
import {
  CACHE_KEY_LANGUAGE,
  isValidLanguagePreference,
  setActiveLanguagePreference,
  t,
} from '../i18n';

export const CACHE_KEY_LOCAL_MODE = '@vikunja_local_mode';
const CACHE_KEY_PROJECTS = '@vikunja_cached_projects';
const CACHE_KEY_TASKS = '@vikunja_cached_tasks';
const CACHE_KEY_LABELS = '@vikunja_cached_labels';
const CACHE_KEY_USERS = '@vikunja_cached_users';
const CACHE_KEY_CURRENT_USER = '@vikunja_current_user';
const CACHE_KEY_LEGACY_CURRENT_USER = '@vikunja_cached_current_user';
const CACHE_KEY_SAVED_USERNAME = STORAGE_KEY_SAVED_USERNAME;
const CACHE_KEY_REENABLE_STAPLES = '@vikunja_reenable_staples';
const CACHE_KEY_LARGE_TASK_ITEMS = '@vikunja_large_task_items';
const CACHE_KEY_TASK_ITEM_SCALE = '@vikunja_task_item_scale';
const CACHE_KEY_TASK_ITEM_TEXT_SCALE = '@vikunja_task_item_text_scale';
const CACHE_KEY_LAST_PROJECT = '@vikunja_last_project_id';
const CACHE_KEY_THEME_MODE = '@vikunja_theme_mode';
const CACHE_KEY_WEEK_START_DAY = '@vikunja_week_start_day';
const CACHE_KEY_APP_BADGE_MODE = '@vikunja_app_badge_mode';
const CACHE_KEY_SAVED_FILTER_TASKS = '@vikunja_saved_filter_tasks';

/** Remapped local ID when a Vikunja server Saved Filter has pseudo-ID -1 (so MY_TASKS_PROJECT_ID = -1 stays distinct). */
export const SAVED_FILTER_MINUS_ONE_ID = -1000001;

function normalizeServerProjectEntry(proj: Project): Project {
  if (!proj || typeof proj.id !== 'number') return proj;
  if (proj.id < 0) {
    if (proj.is_saved_filter && proj.server_project_id !== undefined) {
      return proj;
    }
    const serverId = proj.server_project_id ?? proj.id;
    const localId = serverId === MY_TASKS_PROJECT_ID ? SAVED_FILTER_MINUS_ONE_ID : serverId;
    return {
      ...proj,
      id: localId,
      server_project_id: serverId,
      is_saved_filter: true,
    };
  }
  return proj;
}

/**
 * Keeps embedded `related_tasks.subtask` and `related_tasks.parenttask` entries synchronized
 * with live top-level tasks (status, title, remapped tempId -> positive server ID, and deletions).
 */
function synchronizeRelatedTaskSnapshots(
  tasks: Task[],
  remappedPair?: { oldId: number; newId: number },
  deletedTaskId?: number
): Task[] {
  const byId = new Map<number, Task>();
  for (const t of tasks) {
    byId.set(t.id, t);
  }

  let anyChanged = false;
  const result = tasks.map((task) => {
    if (!task.related_tasks) return task;
    let taskRelChanged = false;
    const nextRel = { ...task.related_tasks };

    for (const key of ['subtask', 'parenttask'] as const) {
      const list = nextRel[key];
      if (!Array.isArray(list)) continue;
      const updatedList: Task[] = [];
      let listChanged = false;

      for (const item of list) {
        if (!item) continue;
        const resolvedId =
          remappedPair && item.id === remappedPair.oldId ? remappedPair.newId : item.id;
        if (deletedTaskId !== undefined && resolvedId === deletedTaskId) {
          listChanged = true;
          continue;
        }
        const live = byId.get(resolvedId);
        if (live) {
          if (
            item.id !== live.id ||
            item.title !== live.title ||
            item.done !== live.done ||
            item.priority !== live.priority
          ) {
            listChanged = true;
            updatedList.push({
              ...item,
              id: live.id,
              title: live.title,
              done: live.done,
              done_at: live.done_at,
              priority: live.priority,
            });
          } else {
            updatedList.push(item);
          }
        } else if (resolvedId !== item.id) {
          listChanged = true;
          updatedList.push({ ...item, id: resolvedId });
        } else {
          updatedList.push(item);
        }
      }

      if (listChanged) {
        nextRel[key] = updatedList;
        taskRelChanged = true;
      }
    }

    if (taskRelChanged) {
      anyChanged = true;
      return { ...task, related_tasks: nextRel };
    }
    return task;
  });

  return anyChanged ? result : tasks;
}

let sessionEpoch = 0;
let sessionAbortController: AbortController | null = null;
let persistTasksTimer: ReturnType<typeof setTimeout> | null = null;
let persistProjectsTimer: ReturnType<typeof setTimeout> | null = null;
let reorderSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastGeneratedNegId = 0;
const pendingReorderBaseline = new Map<number, number | undefined>();

function nextUniqueNegativeId(existingIds?: Iterable<number>): number {
  let candidate = -Math.floor(Date.now() + Math.random() * 1000);
  if (lastGeneratedNegId < 0 && candidate >= lastGeneratedNegId) {
    candidate = lastGeneratedNegId - 1;
  }
  if (existingIds) {
    const used = new Set<number>(existingIds);
    while (used.has(candidate) || candidate >= 0) {
      candidate -= 1;
    }
  }
  lastGeneratedNegId = candidate;
  return candidate;
}

const persistTasksDebounced = (tasks: Task[], immediate = false, expectedEpoch = sessionEpoch) => {
  if (persistTasksTimer) {
    clearTimeout(persistTasksTimer);
    persistTasksTimer = null;
  }
  if (expectedEpoch !== sessionEpoch) return;

  if (immediate) {
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(tasks)).catch(() => {});
  } else {
    persistTasksTimer = setTimeout(() => {
      persistTasksTimer = null;
      if (expectedEpoch === sessionEpoch) {
        AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(tasks)).catch(() => {});
      }
    }, 250);
  }
};

const persistProjectsDebounced = (
  projects: Project[],
  immediate = false,
  expectedEpoch = sessionEpoch
) => {
  if (persistProjectsTimer) {
    clearTimeout(persistProjectsTimer);
    persistProjectsTimer = null;
  }
  if (expectedEpoch !== sessionEpoch) return;

  if (immediate) {
    AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(projects)).catch(() => {});
  } else {
    persistProjectsTimer = setTimeout(() => {
      persistProjectsTimer = null;
      if (expectedEpoch === sessionEpoch) {
        AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(projects)).catch(() => {});
      }
    }, 250);
  }
};

function buildServerLabelsColorMap(labels: Label[]): Map<string, string> {
  const map = new Map<string, string>();
  (labels || []).forEach((l) => {
    const c = l.hex_color || l.color;
    if (c) {
      map.set(l.title.toLowerCase(), c);
      if (l.id > 0) {
        map.set(`id:${l.id}`, c);
      }
    }
  });
  return map;
}

function enrichLabelsWithColors(labels: Label[] | undefined | null, colorMap: Map<string, string>): Label[] {
  const base = Array.isArray(labels) ? labels : [];
  return base.map((l) => {
    const canonicalColor =
      (l.id > 0 ? colorMap.get(`id:${l.id}`) : undefined) ||
      colorMap.get(l.title.toLowerCase()) ||
      l.hex_color ||
      l.color;
    return {
      ...l,
      hex_color: canonicalColor,
      color: canonicalColor,
    };
  });
}

function resolvePosition(
  remoteTask: Task,
  localTask: Task | undefined,
  syncQueue: SyncQueue | null
): number | undefined {
  const hasPendingPositionChange =
    typeof syncQueue?.hasPendingForTask === 'function' &&
    (syncQueue.hasPendingForTask(remoteTask.id, 'REORDER_TASK') ||
      syncQueue.hasPendingForTask(remoteTask.id, 'UPDATE_TASK'));

  if (
    hasPendingPositionChange &&
    localTask &&
    localTask.position !== undefined &&
    localTask.position !== null
  ) {
    return localTask.position;
  }

  if (typeof remoteTask.position === 'number' && remoteTask.position > 0) {
    return remoteTask.position;
  }

  if (localTask && typeof localTask.position === 'number' && localTask.position >= 0) {
    return localTask.position;
  }

  return remoteTask.position !== undefined && remoteTask.position !== null
    ? remoteTask.position
    : localTask?.position;
}

/**
 * Merges an authoritative remote task with any pending local mutations in `syncQueue`
 * so inbound fetches NEVER clobber unsynced deletes, toggles, edits, moves, labels, assignees, or positions.
 * Returns `null` if the task has a pending `DELETE_TASK`.
 */
function reconcileRemoteTaskWithPendingQueue(
  remoteTask: Task,
  localTask: Task | undefined,
  syncQueue: SyncQueue | null,
  colorMap: Map<string, string>
): Task | null {
  const hasPending = (type?: Parameters<SyncQueue['hasPendingForTask']>[1]) =>
    typeof syncQueue?.hasPendingForTask === 'function'
      ? syncQueue.hasPendingForTask(remoteTask.id, type)
      : false;

  if (hasPending('DELETE_TASK')) {
    return null;
  }

  const pendingUpdate = hasPending('UPDATE_TASK');
  const pendingToggle = hasPending('TOGGLE_TASK');
  const pendingMove = hasPending('MOVE_TASK');
  const pendingLabels = hasPending('SET_TASK_LABELS');
  const pendingAssignees = hasPending('SET_TASK_ASSIGNEES');

  let merged: Task = { ...remoteTask };

  if (pendingUpdate && localTask) {
    merged = {
      ...merged,
      title: localTask.title,
      description: localTask.description,
      done: localTask.done,
      done_at: localTask.done_at,
      due_date: localTask.due_date,
      start_date: localTask.start_date,
      end_date: localTask.end_date,
      priority: localTask.priority,
      project_id: localTask.project_id,
      repeat_after: localTask.repeat_after,
      repeat_mode: localTask.repeat_mode,
      reminders: localTask.reminders,
      percent_done: localTask.percent_done,
      color: localTask.color,
      hex_color: localTask.hex_color ?? localTask.color,
    };
  }

  if (pendingToggle && localTask) {
    merged.done = localTask.done;
    merged.done_at = localTask.done_at;
  }

  if (pendingMove && localTask) {
    merged.project_id = localTask.project_id;
  }

  const resolvedPos = resolvePosition(remoteTask, localTask, syncQueue);
  if (resolvedPos !== undefined) {
    merged.position = resolvedPos;
  }

  if ((pendingLabels || (hasPending() && localTask && hasPending('CREATE_TASK'))) && localTask) {
    merged.labels = enrichLabelsWithColors(localTask.labels, colorMap);
  } else {
    merged.labels = enrichLabelsWithColors(remoteTask.labels, colorMap);
  }

  if (pendingAssignees && localTask) {
    merged.assignees = localTask.assignees || [];
  }

  // Preserve optimistic subtask/parenttask relations while relation mutations are still queued
  if (
    localTask?.related_tasks &&
    (hasPending('CREATE_TASK_RELATION') || hasPending('DELETE_TASK_RELATION'))
  ) {
    merged.related_tasks = localTask.related_tasks;
  }

  return merged;
}

export interface TaskState {
  client: VikunjaClient | null;
  syncQueue: SyncQueue | null;
  isLocalMode: boolean;
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  cachedUsers: User[];
  currentUser: User | null;
  selectedProjectId: number | null;
  isLoading: boolean;
  error: string | null;

  // Offline & Sync
  syncStatus: SyncStatus;
  pendingSyncCount: number;
  isSyncingAll?: boolean;
  authRequired?: boolean;

  reenableStaples: boolean;
  largeTaskItems: boolean;
  taskItemScale: number; // Percentage: 100, 125, 150, 175, 200 (default: 100)
  taskItemTextScale: number; // Percentage: 100, 125, 150, 175, 200 (default: 100)
  themeMode: ThemeMode;
  languagePreference: LanguagePreference;
  weekStartDay: WeekStartDay;
  appBadgeMode: AppBadgeMode;
  savedFilterTaskIds: Record<number, number[]>;
  localDataVersion: number;
  pendingOpenTaskId: number | null;

  // Actions
  initialize: (baseUrl: string, token?: string, refreshToken?: string | null) => Promise<void>;
  initializeLocalMode: (options?: { seedDefaultsIfEmpty?: boolean }) => Promise<void>;
  seedMigratedServerState: (data: {
    projects: Project[];
    labels: Label[];
    tasks: Task[];
    selectedProjectId: number | null;
  }) => Promise<void>;
  enqueueDeferredMigrationItems: (
    deferredTasks: DeferredMigrationTask[],
    deferredRelations: DeferredMigrationRelation[],
    deferredFollowUps?: DeferredMigrationFollowUp[]
  ) => void;
  exportBackupJson: () => string;
  importLocalBackup: (
    rawJson: string,
    mode?: 'merge' | 'replace'
  ) => Promise<{ importedProjects: number; importedTasks: number; importedLabels: number }>;
  loadCachedData: (options?: { localMode?: boolean }) => Promise<void>;
  setReenableStaples: (enabled: boolean) => Promise<void>;
  setLargeTaskItems: (enabled: boolean) => Promise<void>;
  setTaskItemScale: (scale: number) => Promise<void>;
  setTaskItemTextScale: (scale: number) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setLanguagePreference: (pref: LanguagePreference) => Promise<void>;
  setWeekStartDay: (day: WeekStartDay) => Promise<void>;
  setAppBadgeMode: (mode: AppBadgeMode) => Promise<void>;
  setPendingOpenTaskId: (taskId: number | null) => void;
  retrySync: () => Promise<void>;
  setSelectedProjectId: (id: number | null) => void;
  fetchProjects: () => Promise<void>;
  fetchLabels: () => Promise<Label[]>;
  fetchCurrentUser: () => Promise<User | null>;
  fetchUsers: (query?: string) => Promise<User[]>;
  setCachedUsers: (users: User[]) => void;
  fetchTasks: (projectId: number) => Promise<void>;
  fetchSavedFilterTasks: (filterProjectId: number) => Promise<void>;
  fetchAllTasks: () => Promise<void>;
  syncAll: () => Promise<void>;
  resetAndSyncFromServer: () => Promise<void>;
  clearSession: () => Promise<void>;
  toggleTask: (taskId: number) => void;
  reenableTask: (taskId: number, newLabels?: Label[]) => void;
  updateTaskLabels: (taskId: number, labels: Label[]) => void;
  updateTaskAssignees: (taskId: number, assignees: User[]) => void;
  createGlobalLabel: (title: string, hex_color?: string) => Promise<Label>;
  updateGlobalLabel: (labelId: number, title: string, hex_color?: string) => Promise<void>;
  deleteGlobalLabel: (labelId: number) => Promise<void>;
  addTask: (input: CreateTaskInput) => Task;
  addSubtask: (parentTaskId: number, title: string) => Task | null;
  unlinkSubtask: (parentTaskId: number, subtaskId: number) => void;
  duplicateTask: (taskId: number) => Task | null;
  updateTaskDetails: (taskId: number, updates: UpdateTaskInput) => void;
  moveTask: (taskId: number, targetProjectId: number) => void;
  reorderTasks: (projectId: number, orderedTaskIds: number[], immediateSync?: boolean) => void;
  deleteTask: (taskId: number) => void;

  // Project Management Actions
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (projectId: number, input: UpdateProjectInput) => Promise<Project>;
  deleteProject: (projectId: number) => Promise<void>;
  archiveProject: (projectId: number, isArchived: boolean) => Promise<Project>;
  duplicateProject: (projectId: number) => Promise<Project>;
  toggleProjectFavorite: (projectId: number) => Promise<Project>;
}

export const useTaskStore = create<TaskState>((set, get) => {
  const reconcileLocalLabels = (
    incomingLabels: Label[] | undefined,
    existingStoreLabels: Label[]
  ): { taskLabels: Label[]; storeLabels: Label[]; storeChanged: boolean } => {
    const safeStore = Array.isArray(existingStoreLabels) ? [...existingStoreLabels] : [];
    if (!Array.isArray(incomingLabels) || incomingLabels.length === 0) {
      return { taskLabels: [], storeLabels: safeStore, storeChanged: false };
    }
    const byLower = new Map<string, Label>();
    const usedIds = new Set<number>();
    for (const sl of safeStore) {
      if (!sl || !sl.title) continue;
      usedIds.add(sl.id);
      byLower.set(sl.title.trim().toLowerCase(), sl);
    }

    let storeChanged = false;
    const seenTaskLower = new Set<string>();
    const canonicalTaskLabels: Label[] = [];

    for (const raw of incomingLabels) {
      if (!raw || typeof raw.title !== 'string') continue;
      const cleanTitle = raw.title.trim();
      if (!cleanTitle) continue;
      const lower = cleanTitle.toLowerCase();
      if (seenTaskLower.has(lower)) continue;
      seenTaskLower.add(lower);

      const rawHex = normalizeHexColor(raw.hex_color || raw.color, true) || undefined;
      let match = byLower.get(lower);
      if (!match) {
        const newId = nextUniqueNegativeId(usedIds);
        usedIds.add(newId);
        match = {
          id: newId,
          title: cleanTitle,
          ...(rawHex ? { hex_color: rawHex, color: rawHex } : {}),
        };
        safeStore.push(match);
        byLower.set(lower, match);
        storeChanged = true;
      } else if (!match.hex_color && rawHex) {
        match = { ...match, hex_color: rawHex, color: rawHex };
        const idx = safeStore.findIndex((s) => s.id === match!.id);
        if (idx >= 0) safeStore[idx] = match;
        byLower.set(lower, match);
        storeChanged = true;
      }
      canonicalTaskLabels.push({ ...match });
    }

    return { taskLabels: canonicalTaskLabels, storeLabels: safeStore, storeChanged };
  };

  const resetCompletedSubtasksForRecurringParent = (
    allTasks: Task[],
    parentTask: Task,
    nowIso: string
  ): { tasks: Task[]; resetSubtaskIds: number[] } => {
    const subRefs = parentTask.related_tasks?.subtask;
    if (!Array.isArray(subRefs) || subRefs.length === 0) {
      return { tasks: allTasks, resetSubtaskIds: [] };
    }
    const subIdSet = new Set<number>(
      subRefs.map((s) => s?.id).filter((id): id is number => typeof id === 'number')
    );
    if (subIdSet.size === 0) {
      return { tasks: allTasks, resetSubtaskIds: [] };
    }
    const resetSubtaskIds: number[] = [];
    const nextTasks = allTasks.map((item) => {
      if (item.id !== parentTask.id && subIdSet.has(item.id) && item.done && !isTaskRecurring(item)) {
        resetSubtaskIds.push(item.id);
        return {
          ...item,
          done: false,
          done_at: null,
          percent_done: 0,
          updated: nowIso,
        };
      }
      return item;
    });
    return { tasks: nextTasks, resetSubtaskIds };
  };

  const applyResolvedCreatedTask = (
    tempId: number,
    remoteTask: Task,
    expectedEpoch = sessionEpoch
  ) => {
    if (expectedEpoch !== sessionEpoch || !remoteTask) return;

    const currentQueue = get().syncQueue;
    const colorMap = buildServerLabelsColorMap(get().labels || []);

    set((state) => {
      const existingTemp = (state.tasks || []).find((t) => t.id === tempId);
      const isDeletedOrPendingDelete =
        !existingTemp ||
        (typeof currentQueue?.hasPendingForTask === 'function' &&
          remoteTask.id > 0 &&
          currentQueue.hasPendingForTask(remoteTask.id, 'DELETE_TASK'));

      if (isDeletedOrPendingDelete) {
        if (tempId < 0) {
          cancelTaskReminders(tempId).catch(() => {});
        }
        if (remoteTask.id > 0) {
          cancelTaskReminders(remoteTask.id).catch(() => {});
        }
        const cleanedTasks = (state.tasks || []).filter(
          (t) => t.id !== tempId && t.id !== remoteTask.id
        );
        persistTasksDebounced(cleanedTasks, false, expectedEpoch);
        return { tasks: cleanedTasks };
      }

      const hasFurtherPending =
        typeof currentQueue?.hasPendingForTask === 'function' &&
        remoteTask.id > 0 &&
        currentQueue.hasPendingForTask(remoteTask.id);

      const hasPendingLabelEdit =
        typeof currentQueue?.hasPendingForTask === 'function' &&
        remoteTask.id > 0 &&
        currentQueue.hasPendingForTask(remoteTask.id, 'SET_TASK_LABELS');
      const hasPendingAssigneeEdit =
        typeof currentQueue?.hasPendingForTask === 'function' &&
        remoteTask.id > 0 &&
        currentQueue.hasPendingForTask(remoteTask.id, 'SET_TASK_ASSIGNEES');

      const resolvedLabels = enrichLabelsWithColors(
        hasPendingLabelEdit && existingTemp
          ? existingTemp.labels || []
          : remoteTask.labels && remoteTask.labels.length > 0
          ? remoteTask.labels
          : existingTemp?.labels || [],
        colorMap
      );
      const resolvedAssignees =
        hasPendingAssigneeEdit && existingTemp
          ? existingTemp.assignees || []
          : remoteTask.assignees && remoteTask.assignees.length > 0
          ? remoteTask.assignees
          : existingTemp?.assignees || [];

      const filterValidFallbackReminders = (
        fallbackReminders: Task['reminders'],
        primarySource: Partial<Task>,
        secondarySource?: Partial<Task>
      ): Task['reminders'] => {
        if (!Array.isArray(fallbackReminders)) return fallbackReminders;
        return fallbackReminders.filter((r) => {
          if (
            r?.relative_to === 'due_date' ||
            r?.relative_to === 'start_date' ||
            r?.relative_to === 'end_date'
          ) {
            const anchor =
              (primarySource as any)?.[r.relative_to] !== undefined
                ? (primarySource as any)[r.relative_to]
                : (secondarySource as any)?.[r.relative_to];
            return Boolean(normalizeVikunjaDate(anchor));
          }
          return true;
        });
      };

      const hasPendingUpdate =
        typeof currentQueue?.hasPendingForTask === 'function' &&
        remoteTask.id > 0 &&
        currentQueue.hasPendingForTask(remoteTask.id, 'UPDATE_TASK');

      const resolvedReminders =
        hasPendingUpdate && existingTemp
          ? filterValidFallbackReminders(existingTemp.reminders, existingTemp, remoteTask)
          : Array.isArray(remoteTask.reminders) && remoteTask.reminders.length > 0
          ? remoteTask.reminders
          : filterValidFallbackReminders(existingTemp?.reminders, remoteTask, existingTemp);

      const mergedTask: Task =
        hasFurtherPending && existingTemp
          ? {
              ...remoteTask,
              ...existingTemp,
              id: remoteTask.id,
              created: remoteTask.created ?? existingTemp.created,
              reminders: resolvedReminders,
              labels: resolvedLabels,
              assignees: resolvedAssignees,
            }
          : {
              ...existingTemp,
              ...remoteTask,
              id: remoteTask.id,
              position:
                typeof remoteTask.position === 'number' && remoteTask.position > 0
                  ? remoteTask.position
                  : existingTemp?.position ?? remoteTask.position,
              reminders: resolvedReminders,
              labels: resolvedLabels,
              assignees: resolvedAssignees,
            };

      // Replace tempId in-place so list ordering never jumps, and update related_tasks references
      const rawFinalTasks: Task[] = [];
      for (const t of state.tasks || []) {
        if (t.id === tempId) {
          rawFinalTasks.push({
            ...mergedTask,
            related_tasks: existingTemp?.related_tasks ?? mergedTask.related_tasks,
          });
        } else if (t.id !== remoteTask.id) {
          rawFinalTasks.push(t);
        }
      }
      const finalTasks = synchronizeRelatedTaskSnapshots(rawFinalTasks, {
        oldId: tempId,
        newId: remoteTask.id,
      });

      // Also merge any newly resolved positive-ID labels into store.labels
      let nextLabels = state.labels || [];
      const positiveResolved = resolvedLabels.filter((l) => l.id > 0);
      if (positiveResolved.length > 0) {
        const labelById = new Map(nextLabels.map((l) => [l.id, l]));
        positiveResolved.forEach((l) => labelById.set(l.id, l));
        nextLabels = Array.from(labelById.values());
      }

      persistTasksDebounced(finalTasks, false, expectedEpoch);

      if (tempId < 0 && remoteTask.id > 0) {
        cancelTaskReminders(tempId).catch(() => {});
        if (!mergedTask.done && mergedTask.reminders && mergedTask.reminders.length > 0) {
          scheduleTaskReminders(mergedTask).catch(() => {});
        }
      }

      return { tasks: finalTasks, labels: nextLabels };
    });
  };

  return {
    client: null,
    syncQueue: null,
    isLocalMode: false,
    projects: [],
    tasks: [],
    labels: [],
    cachedUsers: [],
    currentUser: null,
    selectedProjectId: null,
    isLoading: false,
    error: null,
    syncStatus: 'synced',
    pendingSyncCount: 0,
    isSyncingAll: false,
    authRequired: false,
    reenableStaples: true,
    largeTaskItems: false,
    taskItemScale: 100,
    taskItemTextScale: 100,
    themeMode: 'system',
    languagePreference: 'system',
    weekStartDay: 1,
    appBadgeMode: 'off',
    savedFilterTaskIds: {},
    localDataVersion: 0,
    pendingOpenTaskId: null,

    initialize: async (baseUrl: string, token?: string, refreshToken?: string | null) => {
      // Capture any pending debounced task/project cache snapshots synchronously and advance sessionEpoch
      // BEFORE the first `await` so overlapping initializations never race on disk or state!
      let flushTasksSnapshot: Task[] | null = null;
      let flushProjectsSnapshot: Project[] | null = null;
      if (get().client !== null || get().isLocalMode) {
        if (persistTasksTimer) {
          clearTimeout(persistTasksTimer);
          persistTasksTimer = null;
          flushTasksSnapshot = [...(get().tasks || [])];
        }
        if (persistProjectsTimer) {
          clearTimeout(persistProjectsTimer);
          persistProjectsTimer = null;
          flushProjectsSnapshot = [...(get().projects || [])];
        }
      }

      sessionEpoch += 1;
      const epoch = sessionEpoch;

      if (sessionAbortController) {
        sessionAbortController.abort();
      }
      const controller = new AbortController();
      sessionAbortController = controller;

      if (flushTasksSnapshot) {
        await AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(flushTasksSnapshot)).catch(
          () => {}
        );
        if (epoch !== sessionEpoch) return;
      }
      if (flushProjectsSnapshot) {
        await AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(flushProjectsSnapshot)).catch(
          () => {}
        );
        if (epoch !== sessionEpoch) return;
      }

      await AsyncStorage.removeItem(CACHE_KEY_LOCAL_MODE).catch(() => {});
      if (epoch !== sessionEpoch) return;

      let lastRefreshTransient = false;

      const client = new VikunjaClient({
        baseUrl,
        token,
        refreshToken: refreshToken ?? null,
        sessionSignal: controller.signal,
      });
      const syncQueue = new SyncQueue(client);

      syncQueue.onStatusChange((syncStatus, pendingSyncCount) => {
        if (epoch !== sessionEpoch) return;
        set({
          syncStatus,
          pendingSyncCount,
          ...(syncStatus === 'auth_required' ? { authRequired: true } : {}),
        });
      });

      // Persistent callbacks so temp-ID -> server-ID, recurring server rollovers, and resolved label/user/relation IDs survive cold restarts
      syncQueue.onTaskCreated = (tempId, remoteTask) => {
        applyResolvedCreatedTask(tempId, remoteTask, epoch);
      };

      syncQueue.onTaskUpdated = (taskId, remoteTask) => {
        if (epoch !== sessionEpoch || !remoteTask) return;
        const currentQueue = get().syncQueue;
        if (
          typeof currentQueue?.hasPendingForTask === 'function' &&
          currentQueue.hasPendingForTask(taskId)
        ) {
          return;
        }
        let targetForSchedule: Task | null = null;
        let allUpdatedTasks: Task[] | null = null;

        set((state) => {
          const existing = (state.tasks || []).find((t) => t.id === taskId);
          if (!existing) return {};

          const colorMap = buildServerLabelsColorMap(state.labels || []);
          const scalarRemote: Partial<Task> = {};
          const relationalKeys = new Set([
            'labels',
            'assignees',
            'related_tasks',
            'reminders',
            'position',
          ]);
          for (const [k, v] of Object.entries(remoteTask)) {
            if (v !== undefined && !relationalKeys.has(k)) {
              (scalarRemote as any)[k] = v;
            }
          }

          // Note: Vikunja's POST /tasks/:id returns JSON `null` for non-eager-loaded slices (`labels: null`,
          // `assignees: null`, `related_tasks: null`, `reminders: null`), so preserve `existing` unless
          // `remoteTask` actually provides populated arrays/objects!
          const nextTask: Task = {
            ...existing,
            ...scalarRemote,
            id: existing.id,
            title: remoteTask.title || existing.title,
            project_id:
              typeof remoteTask.project_id === 'number' && remoteTask.project_id > 0
                ? remoteTask.project_id
                : existing.project_id,
            position: resolvePosition(remoteTask, existing, currentQueue),
            reminders:
              Array.isArray(remoteTask.reminders) && remoteTask.reminders.length > 0
                ? remoteTask.reminders
                : Array.isArray(existing.reminders)
                ? existing.reminders.filter((r) => {
                    if (
                      r?.relative_to === 'due_date' ||
                      r?.relative_to === 'start_date' ||
                      r?.relative_to === 'end_date'
                    ) {
                      const anchor =
                        (scalarRemote as any)[r.relative_to] !== undefined
                          ? (scalarRemote as any)[r.relative_to]
                          : (existing as any)[r.relative_to];
                      return Boolean(normalizeVikunjaDate(anchor));
                    }
                    return true;
                  })
                : existing.reminders,
            labels:
              Array.isArray(remoteTask.labels) && remoteTask.labels.length > 0
                ? enrichLabelsWithColors(remoteTask.labels, colorMap)
                : existing.labels,
            assignees:
              Array.isArray(remoteTask.assignees) && remoteTask.assignees.length > 0
                ? remoteTask.assignees
                : existing.assignees,
            related_tasks:
              remoteTask.related_tasks && Object.keys(remoteTask.related_tasks).length > 0
                ? remoteTask.related_tasks
                : existing.related_tasks,
          };

          targetForSchedule = nextTask;
          const updatedTasks = synchronizeRelatedTaskSnapshots(
            (state.tasks || []).map((t) => (t.id === taskId ? nextTask : t))
          );
          allUpdatedTasks = updatedTasks;
          persistTasksDebounced(updatedTasks, false, epoch);
          return { tasks: updatedTasks };
        });

        if (targetForSchedule) {
          const tSnap = targetForSchedule as Task;
          if (tSnap.done) {
            cancelTaskReminders(tSnap.id).catch(() => {});
          } else if (tSnap.reminders && tSnap.reminders.length > 0) {
            scheduleTaskReminders(tSnap).catch(() => {});
          } else {
            cancelTaskReminders(tSnap.id).catch(() => {});
          }
        }
        if (allUpdatedTasks) {
          syncAppBadgeCount(allUpdatedTasks, get().appBadgeMode).catch(() => {});
        }
      };

      syncQueue.onTaskRelationSynced = (taskId, otherTaskId, relationKind) => {
        if (epoch !== sessionEpoch || relationKind !== 'subtask') return;
        set((state) => {
          const safe = state.tasks || [];
          const parent = safe.find((t) => t.id === taskId);
          const child = safe.find((t) => t.id === otherTaskId);
          if (!parent || !child) return {};

          const nextTasks = synchronizeRelatedTaskSnapshots(
            safe.map((t) => {
              if (t.id === taskId) {
                const subs = t.related_tasks?.subtask || [];
                if (subs.some((s) => s.id === otherTaskId)) return t;
                return {
                  ...t,
                  related_tasks: {
                    ...(t.related_tasks || {}),
                    subtask: [
                      ...subs,
                      {
                        id: child.id,
                        title: child.title,
                        done: child.done,
                        done_at: child.done_at,
                        priority: child.priority,
                        project_id: child.project_id,
                      },
                    ],
                  },
                };
              }
              if (t.id === otherTaskId) {
                const pars = t.related_tasks?.parenttask || [];
                if (pars.some((p) => p.id === taskId)) return t;
                return {
                  ...t,
                  related_tasks: {
                    ...(t.related_tasks || {}),
                    parenttask: [
                      ...pars,
                      {
                        id: parent.id,
                        title: parent.title,
                        done: parent.done,
                        done_at: parent.done_at,
                        priority: parent.priority,
                        project_id: parent.project_id,
                      },
                    ],
                  },
                };
              }
              return t;
            })
          );
          persistTasksDebounced(nextTasks, false, epoch);
          return { tasks: nextTasks };
        });
      };

      syncQueue.onTaskLabelsSynced = (taskId, resolvedLabels) => {
        if (epoch !== sessionEpoch) return;
        set((state) => {
          const colorMap = buildServerLabelsColorMap([
            ...(state.labels || []),
            ...(resolvedLabels || []),
          ]);
          const enriched = enrichLabelsWithColors(resolvedLabels, colorMap);

          const updatedTasks = (state.tasks || []).map((t) =>
            t.id === taskId ? { ...t, labels: enriched } : t
          );

          const labelById = new Map((state.labels || []).map((l) => [l.id, l]));
          enriched.filter((l) => l.id > 0).forEach((l) => labelById.set(l.id, l));
          const updatedLabels = Array.from(labelById.values());

          persistTasksDebounced(updatedTasks, false, epoch);
          AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(updatedLabels)).catch(() => {});

          return { tasks: updatedTasks, labels: updatedLabels };
        });
      };

      syncQueue.onTaskAssigneesSynced = (taskId, resolvedAssignees) => {
        if (epoch !== sessionEpoch) return;
        set((state) => {
          const updatedTasks = (state.tasks || []).map((t) =>
            t.id === taskId ? { ...t, assignees: resolvedAssignees } : t
          );

          const userMap = new Map(
            (state.cachedUsers || []).map((u) => [u.username.toLowerCase(), u])
          );
          (resolvedAssignees || [])
            .filter((u) => u && u.id > 0)
            .forEach((u) => userMap.set(u.username.toLowerCase(), u));
          const updatedUsers = Array.from(userMap.values());

          persistTasksDebounced(updatedTasks, false, epoch);
          AsyncStorage.setItem(CACHE_KEY_USERS, JSON.stringify(updatedUsers)).catch(() => {});

          return { tasks: updatedTasks, cachedUsers: updatedUsers };
        });
      };

      // Immediately persist rotated `vikunja_refresh_token` to SecureStore BEFORE resolving refreshPromise
      client.onRefreshTokenUpdated = async (nextRefreshToken) => {
        if (epoch !== sessionEpoch) return;
        await setStoredRefreshToken(nextRefreshToken);
      };

      client.onTokenRefresh = async () => {
        lastRefreshTransient = false;
        const activeToken = client.getToken();
        if (!activeToken || isPersonalApiToken(activeToken)) {
          return null;
        }

        try {
          const auth = await client.renewToken();
          if (epoch !== sessionEpoch) return null;

          if (auth?.token) {
            const stored = await getStoredAuth();
            if (epoch !== sessionEpoch) return null;
            const usernameToKeep = stored.username || get().currentUser?.username || undefined;
            await setStoredAuth(auth.token, stored.serverUrl || baseUrl, usernameToKeep, {
              refreshToken: client.getRefreshToken(),
            });
            client.setToken(auth.token);
            set({ authRequired: false });
            return auth.token;
          }
        } catch (err: any) {
          const status = err?.status || err?.response?.status;
          const isDefinitiveAuthFailure =
            err instanceof VikunjaApiError && (status === 401 || status === 403 || status === 400);
          if (!isDefinitiveAuthFailure) {
            lastRefreshTransient = true;
          }
        }
        return null;
      };

      client.onTransientRefreshFailure = () => {
        if (epoch !== sessionEpoch) return;
        lastRefreshTransient = false;
        set({
          authRequired: false,
          syncStatus: 'offline',
          error: t('store.connectionLostRenewing'),
        });
      };

      client.onUnauthorized = () => {
        if (epoch !== sessionEpoch) return;

        // NEVER wipe syncQueue or cached tasks/projects on transient errors OR 401!
        if (lastRefreshTransient) {
          lastRefreshTransient = false;
          set({
            authRequired: false,
            syncStatus: 'offline',
            error: t('store.connectionLostRenewing'),
          });
          return;
        }

        syncQueue.pauseForAuth();
        set({
          syncStatus: 'auth_required',
          authRequired: true,
          error: t('store.sessionExpiredPleaseSignIn'),
        });
      };

      set({ isLocalMode: false, authRequired: false, error: null });

      if (refreshToken === undefined && token && !isPersonalApiToken(token)) {
        const stored = await getStoredAuth().catch(() => null);
        if (epoch !== sessionEpoch) return;
        if (stored?.refreshToken && !client.getRefreshToken()) {
          client.setRefreshToken(stored.refreshToken);
        }
      }

      await syncQueue.loadFromStorage();
      if (epoch !== sessionEpoch) return;

      await get().loadCachedData();
      if (epoch !== sessionEpoch) return;

      set({
        client,
        syncQueue,
        isLocalMode: false,
        authRequired: false,
        pendingSyncCount: syncQueue.getQueue().length,
      });
    },

    initializeLocalMode: async (options?: { seedDefaultsIfEmpty?: boolean }) => {
      let flushTasksSnapshot: Task[] | null = null;
      let flushProjectsSnapshot: Project[] | null = null;
      if (get().client !== null || get().isLocalMode) {
        if (persistTasksTimer) {
          clearTimeout(persistTasksTimer);
          persistTasksTimer = null;
          flushTasksSnapshot = [...(get().tasks || [])];
        }
        if (persistProjectsTimer) {
          clearTimeout(persistProjectsTimer);
          persistProjectsTimer = null;
          flushProjectsSnapshot = [...(get().projects || [])];
        }
      }

      sessionEpoch += 1;
      const epoch = sessionEpoch;

      if (sessionAbortController) {
        sessionAbortController.abort();
        sessionAbortController = null;
      }

      if (flushTasksSnapshot) {
        await AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(flushTasksSnapshot)).catch(
          () => {}
        );
        if (epoch !== sessionEpoch) return;
      }
      if (flushProjectsSnapshot) {
        await AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(flushProjectsSnapshot)).catch(
          () => {}
        );
        if (epoch !== sessionEpoch) return;
      }

      const existingProjectsRaw = await AsyncStorage.getItem(CACHE_KEY_PROJECTS).catch(() => null);
      if (epoch !== sessionEpoch) return;

      await AsyncStorage.setItem(CACHE_KEY_LOCAL_MODE, 'true').catch(() => {});
      if (epoch !== sessionEpoch) return;

      set({
        client: null,
        syncQueue: null,
        isLocalMode: false,
        currentUser: null,
        cachedUsers: [],
        savedFilterTaskIds: {},
        authRequired: false,
        syncStatus: 'synced',
        pendingSyncCount: 0,
        isSyncingAll: false,
        isLoading: false,
        error: null,
      });

      await get().loadCachedData({ localMode: true });
      if (epoch !== sessionEpoch) return;

      // Expose isLocalMode: true ONLY after loadCachedData({ localMode: true }) has hydrated tasks/projects
      set({ isLocalMode: true });

      const shouldSeed = options?.seedDefaultsIfEmpty !== false;
      if (shouldSeed && existingProjectsRaw === null && (get().projects || []).length === 0) {
        const nowIso = new Date().toISOString();
        const starterProjects: Project[] = [
          {
            id: 1,
            title: t('local.starterTasksList'),
            hex_color: '#0A84FF',
            is_archived: false,
            is_favorite: false,
            position: 1000,
            created: nowIso,
            updated: nowIso,
          },
          {
            id: 2,
            title: t('local.starterGroceriesList'),
            hex_color: '#30D158',
            is_archived: false,
            is_favorite: false,
            position: 2000,
            created: nowIso,
            updated: nowIso,
          },
        ];
        set({ projects: starterProjects, selectedProjectId: 1 });
        await Promise.all([
          AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(starterProjects)).catch(() => {}),
          AsyncStorage.setItem(CACHE_KEY_LAST_PROJECT, '1').catch(() => {}),
        ]);
      } else {
        const curSel = get().selectedProjectId;
        const curProjs = get().projects || [];
        if (curSel !== null && !curProjs.some((p) => p.id > 0 && p.id === curSel)) {
          const fallbackId =
            curProjs.find((p) => p.id > 0 && !p.is_archived)?.id ??
            curProjs.find((p) => p.id > 0)?.id ??
            null;
          set({ selectedProjectId: fallbackId });
        }
      }

      if (epoch !== sessionEpoch) return;
      syncAllTaskReminders(get().tasks || []).catch(() => {});
      syncAppBadgeCount(get().tasks || [], get().appBadgeMode).catch(() => {});
    },

    seedMigratedServerState: async (data) => {
      const epoch = sessionEpoch;
      const safeProjects = (Array.isArray(data.projects) ? data.projects : []).map(
        normalizeServerProjectEntry
      );
      const safeLabels = (Array.isArray(data.labels) ? data.labels : []).map((l) => {
        const c = l.hex_color || l.color;
        return { ...l, hex_color: c, color: c };
      });
      const colorMap = buildServerLabelsColorMap(safeLabels);
      const safeTasks = synchronizeRelatedTaskSnapshots(
        (Array.isArray(data.tasks) ? data.tasks : []).map((task) => ({
          ...task,
          labels: enrichLabelsWithColors(task.labels, colorMap),
        }))
      );

      set({
        projects: safeProjects,
        labels: safeLabels,
        tasks: safeTasks,
        ...(data.selectedProjectId !== null ? { selectedProjectId: data.selectedProjectId } : {}),
      });

      await Promise.all([
        AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(safeProjects)).catch(() => {}),
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(safeLabels)).catch(() => {}),
        AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(safeTasks)).catch(() => {}),
      ]);

      if (epoch !== sessionEpoch) return;
      syncAllTaskReminders(safeTasks).catch(() => {});
      syncAppBadgeCount(safeTasks, get().appBadgeMode).catch(() => {});
    },

    enqueueDeferredMigrationItems: (
      deferredTasks: DeferredMigrationTask[],
      deferredRelations: DeferredMigrationRelation[],
      deferredFollowUps: DeferredMigrationFollowUp[] = []
    ) => {
      const { syncQueue, tasks } = get();
      if (!syncQueue) return;

      const nowIso = new Date().toISOString();
      const existingIds = new Set<number>((tasks || []).map((t) => t.id));
      const localToTempId = new Map<number, number>();
      const optimisticAdditions: Task[] = [];

      for (const followUp of deferredFollowUps) {
        if (followUp.type === 'TOGGLE_TASK') {
          syncQueue.enqueue({
            id: `mig-toggle-${followUp.taskId}-${Date.now()}`,
            type: 'TOGGLE_TASK',
            payload: {
              taskId: followUp.taskId,
              done: followUp.done,
              data: followUp.data,
            },
            timestamp: Date.now(),
          });
        } else if (followUp.type === 'SET_TASK_LABELS') {
          syncQueue.enqueue({
            id: `mig-labels-${followUp.taskId}-${Date.now()}`,
            type: 'SET_TASK_LABELS',
            payload: {
              taskId: followUp.taskId,
              labels: followUp.labels,
              previousLabels: [],
            },
            timestamp: Date.now(),
          });
        }
      }

      for (const dt of deferredTasks) {
        const tempId =
          dt.localTaskId < 0 && !existingIds.has(dt.localTaskId)
            ? dt.localTaskId
            : nextUniqueNegativeId(existingIds);
        existingIds.add(tempId);
        localToTempId.set(dt.localTaskId, tempId);

        optimisticAdditions.push({
          id: tempId,
          title: dt.taskData.title,
          description: dt.taskData.description,
          done: Boolean(dt.taskData.done),
          done_at: dt.taskData.done_at ?? (dt.taskData.done ? nowIso : null),
          priority: dt.taskData.priority ?? 0,
          project_id: dt.serverProjectId,
          due_date: dt.taskData.due_date ?? null,
          start_date: dt.taskData.start_date ?? null,
          end_date: dt.taskData.end_date ?? null,
          repeat_after: dt.taskData.repeat_after,
          repeat_mode: dt.taskData.repeat_mode,
          reminders: dt.taskData.reminders ?? null,
          percent_done: dt.taskData.percent_done,
          color: dt.taskData.color,
          hex_color: dt.taskData.hex_color ?? dt.taskData.color,
          labels: dt.labels,
          position: dt.taskData.position,
          created: nowIso,
          updated: nowIso,
        });

        syncQueue.enqueue({
          id: `create-${tempId}`,
          type: 'CREATE_TASK',
          payload: {
            tempId,
            projectId: dt.serverProjectId,
            taskData: dt.taskData,
            labels: dt.labels,
            assignees: [],
          },
          timestamp: Date.now(),
        });
      }

      const resolvedRelPairs: { parentId: number; childId: number }[] = [];
      for (const rel of deferredRelations) {
        const parentId =
          rel.parentServerId ??
          (rel.parentLocalId !== undefined
            ? localToTempId.get(rel.parentLocalId) ?? rel.parentLocalId
            : localToTempId.get(rel.parentLocalOrServerId) ?? rel.parentLocalOrServerId);
        const childId =
          rel.childServerId ??
          (rel.childLocalId !== undefined
            ? localToTempId.get(rel.childLocalId) ?? rel.childLocalId
            : localToTempId.get(rel.childLocalOrServerId) ?? rel.childLocalOrServerId);

        resolvedRelPairs.push({ parentId, childId });

        syncQueue.enqueue({
          id: `rel-subtask-${parentId}-${childId}-${Date.now()}`,
          type: 'CREATE_TASK_RELATION',
          payload: {
            taskId: parentId,
            otherTaskId: childId,
            relationKind: 'subtask',
          },
          timestamp: Date.now(),
        });
      }

      if (optimisticAdditions.length > 0 || resolvedRelPairs.length > 0) {
        const combined = [...(tasks || []), ...optimisticAdditions];
        const byId = new Map<number, Task>(combined.map((t) => [t.id, t]));
        for (const { parentId, childId } of resolvedRelPairs) {
          const pTask = byId.get(parentId);
          const cTask = byId.get(childId);
          if (pTask && cTask) {
            const existingSubs = pTask.related_tasks?.subtask || [];
            if (!existingSubs.some((s) => s.id === childId)) {
              pTask.related_tasks = {
                ...(pTask.related_tasks || {}),
                subtask: [
                  ...existingSubs,
                  {
                    id: cTask.id,
                    title: cTask.title,
                    done: cTask.done,
                    done_at: cTask.done_at,
                    priority: cTask.priority,
                    project_id: cTask.project_id,
                  },
                ],
              };
            }
            const existingPars = cTask.related_tasks?.parenttask || [];
            if (!existingPars.some((p) => p.id === parentId)) {
              cTask.related_tasks = {
                ...(cTask.related_tasks || {}),
                parenttask: [
                  ...existingPars,
                  {
                    id: pTask.id,
                    title: pTask.title,
                    done: pTask.done,
                    done_at: pTask.done_at,
                    priority: pTask.priority,
                    project_id: pTask.project_id,
                  },
                ],
              };
            }
          }
        }
        const merged = synchronizeRelatedTaskSnapshots(combined);
        set({ tasks: merged });
        persistTasksDebounced(merged, true);
      }
      set({ pendingSyncCount: syncQueue.getQueue().length });
    },

    exportBackupJson: (): string => {
      const state = get();
      return serializeLocalBackup({
        projects: state.projects || [],
        tasks: state.tasks || [],
        labels: state.labels || [],
        preferences: {
          reenableStaples: state.reenableStaples,
          taskItemScale: state.taskItemScale,
          taskItemTextScale: state.taskItemTextScale,
          themeMode: state.themeMode,
          languagePreference: state.languagePreference,
          weekStartDay: state.weekStartDay,
          appBadgeMode: state.appBadgeMode,
        },
      });
    },

    importLocalBackup: async (rawJson: string, mode: 'merge' | 'replace' = 'merge') => {
      if (!get().isLocalMode || get().client) {
        throw new Error('Backup import is only available in Local Mode.');
      }
      const epoch = sessionEpoch;
      const validated = parseAndValidateBackup(rawJson);

      await clearMigrationCheckpoint();
      if (epoch !== sessionEpoch) {
        return { importedProjects: 0, importedTasks: 0, importedLabels: 0 };
      }

      if (persistTasksTimer) {
        clearTimeout(persistTasksTimer);
        persistTasksTimer = null;
      }
      if (persistProjectsTimer) {
        clearTimeout(persistProjectsTimer);
        persistProjectsTimer = null;
      }

      let nextProjects: Project[];
      let nextTasks: Task[];
      let nextLabels: Label[];

      if (mode === 'replace') {
        nextProjects = validated.projects;

        // Assign monotonic negative IDs via nextUniqueNegativeId so future addTask / createGlobalLabel never collide
        const usedLabelIds = new Set<number>();
        const labelByLower = new Map<string, Label>();
        nextLabels = validated.labels.map((lbl) => {
          const freshId = nextUniqueNegativeId(usedLabelIds);
          usedLabelIds.add(freshId);
          const freshLbl: Label = { ...lbl, id: freshId };
          labelByLower.set(lbl.title.trim().toLowerCase(), freshLbl);
          return freshLbl;
        });

        const usedTaskIds = new Set<number>();
        const taskIdRemap = new Map<number, number>();
        for (const vt of validated.tasks) {
          const freshTid = nextUniqueNegativeId(usedTaskIds);
          usedTaskIds.add(freshTid);
          taskIdRemap.set(vt.id, freshTid);
        }

        const remappedTasks: Task[] = validated.tasks.map((vt) => {
          const newId = taskIdRemap.get(vt.id)!;
          const nextRel = vt.related_tasks ? { ...vt.related_tasks } : undefined;
          if (nextRel?.subtask) {
            nextRel.subtask = nextRel.subtask
              .filter((s) => taskIdRemap.has(s.id))
              .map((s) => ({ ...s, id: taskIdRemap.get(s.id)! }));
          }
          if (nextRel?.parenttask) {
            nextRel.parenttask = nextRel.parenttask
              .filter((p) => taskIdRemap.has(p.id))
              .map((p) => ({ ...p, id: taskIdRemap.get(p.id)! }));
          }
          return {
            ...vt,
            id: newId,
            labels: (vt.labels || []).map(
              (l) => labelByLower.get(l.title.trim().toLowerCase()) || l
            ),
            ...(nextRel ? { related_tasks: nextRel } : {}),
          };
        });

        nextTasks = synchronizeRelatedTaskSnapshots(remappedTasks);
      } else {
        const merged = mergeBackupIntoLocalState(
          {
            projects: get().projects || [],
            tasks: get().tasks || [],
            labels: get().labels || [],
          },
          validated
        );
        nextProjects = merged.projects;
        nextTasks = synchronizeRelatedTaskSnapshots(merged.tasks);
        nextLabels = merged.labels;
        // Advance lastGeneratedNegId past all merged negative IDs so subsequent creations never collide
        for (const tItem of nextTasks) {
          if (tItem.id < lastGeneratedNegId) lastGeneratedNegId = tItem.id;
        }
        for (const lItem of nextLabels) {
          if (lItem.id < lastGeneratedNegId) lastGeneratedNegId = lItem.id;
        }
      }

      const currentSelected = get().selectedProjectId;
      const hasValidSelected =
        mode !== 'replace' &&
        (currentSelected === null ||
          nextProjects.some((p) => p.id === currentSelected && !p.is_archived));
      const nextSelectedProjectId = hasValidSelected
        ? currentSelected
        : nextProjects.find((p) => p.id > 0 && !p.is_archived)?.id ??
          nextProjects.find((p) => p.id > 0)?.id ??
          null;

      const prefUpdates: Partial<TaskState> = {};
      const prefStorageWrites: Promise<any>[] = [];
      if (mode === 'replace' && validated.preferences) {
        const prefs = validated.preferences;
        if (prefs.reenableStaples !== undefined) {
          prefUpdates.reenableStaples = prefs.reenableStaples;
          prefStorageWrites.push(
            AsyncStorage.setItem(CACHE_KEY_REENABLE_STAPLES, prefs.reenableStaples ? 'true' : 'false')
          );
        }
        if (prefs.taskItemScale !== undefined) {
          prefUpdates.taskItemScale = prefs.taskItemScale;
          prefUpdates.largeTaskItems = prefs.taskItemScale > 100;
          prefStorageWrites.push(
            AsyncStorage.setItem(CACHE_KEY_TASK_ITEM_SCALE, String(prefs.taskItemScale)),
            AsyncStorage.setItem(CACHE_KEY_LARGE_TASK_ITEMS, prefs.taskItemScale > 100 ? 'true' : 'false')
          );
        }
        if (prefs.taskItemTextScale !== undefined) {
          prefUpdates.taskItemTextScale = prefs.taskItemTextScale;
          prefStorageWrites.push(
            AsyncStorage.setItem(CACHE_KEY_TASK_ITEM_TEXT_SCALE, String(prefs.taskItemTextScale))
          );
        }
        if (prefs.themeMode !== undefined) {
          setActiveThemeMode(prefs.themeMode);
          prefUpdates.themeMode = prefs.themeMode;
          prefStorageWrites.push(AsyncStorage.setItem(CACHE_KEY_THEME_MODE, prefs.themeMode));
        }
        if (prefs.languagePreference !== undefined) {
          setActiveLanguagePreference(prefs.languagePreference);
          prefUpdates.languagePreference = prefs.languagePreference;
          prefStorageWrites.push(
            AsyncStorage.setItem(CACHE_KEY_LANGUAGE, prefs.languagePreference)
          );
        }
        if (prefs.weekStartDay !== undefined) {
          prefUpdates.weekStartDay = prefs.weekStartDay;
          prefStorageWrites.push(
            AsyncStorage.setItem(CACHE_KEY_WEEK_START_DAY, String(prefs.weekStartDay))
          );
        }
        if (prefs.appBadgeMode !== undefined) {
          prefUpdates.appBadgeMode = prefs.appBadgeMode;
          prefStorageWrites.push(
            AsyncStorage.setItem(CACHE_KEY_APP_BADGE_MODE, prefs.appBadgeMode)
          );
        }
      }

      set({
        projects: nextProjects,
        tasks: nextTasks,
        labels: nextLabels,
        selectedProjectId: nextSelectedProjectId,
        localDataVersion: (get().localDataVersion || 0) + 1,
        ...prefUpdates,
      });

      await Promise.all([
        AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(nextProjects)).catch(() => {}),
        AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(nextTasks)).catch(() => {}),
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(nextLabels)).catch(() => {}),
        nextSelectedProjectId !== null && nextSelectedProjectId > 0
          ? AsyncStorage.setItem(CACHE_KEY_LAST_PROJECT, String(nextSelectedProjectId)).catch(
              () => {}
            )
          : AsyncStorage.removeItem(CACHE_KEY_LAST_PROJECT).catch(() => {}),
        ...prefStorageWrites.map((p) => p.catch(() => {})),
      ]);

      if (epoch !== sessionEpoch) {
        return { importedProjects: 0, importedTasks: 0, importedLabels: 0 };
      }

      if (mode === 'replace' && validated.preferences?.languagePreference !== undefined) {
        await initNotifications().catch(() => {});
      }
      await syncAllTaskReminders(nextTasks).catch(() => {});
      await syncAppBadgeCount(nextTasks, get().appBadgeMode).catch(() => {});

      return {
        importedProjects: validated.projects.length,
        importedTasks: validated.tasks.length,
        importedLabels: validated.labels.length,
      };
    },

    loadCachedData: async (options?: { localMode?: boolean }) => {
      const epoch = sessionEpoch;
      try {
        const [
          cachedProjectsRaw,
          cachedTasksRaw,
          cachedLabelsRaw,
          cachedUsersRaw,
          cachedCurrentUserRaw,
          savedUsernameRaw,
          reenableSettingRaw,
          largeItemsRaw,
          taskItemScaleRaw,
          taskItemTextScaleRaw,
          lastProjectRaw,
          themeModeRaw,
          languageRaw,
          weekStartRaw,
          appBadgeModeRaw,
          savedFilterTasksRaw,
        ] = await Promise.all([
          AsyncStorage.getItem(CACHE_KEY_PROJECTS),
          AsyncStorage.getItem(CACHE_KEY_TASKS),
          AsyncStorage.getItem(CACHE_KEY_LABELS),
          AsyncStorage.getItem(CACHE_KEY_USERS),
          AsyncStorage.getItem(CACHE_KEY_CURRENT_USER),
          AsyncStorage.getItem(CACHE_KEY_SAVED_USERNAME),
          AsyncStorage.getItem(CACHE_KEY_REENABLE_STAPLES),
          AsyncStorage.getItem(CACHE_KEY_LARGE_TASK_ITEMS),
          AsyncStorage.getItem(CACHE_KEY_TASK_ITEM_SCALE),
          AsyncStorage.getItem(CACHE_KEY_TASK_ITEM_TEXT_SCALE),
          AsyncStorage.getItem(CACHE_KEY_LAST_PROJECT),
          AsyncStorage.getItem(CACHE_KEY_THEME_MODE),
          AsyncStorage.getItem(CACHE_KEY_LANGUAGE),
          AsyncStorage.getItem(CACHE_KEY_WEEK_START_DAY),
          AsyncStorage.getItem(CACHE_KEY_APP_BADGE_MODE),
          AsyncStorage.getItem(CACHE_KEY_SAVED_FILTER_TASKS),
        ]);

        if (epoch !== sessionEpoch) return;

        const localModeActive = Boolean(
          options?.localMode || (get().isLocalMode && !get().client)
        );
        const updates: Partial<TaskState> = {};

        if (cachedProjectsRaw) {
          const rawCachedProjects = JSON.parse(cachedProjectsRaw);
          if (Array.isArray(rawCachedProjects)) {
            const cachedProjects = localModeActive
              ? rawCachedProjects.filter(
                  (p: Project) => p && typeof p.id === 'number' && p.id > 0 && !p.is_saved_filter
                )
              : rawCachedProjects;
            if (cachedProjects.length > 0) {
              updates.projects = cachedProjects;
              const firstActive =
                cachedProjects.find((p: Project) => !p.is_archived) || cachedProjects[0];
              updates.selectedProjectId = firstActive.id;
            } else if (localModeActive) {
              updates.projects = [];
            }
          }
        }

        if (lastProjectRaw) {
          const parsedId = Number(lastProjectRaw);
          if (!isNaN(parsedId)) {
            if (localModeActive) {
              const validProjs = updates.projects || [];
              if (parsedId > 0 && validProjs.some((p) => p.id === parsedId)) {
                updates.selectedProjectId = parsedId;
              }
            } else {
              updates.selectedProjectId = parsedId;
            }
          }
        }

        if (cachedTasksRaw) {
          const cachedTasks = JSON.parse(cachedTasksRaw);
          if (Array.isArray(cachedTasks)) {
            updates.tasks = cachedTasks;
            for (const ct of cachedTasks) {
              if (ct && typeof ct.id === 'number' && ct.id < lastGeneratedNegId) {
                lastGeneratedNegId = ct.id;
              }
            }
          }
        }

        if (cachedLabelsRaw) {
          const cachedLabels = JSON.parse(cachedLabelsRaw);
          if (Array.isArray(cachedLabels)) {
            updates.labels = cachedLabels;
            for (const cl of cachedLabels) {
              if (cl && typeof cl.id === 'number' && cl.id < lastGeneratedNegId) {
                lastGeneratedNegId = cl.id;
              }
            }
          }
        }

        if (localModeActive) {
          updates.cachedUsers = [];
          updates.currentUser = null;
          updates.savedFilterTaskIds = {};
        } else {
          if (cachedUsersRaw) {
            const cachedUsers = JSON.parse(cachedUsersRaw);
            if (Array.isArray(cachedUsers)) {
              updates.cachedUsers = cachedUsers;
            }
          }

          if (cachedCurrentUserRaw) {
            try {
              const parsed = JSON.parse(cachedCurrentUserRaw);
              if (parsed && parsed.username) {
                updates.currentUser = parsed;
              }
            } catch (_) {}
          } else if (savedUsernameRaw) {
            updates.currentUser = { id: 0, username: savedUsernameRaw } as User;
          }
        }

        if (reenableSettingRaw !== null) {
          updates.reenableStaples = reenableSettingRaw === 'true';
        }

        if (largeItemsRaw !== null) {
          updates.largeTaskItems = largeItemsRaw === 'true';
        }

        if (taskItemScaleRaw !== null) {
          const parsed = parseInt(taskItemScaleRaw, 10);
          if (!isNaN(parsed) && parsed >= 100 && parsed <= 200) {
            updates.taskItemScale = parsed;
            updates.largeTaskItems = parsed > 100;
          }
        } else if (largeItemsRaw !== null) {
          const isLarge = largeItemsRaw === 'true';
          updates.taskItemScale = isLarge ? 150 : 100;
        }

        if (taskItemTextScaleRaw !== null) {
          const parsedText = parseInt(taskItemTextScaleRaw, 10);
          if (!isNaN(parsedText) && parsedText >= 100 && parsedText <= 200) {
            updates.taskItemTextScale = parsedText;
          }
        }

        if (
          themeModeRaw === 'system' ||
          themeModeRaw === 'light' ||
          themeModeRaw === 'dark' ||
          themeModeRaw === 'oled'
        ) {
          updates.themeMode = themeModeRaw;
          setActiveThemeMode(themeModeRaw);
        }

        if (isValidLanguagePreference(languageRaw)) {
          updates.languagePreference = languageRaw;
          setActiveLanguagePreference(languageRaw);
        }

        if (weekStartRaw === '0' || weekStartRaw === '1') {
          updates.weekStartDay = Number(weekStartRaw) as WeekStartDay;
        }

        if (
          appBadgeModeRaw === 'off' ||
          appBadgeModeRaw === 'overdue' ||
          appBadgeModeRaw === 'due_today'
        ) {
          updates.appBadgeMode = appBadgeModeRaw;
        }

        if (!localModeActive && savedFilterTasksRaw) {
          try {
            const parsedFilterMap = JSON.parse(savedFilterTasksRaw);
            if (parsedFilterMap && typeof parsedFilterMap === 'object') {
              updates.savedFilterTaskIds = parsedFilterMap;
            }
          } catch (_) {}
        }

        set(updates);
      } catch (_) {
        // Ignore cache load errors gracefully
      }
    },

    setCachedUsers: (users: User[]) => {
      set({ cachedUsers: users });
      AsyncStorage.setItem(CACHE_KEY_USERS, JSON.stringify(users)).catch(() => {});
    },

    fetchUsers: async (query?: string): Promise<User[]> => {
      const epoch = sessionEpoch;
      const { client, cachedUsers } = get();
      if (!client || typeof client.searchUsers !== 'function') return cachedUsers;

      try {
        const users = await client.searchUsers(query || '');
        if (epoch !== sessionEpoch) return get().cachedUsers;

        const safe = Array.isArray(users) ? users : [];
        if (safe.length > 0) {
          const map = new Map<string, User>(
            (get().cachedUsers || []).map((u) => [u.username.toLowerCase(), u])
          );
          safe.forEach((u) => map.set(u.username.toLowerCase(), u));
          const merged = Array.from(map.values());
          set({ cachedUsers: merged });
          AsyncStorage.setItem(CACHE_KEY_USERS, JSON.stringify(merged)).catch(() => {});
          return merged;
        }
        return get().cachedUsers;
      } catch (_) {
        return get().cachedUsers;
      }
    },

    setReenableStaples: async (enabled: boolean) => {
      set({ reenableStaples: enabled });
      try {
        await AsyncStorage.setItem(CACHE_KEY_REENABLE_STAPLES, enabled ? 'true' : 'false');
      } catch (_) {}
    },

    setLargeTaskItems: async (enabled: boolean) => {
      const scale = enabled ? 150 : 100;
      set({ largeTaskItems: enabled, taskItemScale: scale });
      try {
        await AsyncStorage.setItem(CACHE_KEY_LARGE_TASK_ITEMS, enabled ? 'true' : 'false');
        await AsyncStorage.setItem(CACHE_KEY_TASK_ITEM_SCALE, scale.toString());
      } catch (_) {}
    },

    setTaskItemScale: async (scale: number) => {
      const clamped = Math.max(100, Math.min(200, Math.round(scale)));
      set({ taskItemScale: clamped, largeTaskItems: clamped > 100 });
      try {
        await AsyncStorage.setItem(CACHE_KEY_TASK_ITEM_SCALE, clamped.toString());
        await AsyncStorage.setItem(CACHE_KEY_LARGE_TASK_ITEMS, clamped > 100 ? 'true' : 'false');
      } catch (_) {}
    },

    setTaskItemTextScale: async (scale: number) => {
      const clamped = Math.max(100, Math.min(200, Math.round(scale)));
      set({ taskItemTextScale: clamped });
      try {
        await AsyncStorage.setItem(CACHE_KEY_TASK_ITEM_TEXT_SCALE, clamped.toString());
      } catch (_) {}
    },

    setThemeMode: async (mode: ThemeMode) => {
      const safeMode: ThemeMode =
        mode === 'light' || mode === 'dark' || mode === 'oled' || mode === 'system'
          ? mode
          : 'system';
      setActiveThemeMode(safeMode);
      set({ themeMode: safeMode });
      try {
        await AsyncStorage.setItem(CACHE_KEY_THEME_MODE, safeMode);
      } catch (_) {}
    },

    setLanguagePreference: async (pref: LanguagePreference) => {
      const epoch = sessionEpoch;
      const safePref: LanguagePreference = isValidLanguagePreference(pref) ? pref : 'system';
      setActiveLanguagePreference(safePref);

      // In Local Mode, localize untouched default starter lists dynamically when switching language
      const stateNow = get();
      let localizedProjects: Project[] | null = null;
      if (stateNow.isLocalMode && !stateNow.client && Array.isArray(stateNow.projects)) {
        const curProjects = stateNow.projects;
        const curTasks = stateNow.tasks || [];
        let changed = false;
        const nextProjs = curProjects.map((proj) => {
          if (!isUntouchedEmptyStarterProject(proj, curProjects, curTasks)) {
            return proj;
          }
          if (proj.id === 1 && proj.title !== t('local.starterTasksList')) {
            changed = true;
            return { ...proj, title: t('local.starterTasksList') };
          }
          if (proj.id === 2 && proj.title !== t('local.starterGroceriesList')) {
            changed = true;
            return { ...proj, title: t('local.starterGroceriesList') };
          }
          return proj;
        });
        if (changed) {
          localizedProjects = nextProjs;
        }
      }

      set({
        languagePreference: safePref,
        ...(localizedProjects ? { projects: localizedProjects } : {}),
      });
      if (localizedProjects) {
        persistProjectsDebounced(localizedProjects, true, epoch);
      }
      try {
        await AsyncStorage.setItem(CACHE_KEY_LANGUAGE, safePref);
      } catch (_) {}
      initNotifications()
        .then(() => syncAllTaskReminders(get().tasks || []))
        .catch(() => {});
    },

    setWeekStartDay: async (day: WeekStartDay) => {
      const safeDay: WeekStartDay = day === 0 ? 0 : 1;
      set({ weekStartDay: safeDay });
      try {
        await AsyncStorage.setItem(CACHE_KEY_WEEK_START_DAY, safeDay.toString());
      } catch (_) {}
    },

    setAppBadgeMode: async (mode: AppBadgeMode) => {
      const safeMode: AppBadgeMode =
        mode === 'overdue' || mode === 'due_today' || mode === 'off' ? mode : 'off';
      set({ appBadgeMode: safeMode });
      syncAppBadgeCount(get().tasks || [], safeMode).catch(() => {});
      try {
        await AsyncStorage.setItem(CACHE_KEY_APP_BADGE_MODE, safeMode);
      } catch (_) {}
    },

    setPendingOpenTaskId: (taskId: number | null) => {
      set({ pendingOpenTaskId: taskId });
    },

    retrySync: async () => {
      await get().syncAll();
    },

    setSelectedProjectId: (id: number | null) => {
      set({ selectedProjectId: id });
      if (id !== null && id > 0) {
        AsyncStorage.setItem(CACHE_KEY_LAST_PROJECT, id.toString()).catch(() => {});
        get().fetchTasks(id);
      } else if (id !== null && id < 0 && id !== MY_TASKS_PROJECT_ID) {
        AsyncStorage.setItem(CACHE_KEY_LAST_PROJECT, id.toString()).catch(() => {});
        get().fetchSavedFilterTasks(id);
      } else {
        if (id === null) {
          AsyncStorage.removeItem(CACHE_KEY_LAST_PROJECT).catch(() => {});
        } else {
          AsyncStorage.setItem(CACHE_KEY_LAST_PROJECT, id.toString()).catch(() => {});
        }
        get().fetchAllTasks();
      }
    },

    fetchLabels: async (): Promise<Label[]> => {
      const epoch = sessionEpoch;
      const { client } = get();
      if (!client || typeof client.getLabels !== 'function') return get().labels || [];

      try {
        const labels = await client.getLabels();
        if (epoch !== sessionEpoch) return [];

        const rawLabels = Array.isArray(labels) ? labels : [];
        const safeLabels: Label[] = rawLabels.map((l) => {
          const c = l.hex_color || l.color;
          return {
            ...l,
            hex_color: c,
            color: c,
          };
        });
        set({ labels: safeLabels });
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(safeLabels)).catch(() => {});
        return safeLabels;
      } catch (_) {
        return get().labels || [];
      }
    },

    fetchCurrentUser: async (): Promise<User | null> => {
      const epoch = sessionEpoch;
      const { client } = get();
      if (!client || typeof client.getCurrentUser !== 'function') return get().currentUser;
      try {
        const user = await client.getCurrentUser();
        if (epoch !== sessionEpoch) return null;

        if (user && user.username) {
          set({ currentUser: user });
          AsyncStorage.setItem(CACHE_KEY_CURRENT_USER, JSON.stringify(user)).catch(() => {});
          return user;
        }
      } catch (_) {}
      return get().currentUser;
    },

    fetchProjects: async () => {
      const epoch = sessionEpoch;
      const { client } = get();
      if (!client) return;

      set({ isLoading: true, error: null });
      try {
        const rawProjects = await client.getProjects();
        if (epoch !== sessionEpoch) return;

        const projects = Array.isArray(rawProjects)
          ? rawProjects.map(normalizeServerProjectEntry)
          : [];
        set({ projects, isLoading: false });

        AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(projects)).catch(() => {});

        if (projects.length > 0) {
          const curId = get().selectedProjectId;
          if (curId !== null && curId !== MY_TASKS_PROJECT_ID) {
            const targetId = projects.some((p) => p.id === curId) ? curId : null;
            set({ selectedProjectId: targetId });
          }
        }
      } catch (err: any) {
        if (epoch !== sessionEpoch) return;
        if (err?.name === 'AbortError') {
          set({ isLoading: false });
          return;
        }
        set({ error: err.message || 'Failed to fetch projects', isLoading: false });
      }
    },

    createProject: async (input: CreateProjectInput): Promise<Project> => {
      const epoch = sessionEpoch;
      const { client, isLocalMode, projects } = get();
      if (!client) {
        if (!isLocalMode) {
          throw new Error(t('listEditor.networkRequiredError'));
        }
        const trimmedTitle = (input.title || '').trim();
        if (!trimmedTitle) {
          throw new Error(t('listEditor.emptyTitleError'));
        }
        const safeProjects = Array.isArray(projects) ? projects : [];
        const nextId =
          safeProjects.reduce((max, p) => Math.max(max, p && p.id > 0 ? p.id : 0), 0) + 1;
        const parentId =
          input.parent_project_id &&
          input.parent_project_id > 0 &&
          safeProjects.some((p) => p.id === input.parent_project_id)
            ? input.parent_project_id
            : undefined;
        const nowIso = new Date().toISOString();
        const hex = normalizeHexColor(input.hex_color, true) || '#0A84FF';
        const localCreated: Project = {
          id: nextId,
          title: trimmedTitle,
          description: input.description || '',
          hex_color: hex,
          ...(parentId ? { parent_project_id: parentId } : {}),
          is_favorite: Boolean(input.is_favorite),
          is_archived: false,
          position: (safeProjects.length + 1) * 1000,
          created: nowIso,
          updated: nowIso,
        };
        const updatedProjects = [...safeProjects, localCreated];
        set({ projects: updatedProjects });
        persistProjectsDebounced(updatedProjects, true, epoch);
        return localCreated;
      }

      const created = await client.createProject(input);
      if (epoch !== sessionEpoch) return created;

      const updatedProjects = [...(projects || []), created];
      set({ projects: updatedProjects });
      persistProjectsDebounced(updatedProjects, true, epoch);
      return created;
    },

    updateProject: async (projectId: number, input: UpdateProjectInput): Promise<Project> => {
      const epoch = sessionEpoch;
      const { client, isLocalMode, projects } = get();
      if (!client) {
        if (!isLocalMode) {
          throw new Error(t('listEditor.networkRequiredError'));
        }
        const safeProjects = Array.isArray(projects) ? projects : [];
        const existing = safeProjects.find((p) => p.id === projectId);
        if (!existing) {
          throw new Error(t('listEditor.saveError'));
        }
        if (input.title !== undefined && !input.title.trim()) {
          throw new Error(t('listEditor.emptyTitleError'));
        }
        let nextParentId = existing.parent_project_id;
        if (input.parent_project_id !== undefined) {
          if (
            input.parent_project_id > 0 &&
            input.parent_project_id !== projectId &&
            safeProjects.some((p) => p.id === input.parent_project_id) &&
            !wouldCreateProjectCycle(safeProjects, projectId, input.parent_project_id)
          ) {
            nextParentId = input.parent_project_id;
          } else {
            nextParentId = undefined;
          }
        }
        const nowIso = new Date().toISOString();
        const updatedLocal: Project = {
          ...existing,
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.hex_color !== undefined
            ? { hex_color: normalizeHexColor(input.hex_color, true) || existing.hex_color }
            : {}),
          parent_project_id: nextParentId,
          ...(input.is_archived !== undefined ? { is_archived: Boolean(input.is_archived) } : {}),
          ...(input.is_favorite !== undefined ? { is_favorite: Boolean(input.is_favorite) } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          updated: nowIso,
        };
        const updatedProjects = safeProjects.map((p) =>
          p.id === projectId ? updatedLocal : p
        );
        set({ projects: updatedProjects });
        persistProjectsDebounced(updatedProjects, true, epoch);
        return updatedLocal;
      }

      const existing = (projects || []).find((p) => p.id === projectId);
      const mergedHex = normalizeHexColor(
        input.hex_color !== undefined ? input.hex_color : existing?.hex_color,
        true
      );
      const mergedParentId =
        input.parent_project_id !== undefined
          ? input.parent_project_id
          : existing?.parent_project_id;
      const mergedPayload: UpdateProjectInput = {
        ...(existing
          ? {
              title: existing.title,
              description: existing.description || '',
              ...(mergedHex ? { hex_color: mergedHex } : {}),
              ...(mergedParentId && mergedParentId > 0
                ? { parent_project_id: mergedParentId }
                : {}),
              is_archived: Boolean(existing.is_archived),
              is_favorite: Boolean(existing.is_favorite),
            }
          : {}),
        ...input,
      };
      const updated = await client.updateProject(projectId, mergedPayload);
      if (epoch !== sessionEpoch) return updated;

      const updatedProjects = (projects || []).map((p) =>
        p.id === projectId ? { ...p, ...updated } : p
      );
      set({ projects: updatedProjects });
      persistProjectsDebounced(updatedProjects, true, epoch);
      return updated;
    },

    deleteProject: async (projectId: number): Promise<void> => {
      const epoch = sessionEpoch;
      const { client, isLocalMode, projects, tasks, selectedProjectId, syncQueue, appBadgeMode } =
        get();
      if (!client && !isLocalMode) {
        throw new Error(t('listEditor.networkRequiredError'));
      }
      const deletedProjectTasks = (tasks || []).filter((t) => t.project_id === projectId);

      if (client) {
        await client.deleteProject(projectId);
        if (epoch !== sessionEpoch) return;
      }

      const updatedProjects = (projects || [])
        .filter((p) => p.id !== projectId)
        .map((p) =>
          p.parent_project_id === projectId ? { ...p, parent_project_id: undefined } : p
        );
      let updatedTasks = (tasks || []).filter((t) => t.project_id !== projectId);
      for (const dt of deletedProjectTasks) {
        updatedTasks = synchronizeRelatedTaskSnapshots(updatedTasks, undefined, dt.id);
      }
      const newSelectedId = selectedProjectId === projectId ? null : selectedProjectId;

      if (syncQueue && typeof syncQueue.removePendingForTasks === 'function') {
        syncQueue.removePendingForTasks(deletedProjectTasks.map((t) => t.id));
      }

      set({
        projects: updatedProjects,
        tasks: updatedTasks,
        selectedProjectId: newSelectedId,
      });
      persistProjectsDebounced(updatedProjects, true, epoch);
      persistTasksDebounced(updatedTasks, true, epoch);
      if (selectedProjectId === projectId) {
        AsyncStorage.removeItem(CACHE_KEY_LAST_PROJECT).catch(() => {});
      }

      // Cancel scheduled reminders for every task in the deleted project & update badge
      Promise.all(deletedProjectTasks.map((t) => cancelTaskReminders(t.id))).catch(() => {});
      syncAppBadgeCount(updatedTasks, appBadgeMode).catch(() => {});
    },

    archiveProject: async (projectId: number, isArchived: boolean): Promise<Project> => {
      const epoch = sessionEpoch;
      const { client, isLocalMode, projects, selectedProjectId } = get();
      if (!client) {
        if (!isLocalMode) {
          throw new Error(t('listEditor.networkRequiredError'));
        }
        const safeProjects = Array.isArray(projects) ? projects : [];
        const existing = safeProjects.find((p) => p.id === projectId);
        if (!existing) {
          throw new Error(t('listEditor.archiveError'));
        }
        const updatedLocal: Project = {
          ...existing,
          is_archived: isArchived,
          updated: new Date().toISOString(),
        };
        const updatedProjects = safeProjects.map((p) =>
          p.id === projectId ? updatedLocal : p
        );
        const newSelectedId =
          isArchived && selectedProjectId === projectId ? null : selectedProjectId;
        set({
          projects: updatedProjects,
          selectedProjectId: newSelectedId,
        });
        persistProjectsDebounced(updatedProjects, true, epoch);
        if (isArchived && selectedProjectId === projectId) {
          AsyncStorage.removeItem(CACHE_KEY_LAST_PROJECT).catch(() => {});
        }
        return updatedLocal;
      }

      const current = (projects || []).find((p) => p.id === projectId);
      const hex = normalizeHexColor(current?.hex_color, true);
      const updated = await client.updateProject(projectId, {
        ...(current
          ? {
              title: current.title,
              description: current.description || '',
              ...(hex ? { hex_color: hex } : {}),
              ...(current.parent_project_id && current.parent_project_id > 0
                ? { parent_project_id: current.parent_project_id }
                : {}),
              is_favorite: Boolean(current.is_favorite),
            }
          : {}),
        is_archived: isArchived,
      });
      if (epoch !== sessionEpoch) return updated;

      const updatedProjects = (projects || []).map((p) =>
        p.id === projectId ? { ...p, ...updated } : p
      );
      const newSelectedId = isArchived && selectedProjectId === projectId ? null : selectedProjectId;

      set({
        projects: updatedProjects,
        selectedProjectId: newSelectedId,
      });
      persistProjectsDebounced(updatedProjects, true, epoch);
      if (isArchived && selectedProjectId === projectId) {
        AsyncStorage.removeItem(CACHE_KEY_LAST_PROJECT).catch(() => {});
      }
      return updated;
    },

    toggleProjectFavorite: async (projectId: number): Promise<Project> => {
      const epoch = sessionEpoch;
      const { client, isLocalMode, projects } = get();
      const current = (projects || []).find((p) => p.id === projectId);
      if (!client) {
        if (!isLocalMode) {
          throw new Error(t('listEditor.networkRequiredError'));
        }
        if (!current) {
          throw new Error(t('listEditor.saveError'));
        }
        const updatedLocal: Project = {
          ...current,
          is_favorite: !current.is_favorite,
          updated: new Date().toISOString(),
        };
        const updatedProjects = (projects || []).map((p) =>
          p.id === projectId ? updatedLocal : p
        );
        set({ projects: updatedProjects });
        persistProjectsDebounced(updatedProjects, true, epoch);
        return updatedLocal;
      }

      const hex = normalizeHexColor(current?.hex_color, true);
      const updated = await client.updateProject(projectId, {
        ...(current
          ? {
              title: current.title,
              description: current.description || '',
              ...(hex ? { hex_color: hex } : {}),
              ...(current.parent_project_id && current.parent_project_id > 0
                ? { parent_project_id: current.parent_project_id }
                : {}),
              is_archived: Boolean(current.is_archived),
            }
          : {}),
        is_favorite: !current?.is_favorite,
      });
      if (epoch !== sessionEpoch) return updated;

      const updatedProjects = (projects || []).map((p) =>
        p.id === projectId ? { ...p, ...updated } : p
      );
      set({ projects: updatedProjects });
      persistProjectsDebounced(updatedProjects, true, epoch);
      return updated;
    },

    duplicateProject: async (projectId: number): Promise<Project> => {
      const epoch = sessionEpoch;
      const { client, isLocalMode, projects, tasks, appBadgeMode } = get();
      if (!client) {
        if (!isLocalMode) {
          throw new Error(t('listEditor.networkRequiredError'));
        }
        const safeProjects = Array.isArray(projects) ? projects : [];
        const source = safeProjects.find((p) => p.id === projectId);
        if (!source) {
          throw new Error(t('listEditor.duplicateError'));
        }
        const nowIso = new Date().toISOString();
        let nextProjId =
          safeProjects.reduce((max, p) => Math.max(max, p && p.id > 0 ? p.id : 0), 0) + 1;

        // Collect source project and all descendant sub-lists in topological parent-first order
        const treeNodes = flattenProjectTree(
          buildProjectTree(safeProjects, { showArchived: true })
        );
        const subtreeIds = new Set<number>([source.id]);
        const projectsToClone: Project[] = [source];
        for (const node of treeNodes) {
          if (
            node.project.id !== source.id &&
            node.project.parent_project_id &&
            subtreeIds.has(node.project.parent_project_id)
          ) {
            subtreeIds.add(node.project.id);
            projectsToClone.push(node.project);
          }
        }

        const projIdRemap = new Map<number, number>();
        const clonedProjects: Project[] = [];
        for (let idx = 0; idx < projectsToClone.length; idx++) {
          const origProj = projectsToClone[idx];
          const assignedProjId = nextProjId++;
          projIdRemap.set(origProj.id, assignedProjId);
          const isRootCopy = origProj.id === source.id;
          const mappedParentId = isRootCopy
            ? origProj.parent_project_id
            : origProj.parent_project_id
            ? projIdRemap.get(origProj.parent_project_id)
            : undefined;

          clonedProjects.push({
            ...origProj,
            id: assignedProjId,
            title: isRootCopy
              ? t('listEditor.copyTitle', { title: origProj.title })
              : origProj.title,
            ...(mappedParentId && mappedParentId > 0
              ? { parent_project_id: mappedParentId }
              : { parent_project_id: undefined }),
            is_favorite: false,
            is_archived: isRootCopy ? false : Boolean(origProj.is_archived),
            position: (safeProjects.length + idx + 1) * 1000,
            created: nowIso,
            updated: nowIso,
          });
        }
        const dupProject = clonedProjects[0];

        const safeTasks = Array.isArray(tasks) ? tasks : [];
        const sourceTasks = safeTasks.filter((t) => subtreeIds.has(t.project_id));
        const existingIds = new Set<number>(safeTasks.map((t) => t.id));
        const taskIdRemap = new Map<number, number>();
        for (const st of sourceTasks) {
          const clonedId = nextUniqueNegativeId(existingIds);
          existingIds.add(clonedId);
          taskIdRemap.set(st.id, clonedId);
        }

        const clonedTasks: Task[] = sourceTasks.map((st) => {
          const newId = taskIdRemap.get(st.id)!;
          const targetClonedProjId = projIdRemap.get(st.project_id) ?? dupProject.id;
          const nextRel = st.related_tasks ? { ...st.related_tasks } : undefined;
          if (nextRel?.subtask) {
            nextRel.subtask = nextRel.subtask
              .filter((sub) => taskIdRemap.has(sub.id))
              .map((sub) => ({
                ...sub,
                id: taskIdRemap.get(sub.id)!,
                project_id: projIdRemap.get(sub.project_id) ?? targetClonedProjId,
              }));
          }
          if (nextRel?.parenttask) {
            nextRel.parenttask = nextRel.parenttask
              .filter((par) => taskIdRemap.has(par.id))
              .map((par) => ({
                ...par,
                id: taskIdRemap.get(par.id)!,
                project_id: projIdRemap.get(par.project_id) ?? targetClonedProjId,
              }));
          }
          return {
            ...st,
            id: newId,
            project_id: targetClonedProjId,
            reminders: st.reminders ? st.reminders.map((r) => ({ ...r })) : st.reminders,
            labels: st.labels ? st.labels.map((l) => ({ ...l })) : st.labels,
            assignees: st.assignees ? st.assignees.map((u) => ({ ...u })) : st.assignees,
            ...(nextRel ? { related_tasks: nextRel } : {}),
            created: nowIso,
            updated: nowIso,
          };
        });

        const updatedProjects = [...safeProjects, ...clonedProjects];
        const updatedTasks = synchronizeRelatedTaskSnapshots([...safeTasks, ...clonedTasks]);
        set({ projects: updatedProjects, tasks: updatedTasks });
        persistProjectsDebounced(updatedProjects, true, epoch);
        persistTasksDebounced(updatedTasks, true, epoch);

        for (const ct of clonedTasks) {
          if (!ct.done && ct.reminders && ct.reminders.length > 0) {
            scheduleTaskReminders(ct).catch(() => {});
          }
        }
        syncAppBadgeCount(updatedTasks, appBadgeMode).catch(() => {});
        return dupProject;
      }

      const dup = await client.duplicateProject(projectId);
      if (epoch !== sessionEpoch) return dup;

      const updatedProjects = [...(projects || []), dup];
      set({ projects: updatedProjects });
      persistProjectsDebounced(updatedProjects, true, epoch);
      // Refresh projects & tasks in background so server-cloned sub-lists and tasks appear immediately
      get().fetchProjects().catch(() => {});
      get().fetchAllTasks().catch(() => {});
      return dup;
    },

    fetchTasks: async (projectId: number) => {
      const epoch = sessionEpoch;
      const { client } = get();
      if (!client) return;

      set({ isLoading: true, error: null });
      try {
        const rawTasks = await client.getTasks(projectId);
        if (epoch !== sessionEpoch) return;

        const remoteTasks = Array.isArray(rawTasks) ? rawTasks : [];
        const colorMap = buildServerLabelsColorMap(get().labels || []);
        const currentTasks = get().tasks || [];
        const currentTaskMap = new Map<number, Task>(currentTasks.map((t) => [t.id, t]));
        const syncQueue = get().syncQueue;

        const enrichedTasks: Task[] = [];
        const seenIds = new Set<number>();

        for (const rt of remoteTasks) {
          const local = currentTaskMap.get(rt.id);
          const reconciled = reconcileRemoteTaskWithPendingQueue(rt, local, syncQueue, colorMap);
          if (reconciled) {
            enrichedTasks.push(reconciled);
            seenIds.add(reconciled.id);
          }
        }

        const shouldRetainTempTask = (t: Task): boolean => {
          if (t.id >= 0) return false;
          if (syncQueue && typeof syncQueue.hasPendingForTask === 'function') {
            return syncQueue.hasPendingForTask(t.id, 'CREATE_TASK');
          }
          return true;
        };

        // Keep tasks belonging to other projects, tasks locally moved INTO this project while pending MOVE_TASK,
        // and only negative tempId tasks that still have a pending CREATE_TASK in syncQueue.
        const otherTasks = currentTasks.filter((t) => {
          if (seenIds.has(t.id)) return false;
          if (t.id < 0) {
            return shouldRetainTempTask(t);
          }
          if (
            typeof syncQueue?.hasPendingForTask === 'function' &&
            syncQueue.hasPendingForTask(t.id, 'DELETE_TASK')
          ) {
            return false;
          }
          if (t.project_id !== projectId) {
            return true;
          }
          // Positive-ID task locally moved INTO `projectId` whose MOVE_TASK hasn't hit the server yet
          return (
            typeof syncQueue?.hasPendingForTask === 'function' &&
            syncQueue.hasPendingForTask(t.id, 'MOVE_TASK')
          );
        });

        const merged = synchronizeRelatedTaskSnapshots([...enrichedTasks, ...otherTasks]);

        set({ tasks: merged, isLoading: false });
        AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(merged)).catch(() => {});
        syncAppBadgeCount(merged, get().appBadgeMode).catch(() => {});
      } catch (err: any) {
        if (epoch !== sessionEpoch) return;
        if (err?.name === 'AbortError') {
          set({ isLoading: false });
          return;
        }
        set({ error: err.message || 'Failed to fetch tasks', isLoading: false });
      }
    },

    fetchSavedFilterTasks: async (filterProjectId: number) => {
      const epoch = sessionEpoch;
      const { client, projects } = get();
      if (!client || typeof client.getSavedFilterTasks !== 'function') return;

      const filterProj = (projects || []).find((p) => p.id === filterProjectId);
      if (!filterProj) return;

      set({ isLoading: true, error: null });
      try {
        const rawTasks = await client.getSavedFilterTasks(filterProj);
        if (epoch !== sessionEpoch) return;

        const remoteTasks = Array.isArray(rawTasks) ? rawTasks : [];
        const colorMap = buildServerLabelsColorMap(get().labels || []);
        const currentTasks = get().tasks || [];
        const taskMap = new Map<number, Task>(currentTasks.map((t) => [t.id, t]));
        const syncQueue = get().syncQueue;
        const matchedIds: number[] = [];

        for (const rt of remoteTasks) {
          const local = taskMap.get(rt.id);
          const reconciled = reconcileRemoteTaskWithPendingQueue(rt, local, syncQueue, colorMap);
          if (reconciled) {
            taskMap.set(reconciled.id, reconciled);
            matchedIds.push(reconciled.id);
          }
        }

        const mergedTasks = synchronizeRelatedTaskSnapshots(Array.from(taskMap.values()));
        const nextFilterMap = {
          ...(get().savedFilterTaskIds || {}),
          [filterProjectId]: matchedIds,
        };

        set({
          tasks: mergedTasks,
          savedFilterTaskIds: nextFilterMap,
          isLoading: false,
        });
        AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(mergedTasks)).catch(() => {});
        AsyncStorage.setItem(CACHE_KEY_SAVED_FILTER_TASKS, JSON.stringify(nextFilterMap)).catch(
          () => {}
        );
      } catch (err: any) {
        if (epoch !== sessionEpoch) return;
        if (err?.name === 'AbortError') {
          set({ isLoading: false });
          return;
        }
        set({ error: err.message || 'Failed to fetch saved filter tasks', isLoading: false });
      }
    },

    fetchAllTasks: async () => {
      const epoch = sessionEpoch;
      const { client } = get();
      if (!client) return;

      set({ isLoading: true, error: null });
      try {
        const projects = (get().projects || []).filter((p) => p.id > 0);

        const allTasksPromise =
          typeof client.getAllTasks === 'function'
            ? client.getAllTasks()
            : Promise.resolve([]);

        const projectTaskPromises =
          typeof client.getTasks === 'function'
            ? projects.map((p) => client.getTasks(p.id))
            : [];

        const [allTasksRes, ...projectTaskLists] = await Promise.all([
          allTasksPromise,
          ...projectTaskPromises,
        ]);

        if (epoch !== sessionEpoch) return;

        const taskMap = new Map<number, Task>();
        const currentTasks = get().tasks || [];
        const currentTaskMap = new Map<number, Task>(currentTasks.map((t) => [t.id, t]));
        const syncQueue = get().syncQueue;
        const colorMap = buildServerLabelsColorMap(get().labels || []);

        (allTasksRes || []).forEach((t) => {
          const local = currentTaskMap.get(t.id);
          const reconciled = reconcileRemoteTaskWithPendingQueue(t, local, syncQueue, colorMap);
          if (reconciled) {
            taskMap.set(reconciled.id, reconciled);
          }
        });

        projectTaskLists.forEach((list) => {
          (list || []).forEach((t) => {
            const local = currentTaskMap.get(t.id);
            const reconciled = reconcileRemoteTaskWithPendingQueue(t, local, syncQueue, colorMap);
            if (reconciled) {
              taskMap.set(reconciled.id, reconciled);
            }
          });
        });

        // Retain ONLY negative tempId tasks that still have a pending CREATE_TASK in syncQueue
        currentTasks
          .filter((t) => {
            if (t.id >= 0) return false;
            if (syncQueue && typeof syncQueue.hasPendingForTask === 'function') {
              return syncQueue.hasPendingForTask(t.id, 'CREATE_TASK');
            }
            return true;
          })
          .forEach((t) => taskMap.set(t.id, t));

        const merged = synchronizeRelatedTaskSnapshots(Array.from(taskMap.values()));

        set({ tasks: merged, isLoading: false });
        AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(merged)).catch(() => {});
        syncAppBadgeCount(merged, get().appBadgeMode).catch(() => {});
      } catch (err: any) {
        if (epoch !== sessionEpoch) return;
        if (err?.name === 'AbortError') {
          set({ isLoading: false });
          return;
        }
        // Preserve existing cached tasks on network/fetch failure
        set({ error: err.message || 'Failed to fetch all tasks', isLoading: false });
      }
    },

    syncAll: async () => {
      const epoch = sessionEpoch;
      const { client, syncQueue, isSyncingAll } = get();
      if (!client || isSyncingAll) return;

      set({ isSyncingAll: true, syncStatus: 'syncing', error: null });
      let hadInboundFailure = false;

      try {
        // 1. Outbound sync: process queued mutations first
        if (syncQueue && typeof syncQueue.processQueue === 'function') {
          await syncQueue.processQueue();
        }
        if (epoch !== sessionEpoch) return;

        // If auth expired during outbound sync, stop and keep auth_required state intact
        if (
          get().authRequired ||
          (typeof syncQueue?.getStatus === 'function' && syncQueue.getStatus() === 'auth_required')
        ) {
          set({ syncStatus: 'auth_required' });
          return;
        }

        // 2. Inbound sync: fetch labels, projects, all tasks, and current user, tracking failures accurately
        if (typeof client.getLabels === 'function') {
          try {
            const labels = await client.getLabels();
            if (epoch !== sessionEpoch) return;
            const rawLabels = Array.isArray(labels) ? labels : [];
            const safeLabels: Label[] = rawLabels.map((l) => {
              const c = l.hex_color || l.color;
              return { ...l, hex_color: c, color: c };
            });
            set({ labels: safeLabels });
            AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(safeLabels)).catch(() => {});
          } catch (err: any) {
            if (epoch !== sessionEpoch) return;
            if (err?.name !== 'AbortError') hadInboundFailure = true;
          }
        }

        await get().fetchProjects();
        if (epoch !== sessionEpoch) return;
        if (get().error) hadInboundFailure = true;

        await get().fetchAllTasks();
        if (epoch !== sessionEpoch) return;
        if (get().error) hadInboundFailure = true;

        if (typeof client.getCurrentUser === 'function') {
          try {
            const user = await client.getCurrentUser();
            if (epoch !== sessionEpoch) return;
            if (user && user.username) {
              set({ currentUser: user });
              AsyncStorage.setItem(CACHE_KEY_CURRENT_USER, JSON.stringify(user)).catch(() => {});
            }
          } catch (err: any) {
            if (epoch !== sessionEpoch) return;
            if (err?.name !== 'AbortError') hadInboundFailure = true;
          }
        }

        const queueStatus =
          typeof syncQueue?.getStatus === 'function' ? syncQueue.getStatus() : 'synced';
        const remainingQueueCount =
          typeof syncQueue?.getQueue === 'function' ? syncQueue.getQueue().length : 0;

        if (get().authRequired || queueStatus === 'auth_required') {
          set({ syncStatus: 'auth_required' });
        } else if (hadInboundFailure || queueStatus === 'offline' || remainingQueueCount > 0) {
          set({ syncStatus: 'offline' });
        } else {
          set({ syncStatus: 'synced' });
        }

        // Synchronize on-device local notifications and app badge with current task set
        await syncAllTaskReminders(get().tasks || []);
        await syncAppBadgeCount(get().tasks || [], get().appBadgeMode);
      } catch (_) {
        if (epoch === sessionEpoch) {
          set({ syncStatus: get().authRequired ? 'auth_required' : 'offline' });
        }
      } finally {
        if (epoch === sessionEpoch) {
          set({ isSyncingAll: false });
        }
      }
    },

    resetAndSyncFromServer: async () => {
      const epoch = sessionEpoch;
      const { client, syncQueue } = get();
      if (!client) return;

      set({ isLoading: true, syncStatus: 'syncing', error: null });
      try {
        if (syncQueue && typeof syncQueue.clear === 'function') {
          await syncQueue.clear();
        }
        pendingReorderBaseline.clear();

        await AsyncStorage.multiRemove([
          CACHE_KEY_TASKS,
          CACHE_KEY_LABELS,
          CACHE_KEY_PROJECTS,
          CACHE_KEY_USERS,
          CACHE_KEY_CURRENT_USER,
          CACHE_KEY_LEGACY_CURRENT_USER,
          CACHE_KEY_SAVED_FILTER_TASKS,
          SYNC_QUEUE_STORAGE_KEY,
        ]);

        if (epoch !== sessionEpoch) return;
        set({ tasks: [], savedFilterTaskIds: {}, pendingSyncCount: 0 });

        await get().fetchLabels();
        if (epoch !== sessionEpoch) return;

        await get().fetchProjects();
        if (epoch !== sessionEpoch) return;
        if (get().error) {
          throw new Error(get().error!);
        }

        await get().fetchAllTasks();
        if (epoch !== sessionEpoch) return;
        if (get().error) {
          throw new Error(get().error!);
        }

        const activeSel = get().selectedProjectId;
        if (activeSel !== null && activeSel < 0 && activeSel !== MY_TASKS_PROJECT_ID) {
          await get().fetchSavedFilterTasks(activeSel);
          if (epoch !== sessionEpoch) return;
        }

        await syncAllTaskReminders(get().tasks || []);
        await syncAppBadgeCount(get().tasks || [], get().appBadgeMode);
        if (epoch !== sessionEpoch) return;

        set({ syncStatus: 'synced', isLoading: false });
      } catch (err: any) {
        if (epoch !== sessionEpoch) return;
        set({
          error: err.message || 'Failed to reset and sync from server',
          isLoading: false,
          syncStatus: 'offline',
        });
        throw err;
      }
    },

    clearSession: async () => {
      // 1. Advance session epoch and abort all in-flight requests immediately
      sessionEpoch += 1;
      if (sessionAbortController) {
        sessionAbortController.abort();
        sessionAbortController = null;
      }

      // 2. Cancel all pending timers & reorder baselines
      if (persistTasksTimer) {
        clearTimeout(persistTasksTimer);
        persistTasksTimer = null;
      }
      if (persistProjectsTimer) {
        clearTimeout(persistProjectsTimer);
        persistProjectsTimer = null;
      }
      if (reorderSyncTimer) {
        clearTimeout(reorderSyncTimer);
        reorderSyncTimer = null;
      }
      pendingReorderBaseline.clear();

      // 3. Capture queue reference and synchronously reset Zustand store state BEFORE the first `await`
      // so any unmounting UI components (e.g. ProjectTasksScreen Undo-Delete flush) immediately observe `client === null`!
      const { syncQueue } = get();
      set({
        client: null,
        syncQueue: null,
        isLocalMode: false,
        projects: [],
        tasks: [],
        labels: [],
        cachedUsers: [],
        currentUser: null,
        selectedProjectId: null,
        savedFilterTaskIds: {},
        pendingOpenTaskId: null,
        isLoading: false,
        error: null,
        syncStatus: 'synced',
        pendingSyncCount: 0,
        isSyncingAll: false,
        authRequired: false,
      });

      // 4. Clear offline mutation queue
      if (syncQueue && typeof syncQueue.clear === 'function') {
        await syncQueue.clear();
      }

      // 5. Purge all cached tasks, projects, users, usernames, AI cache, and scheduled notifications
      await Promise.all([
        AsyncStorage.multiRemove([
          CACHE_KEY_LOCAL_MODE,
          MIGRATION_CHECKPOINT_STORAGE_KEY,
          CACHE_KEY_PROJECTS,
          CACHE_KEY_TASKS,
          CACHE_KEY_LABELS,
          CACHE_KEY_USERS,
          CACHE_KEY_CURRENT_USER,
          CACHE_KEY_LEGACY_CURRENT_USER,
          CACHE_KEY_LAST_PROJECT,
          CACHE_KEY_SAVED_FILTER_TASKS,
          SYNC_QUEUE_STORAGE_KEY,
          STORAGE_KEY_USERNAME,
          STORAGE_KEY_SAVED_USERNAME,
          LEGACY_STORAGE_KEY_PASSWORD,
        ]).catch(() => {}),
        clearAllNotifications().catch(() => {}),
        syncAppBadgeCount([], 'off').catch(() => {}),
        clearAICoreCache().catch(() => {}),
        clearMigrationCheckpoint(),
      ]);
    },

    toggleTask: (taskId: number) => {
      const { tasks, syncQueue, client, isLocalMode, appBadgeMode } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      let task = safeTasks.find((t) => t.id === taskId);
      let wasEmbeddedOnly = false;

      if (!task) {
        for (const parent of safeTasks) {
          const foundSub = parent.related_tasks?.subtask?.find((s) => s.id === taskId);
          if (foundSub) {
            task = foundSub;
            wasEmbeddedOnly = true;
            break;
          }
        }
      }
      if (!task) return;

      const nowDate = new Date();
      const now = nowDate.toISOString();
      const shouldRolloverLocally =
        !task.done && isLocalMode && !client && isTaskRecurring(task);

      const updatedTask: Task = shouldRolloverLocally
        ? computeNextRecurringTaskState(task, nowDate)
        : {
            ...task,
            done: !task.done,
            done_at: !task.done ? now : null,
            updated: now,
          };
      const baseTasks = wasEmbeddedOnly
        ? [...safeTasks, updatedTask]
        : safeTasks.map((t) => (t.id === taskId ? updatedTask : t));
      const { tasks: withResetSubs, resetSubtaskIds } = shouldRolloverLocally
        ? resetCompletedSubtasksForRecurringParent(baseTasks, updatedTask, now)
        : { tasks: baseTasks, resetSubtaskIds: [] as number[] };
      const updatedTasks = synchronizeRelatedTaskSnapshots(withResetSubs);

      set({ tasks: updatedTasks });
      persistTasksDebounced(updatedTasks);

      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);

      if (updatedTask.done) {
        cancelTaskReminders(taskId).catch(() => {});
      } else if (updatedTask.reminders && updatedTask.reminders.length > 0) {
        scheduleTaskReminders(updatedTask).catch(() => {});
      } else {
        cancelTaskReminders(taskId).catch(() => {});
      }
      for (const resetSubId of resetSubtaskIds) {
        const subObj = updatedTasks.find((t) => t.id === resetSubId);
        if (subObj && !subObj.done && subObj.reminders && subObj.reminders.length > 0) {
          scheduleTaskReminders(subObj).catch(() => {});
        }
      }
      syncAppBadgeCount(updatedTasks, appBadgeMode).catch(() => {});

      if (syncQueue) {
        syncQueue.enqueue({
          id: `toggle-${taskId}-${Date.now()}`,
          type: 'TOGGLE_TASK',
          payload: { taskId, done: updatedTask.done, data: updatedTask },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },

    reenableTask: (taskId: number, newLabels?: Label[]) => {
      const { tasks, labels: currentLabels, syncQueue, client, isLocalMode, appBadgeMode } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const task = safeTasks.find((t) => t.id === taskId);
      if (!task) return;

      let resolvedLabels = newLabels !== undefined ? newLabels : task.labels || [];
      let nextStoreLabels: Label[] | null = null;
      if (isLocalMode && !client && newLabels !== undefined) {
        const rec = reconcileLocalLabels(newLabels, currentLabels || []);
        resolvedLabels = rec.taskLabels;
        if (rec.storeChanged) {
          nextStoreLabels = rec.storeLabels;
        }
      }

      const projectPeerPositions = safeTasks
        .filter((t) => t.id !== taskId && t.project_id === task.project_id && typeof t.position === 'number' && t.position > 0)
        .map((t) => t.position as number);
      const minPeerPos =
        projectPeerPositions.length > 0 ? Math.min(...projectPeerPositions) : 2000;
      const topPosition = minPeerPos >= 2 ? Math.max(1, Math.floor(minPeerPos / 2)) : 100;

      const updatedTask: Task = {
        ...task,
        done: false,
        done_at: null,
        due_date: null,
        start_date: null,
        end_date: null,
        reminders: null,
        percent_done: 0,
        labels: resolvedLabels,
        position: topPosition,
        updated: new Date().toISOString(),
      };
      const remainingTasks = safeTasks.filter((t) => t.id !== taskId);
      const updatedTasks = synchronizeRelatedTaskSnapshots([updatedTask, ...remainingTasks]);

      set({
        tasks: updatedTasks,
        ...(nextStoreLabels ? { labels: nextStoreLabels } : {}),
      });
      persistTasksDebounced(updatedTasks);
      if (nextStoreLabels) {
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(nextStoreLabels)).catch(() => {});
      }

      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      cancelTaskReminders(taskId).catch(() => {});
      syncAppBadgeCount(updatedTasks, appBadgeMode).catch(() => {});

      if (syncQueue) {
        syncQueue.enqueue({
          id: `reenable-${taskId}-${Date.now()}`,
          type: 'UPDATE_TASK',
          payload: {
            taskId,
            data: updatedTask,
          },
          timestamp: Date.now(),
        });
        if (newLabels !== undefined) {
          syncQueue.enqueue({
            id: `label-${taskId}-${Date.now()}`,
            type: 'SET_TASK_LABELS',
            payload: { taskId, labels: updatedTask.labels, previousLabels: task.labels || [] },
            timestamp: Date.now(),
          });
        }
        syncQueue.processQueue();
      }
    },

    updateTaskLabels: (taskId: number, labels: Label[]) => {
      const { tasks, labels: storeLabels, syncQueue, client, isLocalMode } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const currentTask = safeTasks.find((t) => t.id === taskId);
      const previousLabels = currentTask?.labels || [];

      let effectiveLabels = labels;
      let nextStoreLabels: Label[] | null = null;
      if (isLocalMode && !client) {
        const rec = reconcileLocalLabels(labels, storeLabels || []);
        effectiveLabels = rec.taskLabels;
        if (rec.storeChanged) {
          nextStoreLabels = rec.storeLabels;
        }
      }

      const updatedTasks = safeTasks.map((t) =>
        t.id === taskId ? { ...t, labels: effectiveLabels } : t
      );

      set({
        tasks: updatedTasks,
        ...(nextStoreLabels ? { labels: nextStoreLabels } : {}),
      });
      persistTasksDebounced(updatedTasks);
      if (nextStoreLabels) {
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(nextStoreLabels)).catch(() => {});
      }

      safeHaptics.selection();

      if (syncQueue) {
        syncQueue.enqueue({
          id: `label-${taskId}-${Date.now()}`,
          type: 'SET_TASK_LABELS',
          payload: { taskId, labels: effectiveLabels, previousLabels },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },

    updateTaskAssignees: (taskId: number, assignees: User[]) => {
      const { tasks, syncQueue } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const currentTask = safeTasks.find((t) => t.id === taskId);
      const previousAssignees = currentTask?.assignees || [];
      const updatedTasks = safeTasks.map((t) => (t.id === taskId ? { ...t, assignees } : t));

      set({ tasks: updatedTasks });
      persistTasksDebounced(updatedTasks);

      safeHaptics.selection();

      if (syncQueue) {
        syncQueue.enqueue({
          id: `assignee-${taskId}-${Date.now()}`,
          type: 'SET_TASK_ASSIGNEES',
          payload: { taskId, assignees, previousAssignees },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },

    createGlobalLabel: async (title: string, hex_color?: string): Promise<Label> => {
      const epoch = sessionEpoch;
      const { client, labels } = get();
      const safeLabels = Array.isArray(labels) ? labels : [];
      if (!title.trim()) throw new Error(t('labels.emptyTitleStoreError'));

      let createdLabel: Label;
      if (client) {
        createdLabel = await client.createLabel(title.trim(), hex_color);
        if (epoch !== sessionEpoch) return createdLabel;
      } else {
        createdLabel = {
          id: nextUniqueNegativeId(safeLabels.map((l) => l.id)),
          title: title.trim(),
          hex_color,
          color: hex_color,
        };
      }
      const nextLabels = [...safeLabels.filter((l) => l.id !== createdLabel.id), createdLabel];
      set({ labels: nextLabels });
      AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(nextLabels)).catch(() => {});
      return createdLabel;
    },

    updateGlobalLabel: async (labelId: number, title: string, hex_color?: string) => {
      const epoch = sessionEpoch;
      const { client, labels, tasks } = get();
      const safeLabels = Array.isArray(labels) ? labels : [];
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error(t('labels.emptyTitleStoreError'));
      if (
        safeLabels.some(
          (l) => l.id !== labelId && l.title.trim().toLowerCase() === cleanTitle.toLowerCase()
        )
      ) {
        throw new Error(t('labels.alreadyExistsError', { title: cleanTitle }));
      }

      const targetLabel = safeLabels.find((l) => l.id === labelId);
      const targetLower = targetLabel?.title.trim().toLowerCase();

      const matchesTargetLabel = (l: Label): boolean =>
        l.id === labelId ||
        Boolean(labelId < 0 && targetLower && l.id < 0 && l.title.trim().toLowerCase() === targetLower);

      const updatedLabels = safeLabels.map((l) =>
        l.id === labelId ? { ...l, title: cleanTitle, hex_color, color: hex_color } : l
      );
      const updatedTasks = synchronizeRelatedTaskSnapshots(
        safeTasks.map((tItem) => {
          if (!tItem.labels || !tItem.labels.some(matchesTargetLabel)) return tItem;
          return {
            ...tItem,
            labels: tItem.labels.map((l) =>
              matchesTargetLabel(l)
                ? { ...l, id: labelId, title: cleanTitle, hex_color, color: hex_color }
                : l
            ),
          };
        })
      );

      set({ labels: updatedLabels, tasks: updatedTasks });
      AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(updatedLabels)).catch(() => {});
      persistTasksDebounced(updatedTasks, true, epoch);

      if (client && labelId > 0) {
        try {
          await client.updateLabel(labelId, { title: cleanTitle, hex_color });
        } catch (err) {
          if (epoch === sessionEpoch) {
            set({ labels: safeLabels, tasks: safeTasks });
            AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(safeLabels)).catch(() => {});
            persistTasksDebounced(safeTasks, true, epoch);
          }
          throw err;
        }
      }
    },

    deleteGlobalLabel: async (labelId: number) => {
      const epoch = sessionEpoch;
      const { client, labels, tasks } = get();
      const safeLabels = Array.isArray(labels) ? labels : [];
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const targetLabel = safeLabels.find((l) => l.id === labelId);
      const targetLower = targetLabel?.title.trim().toLowerCase();

      const matchesTargetLabel = (l: Label): boolean =>
        l.id === labelId ||
        Boolean(labelId < 0 && targetLower && l.id < 0 && l.title.trim().toLowerCase() === targetLower);

      const updatedLabels = safeLabels.filter((l) => l.id !== labelId);
      const updatedTasks = synchronizeRelatedTaskSnapshots(
        safeTasks.map((tItem) => {
          if (!tItem.labels || !tItem.labels.some(matchesTargetLabel)) return tItem;
          return {
            ...tItem,
            labels: tItem.labels.filter((l) => !matchesTargetLabel(l)),
          };
        })
      );

      set({ labels: updatedLabels, tasks: updatedTasks });
      AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(updatedLabels)).catch(() => {});
      persistTasksDebounced(updatedTasks, true, epoch);

      if (client && labelId > 0) {
        try {
          await client.deleteLabel(labelId);
        } catch (err) {
          if (epoch === sessionEpoch) {
            set({ labels: safeLabels, tasks: safeTasks });
            AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(safeLabels)).catch(() => {});
            persistTasksDebounced(safeTasks, true, epoch);
          }
          throw err;
        }
      }
    },

    addTask: (input: CreateTaskInput): Task => {
      const epoch = sessionEpoch;
      const { tasks, labels: currentStoreLabels, syncQueue, client, isLocalMode } = get();
      const currentTasks = Array.isArray(tasks) ? tasks : [];
      const tempId = nextUniqueNegativeId(currentTasks.map((t) => t.id));

      let optimisticLabels: Label[];
      let nextStoreLabels: Label[] | null = null;
      if (isLocalMode && !client) {
        const rec = reconcileLocalLabels(input.labels, currentStoreLabels || []);
        optimisticLabels = rec.taskLabels;
        if (rec.storeChanged) {
          nextStoreLabels = rec.storeLabels;
        }
      } else {
        const colorMap = buildServerLabelsColorMap(currentStoreLabels || []);
        optimisticLabels = (input.labels || []).map((l) => ({
          ...l,
          hex_color:
            l.hex_color ||
            (l.id > 0 ? colorMap.get(`id:${l.id}`) : undefined) ||
            colorMap.get(l.title.toLowerCase()),
        }));
      }

      const nowIso = new Date().toISOString();
      const isDone = input.done ?? false;
      const resolvedColor = input.color ?? input.hex_color;

      const optimisticTask: Task = {
        id: tempId,
        title: input.title,
        description: input.description,
        done: isDone,
        done_at: input.done_at !== undefined ? input.done_at : isDone ? nowIso : null,
        priority: input.priority ?? 0,
        project_id: input.project_id,
        due_date: input.due_date ?? null,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        repeat_after: input.repeat_after,
        repeat_mode: input.repeat_mode,
        reminders: input.reminders ?? null,
        percent_done: input.percent_done,
        color: resolvedColor,
        hex_color: input.hex_color ?? input.color,
        labels: optimisticLabels,
        assignees: input.assignees || [],
        position:
          input.position !== undefined ? input.position : (currentTasks.length + 1) * 1000,
        created: nowIso,
        updated: nowIso,
      };

      const updatedTasks = [optimisticTask, ...currentTasks];
      set({
        tasks: updatedTasks,
        ...(nextStoreLabels ? { labels: nextStoreLabels } : {}),
      });
      persistTasksDebounced(updatedTasks);
      if (nextStoreLabels) {
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(nextStoreLabels)).catch(() => {});
      }

      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);

      if (!optimisticTask.done && optimisticTask.reminders && optimisticTask.reminders.length > 0) {
        scheduleTaskReminders(optimisticTask).catch(() => {});
      }
      syncAppBadgeCount(updatedTasks, get().appBadgeMode).catch(() => {});

      if (syncQueue) {
        const hasPersistentCreatedHandler = Boolean((syncQueue as SyncQueue).onTaskCreated);
        syncQueue.enqueue({
          id: `create-${tempId}`,
          type: 'CREATE_TASK',
          payload: {
            tempId,
            projectId: input.project_id,
            taskData: input,
            labels: optimisticLabels,
            assignees: input.assignees || [],
          },
          timestamp: Date.now(),
          // Fallback onSuccess for lightweight unit-test mock queues that don't wire onTaskCreated
          onSuccess: hasPersistentCreatedHandler
            ? undefined
            : (remoteTask: Task) => {
                applyResolvedCreatedTask(tempId, remoteTask, epoch);
              },
        });
        syncQueue.processQueue();
      }

      return optimisticTask;
    },

    addSubtask: (parentTaskId: number, title: string): Task | null => {
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) return null;

      const parent = (get().tasks || []).find((t) => t.id === parentTaskId);
      if (!parent) return null;

      const childTask = get().addTask({
        title: cleanTitle,
        project_id: parent.project_id,
      });

      const parentSummary: Task = {
        id: parent.id,
        title: parent.title,
        done: parent.done,
        priority: parent.priority,
        project_id: parent.project_id,
      };

      set((state) => {
        const nextTasks = (state.tasks || []).map((t) => {
          if (t.id === parentTaskId) {
            const existingSubs = t.related_tasks?.subtask || [];
            return {
              ...t,
              related_tasks: {
                ...(t.related_tasks || {}),
                subtask: [...existingSubs, childTask],
              },
            };
          }
          if (t.id === childTask.id) {
            return {
              ...t,
              related_tasks: {
                ...(t.related_tasks || {}),
                parenttask: [parentSummary],
              },
            };
          }
          return t;
        });
        persistTasksDebounced(nextTasks);
        return { tasks: nextTasks };
      });

      const { syncQueue } = get();
      if (syncQueue) {
        syncQueue.enqueue({
          id: `rel-subtask-${parentTaskId}-${childTask.id}-${Date.now()}`,
          type: 'CREATE_TASK_RELATION',
          payload: {
            taskId: parentTaskId,
            otherTaskId: childTask.id,
            relationKind: 'subtask',
          },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }

      const latestChild = (get().tasks || []).find((t) => t.id === childTask.id) || childTask;
      return latestChild;
    },

    unlinkSubtask: (parentTaskId: number, subtaskId: number) => {
      const { tasks, syncQueue } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];

      const updatedTasks = safeTasks.map((t) => {
        if (t.id === parentTaskId && t.related_tasks?.subtask) {
          return {
            ...t,
            related_tasks: {
              ...t.related_tasks,
              subtask: t.related_tasks.subtask.filter((s) => s.id !== subtaskId),
            },
          };
        }
        if (t.id === subtaskId && t.related_tasks?.parenttask) {
          return {
            ...t,
            related_tasks: {
              ...t.related_tasks,
              parenttask: t.related_tasks.parenttask.filter((p) => p.id !== parentTaskId),
            },
          };
        }
        return t;
      });

      set({ tasks: updatedTasks });
      persistTasksDebounced(updatedTasks);

      if (syncQueue) {
        syncQueue.enqueue({
          id: `unlink-subtask-${parentTaskId}-${subtaskId}-${Date.now()}`,
          type: 'DELETE_TASK_RELATION',
          payload: {
            taskId: parentTaskId,
            otherTaskId: subtaskId,
            relationKind: 'subtask',
          },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },

    duplicateTask: (taskId: number): Task | null => {
      const source = (get().tasks || []).find((t) => t.id === taskId);
      if (!source) return null;

      const copyTitle = `${source.title} (Copy)`;
      const duplicated = get().addTask({
        title: copyTitle,
        description: source.description,
        done: false,
        done_at: null,
        priority: source.priority,
        percent_done: 0,
        color: source.color,
        hex_color: source.hex_color ?? source.color,
        due_date: source.due_date ?? null,
        start_date: source.start_date ?? null,
        end_date: source.end_date ?? null,
        repeat_after: source.repeat_after,
        repeat_mode: source.repeat_mode,
        reminders: source.reminders ? source.reminders.map((r) => ({ ...r })) : undefined,
        labels: source.labels ? source.labels.map((l) => ({ ...l })) : undefined,
        assignees: source.assignees ? source.assignees.map((u) => ({ ...u })) : undefined,
        project_id: source.project_id,
      });

      const sourceSubtasks = source.related_tasks?.subtask || [];
      for (const sub of sourceSubtasks) {
        if (sub?.title) {
          get().addSubtask(duplicated.id, sub.title);
        }
      }

      return (get().tasks || []).find((t) => t.id === duplicated.id) || duplicated;
    },

    updateTaskDetails: (taskId: number, updates: UpdateTaskInput) => {
      const { tasks, labels: currentStoreLabels, syncQueue, client, isLocalMode, appBadgeMode } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const task = safeTasks.find((t) => t.id === taskId);
      const nowDate = new Date();
      const now = nowDate.toISOString();

      let normalizedUpdates = { ...updates };
      let nextStoreLabels: Label[] | null = null;
      if (isLocalMode && !client && updates.labels !== undefined) {
        const rec = reconcileLocalLabels(updates.labels, currentStoreLabels || []);
        normalizedUpdates.labels = rec.taskLabels;
        if (rec.storeChanged) {
          nextStoreLabels = rec.storeLabels;
        }
      }

      let rolledOverParent: Task | null = null;
      const buildNextTask = (existing: Task): Task => {
        const mergedCandidate: Task = { ...existing, ...normalizedUpdates, updated: now };
        if (normalizedUpdates.done !== undefined && normalizedUpdates.done_at === undefined) {
          mergedCandidate.done_at = normalizedUpdates.done ? existing.done_at || now : null;
        }
        if (
          !existing.done &&
          normalizedUpdates.done === true &&
          isLocalMode &&
          !client &&
          isTaskRecurring(mergedCandidate)
        ) {
          const rolled = computeNextRecurringTaskState(mergedCandidate, nowDate);
          rolledOverParent = rolled;
          return rolled;
        }
        return mergedCandidate;
      };

      const mappedTasks = safeTasks.map((t) => (t.id === taskId ? buildNextTask(t) : t));
      const { tasks: withResetSubs, resetSubtaskIds } = rolledOverParent
        ? resetCompletedSubtasksForRecurringParent(mappedTasks, rolledOverParent, now)
        : { tasks: mappedTasks, resetSubtaskIds: [] as number[] };
      const updatedTasks = synchronizeRelatedTaskSnapshots(withResetSubs);

      set({
        tasks: updatedTasks,
        ...(nextStoreLabels ? { labels: nextStoreLabels } : {}),
      });
      persistTasksDebounced(updatedTasks);
      if (nextStoreLabels) {
        AsyncStorage.setItem(CACHE_KEY_LABELS, JSON.stringify(nextStoreLabels)).catch(() => {});
      }

      const updatedTaskObj = updatedTasks.find((t) => t.id === taskId);
      if (updatedTaskObj) {
        scheduleTaskReminders(updatedTaskObj).catch(() => {});
      }
      for (const resetSubId of resetSubtaskIds) {
        const subObj = updatedTasks.find((t) => t.id === resetSubId);
        if (subObj && !subObj.done && subObj.reminders && subObj.reminders.length > 0) {
          scheduleTaskReminders(subObj).catch(() => {});
        }
      }
      syncAppBadgeCount(updatedTasks, appBadgeMode).catch(() => {});

      if (syncQueue) {
        if (normalizedUpdates.assignees !== undefined && task) {
          syncQueue.enqueue({
            id: `assignees-${taskId}-${Date.now()}`,
            type: 'SET_TASK_ASSIGNEES',
            payload: {
              taskId,
              assignees: normalizedUpdates.assignees,
              previousAssignees: task.assignees || [],
            },
            timestamp: Date.now(),
          });
        }
        if (normalizedUpdates.labels !== undefined && task) {
          syncQueue.enqueue({
            id: `labels-${taskId}-${Date.now()}`,
            type: 'SET_TASK_LABELS',
            payload: {
              taskId,
              labels: normalizedUpdates.labels,
              previousLabels: task.labels || [],
            },
            timestamp: Date.now(),
          });
        }

        const mergedTaskData = {
          ...task,
          ...normalizedUpdates,
        };

        syncQueue.enqueue({
          id: `update-${taskId}-${Date.now()}`,
          type: 'UPDATE_TASK',
          payload: { taskId, data: mergedTaskData },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },

    moveTask: (taskId: number, targetProjectId: number) => {
      const { tasks, syncQueue } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const task = safeTasks.find((t) => t.id === taskId);
      const updatedTasks = safeTasks.map((t) =>
        t.id === taskId ? { ...t, project_id: targetProjectId } : t
      );

      set({ tasks: updatedTasks });
      persistTasksDebounced(updatedTasks);

      safeHaptics.selection();

      const updatedTask = task
        ? { ...task, project_id: targetProjectId }
        : { project_id: targetProjectId };

      if (syncQueue) {
        syncQueue.enqueue({
          id: `move-${taskId}-${Date.now()}`,
          type: 'MOVE_TASK',
          payload: { taskId, targetProjectId, data: updatedTask },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },

    reorderTasks: (projectId: number, orderedTaskIds: number[], immediateSync = false) => {
      const epoch = sessionEpoch;
      const { tasks, syncQueue } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const isGlobal = projectId <= 0;

      // Capture baseline positions across debounced drags so intermediate drags never mask changed tasks
      for (const t of safeTasks) {
        if (!pendingReorderBaseline.has(t.id)) {
          pendingReorderBaseline.set(t.id, t.position);
        }
      }

      // 1. Instantly update positions in memory and local storage
      const updatedTasks = safeTasks.map((t) => {
        if (!isGlobal && t.project_id !== projectId) return t;
        const index = orderedTaskIds.indexOf(t.id);
        if (index === -1) return t;
        return { ...t, position: (index + 1) * 1000 };
      });

      set({ tasks: updatedTasks });
      persistTasksDebounced(updatedTasks);

      safeHaptics.selection();

      if (!syncQueue) {
        pendingReorderBaseline.clear();
        return;
      }

      const performSync = async () => {
        if (epoch !== sessionEpoch) return;

        const latestState = get();
        const latestQueue = latestState.syncQueue;
        const latestClient = latestState.client;
        if (!latestQueue) {
          pendingReorderBaseline.clear();
          return;
        }

        const latestTasks = latestState.tasks || [];
        const latestTaskMap = new Map(latestTasks.map((t) => [t.id, t]));

        // Only sync tasks whose position actually changed from baseline
        const changedEntries: { id: number; newPos: number; taskObj: Task | undefined }[] = [];
        orderedTaskIds.forEach((id, idx) => {
          const taskObj = latestTaskMap.get(id);
          const newPos = taskObj?.position ?? (idx + 1) * 1000;
          const prevPos = pendingReorderBaseline.get(id);
          if (prevPos !== newPos) {
            changedEntries.push({ id, newPos, taskObj });
          }
        });
        pendingReorderBaseline.clear();

        if (changedEntries.length === 0) return;

        // 2. Await getProjectViews for any target project missing cached views BEFORE enqueuing
        const neededProjectIds = new Set<number>();
        for (const { taskObj } of changedEntries) {
          const pid = taskObj?.project_id || projectId;
          if (pid > 0) {
            const proj = (get().projects || []).find((p) => p.id === pid);
            if (!proj?.views || proj.views.length === 0) {
              neededProjectIds.add(pid);
            }
          }
        }

        if (
          neededProjectIds.size > 0 &&
          latestClient &&
          typeof latestClient.getProjectViews === 'function'
        ) {
          await Promise.all(
            Array.from(neededProjectIds).map(async (pid) => {
              try {
                const views = await latestClient.getProjectViews(pid);
                if (epoch !== sessionEpoch) return;
                if (Array.isArray(views) && views.length > 0) {
                  set((s) => ({
                    projects: (s.projects || []).map((p) =>
                      p.id === pid ? { ...p, views } : p
                    ),
                  }));
                }
              } catch (_) {
                // Offline or unsupported — reorderTask falls back safely using full task snapshot
              }
            })
          );
        }

        if (epoch !== sessionEpoch) return;

        const currentProjects = get().projects || [];
        const currentProject = currentProjects.find((p) => p.id === projectId);
        const defaultViewId =
          currentProject?.views?.find((v) => v.view_kind === 'list')?.id ||
          currentProject?.views?.[0]?.id;

        for (const { id, newPos, taskObj } of changedEntries) {
          const taskProjectId = taskObj?.project_id || projectId;
          const taskProject = currentProjects.find((p) => p.id === taskProjectId);
          const taskViewId =
            (!isGlobal ? defaultViewId : undefined) ||
            taskProject?.views?.find((v) => v.view_kind === 'list')?.id ||
            taskProject?.views?.[0]?.id;

          latestQueue.enqueue({
            id: `reorder-${id}-${Date.now()}`,
            type: 'REORDER_TASK',
            payload: {
              taskId: id,
              position: newPos,
              projectViewId: taskViewId,
              data: taskObj,
            },
            timestamp: Date.now(),
          });
        }
        latestQueue.processQueue();
      };

      if (reorderSyncTimer) {
        clearTimeout(reorderSyncTimer);
        reorderSyncTimer = null;
      }

      if (immediateSync) {
        performSync().catch(() => {});
      } else {
        reorderSyncTimer = setTimeout(() => {
          reorderSyncTimer = null;
          performSync().catch(() => {});
        }, 400);
      }
    },

    deleteTask: (taskId: number) => {
      const { tasks, syncQueue, appBadgeMode } = get();
      const safeTasks = Array.isArray(tasks) ? tasks : [];
      const updatedTasks = synchronizeRelatedTaskSnapshots(
        safeTasks.filter((t) => t.id !== taskId),
        undefined,
        taskId
      );

      set({ tasks: updatedTasks });
      persistTasksDebounced(updatedTasks);

      cancelTaskReminders(taskId).catch(() => {});
      syncAppBadgeCount(updatedTasks, appBadgeMode).catch(() => {});

      if (syncQueue) {
        syncQueue.enqueue({
          id: `delete-${taskId}-${Date.now()}`,
          type: 'DELETE_TASK',
          payload: { taskId },
          timestamp: Date.now(),
        });
        syncQueue.processQueue();
      }
    },
  };
});
