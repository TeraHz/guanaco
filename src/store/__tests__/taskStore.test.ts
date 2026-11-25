import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useTaskStore } from '../taskStore';
import { RepeatMode, ReminderRelativeTo } from '../../types/vikunja';
import { setActiveThemeMode } from '../../utils/theme';
import * as localNotifications from '../../services/localNotifications';

describe('useTaskStore', () => {
  beforeEach(async () => {
    await useTaskStore.getState().clearSession();
    await AsyncStorage.clear();
    setActiveThemeMode('system');
    useTaskStore.setState({
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [
        { id: 10, title: 'Task 1', done: false, priority: 1, project_id: 1, position: 1000 },
        { id: 20, title: 'Task 2', done: true, priority: 2, project_id: 1, position: 2000 },
      ],
      labels: [],
      cachedUsers: [],
      currentUser: null,
      selectedProjectId: 1,
      savedFilterTaskIds: {},
      pendingOpenTaskId: null,
      isLoading: false,
      error: null,
      client: null,
      syncQueue: null,
      syncStatus: 'synced',
      pendingSyncCount: 0,
      isSyncingAll: false,
      authRequired: false,
      reenableStaples: true,
      largeTaskItems: false,
      taskItemScale: 100,
      taskItemTextScale: 100,
      themeMode: 'system',
      weekStartDay: 1,
      appBadgeMode: 'off',
    });
    jest.clearAllMocks();
  });

  describe('Optimistic Task Toggling', () => {
    it('should toggle task completion immediately in state and trigger haptic feedback', async () => {
      const { toggleTask } = useTaskStore.getState();

      toggleTask(10);

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 10);
      expect(updatedTask?.done).toBe(true);
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Success
      );
    });

    it('should uncheck task if currently done', async () => {
      const { toggleTask } = useTaskStore.getState();

      toggleTask(20);

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 20);
      expect(updatedTask?.done).toBe(false);
    });
  });

  describe('Rapid Task Creation, Full Field Preservation & Cold-Restart Reconciliation', () => {
    it('should create optimistic task with temporary ID immediately', () => {
      const { addTask } = useTaskStore.getState();

      const tempTask = addTask({
        title: 'New urgent item',
        priority: 3,
        project_id: 1,
      });

      expect(tempTask.id).toBeLessThan(0);
      expect(tempTask.title).toBe('New urgent item');
      expect(tempTask.done).toBe(false);

      const tasksInStore = useTaskStore.getState().tasks;
      expect(tasksInStore).toContainEqual(expect.objectContaining({ title: 'New urgent item' }));
    });

    it('should preserve optimistic labels when remote task returns null labels (Regression: labels disappearing)', () => {
      let onSuccessCallback: any = null;
      const mockSyncQueue = {
        enqueue: jest.fn().mockImplementation((item) => {
          onSuccessCallback = item.onSuccess;
        }),
        processQueue: jest.fn(),
      };

      useTaskStore.setState({
        syncQueue: mockSyncQueue as any,
      });

      const { addTask } = useTaskStore.getState();
      const tempTask = addTask({
        title: 'Apples',
        project_id: 1,
        labels: [{ id: -1, title: 'Costco' }],
      });

      expect(useTaskStore.getState().tasks.find((t) => t.id === tempTask.id)?.labels).toEqual([
        { id: -1, title: 'Costco' },
      ]);

      if (onSuccessCallback) {
        onSuccessCallback({
          id: 55,
          title: 'Apples',
          project_id: 1,
          done: false,
          labels: null,
        });
      }

      const updated = useTaskStore.getState().tasks.find((t) => t.id === 55);
      expect(updated?.labels).toEqual([{ id: -1, title: 'Costco', hex_color: undefined, color: undefined }]);
    });

    it('preserves all CreateTaskInput fields (repeat_mode, reminders, start_date, end_date, percent_done, color, done) and schedules reminders', () => {
      const scheduleSpy = jest
        .spyOn(localNotifications, 'scheduleTaskReminders')
        .mockResolvedValue(undefined);

      const futureDue = new Date(Date.now() + 86400_000).toISOString();
      const created = useTaskStore.getState().addTask({
        title: 'Monthly Quarterly Review',
        description: 'Prepare metrics deck',
        done: false,
        priority: 4,
        project_id: 1,
        due_date: futureDue,
        start_date: '2026-11-20T09:00:00Z',
        end_date: '2026-11-25T17:00:00Z',
        repeat_after: 2592000,
        repeat_mode: RepeatMode.Monthly,
        reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: -1800 }],
        percent_done: 0.5,
        color: '#8b5cf6',
        labels: [{ id: -1, title: 'Work' }],
        assignees: [{ id: 1, username: 'terahz' }],
      });

      expect(created.id).toBeLessThan(0);
      expect(created).toMatchObject({
        title: 'Monthly Quarterly Review',
        description: 'Prepare metrics deck',
        done: false,
        priority: 4,
        project_id: 1,
        due_date: futureDue,
        start_date: '2026-11-20T09:00:00Z',
        end_date: '2026-11-25T17:00:00Z',
        repeat_after: 2592000,
        repeat_mode: RepeatMode.Monthly,
        reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: -1800 }],
        percent_done: 0.5,
        color: '#8b5cf6',
      });
      expect(scheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
      scheduleSpy.mockRestore();
    });

    it('reconciles tempId -> server ID and resolved label/user IDs across cold restart via persistent SyncQueue callbacks', async () => {
      const tempId = -4242;
      await AsyncStorage.setItem(
        '@vikunja_cached_tasks',
        JSON.stringify([
          {
            id: tempId,
            title: 'Offline Groceries',
            done: false,
            priority: 2,
            project_id: 1,
            labels: [{ id: -1, title: 'Costco' }],
            assignees: [{ id: -2, username: 'alice' }],
          },
        ])
      );
      await AsyncStorage.setItem(
        '@vikunja_sync_queue',
        JSON.stringify([
          {
            id: `create-${tempId}`,
            type: 'CREATE_TASK',
            payload: {
              tempId,
              projectId: 1,
              taskData: { title: 'Offline Groceries', priority: 2, project_id: 1 },
              labels: [{ id: -1, title: 'Costco' }],
              assignees: [{ id: -2, username: 'alice' }],
            },
            timestamp: 1000,
          },
        ])
      );

      global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
        if (url.endsWith('/projects/1/tasks') && opts?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              id: 777,
              title: 'Offline Groceries',
              done: false,
              priority: 2,
              project_id: 1,
            }),
          } as Response);
        }
        if (url.includes('/tasks/777') && opts?.method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ id: 777, title: 'Offline Groceries', labels: [], assignees: [] }),
          } as Response);
        }
        if (/\/labels(\?|$)/.test(url) && opts?.method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [{ id: 15, title: 'Costco', hex_color: '#ff5722' }],
          } as Response);
        }
        if (url.endsWith('/tasks/777/labels') && opts?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ message: 'ok' }),
          } as Response);
        }
        if (url.includes('/users/search')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [{ id: 25, username: 'alice' }],
          } as Response);
        }
        if (url.endsWith('/tasks/777/assignees') && opts?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ message: 'ok' }),
          } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response);
      });

      await useTaskStore.getState().initialize('https://try.vikunja.io', 'jwt-token');
      await useTaskStore.getState().syncQueue!.processQueue();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks.find((t) => t.id === tempId)).toBeUndefined();
      const syncedTask = tasks.find((t) => t.id === 777);
      expect(syncedTask).toBeDefined();
      expect(syncedTask?.labels).toEqual([
        expect.objectContaining({ id: 15, title: 'Costco', hex_color: '#ff5722' }),
      ]);
      expect(syncedTask?.assignees).toEqual([expect.objectContaining({ id: 25, username: 'alice' })]);
    });

    it('does NOT resurrect a tempId < 0 task deleted while CREATE_TASK was mid-flight, and replaces non-deleted tempId in-place', async () => {
      const scheduleSpy = jest
        .spyOn(localNotifications, 'scheduleTaskReminders')
        .mockResolvedValue(undefined);

      let resolveCreate1!: (res: any) => void;
      let resolveCreate2!: (res: any) => void;
      let createCount = 0;

      global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
        if (url.endsWith('/projects/1/tasks') && opts?.method === 'PUT') {
          createCount++;
          return new Promise((res) => {
            if (createCount === 1) resolveCreate1 = res;
            else resolveCreate2 = res;
          });
        }
        if (url.includes('/tasks/808') && opts?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ message: 'deleted' }),
          } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response);
      });

      await useTaskStore.getState().initialize('https://try.vikunja.io', 'jwt-token');
      useTaskStore.setState({
        tasks: [
          { id: 10, title: 'Anchor Top', done: false, priority: 1, project_id: 1, position: 1000 },
        ],
      });

      const deletedTemp = useTaskStore.getState().addTask({
        title: 'Deleted Mid-Flight',
        project_id: 1,
        due_date: new Date(Date.now() + 86400_000).toISOString(),
        reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
      });
      scheduleSpy.mockClear();

      useTaskStore.getState().deleteTask(deletedTemp.id);
      expect(useTaskStore.getState().tasks.find((t) => t.id === deletedTemp.id)).toBeUndefined();

      resolveCreate1({
        ok: true,
        status: 201,
        json: async () => ({
          id: 808,
          title: 'Deleted Mid-Flight',
          done: false,
          priority: 0,
          project_id: 1,
          due_date: new Date(Date.now() + 86400_000).toISOString(),
          reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
        }),
      });

      await new Promise((r) => setTimeout(r, 30));

      expect(useTaskStore.getState().tasks.find((t) => t.id === 808)).toBeUndefined();
      expect(scheduleSpy).not.toHaveBeenCalled();

      const keptTemp = useTaskStore.getState().addTask({ title: 'Middle Task', project_id: 1 });
      useTaskStore.setState((s) => ({
        tasks: [
          s.tasks.find((t) => t.id === 10)!,
          s.tasks.find((t) => t.id === keptTemp.id)!,
        ],
      }));

      resolveCreate2({
        ok: true,
        status: 201,
        json: async () => ({
          id: 909,
          title: 'Middle Task',
          done: false,
          priority: 0,
          project_id: 1,
        }),
      });

      await new Promise((r) => setTimeout(r, 30));
      expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual([10, 909]);

      scheduleSpy.mockRestore();
    });
  });

  describe('Moving Tasks between Lists', () => {
    it('should move task to new project immediately in local state', () => {
      const { moveTask } = useTaskStore.getState();

      moveTask(10, 2);

      const movedTask = useTaskStore.getState().tasks.find((t) => t.id === 10);
      expect(movedTask?.project_id).toBe(2);
      expect(Haptics.selectionAsync).toHaveBeenCalled();
    });
  });

  describe('Reordering Tasks in List', () => {
    it('should reorder tasks and update positions', () => {
      const { reorderTasks } = useTaskStore.getState();

      reorderTasks(1, [20, 10]);

      const projectTasks = useTaskStore
        .getState()
        .tasks.filter((t) => t.project_id === 1)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      expect(projectTasks[0].id).toBe(20);
      expect(projectTasks[1].id).toBe(10);
    });

    it('should reorder tasks in global / multi-project views (projectId <= 0)', () => {
      const { reorderTasks } = useTaskStore.getState();

      useTaskStore.setState({
        tasks: [
          { id: 101, title: 'Task in List 1', done: false, priority: 1, project_id: 1, position: 1000 },
          { id: 201, title: 'Task in List 2', done: false, priority: 1, project_id: 2, position: 2000 },
        ],
      });

      reorderTasks(0, [201, 101]);

      const updatedTasks = useTaskStore.getState().tasks;
      const pos201 = updatedTasks.find((t) => t.id === 201)?.position ?? 0;
      const pos101 = updatedTasks.find((t) => t.id === 101)?.position ?? 0;
      expect(pos201).toBeGreaterThan(0);
      expect(pos201).toBeLessThan(pos101);
    });

    it('fetchTasks should NOT overwrite local task positions when server returns Go default position: 0', async () => {
      const mockClient = {
        getTasks: jest.fn().mockResolvedValue([
          { id: 10, title: 'Task 1', done: false, priority: 1, project_id: 1, position: 0 },
          { id: 20, title: 'Task 2', done: true, priority: 2, project_id: 1, position: 0 },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        tasks: [
          { id: 10, title: 'Task 1', done: false, priority: 1, project_id: 1, position: 2000 },
          { id: 20, title: 'Task 2', done: true, priority: 2, project_id: 1, position: 1000 },
        ],
      });

      await useTaskStore.getState().fetchTasks(1);

      const tasks = useTaskStore.getState().tasks;
      expect(tasks.find((t) => t.id === 10)?.position).toBe(2000);
      expect(tasks.find((t) => t.id === 20)?.position).toBe(1000);
    });

    it('fetchAllTasks should preserve local task positions when server returns Go default position: 0', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockResolvedValue([
          { id: 1, title: 'Task 1', done: false, priority: 1, project_id: 1, position: 0 },
          { id: 2, title: 'Task 2', done: false, priority: 1, project_id: 1, position: 0 },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        projects: [{ id: 1, title: 'Main' }],
        tasks: [
          { id: 1, title: 'Task 1', done: false, priority: 1, project_id: 1, position: 3000 },
          { id: 2, title: 'Task 2', done: false, priority: 1, project_id: 1, position: 1000 },
        ],
      });

      await useTaskStore.getState().fetchAllTasks();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks.find((t) => t.id === 1)?.position).toBe(3000);
      expect(tasks.find((t) => t.id === 2)?.position).toBe(1000);
    });

    it('handles all 4 resolvePosition cases accurately (pending reorder, positive remote, Go position: 0 vs local custom/0, and fresh position: 0)', async () => {
      const mockSyncQueue = {
        hasPendingForTask: (id: number, type?: string) => id === 10 && type === 'REORDER_TASK',
      };
      const mockClient = {
        getTasks: jest.fn().mockResolvedValue([
          { id: 10, title: 'Pending Reorder to Top', done: false, priority: 1, project_id: 1, position: 4000 },
          { id: 20, title: 'Server Repositioned', done: false, priority: 1, project_id: 1, position: 3500 },
          { id: 30, title: 'Custom Local Order', done: false, priority: 1, project_id: 1, position: 0 },
          { id: 40, title: 'Reenabled Top Task', done: false, priority: 1, project_id: 1, position: 0 },
          { id: 50, title: 'Fresh Remote Zero', done: false, priority: 1, project_id: 1, position: 0 },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: mockSyncQueue as any,
        tasks: [
          { id: 10, title: 'Pending Reorder to Top', done: false, priority: 1, project_id: 1, position: 0 },
          { id: 20, title: 'Server Repositioned', done: false, priority: 1, project_id: 1, position: 1000 },
          { id: 30, title: 'Custom Local Order', done: false, priority: 1, project_id: 1, position: 2000 },
          { id: 40, title: 'Reenabled Top Task', done: false, priority: 1, project_id: 1, position: 0 },
        ],
      });

      await useTaskStore.getState().fetchTasks(1);
      const tasks = useTaskStore.getState().tasks;

      expect(tasks.find((t) => t.id === 10)?.position).toBe(0);
      expect(tasks.find((t) => t.id === 20)?.position).toBe(3500);
      expect(tasks.find((t) => t.id === 30)?.position).toBe(2000);
      expect(tasks.find((t) => t.id === 40)?.position).toBe(0);
      expect(tasks.find((t) => t.id === 50)?.position).toBe(0);
    });

    it('awaits getProjectViews before enqueuing REORDER_TASK and only enqueues tasks whose positions changed', async () => {
      const mockEnqueue = jest.fn();
      const mockSyncQueue = {
        enqueue: mockEnqueue,
        processQueue: jest.fn(),
      };
      const mockClient = {
        getProjectViews: jest.fn().mockResolvedValue([
          { id: 42, title: 'List', project_id: 1, view_kind: 'list' },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: mockSyncQueue as any,
        projects: [{ id: 1, title: 'Inbox' }],
        tasks: [
          { id: 10, title: 'Stay First', done: false, priority: 0, project_id: 1, position: 1000 },
          { id: 20, title: 'Swap Second', done: false, priority: 0, project_id: 1, position: 2000 },
          { id: 30, title: 'Swap Third', done: false, priority: 0, project_id: 1, position: 3000 },
        ],
      });

      useTaskStore.getState().reorderTasks(1, [10, 30, 20], true);
      await new Promise((r) => setTimeout(r, 20));

      expect(mockClient.getProjectViews).toHaveBeenCalledWith(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    it('queues only 1 REORDER_TASK using LIS float midpoint when dragging 1 item in a 20-item list', async () => {
      const mockEnqueue = jest.fn();
      const mockSyncQueue = {
        enqueue: mockEnqueue,
        processQueue: jest.fn(),
      };
      const mockClient = {
        getProjectViews: jest.fn().mockResolvedValue([
          { id: 7, title: 'List', project_id: 1, view_kind: 'list' },
        ]),
      };

      const twentyTasks = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        title: `Item ${i + 1}`,
        done: false,
        priority: 0,
        project_id: 1,
        position: (i + 1) * 1000,
      }));

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: mockSyncQueue as any,
        projects: [{ id: 1, title: 'Inbox', views: [{ id: 7, title: 'List', project_id: 1, view_kind: 'list' }] }],
        tasks: twentyTasks,
      });

      // Drag item 20 between item 2 (2000) and item 3 (3000)
      const newOrder = [1, 2, 20, ...Array.from({ length: 17 }, (_, i) => i + 3)];
      useTaskStore.getState().reorderTasks(1, newOrder, true);
      await new Promise((r) => setTimeout(r, 20));

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REORDER_TASK',
          payload: expect.objectContaining({
            taskId: 20,
            position: 2500,
            projectViewId: 7,
          }),
        })
      );
    });
  });

  describe('Deleting Tasks', () => {
    it('should remove task immediately from store', () => {
      const { deleteTask } = useTaskStore.getState();

      deleteTask(10);

      expect(useTaskStore.getState().tasks.find((t) => t.id === 10)).toBeUndefined();
    });
  });

  describe('Re-enabling Staple Tasks (Staple Foods / Recurring Items)', () => {
    it('should re-enable done task, unchecking it and clearing past due date & time', () => {
      useTaskStore.setState({
        tasks: [
          {
            id: 20,
            title: 'Almond Milk',
            done: true,
            priority: 0,
            done_at: '2023-01-01T00:00:00Z',
            due_date: '2023-01-01T12:00:00Z',
            project_id: 1,
            labels: [{ id: 1, title: 'Costco' }],
          },
        ],
      });

      useTaskStore.getState().reenableTask(20);

      const reenabled = useTaskStore.getState().tasks.find((t) => t.id === 20);
      expect(reenabled?.done).toBe(false);
      expect(reenabled?.done_at).toBeNull();
      expect(reenabled?.due_date).toBeNull();
    });

    it('should re-enable task with optional new labels (e.g. moving item to another store)', () => {
      useTaskStore.setState({
        tasks: [
          {
            id: 20,
            title: 'Eggs',
            done: true,
            priority: 0,
            project_id: 1,
            labels: [{ id: 1, title: 'Costco' }],
          },
        ],
      });

      useTaskStore.getState().reenableTask(20, [{ id: 2, title: "Trader Joe's" }]);

      const reenabled = useTaskStore.getState().tasks.find((t) => t.id === 20);
      expect(reenabled?.done).toBe(false);
      expect(reenabled?.labels).toEqual([{ id: 2, title: "Trader Joe's" }]);
    });

    it('should allow toggling reenableStaples setting and persist preference', async () => {
      const { setReenableStaples } = useTaskStore.getState();
      expect(useTaskStore.getState().reenableStaples).toBe(true);

      await setReenableStaples(false);
      expect(useTaskStore.getState().reenableStaples).toBe(false);

      await setReenableStaples(true);
      expect(useTaskStore.getState().reenableStaples).toBe(true);
    });
  });

  describe('Quick Label Editing', () => {
    it('should quickly update task labels directly', () => {
      useTaskStore.getState().updateTaskLabels(10, [{ id: 5, title: 'Supermarket' }]);

      const task = useTaskStore.getState().tasks.find((t) => t.id === 10);
      expect(task?.labels).toEqual([{ id: 5, title: 'Supermarket' }]);
    });
  });

  describe('Offline Caching & Sync Status', () => {
    it('should provide syncStatus (synced by default) and pendingSyncCount', () => {
      const state = useTaskStore.getState();
      expect(state.syncStatus).toBe('synced');
      expect(state.pendingSyncCount).toBe(0);
    });

    it('should load cached projects (preferring active over archived) and tasks from AsyncStorage', async () => {
      await AsyncStorage.setItem(
        '@vikunja_cached_projects',
        JSON.stringify([
          { id: 98, title: 'Archived List', is_archived: true },
          { id: 99, title: 'Offline List', is_archived: false },
        ])
      );
      await AsyncStorage.setItem(
        '@vikunja_cached_tasks',
        JSON.stringify([{ id: 999, title: 'Offline Milk', done: false, project_id: 99 }])
      );

      await useTaskStore.getState().loadCachedData();

      expect(useTaskStore.getState().selectedProjectId).toBe(99);
      expect(useTaskStore.getState().projects).toContainEqual(
        expect.objectContaining({ id: 99, title: 'Offline List' })
      );
      expect(useTaskStore.getState().tasks).toContainEqual(
        expect.objectContaining({ id: 999, title: 'Offline Milk' })
      );
    });
  });

  describe('Bidirectional Sync & Multi-Project Task Preservation', () => {
    it('fetchTasks(projectId) should NOT erase tasks belonging to other projects', async () => {
      const mockClient = {
        getTasks: jest.fn().mockResolvedValue([
          { id: 201, title: 'Project 2 Task', done: false, priority: 1, project_id: 2 },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        tasks: [
          { id: 101, title: 'Project 1 Task', done: false, priority: 1, project_id: 1 },
        ],
      });

      await useTaskStore.getState().fetchTasks(2);

      const allTasks = useTaskStore.getState().tasks;
      expect(allTasks.find((t) => t.id === 101)).toBeDefined();
      expect(allTasks.find((t) => t.id === 201)).toBeDefined();
    });

    it('fetchAllTasks() should pull all tasks across projects and preserve optimistic pending tasks', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockResolvedValue([
          { id: 1, title: 'Remote Task 1', done: false, priority: 1, project_id: 1 },
          { id: 2, title: 'Remote Task 2', done: true, priority: 2, project_id: 2 },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        tasks: [
          { id: -999, title: 'Optimistic Offline Task', done: false, priority: 3, project_id: 1 },
        ],
      });

      await useTaskStore.getState().fetchAllTasks();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks).toHaveLength(3);
      expect(tasks.find((t) => t.id === -999)).toBeDefined();
      expect(tasks.find((t) => t.id === 1)).toBeDefined();
      expect(tasks.find((t) => t.id === 2)).toBeDefined();
    });

    it('respects pending DELETE, TOGGLE, UPDATE, MOVE, SET_TASK_LABELS, SET_TASK_ASSIGNEES, and drops orphaned negative IDs', async () => {
      const pendingByTaskAndType = new Set<string>([
        '1:DELETE_TASK',
        '2:TOGGLE_TASK',
        '3:UPDATE_TASK',
        '4:MOVE_TASK',
        '5:SET_TASK_LABELS',
        '6:SET_TASK_ASSIGNEES',
        '-100:CREATE_TASK',
      ]);

      const mockSyncQueue = {
        hasPendingForTask: (taskId: number, type?: string) => {
          if (type) return pendingByTaskAndType.has(`${taskId}:${type}`);
          return Array.from(pendingByTaskAndType).some((k) => k.startsWith(`${taskId}:`));
        },
      };

      const mockClient = {
        getAllTasks: jest.fn().mockResolvedValue([
          { id: 1, title: 'Deleted Locally', done: false, priority: 0, project_id: 1 },
          { id: 2, title: 'Toggled Locally', done: false, priority: 0, project_id: 1 },
          { id: 3, title: 'Old Server Title', done: false, priority: 1, project_id: 1 },
          { id: 4, title: 'Moved Locally', done: false, priority: 0, project_id: 1 },
          { id: 5, title: 'Label Edited', done: false, priority: 0, project_id: 1, labels: [] },
          { id: 6, title: 'Assignee Edited', done: false, priority: 0, project_id: 1, assignees: [] },
        ]),
        getTasks: jest.fn().mockResolvedValue([]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: mockSyncQueue as any,
        projects: [],
        tasks: [
          { id: 2, title: 'Toggled Locally', done: true, done_at: '2026-11-22T00:00:00Z', priority: 0, project_id: 1 },
          { id: 3, title: 'Locally Edited Title', done: false, priority: 5, project_id: 1 },
          { id: 4, title: 'Moved Locally', done: false, priority: 0, project_id: 2 },
          { id: 5, title: 'Label Edited', done: false, priority: 0, project_id: 1, labels: [{ id: 9, title: 'LocalTag' }] },
          { id: 6, title: 'Assignee Edited', done: false, priority: 0, project_id: 1, assignees: [{ id: 8, username: 'bob' }] },
          { id: -100, title: 'Pending Create', done: false, priority: 0, project_id: 1 },
          { id: -200, title: 'Orphaned Temp Task Without Create', done: false, priority: 0, project_id: 1 },
        ],
      });

      await useTaskStore.getState().fetchAllTasks();
      const tasks = useTaskStore.getState().tasks;

      expect(tasks.find((t) => t.id === 1)).toBeUndefined();
      expect(tasks.find((t) => t.id === 2)?.done).toBe(true);
      expect(tasks.find((t) => t.id === 3)?.title).toBe('Locally Edited Title');
      expect(tasks.find((t) => t.id === 4)?.project_id).toBe(2);
      expect(tasks.find((t) => t.id === 5)?.labels?.[0].title).toBe('LocalTag');
      expect(tasks.find((t) => t.id === 6)?.assignees?.[0].username).toBe('bob');
      expect(tasks.find((t) => t.id === -100)).toBeDefined();
      expect(tasks.find((t) => t.id === -200)).toBeUndefined();
    });

    it('syncAll() should perform bidirectional sync: push queue mutations first, then pull projects and all tasks', async () => {
      const mockQueue = {
        processQueue: jest.fn().mockResolvedValue(undefined),
        getStatus: jest.fn().mockReturnValue('synced'),
        getQueue: jest.fn().mockReturnValue([]),
      };
      const mockClient = {
        getProjects: jest.fn().mockResolvedValue([
          { id: 1, title: 'Inbox' },
          { id: 2, title: 'Groceries' },
        ]),
        getAllTasks: jest.fn().mockResolvedValue([
          { id: 10, title: 'Buy Apples', done: false, priority: 1, project_id: 2 },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: mockQueue as any,
      });

      await useTaskStore.getState().syncAll();

      expect(mockQueue.processQueue).toHaveBeenCalled();
      expect(mockClient.getProjects).toHaveBeenCalled();
      expect(mockClient.getAllTasks).toHaveBeenCalled();
      expect(useTaskStore.getState().syncStatus).toBe('synced');
      expect(useTaskStore.getState().tasks).toContainEqual(
        expect.objectContaining({ title: 'Buy Apples' })
      );
    });

    it('sets syncStatus to offline when inbound or outbound sync fails instead of falsely reporting synced', async () => {
      const mockQueue = {
        processQueue: jest.fn().mockResolvedValue(undefined),
        getStatus: jest.fn().mockReturnValue('synced'),
        getQueue: jest.fn().mockReturnValue([]),
      };
      const mockClient = {
        getProjects: jest.fn().mockRejectedValue(new Error('Server unreachable')),
        getAllTasks: jest.fn().mockRejectedValue(new Error('Server unreachable')),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: mockQueue as any,
        tasks: [{ id: 10, title: 'Cached Task', done: false, priority: 1, project_id: 1 }],
      });

      await useTaskStore.getState().syncAll();

      expect(useTaskStore.getState().syncStatus).toBe('offline');
      expect(useTaskStore.getState().tasks).toHaveLength(1);
    });

    it('fetchAllTasks() should NOT wipe cached tasks when network fetch fails (offline protection)', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockRejectedValue(new Error('Network error: server unreachable')),
        getTasks: jest.fn().mockRejectedValue(new Error('Network error: server unreachable')),
      };

      useTaskStore.setState({
        client: mockClient as any,
        tasks: [{ id: 10, title: 'Cached Bread', done: false, priority: 1, project_id: 1 }],
      });

      await useTaskStore.getState().fetchAllTasks();

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].title).toBe('Cached Bread');
    });

    it('setSelectedProjectId(null) should select All Tasks mode and trigger fetchAllTasks', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockResolvedValue([
          { id: 1, title: 'Task 1', done: false, priority: 1, project_id: 1 },
        ]),
        getTasks: jest.fn().mockResolvedValue([]),
      };

      useTaskStore.setState({ client: mockClient as any, selectedProjectId: 1 });
      useTaskStore.getState().setSelectedProjectId(null);

      expect(useTaskStore.getState().selectedProjectId).toBeNull();
      expect(mockClient.getAllTasks).toHaveBeenCalled();
    });

    it('setSelectedProjectId(-1) should select My Open Tasks mode and trigger fetchAllTasks without calling fetchTasks(-1)', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockResolvedValue([]),
        getTasks: jest.fn().mockResolvedValue([]),
      };

      useTaskStore.setState({ client: mockClient as any, selectedProjectId: 1 });
      useTaskStore.getState().setSelectedProjectId(-1);

      expect(useTaskStore.getState().selectedProjectId).toBe(-1);
      expect(mockClient.getAllTasks).toHaveBeenCalled();
      expect(mockClient.getTasks).not.toHaveBeenCalledWith(-1);
    });

    it('fetchProjects() should preserve selectedProjectId = -1 (My Open Tasks) without resetting to null', async () => {
      const mockClient = {
        getProjects: jest.fn().mockResolvedValue([
          { id: 1, title: 'Inbox' },
          { id: 2, title: 'Work' },
        ]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        selectedProjectId: -1,
        projects: [],
      });

      await useTaskStore.getState().fetchProjects();
      expect(useTaskStore.getState().selectedProjectId).toBe(-1);
    });

    it('toggleTask() should enqueue mutation carrying full task snapshot to prevent server field wiping', () => {
      const mockEnqueue = jest.fn();
      useTaskStore.setState({
        tasks: [
          {
            id: 42,
            title: 'Complete tax filing',
            description: 'Forms 1040 and W2 attached',
            done: false,
            priority: 4,
            project_id: 2,
            due_date: '2026-10-15T00:00:00Z',
            assignees: [{ id: 101, username: 'terahz' }],
          },
        ],
        syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn() } as any,
      });

      useTaskStore.getState().toggleTask(42);

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TOGGLE_TASK',
          payload: expect.objectContaining({
            taskId: 42,
            data: expect.objectContaining({
              id: 42,
              title: 'Complete tax filing',
              description: 'Forms 1040 and W2 attached',
              priority: 4,
              done: true,
              assignees: [{ id: 101, username: 'terahz' }],
            }),
          }),
        })
      );
    });

    it('moveTask() should enqueue mutation carrying full task snapshot with updated project_id', () => {
      const mockEnqueue = jest.fn();
      useTaskStore.setState({
        tasks: [
          {
            id: 42,
            title: 'Move Me',
            description: 'Important notes',
            done: false,
            priority: 3,
            project_id: 1,
          },
        ],
        syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn() } as any,
      });

      useTaskStore.getState().moveTask(42, 5);

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MOVE_TASK',
          payload: expect.objectContaining({
            taskId: 42,
            targetProjectId: 5,
            data: expect.objectContaining({
              id: 42,
              title: 'Move Me',
              description: 'Important notes',
              priority: 3,
              project_id: 5,
            }),
          }),
        })
      );
    });

    it('updateTaskDetails() should enqueue mutation carrying full merged task snapshot', () => {
      const mockEnqueue = jest.fn();
      useTaskStore.setState({
        tasks: [
          {
            id: 42,
            title: 'Original Title',
            description: 'Original Description',
            done: false,
            priority: 1,
            project_id: 1,
            due_date: '2026-10-10T00:00:00Z',
          },
        ],
        syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn() } as any,
      });

      useTaskStore.getState().updateTaskDetails(42, { title: 'Updated Title', priority: 3 });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_TASK',
          payload: expect.objectContaining({
            taskId: 42,
            data: expect.objectContaining({
              id: 42,
              title: 'Updated Title',
              description: 'Original Description',
              priority: 3,
              due_date: '2026-10-10T00:00:00Z',
            }),
          }),
        })
      );
    });
  });

  describe('Label Sync, Color Enrichment, and Global Label Management', () => {
    it('fetchLabels() should retrieve labels from server and store them', async () => {
      const mockClient = {
        getLabels: jest.fn().mockResolvedValue([
          { id: 1, title: 'Costco', hex_color: 'ff5722' },
          { id: 2, title: 'Groceries', hex_color: '3498db' },
        ]),
      };

      useTaskStore.setState({ client: mockClient as any, labels: [] });
      const labels = await useTaskStore.getState().fetchLabels();

      expect(labels).toHaveLength(2);
      expect(useTaskStore.getState().labels).toEqual([
        { id: 1, title: 'Costco', hex_color: 'ff5722', color: 'ff5722' },
        { id: 2, title: 'Groceries', hex_color: '3498db', color: '3498db' },
      ]);
    });

    it('updateTaskLabels() should enqueue mutation with previousLabels for deletion', () => {
      const mockEnqueue = jest.fn();
      useTaskStore.setState({
        syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn() } as any,
        tasks: [
          {
            id: 10,
            title: 'Buy Milk',
            done: false,
            priority: 1,
            project_id: 1,
            labels: [
              { id: 1, title: 'Costco' },
              { id: 2, title: 'Groceries' },
            ],
          },
        ],
      });

      useTaskStore.getState().updateTaskLabels(10, [{ id: 1, title: 'Costco' }]);

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_TASK_LABELS',
          payload: {
            taskId: 10,
            labels: [{ id: 1, title: 'Costco' }],
            previousLabels: [
              { id: 1, title: 'Costco' },
              { id: 2, title: 'Groceries' },
            ],
          },
        })
      );
    });

    it('fetchAllTasks() should enrich labels with server hex_color and not resurrect deleted labels', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'Task With Labels',
            done: false,
            priority: 1,
            project_id: 1,
            labels: [{ id: 1, title: 'Costco' }],
          },
          {
            id: 20,
            title: 'Task Where Label Was Removed',
            done: false,
            priority: 1,
            project_id: 1,
            labels: [],
          },
        ]),
        getTasks: jest.fn().mockResolvedValue([]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: { hasPendingForTask: () => false } as any,
        labels: [{ id: 1, title: 'Costco', hex_color: 'ff5722' }],
        tasks: [
          {
            id: 20,
            title: 'Task Where Label Was Removed',
            done: false,
            priority: 1,
            project_id: 1,
            labels: [{ id: 9, title: 'OldLabel' }],
          },
        ],
      });

      await useTaskStore.getState().fetchAllTasks();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks.find((t) => t.id === 10)?.labels).toEqual([
        { id: 1, title: 'Costco', hex_color: 'ff5722', color: 'ff5722' },
      ]);
      expect(tasks.find((t) => t.id === 20)?.labels).toEqual([]);
    });

    it('resetAndSyncFromServer() should clear local cache and reload authoritative server state', async () => {
      const mockClient = {
        getLabels: jest.fn().mockResolvedValue([
          { id: 1, title: 'Costco', color: 'ef4444' },
          { id: 2, title: 'Caraluzzi', color: '22c55e' },
        ]),
        getProjects: jest.fn().mockResolvedValue([{ id: 1, title: 'Groceries' }]),
        getAllTasks: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'Water',
            done: false,
            priority: 1,
            project_id: 1,
            labels: [{ id: 1, title: 'Costco', color: '' }],
          },
          {
            id: 11,
            title: 'Milk',
            done: false,
            priority: 1,
            project_id: 1,
            labels: [{ id: 2, title: 'Caraluzzi', color: '3b82f6' }],
          },
        ]),
        getTasks: jest.fn().mockResolvedValue([]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: { clear: jest.fn(), hasPendingForTask: () => false } as any,
        tasks: [{ id: 999, title: 'Stale Local Task', done: false, priority: 0, project_id: 1 }],
      });

      await useTaskStore.getState().resetAndSyncFromServer();

      const state = useTaskStore.getState();
      expect(state.syncStatus).toBe('synced');
      expect(state.tasks.find((t) => t.id === 999)).toBeUndefined();
      expect(state.tasks.find((t) => t.id === 10)?.labels?.[0].hex_color).toBe('ef4444');
      expect(state.tasks.find((t) => t.id === 11)?.labels?.[0].hex_color).toBe('22c55e');
    });

    it('createGlobalLabel, updateGlobalLabel, and deleteGlobalLabel manage labels in store and server', async () => {
      const mockClient = {
        createLabel: jest.fn().mockResolvedValue({ id: 7, title: 'Produce', hex_color: '#22c55e' }),
        updateLabel: jest.fn().mockResolvedValue({ id: 7, title: 'Fresh Produce', hex_color: '#16a34a' }),
        deleteLabel: jest.fn().mockResolvedValue({ message: 'deleted' }),
      };

      useTaskStore.setState({
        client: mockClient as any,
        labels: [],
        tasks: [{ id: 10, title: 'Apples', done: false, priority: 0, project_id: 1, labels: [{ id: 7, title: 'Produce' }] }],
      });

      const created = await useTaskStore.getState().createGlobalLabel('Produce', '#22c55e');
      expect(created.id).toBe(7);
      expect(useTaskStore.getState().labels).toHaveLength(1);

      await useTaskStore.getState().updateGlobalLabel(7, 'Fresh Produce', '#16a34a');
      expect(useTaskStore.getState().tasks[0].labels?.[0].title).toBe('Fresh Produce');

      await useTaskStore.getState().deleteGlobalLabel(7);
      expect(useTaskStore.getState().labels).toHaveLength(0);
      expect(useTaskStore.getState().tasks[0].labels).toEqual([]);
    });
  });

  describe('User Caching & Assignee Sync', () => {
    it('should cache and retrieve known users for typing suggestions', async () => {
      const testUsers = [
        { id: 1, username: 'terahz', name: 'Georgi' },
        { id: 2, username: 'alex' },
      ];

      useTaskStore.getState().setCachedUsers(testUsers);
      expect(useTaskStore.getState().cachedUsers).toEqual(testUsers);
    });

    it('fetchUsers() merges searched users into cachedUsers', async () => {
      const mockClient = {
        searchUsers: jest.fn().mockResolvedValue([{ id: 3, username: 'bob' }]),
      };
      useTaskStore.setState({
        client: mockClient as any,
        cachedUsers: [{ id: 1, username: 'alice' }],
      });

      const merged = await useTaskStore.getState().fetchUsers('bo');
      expect(merged.map((u) => u.username)).toEqual(['alice', 'bob']);
    });

    it('updateTaskAssignees() should enqueue SET_TASK_ASSIGNEES mutation with previous assignees', () => {
      const mockEnqueue = jest.fn();
      useTaskStore.setState({
        syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn() } as any,
        tasks: [
          {
            id: 10,
            title: 'Task With Assignees',
            done: false,
            priority: 1,
            project_id: 1,
            assignees: [
              { id: 1, username: 'terahz' },
              { id: 2, username: 'alex' },
            ],
          },
        ],
      });

      useTaskStore.getState().updateTaskAssignees(10, [
        { id: 1, username: 'terahz' },
        { id: 3, username: 'bob' },
      ]);

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_TASK_ASSIGNEES',
          payload: {
            taskId: 10,
            assignees: [
              { id: 1, username: 'terahz' },
              { id: 3, username: 'bob' },
            ],
            previousAssignees: [
              { id: 1, username: 'terahz' },
              { id: 2, username: 'alex' },
            ],
          },
        })
      );
    });
  });

  describe('Large Task Items & Scale Preferences', () => {
    it('should update largeTaskItems state and persist to AsyncStorage', async () => {
      const { setLargeTaskItems } = useTaskStore.getState();
      expect(useTaskStore.getState().largeTaskItems).toBe(false);

      await setLargeTaskItems(true);
      expect(useTaskStore.getState().largeTaskItems).toBe(true);
      expect(useTaskStore.getState().taskItemScale).toBe(150);

      await setLargeTaskItems(false);
      expect(useTaskStore.getState().largeTaskItems).toBe(false);
      expect(useTaskStore.getState().taskItemScale).toBe(100);
    });

    it('should update taskItemScale and clamp between 100 and 200', async () => {
      const { setTaskItemScale } = useTaskStore.getState();

      await setTaskItemScale(125);
      expect(useTaskStore.getState().taskItemScale).toBe(125);
      expect(useTaskStore.getState().largeTaskItems).toBe(true);

      await setTaskItemScale(250);
      expect(useTaskStore.getState().taskItemScale).toBe(200);

      await setTaskItemScale(80);
      expect(useTaskStore.getState().taskItemScale).toBe(100);
      expect(useTaskStore.getState().largeTaskItems).toBe(false);
    });

    it('should update taskItemTextScale independently and clamp between 100 and 200', async () => {
      const { setTaskItemTextScale } = useTaskStore.getState();

      await setTaskItemTextScale(150);
      expect(useTaskStore.getState().taskItemTextScale).toBe(150);

      await setTaskItemTextScale(250);
      expect(useTaskStore.getState().taskItemTextScale).toBe(200);

      await setTaskItemTextScale(50);
      expect(useTaskStore.getState().taskItemTextScale).toBe(100);
    });
  });

  describe('Reliability, Token Renewal, Notifications, Clear Session & Project Management', () => {
    it('syncAll should acquire concurrency lock and prevent overlapping executions', async () => {
      let resolveFirstSync: () => void = () => {};
      const mockClient = {
        getLabels: jest.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveFirstSync = () => resolve([]);
            })
        ),
        getProjects: jest.fn().mockResolvedValue([{ id: 1, title: 'Inbox' } as any]),
        getAllTasks: jest.fn().mockResolvedValue([]),
        getCurrentUser: jest.fn().mockResolvedValue({ id: 1, username: 'terahz' } as any),
      };

      useTaskStore.setState({ client: mockClient as any });
      const store = useTaskStore.getState();

      const firstSyncPromise = store.syncAll();
      expect(useTaskStore.getState().syncStatus).toBe('syncing');

      const secondSyncPromise = store.syncAll();

      resolveFirstSync();
      await Promise.all([firstSyncPromise, secondSyncPromise]);

      expect(mockClient.getLabels).toHaveBeenCalledTimes(1);
    });

    it('initialize should rehydrate pending syncQueue from AsyncStorage', async () => {
      await AsyncStorage.setItem(
        '@vikunja_sync_queue',
        JSON.stringify([
          {
            id: 'persisted-mutation',
            type: 'TOGGLE_TASK',
            payload: { taskId: 55, done: true },
            timestamp: 1000,
          },
        ])
      );

      await useTaskStore.getState().initialize('https://try.vikunja.io', 'test-token');

      const queue = useTaskStore.getState().syncQueue;
      expect(queue).not.toBeNull();
      expect(queue?.getQueue()).toHaveLength(1);
      expect(queue?.getQueue()[0].id).toBe('persisted-mutation');
    });

    it('renews JWT via POST /user/token on 401 and skips renewToken for tk_ Personal API Tokens', async () => {
      const { setStoredAuth, getStoredAuth } = require('../../utils/biometrics');
      await setStoredAuth('old-jwt-token', 'https://try.vikunja.io', 'bob');
      await useTaskStore.getState().initialize('https://try.vikunja.io', 'old-jwt-token');

      const client = useTaskStore.getState().client!;
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'renewed-jwt-token' }),
      } as Response);

      const refreshed = await client.onTokenRefresh!();
      expect(refreshed).toBe('renewed-jwt-token');
      expect((await getStoredAuth()).token).toBe('renewed-jwt-token');

      client.setToken('tk_personal_secret');
      global.fetch = jest.fn();
      const tkRefreshed = await client.onTokenRefresh!();
      expect(tkRefreshed).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('pauses sync as auth_required on 401 without wiping syncQueue or cached tasks', async () => {
      await useTaskStore.getState().initialize('https://try.vikunja.io', 'expired-jwt');
      useTaskStore.getState().addTask({ title: 'Must Never Lose Offline Task', project_id: 1 });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Expired' }),
      } as Response);

      await useTaskStore.getState().syncAll();

      const state = useTaskStore.getState();
      expect(state.authRequired).toBe(true);
      expect(state.syncStatus).toBe('auth_required');
      expect(state.tasks.some((t) => t.title === 'Must Never Lose Offline Task')).toBe(true);
      expect(state.syncQueue?.getQueue().length).toBeGreaterThan(0);
    });

    it('sets syncStatus to offline (not auth_required and without wiping) when renewToken fails transiently offline', async () => {
      await useTaskStore.getState().initialize('https://try.vikunja.io', 'expiring-jwt');
      const client = useTaskStore.getState().client!;

      let callNum = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          return Promise.resolve({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ message: 'Expired' }),
          } as Response);
        }
        return Promise.reject(new Error('Network request failed'));
      });

      await expect(client.getProjects()).rejects.toThrow();
      expect(useTaskStore.getState().authRequired).toBe(false);
      expect(useTaskStore.getState().syncStatus).toBe('offline');
    });

    it('proactively renews expired 10-minute JWT via rotating refreshToken in syncAll, survives transient offline errors without authRequired, and flags authRequired on 401 refresh rejection while preserving syncQueue', async () => {
      const {
        setStoredAuth,
        getStoredAuth,
        SECURE_KEY_REFRESH_TOKEN,
      } = require('../../utils/biometrics');
      const SecureStore = require('expo-secure-store');
      const makeJwt = (expSec: number) => {
        const b64 = (o: any) =>
          Buffer.from(JSON.stringify(o))
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', exp: expSec })}.sig`;
      };

      const nowSec = Math.floor(Date.now() / 1000);
      const expired10mJwt = makeJwt(nowSec - 7200); // Expired 2 hours ago!
      const fresh10mJwt = makeJwt(nowSec + 600);

      await setStoredAuth(expired10mJwt, 'https://try.vikunja.io', 'alice', {
        refreshToken: 'rt_stored_1',
      });
      await useTaskStore
        .getState()
        .initialize('https://try.vikunja.io', expired10mJwt, 'rt_stored_1');

      // Queue an offline task while offline: proactive refresh fails transiently -> authRequired MUST remain false!
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      useTaskStore.getState().addTask({ title: 'Queued While Offline', project_id: 1 });
      await useTaskStore.getState().syncAll();

      expect(useTaskStore.getState().authRequired).toBe(false);
      expect(useTaskStore.getState().syncStatus).toBe('offline');
      expect(useTaskStore.getState().syncQueue?.getQueue()).toHaveLength(1);

      // Reconnect: proactive refresh exchanges rt_stored_1 -> rt_rotated_2 + fresh10mJwt and flushes syncQueue!
      let refreshCount = 0;
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: any) => {
        if (url.endsWith('/user/token/refresh')) {
          refreshCount++;
          expect(opts?.headers?.Authorization).toBeUndefined();
          expect(opts?.headers?.Cookie).toBe('vikunja_refresh_token=rt_stored_1');
          return {
            ok: true,
            status: 200,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'set-cookie'
                  ? 'vikunja_refresh_token=rt_rotated_2; Path=/api/v1/user/token; HttpOnly'
                  : 'application/json',
            },
            json: async () => ({ token: fresh10mJwt }),
          } as unknown as Response;
        }
        if (url.endsWith('/projects/1/tasks') && opts?.method === 'PUT') {
          expect(opts?.headers?.Authorization).toBe(`Bearer ${fresh10mJwt}`);
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: 301,
              title: 'Queued While Offline',
              done: false,
              priority: 0,
              project_id: 1,
            }),
          } as Response;
        }
        if (/\/projects(\?|$)/.test(url)) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: 1, title: 'Inbox' }],
          } as Response;
        }
        if (url.endsWith('/user')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 1, username: 'alice' }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      await useTaskStore.getState().syncAll();

      expect(refreshCount).toBe(1);
      expect(useTaskStore.getState().authRequired).toBe(false);
      expect(useTaskStore.getState().syncStatus).toBe('synced');
      expect(useTaskStore.getState().syncQueue?.getQueue()).toHaveLength(0);
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBe('rt_rotated_2');
      expect((await getStoredAuth()).token).toBe(fresh10mJwt);

      // Now simulate refresh token revoked on server (401 from /user/token/refresh) after JWT expires:
      const anotherExpiredJwt = makeJwt(nowSec - 60);
      useTaskStore.getState().client!.setToken(anotherExpiredJwt);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Refresh token revoked' }),
      } as Response);
      useTaskStore.getState().addTask({ title: 'Safe Unsynced Task', project_id: 1 });
      await useTaskStore.getState().syncAll();

      expect(useTaskStore.getState().authRequired).toBe(true);
      expect(useTaskStore.getState().syncStatus).toBe('auth_required');
      expect(useTaskStore.getState().syncQueue?.getQueue()).toHaveLength(1);
    });

    it('wires local notification scheduling & cancellation into toggleTask, updateTaskDetails, reenableTask, deleteTask, and deleteProject', async () => {
      const cancelSpy = jest
        .spyOn(localNotifications, 'cancelTaskReminders')
        .mockResolvedValue(undefined);
      const scheduleSpy = jest
        .spyOn(localNotifications, 'scheduleTaskReminders')
        .mockResolvedValue(undefined);

      useTaskStore.setState({
        client: { deleteProject: jest.fn().mockResolvedValue({ message: 'ok' }) } as any,
        projects: [{ id: 1, title: 'Inbox' }, { id: 2, title: 'Work' }],
        tasks: [
          {
            id: 10,
            title: 'Task 10',
            done: false,
            priority: 1,
            project_id: 1,
            due_date: new Date(Date.now() + 86400_000).toISOString(),
            reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
          },
          { id: 20, title: 'Task 20', done: false, priority: 1, project_id: 2 },
        ],
      });

      useTaskStore.getState().toggleTask(10);
      expect(cancelSpy).toHaveBeenCalledWith(10);

      useTaskStore.getState().updateTaskDetails(10, { title: 'Task 10 Edited' });
      expect(scheduleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 10, title: 'Task 10 Edited' })
      );

      cancelSpy.mockClear();
      useTaskStore.getState().reenableTask(10);
      expect(cancelSpy).toHaveBeenCalledWith(10);

      cancelSpy.mockClear();
      useTaskStore.getState().deleteTask(10);
      expect(cancelSpy).toHaveBeenCalledWith(10);

      cancelSpy.mockClear();
      await useTaskStore.getState().deleteProject(2);
      expect(cancelSpy).toHaveBeenCalledWith(20);

      cancelSpy.mockRestore();
      scheduleSpy.mockRestore();
    });

    it('clearSession synchronously sets client: null, aborts in-flight fetches, cancels notifications, clears AI cache, and purges all seeded storage keys', async () => {
      await AsyncStorage.multiSet([
        ['@vikunja_cached_projects', JSON.stringify([{ id: 1, title: 'Secret List' }])],
        ['@vikunja_cached_tasks', JSON.stringify([{ id: 10, title: 'Secret Task' }])],
        ['@vikunja_cached_labels', JSON.stringify([{ id: 2, title: 'Secret Label' }])],
        ['@vikunja_cached_users', JSON.stringify([{ id: 5, username: 'alice' }])],
        ['@vikunja_current_user', JSON.stringify({ id: 5, username: 'alice' })],
        ['@vikunja_cached_current_user', JSON.stringify({ id: 5, username: 'alice' })],
        ['@vikunja_last_project_id', '1'],
        ['@vikunja_sync_queue', JSON.stringify([{ id: 'm1', type: 'DELETE_TASK', payload: { taskId: 10 }, timestamp: 1 }])],
        ['@vikunja_username', 'alice'],
        ['@vikunja_saved_username', 'alice'],
        ['@vikunja_aicore_cat_1_10_inbox', 'Work'],
      ]);

      let resolveSlowTasks!: (val: any) => void;
      let capturedSignal: AbortSignal | undefined;
      global.fetch = jest.fn().mockImplementation((_url: string, opts?: any) => {
        capturedSignal = opts?.signal;
        return new Promise((resolve) => {
          resolveSlowTasks = resolve;
        });
      });

      await useTaskStore.getState().initialize('https://try.vikunja.io', 'jwt-active');

      const inFlightFetch = useTaskStore.getState().fetchTasks(1);
      await new Promise((r) => setTimeout(r, 10));

      const clearPromise = useTaskStore.getState().clearSession();
      // Synchronously null BEFORE clearPromise resolves!
      expect(useTaskStore.getState().client).toBeNull();
      await clearPromise;

      expect(capturedSignal?.aborted).toBe(true);
      expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();

      resolveSlowTasks({
        ok: true,
        status: 200,
        json: async () => [
          { id: 999, title: 'Leaked Post-Logout Task', done: false, priority: 0, project_id: 1 },
        ],
      });
      await inFlightFetch;

      expect(useTaskStore.getState().tasks).toEqual([]);
      for (const key of [
        '@vikunja_cached_projects',
        '@vikunja_cached_tasks',
        '@vikunja_cached_labels',
        '@vikunja_cached_users',
        '@vikunja_current_user',
        '@vikunja_cached_current_user',
        '@vikunja_last_project_id',
        '@vikunja_sync_queue',
        '@vikunja_username',
        '@vikunja_saved_username',
        '@vikunja_aicore_cat_1_10_inbox',
      ]) {
        expect(await AsyncStorage.getItem(key)).toBeNull();
      }
    });

    describe('Project Management Actions', () => {
      it('createProject() should call client and append to projects array', async () => {
        const mockClient = {
          createProject: jest.fn().mockResolvedValue({ id: 9, title: 'Vacation', hex_color: '#3498db' }),
        };
        useTaskStore.setState({ client: mockClient as any, projects: [] });

        const created = await useTaskStore
          .getState()
          .createProject({ title: 'Vacation', hex_color: '#3498db' });
        expect(created.id).toBe(9);
        expect(useTaskStore.getState().projects).toEqual([created]);
      });

      it('updateProject() should call client and update project in state', async () => {
        const mockClient = {
          updateProject: jest.fn().mockResolvedValue({ id: 1, title: 'Work Updated', hex_color: '#ff0000' }),
        };
        useTaskStore.setState({
          client: mockClient as any,
          projects: [{ id: 1, title: 'Work', hex_color: '#00ff00' } as any],
        });

        const updated = await useTaskStore
          .getState()
          .updateProject(1, { title: 'Work Updated', hex_color: '#ff0000' });
        expect(updated.title).toBe('Work Updated');
        expect(useTaskStore.getState().projects[0].title).toBe('Work Updated');
      });

      it('deleteProject() should remove project, clean tasks, and reset active selection if deleted', async () => {
        const mockClient = {
          deleteProject: jest.fn().mockResolvedValue({ message: 'deleted' }),
        };
        useTaskStore.setState({
          client: mockClient as any,
          projects: [{ id: 1, title: 'Work' } as any, { id: 2, title: 'Personal' } as any],
          tasks: [
            { id: 10, title: 'Task 1', project_id: 1 } as any,
            { id: 20, title: 'Task 2', project_id: 2 } as any,
          ],
          selectedProjectId: 1,
        });

        await useTaskStore.getState().deleteProject(1);

        expect(useTaskStore.getState().projects.map((p) => p.id)).toEqual([2]);
        expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual([20]);
        expect(useTaskStore.getState().selectedProjectId).toBeNull();
      });

      it('archiveProject() should toggle archive and reset active selection if archived', async () => {
        const mockClient = {
          updateProject: jest.fn().mockResolvedValue({ id: 1, title: 'Work', is_archived: true }),
        };
        useTaskStore.setState({
          client: mockClient as any,
          projects: [{ id: 1, title: 'Work', is_archived: false } as any],
          selectedProjectId: 1,
        });

        await useTaskStore.getState().archiveProject(1, true);

        expect(useTaskStore.getState().projects[0].is_archived).toBe(true);
        expect(useTaskStore.getState().selectedProjectId).toBeNull();
      });

      it('toggleProjectFavorite() should invert favorite status', async () => {
        const mockClient = {
          updateProject: jest.fn().mockResolvedValue({ id: 1, title: 'Work', is_favorite: true }),
        };
        useTaskStore.setState({
          client: mockClient as any,
          projects: [{ id: 1, title: 'Work', is_favorite: false } as any],
        });

        await useTaskStore.getState().toggleProjectFavorite(1);
        expect(useTaskStore.getState().projects[0].is_favorite).toBe(true);
      });

      it('allows favoriting a read-only shared list with a minimal is_favorite-only payload', async () => {
        const mockClient = {
          updateProject: jest.fn().mockResolvedValue({
            id: 9,
            title: 'Shared ReadOnly',
            max_permission: 0,
            is_favorite: true,
          }),
        };
        useTaskStore.setState({
          client: mockClient as any,
          isLocalMode: false,
          projects: [
            { id: 9, title: 'Shared ReadOnly', max_permission: 0, is_favorite: false } as any,
          ],
        });

        await useTaskStore.getState().toggleProjectFavorite(9);
        expect(mockClient.updateProject).toHaveBeenCalledWith(9, { is_favorite: true });
        expect(useTaskStore.getState().projects[0].is_favorite).toBe(true);
      });

      it('keeps local task alive on MOVE_TASK 404 when destination project is missing and getTask() still finds the task', async () => {
        const prevFetch = global.fetch;
        global.fetch = jest.fn().mockRejectedValue(new Error('Offline')) as any;
        try {
          await useTaskStore.getState().initialize('https://vikunja.example.com', 'tk_test');
          const activeClient = useTaskStore.getState().client!;
          const getTaskSpy = jest.spyOn(activeClient, 'getTask').mockResolvedValue({
            id: 501,
            title: 'Keep Me Alive',
            done: false,
            priority: 1,
            project_id: 1,
          } as any);
          jest.spyOn(activeClient, 'updateTask').mockRejectedValue(
            Object.assign(new Error('Project does not exist'), {
              status: 404,
              data: { code: 3001, message: 'Project does not exist' },
            })
          );
          useTaskStore.setState({
            projects: [
              { id: 1, title: 'Inbox', max_permission: 2 } as any,
              { id: 2, title: 'Deleted Target', max_permission: 2 } as any,
            ],
            tasks: [
              {
                id: 501,
                title: 'Keep Me Alive',
                done: false,
                priority: 1,
                project_id: 2,
              } as any,
            ],
          });

          const sq = useTaskStore.getState().syncQueue!;
          sq.enqueue({
            id: 'move-404-target',
            type: 'MOVE_TASK',
            payload: { taskId: 501, targetProjectId: 2, patch: { project_id: 2 } },
            timestamp: Date.now(),
          });
          await sq.processQueue();
          await new Promise((r) => setTimeout(r, 0));

          expect(getTaskSpy).toHaveBeenCalledWith(501);
          const kept = useTaskStore.getState().tasks.find((t) => t.id === 501);
          expect(kept).toBeTruthy();
          expect(kept?.project_id).toBe(1);
          expect(useTaskStore.getState().syncFailures.length).toBeGreaterThanOrEqual(1);
        } finally {
          global.fetch = prevFetch;
        }
      });

      it('duplicateProject() should call client and append duplicate to projects', async () => {
        const mockClient = {
          duplicateProject: jest.fn().mockResolvedValue({ id: 50, title: 'Work Copy' }),
        };
        useTaskStore.setState({
          client: mockClient as any,
          projects: [{ id: 1, title: 'Work' } as any],
        });

        const dup = await useTaskStore.getState().duplicateProject(1);
        expect(dup.id).toBe(50);
        expect(useTaskStore.getState().projects).toHaveLength(2);
      });

      it('throws when trying to manage projects offline without client', async () => {
        useTaskStore.setState({ client: null });

        await expect(
          useTaskStore.getState().createProject({ title: 'Offline' })
        ).rejects.toThrow('Network connection required to manage lists');
      });
    });

    describe('Subtasks, Task Duplication, Saved Filters, and Display/Week Preferences', () => {
      it('addSubtask() creates optimistic child task, links parent.related_tasks.subtask, and enqueues CREATE_TASK + CREATE_TASK_RELATION', () => {
        const mockEnqueue = jest.fn();
        useTaskStore.setState({
          tasks: [
            {
              id: 42,
              title: 'Prepare Release',
              done: false,
              priority: 3,
              project_id: 2,
            },
          ],
          syncQueue: {
            enqueue: mockEnqueue,
            processQueue: jest.fn(),
            hasPendingForTask: () => true,
          } as any,
        });

        const child = useTaskStore.getState().addSubtask(42, 'Run regression suite');
        expect(child).not.toBeNull();
        expect(child!.id).toBeLessThan(0);
        expect(child!.project_id).toBe(2);
        expect(child!.related_tasks?.parenttask?.[0]?.id).toBe(42);

        const parent = useTaskStore.getState().tasks.find((t) => t.id === 42)!;
        expect(parent.related_tasks?.subtask).toHaveLength(1);
        expect(parent.related_tasks?.subtask?.[0]?.title).toBe('Run regression suite');

        expect(mockEnqueue).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'CREATE_TASK' })
        );
        expect(mockEnqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'CREATE_TASK_RELATION',
            payload: {
              taskId: 42,
              otherTaskId: child!.id,
              relationKind: 'subtask',
            },
          })
        );
      });

      it('duplicateTask() creates an open copy preserving metadata and duplicating subtasks', () => {
        const mockEnqueue = jest.fn();
        useTaskStore.setState({
          tasks: [
            {
              id: 10,
              title: 'Sprint Checklist',
              description: '<p>Verify builds</p>',
              done: true,
              percent_done: 1,
              priority: 4,
              hex_color: '#0A84FF',
              project_id: 1,
              labels: [{ id: 3, title: 'Ops', hex_color: '#30D158' }],
              related_tasks: {
                subtask: [
                  { id: 11, title: 'Tag release', done: true, priority: 0, project_id: 1 },
                  { id: 12, title: 'Upload bundle', done: false, priority: 0, project_id: 1 },
                ],
              },
            },
            { id: 11, title: 'Tag release', done: true, priority: 0, project_id: 1 },
            { id: 12, title: 'Upload bundle', done: false, priority: 0, project_id: 1 },
          ],
          syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn() } as any,
        });

        const duplicated = useTaskStore.getState().duplicateTask(10);
        expect(duplicated).not.toBeNull();
        expect(duplicated!.id).toBeLessThan(0);
        expect(duplicated!.title).toBe('Sprint Checklist (Copy)');
        expect(duplicated!.done).toBe(false);
        expect(duplicated!.percent_done).toBe(0);
        expect(duplicated!.priority).toBe(4);
        expect(duplicated!.description).toBe('<p>Verify builds</p>');
        expect(duplicated!.related_tasks?.subtask).toHaveLength(2);
        expect(duplicated!.related_tasks?.subtask?.every((s) => !s.done)).toBe(true);
      });

      it('normalizes negative-ID server Saved Filters without colliding with MY_TASKS_PROJECT_ID (-1) and fetches filter tasks', async () => {
        const mockClient = {
          getProjects: jest.fn().mockResolvedValue([
            { id: 1, title: 'Inbox' },
            {
              id: -1,
              title: 'Urgent Filter',
              views: [{ id: 15, title: 'List', project_id: -1, view_kind: 'list' }],
            },
            {
              id: -2,
              title: 'Shopping Filter',
              views: [{ id: 16, title: 'List', project_id: -2, view_kind: 'list' }],
            },
          ]),
          getSavedFilterTasks: jest.fn().mockResolvedValue([
            { id: 301, title: 'Critical Server Patch', done: false, priority: 5, project_id: 1 },
          ]),
        };

        useTaskStore.setState({ client: mockClient as any, projects: [], tasks: [] });
        await useTaskStore.getState().fetchProjects();

        const projects = useTaskStore.getState().projects;
        const urgentFilter = projects.find((p) => p.title === 'Urgent Filter')!;
        expect(urgentFilter.is_saved_filter).toBe(true);
        expect(urgentFilter.id).not.toBe(-1); // Never collides with MY_TASKS_PROJECT_ID (-1)!
        expect(urgentFilter.server_project_id).toBe(-1);

        useTaskStore.getState().setSelectedProjectId(urgentFilter.id);
        await new Promise((r) => setTimeout(r, 15));

        expect(mockClient.getSavedFilterTasks).toHaveBeenCalledWith(
          expect.objectContaining({ server_project_id: -1 })
        );
        expect(useTaskStore.getState().savedFilterTaskIds[urgentFilter.id]).toEqual([301]);
        expect(useTaskStore.getState().tasks.some((t) => t.id === 301)).toBe(true);
      });

      it('persists themeMode, weekStartDay, and appBadgeMode in AsyncStorage', async () => {
        await useTaskStore.getState().setThemeMode('oled');
        await useTaskStore.getState().setWeekStartDay(0);
        await useTaskStore.getState().setAppBadgeMode('due_today');

        expect(useTaskStore.getState().themeMode).toBe('oled');
        expect(useTaskStore.getState().weekStartDay).toBe(0);
        expect(useTaskStore.getState().appBadgeMode).toBe('due_today');

        useTaskStore.setState({ themeMode: 'system', weekStartDay: 1, appBadgeMode: 'off' });
        await useTaskStore.getState().loadCachedData();

        expect(useTaskStore.getState().themeMode).toBe('oled');
        expect(useTaskStore.getState().weekStartDay).toBe(0);
        expect(useTaskStore.getState().appBadgeMode).toBe('due_today');
      });

      it('enforces read-only & admin permission guards in Server Mode, records & recovers syncFailures, diffs dirty task updates, and keeps local state intact on offline resetAndSyncFromServer', async () => {
        const mockEnqueue = jest.fn();
        useTaskStore.setState({
          isLocalMode: false,
          projects: [
            { id: 1, title: 'Writable List', max_permission: 1 },
            { id: 2, title: 'Read-Only Shared', max_permission: 0 },
          ],
          tasks: [
            { id: 10, title: 'Writable Task', done: false, priority: 1, project_id: 1, labels: [{ id: 1, title: 'Tag' }] },
            { id: 20, title: 'Read-Only Task', done: false, priority: 1, project_id: 2 },
          ],
          syncQueue: { enqueue: mockEnqueue, processQueue: jest.fn(), clear: jest.fn() } as any,
          client: {
            deleteProject: jest.fn(),
            getLabels: jest.fn().mockRejectedValue(new Error('Offline')),
            getProjects: jest.fn().mockRejectedValue(new Error('Offline')),
          } as any,
        });

        // Read-only addTask returns unpersisted stub and sets error without mutating tasks or syncQueue
        const blockedStub = useTaskStore.getState().addTask({ title: 'Blocked', project_id: 2 });
        expect(blockedStub.id).toBe(0);
        expect(useTaskStore.getState().tasks.some((t) => t.title === 'Blocked')).toBe(false);
        expect(useTaskStore.getState().error).toMatch(/read-only/i);

        // Read-only toggleTask & moveTask into read-only project are blocked
        useTaskStore.getState().toggleTask(20);
        expect(useTaskStore.getState().tasks.find((t) => t.id === 20)?.done).toBe(false);
        useTaskStore.getState().moveTask(10, 2);
        expect(useTaskStore.getState().tasks.find((t) => t.id === 10)?.project_id).toBe(1);

        // Non-admin (max_permission: 1) deleteProject throws adminRequiredError
        await expect(useTaskStore.getState().deleteProject(1)).rejects.toThrow(/Admin/i);

        // Dirty-patch diffing: unchanged labels + unchanged fields enqueue nothing; changed title enqueues minimal patch
        mockEnqueue.mockClear();
        useTaskStore.getState().updateTaskDetails(10, {
          title: 'Writable Task',
          priority: 1,
          labels: [{ id: 1, title: 'Tag' }],
        });
        expect(mockEnqueue).not.toHaveBeenCalled();

        useTaskStore.getState().updateTaskDetails(10, {
          title: 'Renamed Task',
          priority: 1,
          labels: [{ id: 1, title: 'Tag' }],
        });
        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue.mock.calls[0][0].payload.patch).toEqual({ title: 'Renamed Task' });

        // Skipped migration task recording & one-tap recovery
        useTaskStore.getState().recordSkippedMigrationTasks([
          {
            localTask: { id: -55, title: 'Skipped Local', done: false, priority: 3, project_id: 2 },
            serverProjectId: 2,
            errorMessage: 'Forbidden',
            status: 403,
          },
        ]);
        expect(useTaskStore.getState().syncFailures).toHaveLength(1);
        const failId = useTaskStore.getState().syncFailures[0].id;
        expect(useTaskStore.getState().recoverFailedTask(failId, 1)).toBe(true);
        expect(useTaskStore.getState().syncFailures).toHaveLength(0);
        expect(useTaskStore.getState().tasks.some((t) => t.title === 'Skipped Local')).toBe(true);

        // Offline resetAndSyncFromServer fetches FIRST so local tasks & syncQueue are NEVER wiped!
        const taskCountBefore = useTaskStore.getState().tasks.length;
        await expect(useTaskStore.getState().resetAndSyncFromServer()).rejects.toThrow('Offline');
        expect(useTaskStore.getState().tasks).toHaveLength(taskCountBefore);
        expect(useTaskStore.getState().syncQueue?.clear).not.toHaveBeenCalled();
      });

      it('supports setProjectSortMode, consumeSelectedProjectFetch, concurrency-capped fetchAllTasks, and silent background syncAll', async () => {
        let activeGets = 0;
        let maxConcurrentGets = 0;
        const mockClient = {
          getLabels: jest.fn().mockResolvedValue([]),
          getProjects: jest.fn().mockResolvedValue([
            { id: 1, title: 'P1' },
            { id: 2, title: 'P2' },
            { id: 3, title: 'P3' },
            { id: 4, title: 'P4' },
            { id: 5, title: 'P5' },
            { id: 6, title: 'Archived P6', is_archived: true },
          ]),
          getAllTasks: jest.fn().mockResolvedValue([]),
          getTasks: jest.fn().mockImplementation(async () => {
            activeGets += 1;
            maxConcurrentGets = Math.max(maxConcurrentGets, activeGets);
            await new Promise((r) => setTimeout(r, 10));
            activeGets -= 1;
            return [];
          }),
        };

        useTaskStore.setState({
          client: mockClient as any,
          projects: [
            { id: 1, title: 'P1' },
            { id: 2, title: 'P2' },
            { id: 3, title: 'P3' },
            { id: 4, title: 'P4' },
            { id: 5, title: 'P5' },
            { id: 6, title: 'Archived P6', is_archived: true },
          ],
          tasks: [{ id: 600, title: 'Cached Archived Task', done: false, priority: 0, project_id: 6 }],
          error: 'Keep Foreground Error',
        });

        useTaskStore.getState().setProjectSortMode('1', 'priority');
        expect(useTaskStore.getState().sortModesByProject['1']).toBe('priority');

        useTaskStore.getState().setSelectedProjectId(1);
        expect(useTaskStore.getState().consumeSelectedProjectFetch(1)).toBe(true);
        expect(useTaskStore.getState().consumeSelectedProjectFetch(1)).toBe(false);
        await new Promise((r) => setTimeout(r, 20));

        mockClient.getTasks.mockClear();
        maxConcurrentGets = 0;
        useTaskStore.setState({ error: 'Keep Foreground Error' });

        let sawLoadingTrue = false;
        const unsub = useTaskStore.subscribe((s) => {
          if (s.isLoading) sawLoadingTrue = true;
        });
        await useTaskStore.getState().syncAll({ silent: true });
        unsub();

        expect(sawLoadingTrue).toBe(false);
        expect(maxConcurrentGets).toBeLessThanOrEqual(3);
        expect(mockClient.getTasks).not.toHaveBeenCalledWith(6);
        expect(useTaskStore.getState().tasks.some((t) => t.id === 600)).toBe(true);
        expect(useTaskStore.getState().error).toBe('Keep Foreground Error');
        expect(useTaskStore.getState().isLoading).toBe(false);
      });

      it('covers Round 2 regressions: sort validation, no-op dirty patch & position reconciliation, embedded subtask & global reorder permissions, cross-list debounced reorder, and localDataVersion on reset', async () => {
        jest.useFakeTimers();
        try {
          // 1. Sort validation falls back invalid options to 'default'
          useTaskStore.getState().setProjectSortMode('proj:1', 'invalid_sort_option');
          expect(useTaskStore.getState().sortModesByProject['proj:1']).toBe('default');

          const mockQueue = {
            enqueue: jest.fn(),
            processQueue: jest.fn(),
            hasPendingForTask: jest.fn((taskId: number, type?: string) => {
              if (taskId === 101 && (!type || type === 'UPDATE_TASK')) return true;
              return false;
            }),
            getPendingPatchForTask: jest.fn((taskId: number) =>
              taskId === 101 ? { title: 'Locally Renamed' } : null
            ),
            clear: jest.fn().mockResolvedValue(undefined),
          };

          const mockClient = {
            getTasks: jest.fn().mockResolvedValue([
              {
                id: 101,
                title: 'Old Server Title',
                done: false,
                priority: 0,
                project_id: 1,
                position: 9000,
              },
            ]),
            getProjectViews: jest.fn().mockResolvedValue([]),
            getLabels: jest.fn().mockResolvedValue([]),
            getProjects: jest.fn().mockResolvedValue([{ id: 1, title: 'Writable', max_permission: 2 }]),
            getAllTasks: jest.fn().mockResolvedValue([]),
            getCurrentUser: jest.fn().mockResolvedValue({ id: 1, username: 'tester' }),
          };

          useTaskStore.setState({
            client: mockClient as any,
            syncQueue: mockQueue as any,
            isLocalMode: false,
            projects: [
              { id: 1, title: 'Writable P1', max_permission: 2, views: [{ id: 11, title: 'List', project_id: 1, view_kind: 'list' }] },
              { id: 2, title: 'Writable P2', max_permission: 1, views: [{ id: 22, title: 'List', project_id: 2, view_kind: 'list' }] },
              { id: 3, title: 'ReadOnly P3', max_permission: 0, views: [{ id: 33, title: 'List', project_id: 3, view_kind: 'list' }] },
            ],
            tasks: [
              {
                id: 101,
                title: 'Locally Renamed',
                done: false,
                priority: 0,
                project_id: 1,
                position: 1000,
                color: '',
                hex_color: '',
                repeat_after: 0,
                percent_done: 0.333333,
                related_tasks: {
                  subtask: [
                    { id: 301, title: 'ReadOnly Embedded Subtask', done: false, priority: 0, project_id: 3 },
                  ],
                },
              },
              { id: 102, title: 'P1 Second', done: false, priority: 0, project_id: 1, position: 2000 },
              { id: 201, title: 'P2 First', done: false, priority: 0, project_id: 2, position: 1000 },
              { id: 202, title: 'P2 Second', done: false, priority: 0, project_id: 2, position: 2000 },
              { id: 302, title: 'ReadOnly Top Task', done: false, priority: 0, project_id: 3, position: 1000 },
            ],
            error: null,
          });

          // 2. computeDirtyTaskPatch ignores '000000' vs '', repeat_mode: 0 vs undefined, and 0.33 rounded percent_done
          useTaskStore.getState().updateTaskDetails(101, {
            color: '000000',
            hex_color: '#000000',
            repeat_mode: 0,
            percent_done: 0.33,
          });
          expect(mockQueue.enqueue).not.toHaveBeenCalled();

          // 3. Embedded subtask in read-only project 3 is blocked by findTaskIncludingSubtasks + canWriteTask
          useTaskStore.getState().deleteTask(301);
          expect(useTaskStore.getState().error).toMatch(/read-only/i);
          expect(mockQueue.enqueue).not.toHaveBeenCalled();

          // 4. Global reorderTasks(0, ...) excludes read-only task 302 and rejects if ONLY read-only tasks are ordered
          useTaskStore.setState({ error: null });
          useTaskStore.getState().reorderTasks(0, [302]);
          expect(useTaskStore.getState().error).toMatch(/read-only/i);

          // 5. Rapid cross-list debounced reorders within 400ms sync BOTH lists via pendingReorderBaseline.entries()
          useTaskStore.setState({ error: null });
          useTaskStore.getState().reorderTasks(1, [102, 101], false);
          useTaskStore.getState().reorderTasks(2, [202, 201], false);
          jest.advanceTimersByTime(450);
          await Promise.resolve();
          await Promise.resolve();

          const reorderedTaskIds = mockQueue.enqueue.mock.calls
            .filter((c: any[]) => c[0].type === 'REORDER_TASK')
            .map((c: any[]) => c[0].payload.taskId);
          expect(reorderedTaskIds.length).toBeGreaterThanOrEqual(2);
          expect(
            reorderedTaskIds.some((id: number) => id === 101 || id === 102) &&
              reorderedTaskIds.some((id: number) => id === 201 || id === 202)
          ).toBe(true);

          // 6. resolvePosition accepts remote position (9000) when pending UPDATE_TASK only patched title
          await useTaskStore.getState().fetchTasks(1);
          const refreshed101 = useTaskStore.getState().tasks.find((t) => t.id === 101);
          expect(refreshed101?.title).toBe('Locally Renamed');
          expect(refreshed101?.position).toBe(9000);

          // 7. resetAndSyncFromServer increments localDataVersion
          const prevVersion = useTaskStore.getState().localDataVersion;
          await useTaskStore.getState().resetAndSyncFromServer();
          expect(useTaskStore.getState().localDataVersion).toBe(prevVersion + 1);
        } finally {
          jest.useRealTimers();
        }
      });
    });
  });
});
