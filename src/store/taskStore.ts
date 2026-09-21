import { create } from 'zustand';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CreateTaskInput, Label, Project, Task, UpdateTaskInput, User } from '../types/vikunja';
import { VikunjaClient } from '../api/client';
import { SyncQueue, SyncStatus } from './syncQueue';
import { safeHaptics } from '../utils/haptics';

const CACHE_KEY_PROJECTS = '@vikunja_cached_projects';
const CACHE_KEY_TASKS = '@vikunja_cached_tasks';
const CACHE_KEY_LABELS = '@vikunja_cached_labels';
const CACHE_KEY_USERS = '@vikunja_cached_users';
const CACHE_KEY_REENABLE_STAPLES = '@vikunja_reenable_staples';
const CACHE_KEY_LAST_PROJECT = '@vikunja_last_project_id';

export interface TaskState {
  client: VikunjaClient | null;
  syncQueue: SyncQueue | null;
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  cachedUsers: User[];
  selectedProjectId: number | null;
  isLoading: boolean;
  error: string | null;

  // Offline & Sync
  syncStatus: SyncStatus;
  pendingSyncCount: number;

  // Settings
  reenableStaples: boolean;

  // Actions
  initialize: (baseUrl: string, token?: string) => Promise<void>;
  loadCachedData: () => Promise<void>;
  setReenableStaples: (enabled: boolean) => Promise<void>;
  retrySync: () => Promise<void>;
  setSelectedProjectId: (id: number | null) => void;
  fetchProjects: () => Promise<void>;
  fetchLabels: () => Promise<Label[]>;
  fetchUsers: (query?: string) => Promise<User[]>;
  setCachedUsers: (users: User[]) => void;
  fetchTasks: (projectId: number) => Promise<void>;
  fetchAllTasks: () => Promise<void>;
  syncAll: () => Promise<void>;
  resetAndSyncFromServer: () => Promise<void>;
  toggleTask: (taskId: number) => void;
  reenableTask: (taskId: number, newLabels?: Label[]) => void;
  updateTaskLabels: (taskId: number, labels: Label[]) => void;
  updateTaskAssignees: (taskId: number, assignees: User[]) => void;
  addTask: (input: CreateTaskInput) => Task;
  updateTaskDetails: (taskId: number, updates: UpdateTaskInput) => void;
  moveTask: (taskId: number, targetProjectId: number) => void;
  reorderTasks: (projectId: number, orderedTaskIds: number[]) => void;
  deleteTask: (taskId: number) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  client: null,
  syncQueue: null,
  projects: [],
  tasks: [],
  labels: [],
  cachedUsers: [],
  selectedProjectId: null,
  isLoading: false,
  error: null,
  syncStatus: 'synced',
  pendingSyncCount: 0,
  reenableStaples: true,

  initialize: async (baseUrl: string, token?: string) => {
    const client = new VikunjaClient({ baseUrl, token });
    const syncQueue = new SyncQueue(client);

    syncQueue.onStatusChange((syncStatus, pendingSyncCount) => {
      set({ syncStatus, pendingSyncCount });
    });

    set({ client, syncQueue });
    await get().loadCachedData();
  },

  loadCachedData: async () => {
    try {
      const [
        cachedProjectsRaw,
        cachedTasksRaw,
        cachedLabelsRaw,
        cachedUsersRaw,
        reenableSettingRaw,
        lastProjectRaw,
      ] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY_PROJECTS),
        AsyncStorage.getItem(CACHE_KEY_TASKS),
        AsyncStorage.getItem(CACHE_KEY_LABELS),
        AsyncStorage.getItem(CACHE_KEY_USERS),
        AsyncStorage.getItem(CACHE_KEY_REENABLE_STAPLES),
        AsyncStorage.getItem(CACHE_KEY_LAST_PROJECT),
      ]);

      const updates: Partial<TaskState> = {};

      if (cachedProjectsRaw) {
        const cachedProjects = JSON.parse(cachedProjectsRaw);
        if (Array.isArray(cachedProjects) && cachedProjects.length > 0) {
          updates.projects = cachedProjects;
          updates.selectedProjectId = cachedProjects[0].id;
        }
      }

      if (lastProjectRaw) {
        const parsedId = Number(lastProjectRaw);
        if (!isNaN(parsedId)) {
          updates.selectedProjectId = parsedId;
        }
      }

      if (cachedTasksRaw) {
        const cachedTasks = JSON.parse(cachedTasksRaw);
        if (Array.isArray(cachedTasks)) {
          updates.tasks = cachedTasks;
        }
      }

      if (cachedLabelsRaw) {
        const cachedLabels = JSON.parse(cachedLabelsRaw);
        if (Array.isArray(cachedLabels)) {
          updates.labels = cachedLabels;
        }
      }

      if (cachedUsersRaw) {
        const cachedUsers = JSON.parse(cachedUsersRaw);
        if (Array.isArray(cachedUsers)) {
          updates.cachedUsers = cachedUsers;
        }
      }

      if (reenableSettingRaw !== null) {
        updates.reenableStaples = reenableSettingRaw === 'true';
      }

      set(updates);
    } catch (e) {
      // Ignore cache load errors gracefully
    }
  },

  setCachedUsers: (users: User[]) => {
    set({ cachedUsers: users });
    AsyncStorage.setItem(CACHE_KEY_USERS, JSON.stringify(users)).catch(() => {});
  },

  fetchUsers: async (query?: string): Promise<User[]> => {
    const { client, cachedUsers } = get();
    if (!client || typeof client.searchUsers !== 'function') return cachedUsers;

    try {
      const users = await client.searchUsers(query || '');
      const safe = Array.isArray(users) ? users : [];
      if (safe.length > 0) {
        const map = new Map<string, User>(cachedUsers.map((u) => [u.username.toLowerCase(), u]));
        safe.forEach((u) => map.set(u.username.toLowerCase(), u));
        const merged = Array.from(map.values());
        set({ cachedUsers: merged });
        AsyncStorage.setItem(CACHE_KEY_USERS, JSON.stringify(merged)).catch(() => {});
        return merged;
      }
      return cachedUsers;
    } catch (_) {
      return cachedUsers;
    }
  },

  setReenableStaples: async (enabled: boolean) => {
    set({ reenableStaples: enabled });
    try {
      await AsyncStorage.setItem(CACHE_KEY_REENABLE_STAPLES, enabled ? 'true' : 'false');
    } catch (e) {
      // non-blocking
    }
  },

  retrySync: async () => {
    await get().syncAll();
  },

  setSelectedProjectId: (id: number | null) => {
    set({ selectedProjectId: id });
    if (id !== null) {
      AsyncStorage.setItem(CACHE_KEY_LAST_PROJECT, id.toString()).catch(() => {});
      get().fetchTasks(id);
    } else {
      AsyncStorage.removeItem(CACHE_KEY_LAST_PROJECT).catch(() => {});
      get().fetchAllTasks();
    }
  },

  fetchLabels: async (): Promise<Label[]> => {
    const { client } = get();
    if (!client || typeof client.getLabels !== 'function') return [];

    try {
      const labels = await client.getLabels();
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

  fetchProjects: async () => {
    const { client } = get();
    if (!client) return;

    set({ isLoading: true, error: null });
    try {
      const rawProjects = await client.getProjects();
      const projects = Array.isArray(rawProjects) ? rawProjects : [];
      set({ projects, isLoading: false });

      // Cache projects locally for offline access
      AsyncStorage.setItem(CACHE_KEY_PROJECTS, JSON.stringify(projects)).catch(() => {});

      if (projects.length > 0) {
        const curId = get().selectedProjectId;
        if (curId !== null) {
          const targetId = projects.some((p) => p.id === curId) ? curId : null;
          set({ selectedProjectId: targetId });
        }
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch projects', isLoading: false });
    }
  },

  fetchTasks: async (projectId: number) => {
    const { client } = get();
    if (!client) return;

    set({ isLoading: true, error: null });
    try {
      const rawTasks = await client.getTasks(projectId);
      const tasks = Array.isArray(rawTasks) ? rawTasks : [];

      const serverLabelsMap = new Map<string, string>();
      (get().labels || []).forEach((l) => {
        const c = l.hex_color || l.color;
        if (c) {
          serverLabelsMap.set(l.title.toLowerCase(), c);
          if (l.id > 0) {
            serverLabelsMap.set(`id:${l.id}`, c);
          }
        }
      });

      const enrichedTasks = tasks.map((t) => ({
        ...t,
        labels: (t.labels || []).map((l) => {
          const canonicalColor =
            (l.id > 0 ? serverLabelsMap.get(`id:${l.id}`) : undefined) ||
            serverLabelsMap.get(l.title.toLowerCase()) ||
            l.hex_color ||
            l.color;
          return {
            ...l,
            hex_color: canonicalColor,
            color: canonicalColor,
          };
        }),
      }));

      const currentTasks = get().tasks || [];
      // Keep tasks for other projects and any local optimistic tasks
      const otherTasks = currentTasks.filter((t) => t.project_id !== projectId || t.id < 0);
      const merged = [...enrichedTasks, ...otherTasks];

      set({ tasks: merged, isLoading: false });

      // Cache all tasks locally for offline access
      AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(merged)).catch(() => {});
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch tasks', isLoading: false });
    }
  },

  fetchAllTasks: async () => {
    const { client } = get();
    if (!client) return;

    set({ isLoading: true, error: null });
    try {
      const projects = (get().projects || []).filter((p) => p.id > 0);

      // 1. Fetch via getAllTasks if available (do not catch here; errors should fall through to catch block)
      const allTasksPromise =
        typeof client.getAllTasks === 'function'
          ? client.getAllTasks()
          : Promise.resolve([]);

      // 2. Also fetch tasks per project to guarantee 100% project coverage
      const projectTaskPromises =
        typeof client.getTasks === 'function'
          ? projects.map((p) => client.getTasks(p.id))
          : [];

      const [allTasksRes, ...projectTaskLists] = await Promise.all([
        allTasksPromise,
        ...projectTaskPromises,
      ]);

      const taskMap = new Map<number, Task>();
      const currentTasks = get().tasks || [];
      const currentTaskMap = new Map<number, Task>(currentTasks.map((t) => [t.id, t]));
      const syncQueue = get().syncQueue;

      // Server labels map for enriching canonical colors
      const serverLabelsMap = new Map<string, string>();
      (get().labels || []).forEach((l) => {
        const c = l.hex_color || l.color;
        if (c) {
          serverLabelsMap.set(l.title.toLowerCase(), c);
          if (l.id > 0) {
            serverLabelsMap.set(`id:${l.id}`, c);
          }
        }
      });

      const resolveLabels = (remoteTask: Task, localTask?: Task): Label[] => {
        // If there is an in-flight mutation for this task, respect local task's labels
        const hasPending =
          typeof syncQueue?.hasPendingForTask === 'function'
            ? syncQueue.hasPendingForTask(remoteTask.id)
            : false;
        if (hasPending && localTask) {
          return localTask.labels || [];
        }

        const remoteLabels = remoteTask.labels;
        const base = Array.isArray(remoteLabels) ? remoteLabels : [];
        return base.map((l) => {
          const canonicalColor =
            (l.id > 0 ? serverLabelsMap.get(`id:${l.id}`) : undefined) ||
            serverLabelsMap.get(l.title.toLowerCase()) ||
            l.hex_color ||
            l.color;
          return {
            ...l,
            hex_color: canonicalColor,
            color: canonicalColor,
          };
        });
      };

      (allTasksRes || []).forEach((t) => {
        const local = currentTaskMap.get(t.id);
        const labels = resolveLabels(t, local);
        taskMap.set(t.id, { ...t, labels });
      });

      projectTaskLists.forEach((list) => {
        (list || []).forEach((t) => {
          const local = currentTaskMap.get(t.id);
          const labels = resolveLabels(t, local);
          taskMap.set(t.id, { ...t, labels });
        });
      });

      // Keep local optimistic/temp tasks (id < 0) that are still pending sync
      currentTasks.filter((t) => t.id < 0).forEach((t) => taskMap.set(t.id, t));

      const merged = Array.from(taskMap.values());

      set({ tasks: merged, isLoading: false });
      AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(merged)).catch(() => {});
    } catch (err: any) {
      // Preserve existing cached tasks on network/fetch failure
      set({ error: err.message || 'Failed to fetch all tasks', isLoading: false });
    }
  },

  syncAll: async () => {
    const { client, syncQueue } = get();
    if (!client) return;

    set({ syncStatus: 'syncing' });
    try {
      // 1. Outbound sync: process queued mutations first
      if (syncQueue) {
        await syncQueue.processQueue();
      }

      // 2. Inbound sync: fetch all labels, projects & all tasks bi-directionally
      await get().fetchLabels();
      await get().fetchProjects();
      await get().fetchAllTasks();

      set({ syncStatus: 'synced' });
    } catch (err) {
      set({ syncStatus: 'offline' });
    }
  },

  resetAndSyncFromServer: async () => {
    const { client } = get();
    if (!client) return;

    set({ isLoading: true, syncStatus: 'syncing', error: null });
    try {
      // 1. Clear cached storage to eliminate any stale data
      await AsyncStorage.multiRemove([
        CACHE_KEY_TASKS,
        CACHE_KEY_LABELS,
        CACHE_KEY_PROJECTS,
      ]);

      // 2. Clear in-memory tasks
      set({ tasks: [] });

      // 3. Sequentially fetch fresh labels, projects, and all tasks
      await get().fetchLabels();
      await get().fetchProjects();
      await get().fetchAllTasks();

      set({ syncStatus: 'synced', isLoading: false });
    } catch (err: any) {
      set({
        error: err.message || 'Failed to reset and sync from server',
        isLoading: false,
        syncStatus: 'offline',
      });
      throw err;
    }
  },

  toggleTask: (taskId: number) => {
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const task = safeTasks.find((t) => t.id === taskId);
    if (!task) return;

    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...task,
      done: !task.done,
      done_at: !task.done ? now : null,
      updated: now,
    };
    const updatedTasks = safeTasks.map((t) => (t.id === taskId ? updatedTask : t));

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);

    if (syncQueue) {
      syncQueue.enqueue({
        id: `toggle-${taskId}-${Date.now()}`,
        type: 'TOGGLE_TASK',
        payload: { taskId, done: updatedTask.done },
        timestamp: Date.now(),
      });
      syncQueue.processQueue();
    }
  },

  reenableTask: (taskId: number, newLabels?: Label[]) => {
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const task = safeTasks.find((t) => t.id === taskId);
    if (!task) return;

    const updatedTask: Task = {
      ...task,
      done: false,
      done_at: null,
      due_date: null,
      end_date: null,
      labels: newLabels !== undefined ? newLabels : task.labels || [],
      position: 0,
      updated: new Date().toISOString(),
    };
    const remainingTasks = safeTasks.filter((t) => t.id !== taskId);
    const updatedTasks = [updatedTask, ...remainingTasks];

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);

    if (syncQueue) {
      syncQueue.enqueue({
        id: `reenable-${taskId}-${Date.now()}`,
        type: 'UPDATE_TASK',
        payload: {
          taskId,
          data: { done: false, done_at: null, due_date: null, end_date: null },
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
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const currentTask = safeTasks.find((t) => t.id === taskId);
    const previousLabels = currentTask?.labels || [];
    const updatedTasks = safeTasks.map((t) => (t.id === taskId ? { ...t, labels } : t));

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    safeHaptics.selection();

    if (syncQueue) {
      syncQueue.enqueue({
        id: `label-${taskId}-${Date.now()}`,
        type: 'SET_TASK_LABELS',
        payload: { taskId, labels, previousLabels },
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
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

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

  addTask: (input: CreateTaskInput): Task => {
    const { tasks, syncQueue } = get();
    const currentTasks = Array.isArray(tasks) ? tasks : [];
    const tempId = -Math.floor(Date.now() + Math.random() * 1000);

    // Enrich optimistic labels with server label colors if known
    const serverLabelsMap = new Map<string, string>();
    (get().labels || []).forEach((l) => {
      if (l.hex_color) {
        serverLabelsMap.set(l.title.toLowerCase(), l.hex_color);
      }
    });

    const optimisticLabels = (input.labels || []).map((l) => ({
      ...l,
      hex_color: l.hex_color || serverLabelsMap.get(l.title.toLowerCase()),
    }));

    const optimisticTask: Task = {
      id: tempId,
      title: input.title,
      description: input.description,
      done: false,
      priority: input.priority ?? 0,
      project_id: input.project_id,
      due_date: input.due_date ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      repeat_after: input.repeat_after,
      percent_done: input.percent_done,
      color: input.color,
      labels: optimisticLabels,
      assignees: input.assignees || [],
      position: (currentTasks.length + 1) * 1000,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    // Instant optimistic update
    const updatedTasks = [optimisticTask, ...currentTasks];
    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);

    if (syncQueue) {
      syncQueue.enqueue({
        id: `create-${tempId}`,
        type: 'CREATE_TASK',
        payload: { projectId: input.project_id, taskData: input },
        timestamp: Date.now(),
        onSuccess: (remoteTask: Task) => {
          // Replace temp task with remote task containing official Vikunja ID
          set((state) => {
            const finalTasks = (state.tasks || []).map((t) => {
              if (t.id === tempId) {
                return {
                  ...remoteTask,
                  // Preserve optimistic labels & assignees if remote task returns null/empty
                  labels:
                    remoteTask.labels && remoteTask.labels.length > 0
                      ? remoteTask.labels
                      : t.labels || [],
                  assignees:
                    remoteTask.assignees && remoteTask.assignees.length > 0
                      ? remoteTask.assignees
                      : t.assignees || [],
                };
              }
              return t;
            });
            AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(finalTasks)).catch(() => {});
            return { tasks: finalTasks };
          });
        },
      });
      syncQueue.processQueue();
    }

    return optimisticTask;
  },

  updateTaskDetails: (taskId: number, updates: UpdateTaskInput) => {
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const task = safeTasks.find((t) => t.id === taskId);
    const now = new Date().toISOString();
    const updatedTasks = safeTasks.map((t) => (t.id === taskId ? { ...t, ...updates, updated: now } : t));

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    if (syncQueue) {
      if (updates.assignees !== undefined && task) {
        syncQueue.enqueue({
          id: `assignees-${taskId}-${Date.now()}`,
          type: 'SET_TASK_ASSIGNEES',
          payload: {
            taskId,
            assignees: updates.assignees,
            previousAssignees: task.assignees || [],
          },
          timestamp: Date.now(),
        });
      }
      if (updates.labels !== undefined && task) {
        syncQueue.enqueue({
          id: `labels-${taskId}-${Date.now()}`,
          type: 'SET_TASK_LABELS',
          payload: {
            taskId,
            labels: updates.labels,
            previousLabels: task.labels || [],
          },
          timestamp: Date.now(),
        });
      }

      const { labels, assignees, ...taskData } = updates;
      if (Object.keys(taskData).length > 0) {
        syncQueue.enqueue({
          id: `update-${taskId}-${Date.now()}`,
          type: 'UPDATE_TASK',
          payload: { taskId, data: taskData },
          timestamp: Date.now(),
        });
      }
      syncQueue.processQueue();
    }
  },

  moveTask: (taskId: number, targetProjectId: number) => {
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const updatedTasks = safeTasks.map((t) =>
      t.id === taskId ? { ...t, project_id: targetProjectId } : t
    );

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    safeHaptics.selection();

    if (syncQueue) {
      syncQueue.enqueue({
        id: `move-${taskId}-${Date.now()}`,
        type: 'MOVE_TASK',
        payload: { taskId, targetProjectId },
        timestamp: Date.now(),
      });
      syncQueue.processQueue();
    }
  },

  reorderTasks: (projectId: number, orderedTaskIds: number[]) => {
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];

    const updatedTasks = safeTasks.map((t) => {
      if (t.project_id !== projectId) return t;
      const index = orderedTaskIds.indexOf(t.id);
      if (index === -1) return t;
      return { ...t, position: (index + 1) * 1000 };
    });

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

    safeHaptics.selection();

    if (syncQueue) {
      orderedTaskIds.forEach((id, idx) => {
        syncQueue.enqueue({
          id: `reorder-${id}-${Date.now()}`,
          type: 'REORDER_TASK',
          payload: { taskId: id, position: (idx + 1) * 1000 },
          timestamp: Date.now(),
        });
      });
      syncQueue.processQueue();
    }
  },

  deleteTask: (taskId: number) => {
    const { tasks, syncQueue } = get();
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const updatedTasks = safeTasks.filter((t) => t.id !== taskId);

    set({ tasks: updatedTasks });
    AsyncStorage.setItem(CACHE_KEY_TASKS, JSON.stringify(updatedTasks)).catch(() => {});

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
}));
