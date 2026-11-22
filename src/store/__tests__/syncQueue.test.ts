import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncQueue, Mutation } from '../syncQueue';
import { VikunjaClient } from '../../api/client';

describe('SyncQueue', () => {
  let queue: SyncQueue;
  let mockClient: jest.Mocked<VikunjaClient>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockClient = {
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      toggleTaskDone: jest.fn(),
      moveTask: jest.fn(),
      reorderTask: jest.fn(),
      setTaskLabels: jest.fn(),
      setTaskAssignees: jest.fn(),
    } as unknown as jest.Mocked<VikunjaClient>;

    queue = new SyncQueue(mockClient);
  });

  it('should enqueue mutations and maintain FIFO order', () => {
    const mutation1: Mutation = {
      id: 'm1',
      type: 'TOGGLE_TASK',
      payload: { taskId: 10, done: true },
      timestamp: 1000,
    };
    const mutation2: Mutation = {
      id: 'm2',
      type: 'MOVE_TASK',
      payload: { taskId: 10, targetProjectId: 2 },
      timestamp: 2000,
    };

    queue.enqueue(mutation1);
    queue.enqueue(mutation2);

    expect(queue.getQueue()).toHaveLength(2);
    expect(queue.getQueue()[0].id).toBe('m1');
    expect(queue.getQueue()[1].id).toBe('m2');
  });

  it('should process pending TOGGLE_TASK mutations through API client', async () => {
    mockClient.toggleTaskDone.mockResolvedValue({
      id: 10,
      title: 'Buy milk',
      done: true,
      priority: 1,
      project_id: 1,
    });

    queue.enqueue({
      id: 'm1',
      type: 'TOGGLE_TASK',
      payload: { taskId: 10, done: true },
      timestamp: Date.now(),
    });

    await queue.processQueue();

    expect(mockClient.toggleTaskDone).toHaveBeenCalledWith(10, true);
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('should process CREATE_TASK and execute onSuccess callback with remote task', async () => {
    const onResolved = jest.fn();
    mockClient.createTask.mockResolvedValue({
      id: 99,
      title: 'Call doctor',
      done: false,
      priority: 2,
      project_id: 1,
    });

    queue.enqueue({
      id: 'm-create',
      type: 'CREATE_TASK',
      payload: {
        tempId: -100,
        projectId: 1,
        taskData: { title: 'Call doctor', priority: 2, project_id: 1 },
      },
      timestamp: Date.now(),
      onSuccess: onResolved,
    });

    await queue.processQueue();

    expect(mockClient.createTask).toHaveBeenCalledWith(1, {
      title: 'Call doctor',
      priority: 2,
      project_id: 1,
    });
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, title: 'Call doctor' })
    );
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('processes CREATE_TASK and invokes persistent onTaskCreated callback across cold restarts', async () => {
    mockClient.createTask.mockResolvedValue({
      id: 99,
      title: 'Cold Restart Task',
      done: false,
      priority: 2,
      project_id: 1,
    });

    queue.enqueue({
      id: 'm-create-cold',
      type: 'CREATE_TASK',
      payload: {
        tempId: -100,
        projectId: 1,
        taskData: { title: 'Cold Restart Task', priority: 2, project_id: 1 },
      },
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 10));

    const restartedQueue = new SyncQueue(mockClient);
    const onTaskCreated = jest.fn();
    restartedQueue.onTaskCreated = onTaskCreated;
    await restartedQueue.loadFromStorage();

    expect(restartedQueue.getQueue()).toHaveLength(1);
    await restartedQueue.processQueue();

    expect(onTaskCreated).toHaveBeenCalledWith(
      -100,
      expect.objectContaining({ id: 99, title: 'Cold Restart Task' })
    );
    expect(restartedQueue.getQueue()).toHaveLength(0);
  });

  it('should synchronize task labels when CREATE_TASK contains labels', async () => {
    mockClient.setTaskLabels.mockResolvedValue([
      { id: 1, title: 'Costco' },
      { id: 2, title: 'Groceries' },
    ]);
    mockClient.createTask.mockResolvedValue({
      id: 50,
      title: 'Buy Milk',
      done: false,
      priority: 1,
      project_id: 1,
      labels: null as any,
    });

    const onResolved = jest.fn();

    queue.enqueue({
      id: 'm-create-labels',
      type: 'CREATE_TASK',
      payload: {
        projectId: 1,
        taskData: {
          title: 'Buy Milk',
          project_id: 1,
          labels: [
            { id: -1, title: 'Costco' },
            { id: -2, title: 'Groceries' },
          ],
        },
      },
      timestamp: Date.now(),
      onSuccess: onResolved,
    });

    await queue.processQueue();

    expect(mockClient.createTask).toHaveBeenCalled();
    expect(mockClient.setTaskLabels).toHaveBeenCalledWith(50, [
      { id: -1, title: 'Costco' },
      { id: -2, title: 'Groceries' },
    ]);
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 50,
        labels: [
          { id: 1, title: 'Costco' },
          { id: 2, title: 'Groceries' },
        ],
      })
    );
  });

  it('should process SET_TASK_LABELS mutation to update labels on server', async () => {
    mockClient.setTaskLabels.mockResolvedValue([{ id: 1, title: 'Costco' }]);

    queue.enqueue({
      id: 'm-set-labels',
      type: 'SET_TASK_LABELS',
      payload: {
        taskId: 50,
        labels: [{ id: 1, title: 'Costco' }],
      },
      timestamp: Date.now(),
    });

    await queue.processQueue();

    expect(mockClient.setTaskLabels).toHaveBeenCalledWith(50, [{ id: 1, title: 'Costco' }]);
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('should process SET_TASK_ASSIGNEES mutation and notify onTaskAssigneesSynced', async () => {
    mockClient.setTaskAssignees.mockResolvedValue([{ id: 7, username: 'alice' }]);
    const onAssigneesSynced = jest.fn();
    queue.onTaskAssigneesSynced = onAssigneesSynced;

    queue.enqueue({
      id: 'm-set-assignees',
      type: 'SET_TASK_ASSIGNEES',
      payload: {
        taskId: 50,
        assignees: [{ id: -1, username: 'alice' }],
        previousAssignees: [],
      },
      timestamp: Date.now(),
    });

    await queue.processQueue();

    expect(mockClient.setTaskAssignees).toHaveBeenCalledWith(
      50,
      [{ id: -1, username: 'alice' }],
      []
    );
    expect(onAssigneesSynced).toHaveBeenCalledWith(50, [{ id: 7, username: 'alice' }]);
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('should stop processing and retain queue on network error for retry', async () => {
    mockClient.toggleTaskDone.mockRejectedValue(new Error('Network offline'));

    queue.enqueue({
      id: 'm1',
      type: 'TOGGLE_TASK',
      payload: { taskId: 10, done: true },
      timestamp: Date.now(),
    });

    await queue.processQueue();

    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getQueue()[0].id).toBe('m1');
    expect(queue.getQueue()[0].retryCount).toBe(1);
  });

  it('should track status lifecycle: synced -> syncing -> offline -> retry -> synced', async () => {
    const statusHistory: string[] = [];
    queue.onStatusChange((status, pending) => {
      statusHistory.push(`${status}:${pending}`);
    });

    expect(queue.getStatus()).toBe('synced');

    mockClient.toggleTaskDone.mockRejectedValueOnce(new Error('Network disconnected'));

    queue.enqueue({
      id: 'm-offline',
      type: 'TOGGLE_TASK',
      payload: { taskId: 1, done: true },
      timestamp: Date.now(),
    });

    expect(queue.getStatus()).toBe('syncing');

    await queue.processQueue();

    expect(queue.getStatus()).toBe('offline');
    expect(queue.getQueue()).toHaveLength(1);

    mockClient.toggleTaskDone.mockResolvedValueOnce({
      id: 1,
      title: 'Apples',
      done: true,
      priority: 0,
      project_id: 1,
    });

    await queue.retry();

    expect(queue.getStatus()).toBe('synced');
    expect(queue.getQueue()).toHaveLength(0);
    expect(statusHistory).toContain('offline:1');
    expect(statusHistory[statusHistory.length - 1]).toBe('synced:0');
  });

  it('should remap temporary negative task IDs to remote ID across subsequent queued mutations', async () => {
    const tempId = -999;
    const remoteId = 12345;

    mockClient.createTask.mockResolvedValueOnce({
      id: remoteId,
      title: 'Offline Created Task',
      done: false,
      priority: 1,
      project_id: 1,
    });
    mockClient.updateTask.mockResolvedValueOnce({
      id: remoteId,
      title: 'Offline Created Task',
      done: true,
      priority: 1,
      project_id: 1,
    });

    queue.enqueue({
      id: `create-${tempId}`,
      type: 'CREATE_TASK',
      payload: {
        tempId,
        projectId: 1,
        taskData: { title: 'Offline Created Task', project_id: 1 },
      },
      timestamp: 1000,
    });

    queue.enqueue({
      id: `toggle-${tempId}`,
      type: 'TOGGLE_TASK',
      payload: {
        taskId: tempId,
        done: true,
        data: { id: tempId, title: 'Offline Created Task', done: true, project_id: 1 },
      },
      timestamp: 2000,
    });

    await queue.processQueue();

    expect(mockClient.createTask).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ title: 'Offline Created Task' })
    );
    expect(mockClient.updateTask).toHaveBeenCalledWith(
      remoteId,
      expect.objectContaining({ done: true })
    );
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('cancels pending CREATE_TASK and dependent mutations when DELETE_TASK is enqueued for unsynced tempId < 0', async () => {
    const tempId = -555;
    queue.enqueue({
      id: `create-${tempId}`,
      type: 'CREATE_TASK',
      payload: {
        tempId,
        projectId: 1,
        taskData: { title: 'Draft Task', project_id: 1 },
      },
      timestamp: 1000,
    });
    queue.enqueue({
      id: `update-${tempId}`,
      type: 'UPDATE_TASK',
      payload: { taskId: tempId, data: { title: 'Edited Draft' } },
      timestamp: 1500,
    });

    queue.enqueue({
      id: `delete-${tempId}`,
      type: 'DELETE_TASK',
      payload: { taskId: tempId },
      timestamp: 2000,
    });

    expect(queue.getQueue()).toHaveLength(0);
    expect(queue.getStatus()).toBe('synced');

    await queue.processQueue();
    expect(mockClient.createTask).not.toHaveBeenCalled();
    expect(mockClient.deleteTask).not.toHaveBeenCalled();
  });

  it('remaps queued DELETE_TASK to positive server ID if CREATE_TASK was already in-flight when deleted', async () => {
    const tempId = -777;
    let resolveCreate!: (val: any) => void;
    mockClient.createTask.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveCreate = res;
        })
    );
    mockClient.deleteTask.mockResolvedValueOnce({ message: 'deleted' });

    queue.enqueue({
      id: `create-${tempId}`,
      type: 'CREATE_TASK',
      payload: {
        tempId,
        projectId: 1,
        taskData: { title: 'In-flight task', project_id: 1 },
      },
      timestamp: 1000,
    });

    const processingPromise = queue.processQueue();

    queue.enqueue({
      id: `delete-${tempId}`,
      type: 'DELETE_TASK',
      payload: { taskId: tempId },
      timestamp: 1100,
    });

    resolveCreate({ id: 808, title: 'In-flight task', done: false, priority: 0, project_id: 1 });
    await processingPromise;

    expect(mockClient.deleteTask).toHaveBeenCalledWith(808);
    expect(queue.getQueue()).toHaveLength(0);
  });

  it('propagates transient setTaskLabels / setTaskAssignees failures during CREATE_TASK into retryable queue items without duplicating task', async () => {
    mockClient.createTask.mockResolvedValueOnce({
      id: 50,
      title: 'Buy Milk',
      done: false,
      priority: 1,
      project_id: 1,
    });
    mockClient.setTaskLabels
      .mockRejectedValueOnce(new Error('Network glitch attaching labels'))
      .mockResolvedValueOnce([{ id: 1, title: 'Costco' }]);
    mockClient.setTaskAssignees
      .mockRejectedValueOnce(new Error('Network glitch attaching assignees'))
      .mockResolvedValueOnce([{ id: 7, username: 'alice' }]);

    queue.enqueue({
      id: 'm-create-with-meta',
      type: 'CREATE_TASK',
      payload: {
        tempId: -50,
        projectId: 1,
        taskData: { title: 'Buy Milk', project_id: 1 },
        labels: [{ id: -1, title: 'Costco' }],
        assignees: [{ id: -2, username: 'alice' }],
      },
      timestamp: Date.now(),
    });

    await queue.processQueue();

    expect(mockClient.createTask).toHaveBeenCalledTimes(1);
    expect(queue.getStatus()).toBe('offline');
    expect(queue.getQueue().map((m) => m.type)).toEqual([
      'SET_TASK_LABELS',
      'SET_TASK_ASSIGNEES',
    ]);

    await queue.retry();
    expect(mockClient.createTask).toHaveBeenCalledTimes(1);
    expect(mockClient.setTaskLabels).toHaveBeenCalledTimes(2);
    expect(mockClient.setTaskAssignees).toHaveBeenCalledTimes(2);
    expect(queue.getQueue()).toHaveLength(0);
    expect(queue.getStatus()).toBe('synced');
  });

  it('strips negative temporary label/user/task IDs from UPDATE_TASK snapshots', async () => {
    mockClient.updateTask.mockResolvedValueOnce({
      id: 42,
      title: 'Clean Snapshot',
      done: false,
      priority: 1,
      project_id: 1,
    });

    queue.enqueue({
      id: 'm-update-neg',
      type: 'UPDATE_TASK',
      payload: {
        taskId: 42,
        data: {
          id: -42,
          title: 'Clean Snapshot',
          labels: [
            { id: -1, title: 'UnsyncedLabel' },
            { id: 5, title: 'SyncedLabel' },
          ],
          assignees: [
            { id: -9, username: 'pendingUser' },
            { id: 3, username: 'realUser' },
          ],
        },
      },
      timestamp: Date.now(),
    });

    await queue.processQueue();

    expect(mockClient.updateTask).toHaveBeenCalledWith(42, {
      title: 'Clean Snapshot',
      labels: [{ id: 5, title: 'SyncedLabel' }],
      assignees: [{ id: 3, username: 'realUser' }],
    });
  });

  it('should drop permanent 4xx errors and continue processing subsequent queued items', async () => {
    const error404: any = new Error('Task not found');
    error404.status = 404;

    mockClient.updateTask.mockRejectedValueOnce(error404);
    mockClient.toggleTaskDone.mockResolvedValueOnce({
      id: 2,
      title: 'Valid task',
      done: true,
      priority: 0,
      project_id: 1,
    });

    const onError = jest.fn();

    queue.enqueue({
      id: 'm-bad-404',
      type: 'UPDATE_TASK',
      payload: { taskId: 99999, data: { done: true } },
      timestamp: 1000,
      onError,
    });

    queue.enqueue({
      id: 'm-valid',
      type: 'TOGGLE_TASK',
      payload: { taskId: 2, done: true },
      timestamp: 2000,
    });

    await queue.processQueue();

    expect(onError).toHaveBeenCalledWith(error404);
    expect(mockClient.toggleTaskDone).toHaveBeenCalledWith(2, true);
    expect(queue.getQueue()).toHaveLength(0);
    expect(queue.getStatus()).toBe('synced');
  });

  it('preserves queue on 401, 403, 408, and 429 errors without dropping user mutations', async () => {
    for (const retryableStatus of [401, 403, 408, 429]) {
      const q = new SyncQueue(mockClient);
      const err: any = new Error(`HTTP ${retryableStatus}`);
      err.status = retryableStatus;
      mockClient.toggleTaskDone.mockRejectedValueOnce(err);

      q.enqueue({
        id: `m-${retryableStatus}`,
        type: 'TOGGLE_TASK',
        payload: { taskId: 10, done: true },
        timestamp: 1000,
      });

      await q.processQueue();
      expect(q.getQueue()).toHaveLength(1);
      expect(q.getStatus()).toBe(retryableStatus === 401 ? 'auth_required' : 'offline');
    }
  });

  it('should not retry mutation if onSuccess throws an error', async () => {
    mockClient.createTask.mockResolvedValueOnce({
      id: 777,
      title: 'Callback test',
      done: false,
      priority: 0,
      project_id: 1,
    });

    const badOnSuccess = jest.fn().mockImplementation(() => {
      throw new Error('Crash in callback');
    });

    queue.enqueue({
      id: 'm-crash-callback',
      type: 'CREATE_TASK',
      payload: { projectId: 1, taskData: { title: 'Callback test', project_id: 1 } },
      timestamp: 1000,
      onSuccess: badOnSuccess,
    });

    await queue.processQueue();

    expect(queue.getQueue()).toHaveLength(0);
  });

  it('should persist queue to AsyncStorage on enqueue and rehydrate on loadFromStorage', async () => {
    const mutation: Mutation = {
      id: 'persist-1',
      type: 'TOGGLE_TASK',
      payload: { taskId: 42, done: true },
      timestamp: 5000,
      onSuccess: jest.fn(),
    };

    queue.enqueue(mutation);
    await new Promise((r) => setTimeout(r, 10));

    const stored = await AsyncStorage.getItem('@vikunja_sync_queue');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('persist-1');
    expect(parsed[0].payload.taskId).toBe(42);
    expect(parsed[0].onSuccess).toBeUndefined();

    const newQueue = new SyncQueue(mockClient);
    await newQueue.loadFromStorage();

    expect(newQueue.getQueue()).toHaveLength(1);
    expect(newQueue.getQueue()[0].id).toBe('persist-1');
    expect(newQueue.getStatus()).toBe('syncing');

    mockClient.toggleTaskDone.mockResolvedValueOnce({
      id: 42,
      done: true,
      title: 'Persisted task',
      priority: 0,
      project_id: 1,
    } as any);

    await newQueue.processQueue();
    expect(newQueue.getQueue()).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 10));
    expect(await AsyncStorage.getItem('@vikunja_sync_queue')).toBeNull();
  });

  it('should clear AsyncStorage when queue.clear() is called', async () => {
    queue.enqueue({
      id: 'persist-2',
      type: 'DELETE_TASK',
      payload: { taskId: 99 },
      timestamp: 6000,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(await AsyncStorage.getItem('@vikunja_sync_queue')).not.toBeNull();

    await queue.clear();
    expect(await AsyncStorage.getItem('@vikunja_sync_queue')).toBeNull();
    expect(queue.getQueue()).toHaveLength(0);
  });

  describe('REORDER_TASK Deduplication & Concurrency Safety', () => {
    it('should deduplicate non-in-flight REORDER_TASK mutations in-place for the same task ID', () => {
      queue.enqueue({
        id: 'reorder-10-1',
        type: 'REORDER_TASK',
        payload: { taskId: 10, position: 1000, projectViewId: 5 },
        timestamp: 100,
      });

      expect(queue.getQueue()).toHaveLength(1);
      expect(queue.getQueue()[0].payload.position).toBe(1000);

      queue.enqueue({
        id: 'reorder-10-2',
        type: 'REORDER_TASK',
        payload: { taskId: 10, position: 3000, projectViewId: 5 },
        timestamp: 200,
      });

      expect(queue.getQueue()).toHaveLength(1);
      expect(queue.getQueue()[0].payload.position).toBe(3000);
      expect(queue.getQueue()[0].timestamp).toBe(200);
    });

    it('should call client.reorderTask and clear queue when processing REORDER_TASK', async () => {
      mockClient.reorderTask.mockResolvedValueOnce({ success: true });

      queue.enqueue({
        id: 'reorder-42-1',
        type: 'REORDER_TASK',
        payload: { taskId: 42, position: 2000, projectViewId: 7 },
        timestamp: 500,
      });

      await queue.processQueue();

      expect(mockClient.reorderTask).toHaveBeenCalledWith(42, 2000, 7);
      expect(queue.getQueue()).toHaveLength(0);
      expect(queue.getStatus()).toBe('synced');
    });

    it('never overwrites an in-flight REORDER_TASK queue[0] item when a new drag arrives mid-flight', async () => {
      let resolveFirstReorder!: (val: any) => void;
      mockClient.reorderTask
        .mockImplementationOnce(
          () =>
            new Promise((res) => {
              resolveFirstReorder = res;
            })
        )
        .mockResolvedValueOnce({ success: true });

      queue.enqueue({
        id: 'reorder-10-first',
        type: 'REORDER_TASK',
        payload: { taskId: 10, position: 1000, projectViewId: 5 },
        timestamp: 100,
      });

      const runPromise = queue.processQueue();

      queue.enqueue({
        id: 'reorder-10-second',
        type: 'REORDER_TASK',
        payload: { taskId: 10, position: 3000, projectViewId: 5 },
        timestamp: 200,
      });

      expect(queue.getQueue()).toHaveLength(2);

      resolveFirstReorder({ success: true });
      await runPromise;

      expect(mockClient.reorderTask).toHaveBeenNthCalledWith(1, 10, 1000, 5);
      expect(mockClient.reorderTask).toHaveBeenNthCalledWith(2, 10, 3000, 5);
      expect(queue.getQueue()).toHaveLength(0);
    });
  });
});
