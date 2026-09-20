import { useTaskStore } from '../taskStore';
import * as Haptics from 'expo-haptics';

describe('useTaskStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTaskStore.setState({
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [
        { id: 10, title: 'Task 1', done: false, priority: 1, project_id: 1, position: 100 },
        { id: 20, title: 'Task 2', done: true, priority: 2, project_id: 1, position: 200 },
      ],
      selectedProjectId: 1,
      isLoading: false,
      error: null,
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

  describe('Rapid Task Creation (Optimistic Quick Add)', () => {
    it('should create optimistic task with temporary ID immediately', () => {
      const { addTask } = useTaskStore.getState();

      const tempTask = addTask({
        title: 'New urgent item',
        priority: 3,
        project_id: 1,
      });

      expect(tempTask.id).toBeLessThan(0); // negative temporary ID
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

      // Server returns task with null labels
      if (onSuccessCallback) {
        onSuccessCallback({
          id: 55,
          title: 'Apples',
          project_id: 1,
          done: false,
          labels: null,
        });
      }

      // Labels MUST NOT disappear!
      const updated = useTaskStore.getState().tasks.find((t) => t.id === 55);
      expect(updated?.labels).toEqual([{ id: -1, title: 'Costco' }]);
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

      // Reverse order: task 20 first, task 10 second
      reorderTasks(1, [20, 10]);

      const projectTasks = useTaskStore
        .getState()
        .tasks.filter((t) => t.project_id === 1)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      expect(projectTasks[0].id).toBe(20);
      expect(projectTasks[1].id).toBe(10);
    });
  });

  describe('Deleting Tasks', () => {
    it('should remove task immediately from store', () => {
      const { deleteTask } = useTaskStore.getState();

      deleteTask(10);

      const task = useTaskStore.getState().tasks.find((t) => t.id === 10);
      expect(task).toBeUndefined();
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

      const { reenableTask } = useTaskStore.getState();
      reenableTask(20);

      const reenabled = useTaskStore.getState().tasks.find((t) => t.id === 20);
      expect(reenabled?.done).toBe(false);
      expect(reenabled?.done_at).toBeNull();
      // Past due date cleared per user requirement
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

      const { reenableTask } = useTaskStore.getState();
      reenableTask(20, [{ id: 2, title: 'Trader Joe\'s' }]);

      const reenabled = useTaskStore.getState().tasks.find((t) => t.id === 20);
      expect(reenabled?.done).toBe(false);
      expect(reenabled?.labels).toEqual([{ id: 2, title: 'Trader Joe\'s' }]);
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
      const { updateTaskLabels } = useTaskStore.getState();
      updateTaskLabels(10, [{ id: 5, title: 'Supermarket' }]);

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

    it('should load cached projects and tasks from AsyncStorage', async () => {
      const AsyncStorage = require('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem(
        '@vikunja_cached_projects',
        JSON.stringify([{ id: 99, title: 'Offline List' }])
      );
      await AsyncStorage.setItem(
        '@vikunja_cached_tasks',
        JSON.stringify([{ id: 999, title: 'Offline Milk', done: false, project_id: 99 }])
      );

      const { loadCachedData } = useTaskStore.getState();
      await loadCachedData();

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

      const { fetchTasks } = useTaskStore.getState();
      await fetchTasks(2);

      const allTasks = useTaskStore.getState().tasks;
      expect(allTasks.find((t) => t.id === 101)).toBeDefined(); // Project 1 task preserved!
      expect(allTasks.find((t) => t.id === 201)).toBeDefined(); // Project 2 task added!
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
          // Local optimistic task created offline with negative ID
          { id: -999, title: 'Optimistic Offline Task', done: false, priority: 3, project_id: 1 },
        ],
      });

      const { fetchAllTasks } = useTaskStore.getState();
      await fetchAllTasks();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks).toHaveLength(3);
      expect(tasks.find((t) => t.id === -999)).toBeDefined(); // Optimistic task retained
      expect(tasks.find((t) => t.id === 1)).toBeDefined();
      expect(tasks.find((t) => t.id === 2)).toBeDefined();
    });

    it('syncAll() should perform bidirectional sync: push queue mutations first, then pull projects and all tasks', async () => {
      const mockQueue = {
        processQueue: jest.fn().mockResolvedValue(undefined),
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

      const { syncAll } = useTaskStore.getState();
      await syncAll();

      // Outbound push called
      expect(mockQueue.processQueue).toHaveBeenCalled();
      // Inbound pull called
      expect(mockClient.getProjects).toHaveBeenCalled();
      expect(mockClient.getAllTasks).toHaveBeenCalled();

      expect(useTaskStore.getState().syncStatus).toBe('synced');
      expect(useTaskStore.getState().tasks).toContainEqual(
        expect.objectContaining({ title: 'Buy Apples' })
      );
    });

    it('fetchAllTasks() should NOT wipe cached tasks when network fetch fails (offline protection)', async () => {
      const mockClient = {
        getAllTasks: jest.fn().mockRejectedValue(new Error('Network error: server unreachable')),
        getTasks: jest.fn().mockRejectedValue(new Error('Network error: server unreachable')),
      };

      const existingTasks = [
        { id: 10, title: 'Cached Bread', done: false, priority: 1, project_id: 1 },
      ];

      useTaskStore.setState({
        client: mockClient as any,
        tasks: existingTasks,
      });

      const { fetchAllTasks } = useTaskStore.getState();
      await fetchAllTasks();

      // Tasks must NOT be wiped to empty array!
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

      useTaskStore.setState({
        client: mockClient as any,
        selectedProjectId: 1,
      });

      const { setSelectedProjectId } = useTaskStore.getState();
      setSelectedProjectId(null);

      expect(useTaskStore.getState().selectedProjectId).toBeNull();
      expect(mockClient.getAllTasks).toHaveBeenCalled();
    });
  });

  describe('Label Sync, Color Enrichment, and Deletion', () => {
    it('fetchLabels() should retrieve labels from server and store them', async () => {
      const mockClient = {
        getLabels: jest.fn().mockResolvedValue([
          { id: 1, title: 'Costco', hex_color: 'ff5722' },
          { id: 2, title: 'Groceries', hex_color: '3498db' },
        ]),
      };

      useTaskStore.setState({ client: mockClient as any, labels: [] });
      const { fetchLabels } = useTaskStore.getState();
      const labels = await fetchLabels();

      expect(labels).toHaveLength(2);
      expect(useTaskStore.getState().labels).toEqual([
        { id: 1, title: 'Costco', hex_color: 'ff5722', color: 'ff5722' },
        { id: 2, title: 'Groceries', hex_color: '3498db', color: '3498db' },
      ]);
    });

    it('updateTaskLabels() should enqueue mutation with previousLabels for deletion', () => {
      const mockEnqueue = jest.fn();
      const mockSyncQueue = {
        enqueue: mockEnqueue,
        processQueue: jest.fn(),
      };

      useTaskStore.setState({
        syncQueue: mockSyncQueue as any,
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

      const { updateTaskLabels } = useTaskStore.getState();
      // Remove Groceries (keep only Costco)
      updateTaskLabels(10, [{ id: 1, title: 'Costco' }]);

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
      expect(useTaskStore.getState().tasks[0].labels).toEqual([{ id: 1, title: 'Costco' }]);
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
            // Server returns label without hex_color
            labels: [{ id: 1, title: 'Costco' }],
          },
          {
            id: 20,
            title: 'Task Where Label Was Removed',
            done: false,
            priority: 1,
            project_id: 1,
            // Server returns empty labels array (user deleted them)
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

      const { fetchAllTasks } = useTaskStore.getState();
      await fetchAllTasks();

      const tasks = useTaskStore.getState().tasks;
      const task10 = tasks.find((t) => t.id === 10);
      const task20 = tasks.find((t) => t.id === 20);

      // Task 10's label is enriched with hex_color
      expect(task10?.labels).toEqual([{ id: 1, title: 'Costco', hex_color: 'ff5722', color: 'ff5722' }]);

      // Task 20's old label is NOT resurrected
      expect(task20?.labels).toEqual([]);
    });

    it('resetAndSyncFromServer() should clear local cache and reload authoritative server state', async () => {
      const mockClient = {
        getLabels: jest.fn().mockResolvedValue([
          { id: 1, title: 'Costco', color: 'ef4444' },
          { id: 2, title: 'Caraluzzi', color: '22c55e' },
        ]),
        getProjects: jest.fn().mockResolvedValue([
          { id: 1, title: 'Groceries' },
        ]),
        getAllTasks: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'Water',
            done: false,
            priority: 1,
            project_id: 1,
            // Task has stale/blank color snapshot from server
            labels: [{ id: 1, title: 'Costco', color: '' }],
          },
          {
            id: 11,
            title: 'Milk',
            done: false,
            priority: 1,
            project_id: 1,
            // Task has outdated blue snapshot from server
            labels: [{ id: 2, title: 'Caraluzzi', color: '3b82f6' }],
          },
        ]),
        getTasks: jest.fn().mockResolvedValue([]),
      };

      useTaskStore.setState({
        client: mockClient as any,
        syncQueue: { hasPendingForTask: () => false } as any,
        tasks: [
          { id: 999, title: 'Stale Local Task', done: false, priority: 0, project_id: 1 },
        ],
      });

      const { resetAndSyncFromServer } = useTaskStore.getState();
      await resetAndSyncFromServer();

      expect(mockClient.getLabels).toHaveBeenCalled();
      expect(mockClient.getProjects).toHaveBeenCalled();
      expect(mockClient.getAllTasks).toHaveBeenCalled();

      const state = useTaskStore.getState();
      expect(state.syncStatus).toBe('synced');
      // Stale task 999 was wiped
      expect(state.tasks.find((t) => t.id === 999)).toBeUndefined();

      // Labels are normalized with canonical server colors
      const waterTask = state.tasks.find((t) => t.id === 10);
      const milkTask = state.tasks.find((t) => t.id === 11);

      expect(waterTask?.labels?.[0].color).toBe('ef4444');
      expect(waterTask?.labels?.[0].hex_color).toBe('ef4444');

      // Milk's Caraluzzi label was overwritten with canonical green (22c55e), not old blue (3b82f6)
      expect(milkTask?.labels?.[0].color).toBe('22c55e');
      expect(milkTask?.labels?.[0].hex_color).toBe('22c55e');
    });
  });
});

