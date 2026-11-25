import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SyncQueue,
  Mutation,
  MAX_SERVER_ERROR_RETRIES,
  countDistinctPendingChanges,
} from '../syncQueue';
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
      createTaskRelation: jest.fn(),
      deleteTaskRelation: jest.fn(),
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

  it('preserves queue on 401, 408, and 429 errors without dropping user mutations', async () => {
    for (const retryableStatus of [401, 408, 429]) {
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

  it('treats 403 as permanent, drops dependent tempId < 0 mutations, caps 500 retries at MAX_SERVER_ERROR_RETRIES, and keeps 502/503/504 unbounded', async () => {
    const onMutationFailed = jest.fn();
    queue.onMutationFailed = onMutationFailed;

    const err403: any = new Error('Forbidden');
    err403.status = 403;
    mockClient.createTask.mockRejectedValueOnce(err403);
    mockClient.toggleTaskDone.mockResolvedValueOnce({
      id: 77,
      title: 'Independent Task',
      done: true,
      priority: 0,
      project_id: 1,
    });

    queue.enqueue({
      id: 'create-ro',
      type: 'CREATE_TASK',
      payload: { tempId: -301, projectId: 9, taskData: { title: 'Blocked Task', project_id: 9 } },
      timestamp: 100,
    });
    queue.enqueue({
      id: 'dep-label',
      type: 'SET_TASK_LABELS',
      payload: { taskId: -301, labels: [{ id: 1, title: 'Tag' }] },
      timestamp: 110,
    });
    queue.enqueue({
      id: 'indep-toggle',
      type: 'TOGGLE_TASK',
      payload: { taskId: 77, done: true },
      timestamp: 120,
    });

    await queue.processQueue();

    expect(onMutationFailed).toHaveBeenCalledTimes(1);
    expect(onMutationFailed.mock.calls[0][0].id).toBe('create-ro');
    expect(onMutationFailed.mock.calls[0][2].map((m: Mutation) => m.id)).toEqual(['dep-label']);
    expect(mockClient.setTaskLabels).not.toHaveBeenCalled();
    expect(mockClient.toggleTaskDone).toHaveBeenCalledWith(77, true);
    expect(queue.getQueue()).toHaveLength(0);

    // Deterministic 500 is capped at MAX_SERVER_ERROR_RETRIES, while 503 gateway maintenance stays unbounded
    const err503: any = new Error('Service Unavailable');
    err503.status = 503;
    const qGateway = new SyncQueue(mockClient);
    mockClient.toggleTaskDone.mockRejectedValue(err503);
    qGateway.enqueue({
      id: 'm-503',
      type: 'TOGGLE_TASK',
      payload: { taskId: 10, done: true },
      timestamp: 200,
    });
    for (let i = 0; i < MAX_SERVER_ERROR_RETRIES + 2; i++) {
      await qGateway.processQueue();
    }
    expect(qGateway.getQueue()).toHaveLength(1);

    const err500: any = new Error('Internal Server Error');
    err500.status = 500;
    const onFailed500 = jest.fn();
    const q500 = new SyncQueue(mockClient);
    q500.onMutationFailed = onFailed500;
    mockClient.toggleTaskDone.mockReset();
    mockClient.toggleTaskDone.mockRejectedValue(err500);
    q500.enqueue({
      id: 'm-500',
      type: 'TOGGLE_TASK',
      payload: { taskId: 10, done: true },
      timestamp: 300,
    });
    let fakeNow = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    try {
      await q500.processQueue();
      expect(mockClient.toggleTaskDone).toHaveBeenCalledTimes(1);
      expect(q500.getQueue()).toHaveLength(1);

      // Immediate automatic retry inside backoff window must NOT burn another retry attempt!
      await q500.processQueue();
      expect(mockClient.toggleTaskDone).toHaveBeenCalledTimes(1);
      expect(q500.getQueue()).toHaveLength(1);

      // Advancing past exponential backoff allows remaining retries up to MAX_SERVER_ERROR_RETRIES
      for (let i = 1; i < MAX_SERVER_ERROR_RETRIES - 1; i++) {
        fakeNow += 600_000;
        await q500.processQueue();
        expect(q500.getQueue()).toHaveLength(1);
      }
      fakeNow += 600_000;
      await q500.processQueue();
      expect(q500.getQueue()).toHaveLength(0);
      expect(onFailed500).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('preserves queued changes on reverse-proxy / Cloudflare 403 while evicting Vikunja API 403', async () => {
    const onMutationFailed = jest.fn();
    queue.onMutationFailed = onMutationFailed;

    const proxy403: any = new Error('Forbidden');
    proxy403.status = 403;
    proxy403.data = null;
    proxy403.isProxyError = true;
    mockClient.toggleTaskDone.mockRejectedValueOnce(proxy403);

    queue.enqueue({
      id: 'proxy-403-item',
      type: 'TOGGLE_TASK',
      payload: { taskId: 88, done: true },
      timestamp: 100,
    });

    await queue.processQueue();

    // Proxy 403 pauses queue as offline without permanently dropping the user's change
    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getStatus()).toBe('offline');
    expect(onMutationFailed).not.toHaveBeenCalled();

    // Genuine Vikunja API 403 with numeric code evicts cleanly
    const vikunja403: any = new Error('Forbidden');
    vikunja403.status = 403;
    vikunja403.data = { code: 4, message: 'Forbidden' };
    mockClient.toggleTaskDone.mockRejectedValueOnce(vikunja403);

    await queue.processQueue();
    expect(queue.getQueue()).toHaveLength(0);
    expect(onMutationFailed).toHaveBeenCalledTimes(1);
  });

  it('coalesces same-type mutations on taskId > 0, merges patch onto fresh remote getTask(), and computes countDistinctPendingChanges', async () => {
    queue.enqueue({
      id: 'u1',
      type: 'UPDATE_TASK',
      payload: { taskId: 15, patch: { title: 'Title A' }, data: { id: 15, title: 'Title A' } },
      timestamp: 100,
    });
    queue.enqueue({
      id: 'u2',
      type: 'UPDATE_TASK',
      payload: { taskId: 15, patch: { priority: 4 }, data: { id: 15, title: 'Title A', priority: 4 } },
      timestamp: 110,
    });
    queue.enqueue({
      id: 'l1',
      type: 'SET_TASK_LABELS',
      payload: { taskId: 15, labels: [{ id: 1, title: 'One' }], previousLabels: [] },
      timestamp: 120,
    });
    queue.enqueue({
      id: 'l2',
      type: 'SET_TASK_LABELS',
      payload: {
        taskId: 15,
        labels: [{ id: 2, title: 'Two' }],
        previousLabels: [{ id: 1, title: 'One' }],
      },
      timestamp: 130,
    });

    expect(queue.getQueue()).toHaveLength(2);
    expect(queue.getPendingPatchForTask(15)).toEqual({ title: 'Title A', priority: 4 });
    expect(queue.getQueue()[1].payload.previousLabels).toEqual([]);
    // Both mutations target task 15 -> 1 logical pending change!
    expect(queue.getPendingCount()).toBe(1);
    expect(
      countDistinctPendingChanges([
        ...queue.getQueue(),
        { id: 'r1', type: 'REORDER_TASK', payload: { taskId: 20, position: 500, projectViewId: 9 }, timestamp: 140 },
        { id: 'r2', type: 'REORDER_TASK', payload: { taskId: 21, position: 600, projectViewId: 9 }, timestamp: 141 },
      ])
    ).toBe(2);

    (mockClient as any).getTask = jest.fn().mockResolvedValue({
      id: 15,
      title: 'Old Server Title',
      description: 'Concurrent Remote Notes',
      done: false,
      priority: 1,
      project_id: 1,
    });
    mockClient.updateTask.mockResolvedValue({
      id: 15,
      title: 'Title A',
      description: 'Concurrent Remote Notes',
      done: false,
      priority: 4,
      project_id: 1,
    });
    mockClient.setTaskLabels.mockResolvedValue([{ id: 2, title: 'Two' }]);

    await queue.processQueue();
    expect(mockClient.updateTask).toHaveBeenCalledWith(
      15,
      expect.objectContaining({
        title: 'Title A',
        description: 'Concurrent Remote Notes',
        priority: 4,
      })
    );

    // DELETE_TASK on positive server ID prunes prior pending task mutations
    queue.enqueue({
      id: 't1',
      type: 'TOGGLE_TASK',
      payload: { taskId: 88, done: true },
      timestamp: 200,
    });
    queue.enqueue({
      id: 'd1',
      type: 'DELETE_TASK',
      payload: { taskId: 88 },
      timestamp: 210,
    });
    expect(queue.getQueue().map((m) => m.type)).toEqual(['DELETE_TASK']);
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

  describe('Subtask / Task Relation Mutations & Dual Temp-ID Remapping', () => {
    it('remaps BOTH negative parent taskId AND negative child otherTaskId across chained offline subtask creation', async () => {
      mockClient.createTask
        .mockResolvedValueOnce({
          id: 501,
          title: 'Parent Trip',
          done: false,
          priority: 2,
          project_id: 1,
        })
        .mockResolvedValueOnce({
          id: 502,
          title: 'Pack Passport',
          done: false,
          priority: 0,
          project_id: 1,
        });
      mockClient.createTaskRelation.mockResolvedValueOnce({
        task_id: 501,
        other_task_id: 502,
        relation_kind: 'subtask',
      });

      queue.enqueue({
        id: 'create-parent',
        type: 'CREATE_TASK',
        payload: { tempId: -101, projectId: 1, taskData: { title: 'Parent Trip', project_id: 1 } },
        timestamp: 100,
      });
      queue.enqueue({
        id: 'create-subtask',
        type: 'CREATE_TASK',
        payload: { tempId: -102, projectId: 1, taskData: { title: 'Pack Passport', project_id: 1 } },
        timestamp: 110,
      });
      queue.enqueue({
        id: 'link-subtask',
        type: 'CREATE_TASK_RELATION',
        payload: { taskId: -101, otherTaskId: -102, relationKind: 'subtask' },
        timestamp: 120,
      });

      await queue.processQueue();

      expect(mockClient.createTaskRelation).toHaveBeenCalledWith(501, 502, 'subtask');
      expect(queue.getQueue()).toHaveLength(0);
      expect(queue.getStatus()).toBe('synced');
    });

    it('cancels pending CREATE_TASK_RELATION when an unsynced negative-tempId subtask is deleted offline', async () => {
      queue.enqueue({
        id: 'create-subtask',
        type: 'CREATE_TASK',
        payload: { tempId: -202, projectId: 1, taskData: { title: 'Temp Subtask', project_id: 1 } },
        timestamp: 100,
      });
      queue.enqueue({
        id: 'link-subtask',
        type: 'CREATE_TASK_RELATION',
        payload: { taskId: 42, otherTaskId: -202, relationKind: 'subtask' },
        timestamp: 110,
      });

      queue.enqueue({
        id: 'delete-subtask',
        type: 'DELETE_TASK',
        payload: { taskId: -202 },
        timestamp: 120,
      });

      expect(queue.getQueue()).toHaveLength(0);
      await queue.processQueue();
      expect(mockClient.createTask).not.toHaveBeenCalled();
      expect(mockClient.createTaskRelation).not.toHaveBeenCalled();
    });

    it('processes DELETE_TASK_RELATION via client.deleteTaskRelation', async () => {
      mockClient.deleteTaskRelation.mockResolvedValueOnce({ message: 'unlinked' });

      queue.enqueue({
        id: 'unlink-1',
        type: 'DELETE_TASK_RELATION',
        payload: { taskId: 42, otherTaskId: 99, relationKind: 'subtask' },
        timestamp: 200,
      });

      await queue.processQueue();
      expect(mockClient.deleteTaskRelation).toHaveBeenCalledWith(42, 'subtask', 99);
      expect(queue.getQueue()).toHaveLength(0);
    });
  });

  describe('Round 2 Adversarial Audit Regressions (Chronological Coalescing, Slice Preservation, 404 Delete & Sub-Step 4xx)', () => {
    it('preserves strict chronological order via splice-to-tail coalescing and strips superseded cross-type scalar keys', () => {
      // 1. UPDATE({ done: true }) -> TOGGLE(false) -> UPDATE({ title: 'Final', done: true })
      queue.enqueue({
        id: 'u1',
        type: 'UPDATE_TASK',
        payload: { taskId: 10, patch: { done: true, done_at: '2026-01-01T00:00:00Z' } },
        timestamp: 1,
      });
      queue.enqueue({
        id: 't1',
        type: 'TOGGLE_TASK',
        payload: { taskId: 10, done: false, patch: { done: false, done_at: null } },
        timestamp: 2,
      });
      // First UPDATE had only { done, done_at }, so TOGGLE stripped it to empty {} and removed u1!
      expect(queue.getQueue().map((m) => m.id)).toEqual(['t1']);

      queue.enqueue({
        id: 'u2',
        type: 'UPDATE_TASK',
        payload: { taskId: 10, patch: { title: 'Final', done: true } },
        timestamp: 3,
      });
      // u2 specifies patch.done, so earlier TOGGLE is superseded and u2 sits at tail!
      expect(queue.getQueue().map((m) => m.id)).toEqual(['u2']);
      expect(queue.getPendingPatchForTask(10)).toEqual({ title: 'Final', done: true });

      // 2. UPDATE({ title: 'Edited', done: true }) -> TOGGLE(false) keeps UPDATE({ title: 'Edited' }) then TOGGLE(false)
      queue.enqueue({
        id: 'u3',
        type: 'UPDATE_TASK',
        payload: { taskId: 20, patch: { title: 'Edited', done: true, done_at: '2026-01-01T00:00:00Z' } },
        timestamp: 4,
      });
      queue.enqueue({
        id: 't2',
        type: 'TOGGLE_TASK',
        payload: { taskId: 20, done: false, patch: { done: false, done_at: null } },
        timestamp: 5,
      });
      const q20 = queue.getQueue().filter((m) => m.payload.taskId === 20);
      expect(q20.map((m) => m.type)).toEqual(['UPDATE_TASK', 'TOGGLE_TASK']);
      expect(q20[0].payload.patch).toEqual({ title: 'Edited' });

      // 3. TOGGLE_TASK followed by MOVE_TASK stays as 2 separate items
      queue.enqueue({
        id: 't3',
        type: 'TOGGLE_TASK',
        payload: { taskId: 30, done: true, patch: { done: true } },
        timestamp: 6,
      });
      queue.enqueue({
        id: 'm3',
        type: 'MOVE_TASK',
        payload: { taskId: 30, targetProjectId: 5, patch: { project_id: 5 } },
        timestamp: 7,
      });
      const q30 = queue.getQueue().filter((m) => m.payload.taskId === 30);
      expect(q30.map((m) => m.type)).toEqual(['TOGGLE_TASK', 'MOVE_TASK']);
    });

    it('preserves relational slices (labels, assignees, reminders, related_tasks) when updateTask returns null slices', async () => {
      const updatedSpy = jest.fn();
      queue.onTaskUpdated = updatedSpy;

      mockClient.getTask = jest.fn().mockResolvedValueOnce({
        id: 55,
        title: 'Server Task',
        done: false,
        priority: 2,
        project_id: 1,
        labels: [{ id: 3, title: 'Urgent' }],
        assignees: [{ id: 7, username: 'alice' }],
        reminders: [{ reminder: '2026-06-01T09:00:00Z' }],
        related_tasks: { subtask: [{ id: 56, title: 'Child', done: false, priority: 0, project_id: 1 }] },
      });
      mockClient.updateTask.mockResolvedValueOnce({
        id: 55,
        title: 'Server Task Updated',
        done: false,
        priority: 5,
        project_id: 1,
        labels: null as any,
        assignees: null as any,
        reminders: null,
        related_tasks: null as any,
      });

      queue.enqueue({
        id: 'upd-55',
        type: 'UPDATE_TASK',
        payload: { taskId: 55, patch: { title: 'Server Task Updated', priority: 5 } },
        timestamp: 100,
      });

      await queue.processQueue();

      expect(updatedSpy).toHaveBeenCalledTimes(1);
      const syncedTask = updatedSpy.mock.calls[0][1];
      expect(syncedTask.labels).toEqual([{ id: 3, title: 'Urgent' }]);
      expect(syncedTask.assignees).toEqual([{ id: 7, username: 'alice' }]);
      expect(syncedTask.reminders).toEqual([{ reminder: '2026-06-01T09:00:00Z' }]);
      expect(syncedTask.related_tasks.subtask).toHaveLength(1);
    });

    it('treats 404 on DELETE_TASK as idempotent success and surfaces permanent 403 on CREATE_TASK label sub-step', async () => {
      const failedSpy = jest.fn();
      const labelsSyncedSpy = jest.fn();
      const createdSpy = jest.fn();
      queue.onMutationFailed = failedSpy;
      queue.onTaskLabelsSynced = labelsSyncedSpy;
      queue.onTaskCreated = createdSpy;

      const notFoundErr = Object.assign(new Error('Task not found'), { status: 404 });
      mockClient.deleteTask.mockRejectedValueOnce(notFoundErr);

      queue.enqueue({
        id: 'del-404',
        type: 'DELETE_TASK',
        payload: { taskId: 999, taskTitle: 'Already Gone' },
        timestamp: 10,
      });

      await queue.processQueue();
      expect(failedSpy).not.toHaveBeenCalled();
      expect(queue.getQueue()).toHaveLength(0);

      // Permanent 403 on CREATE_TASK setTaskLabels sub-step
      mockClient.createTask.mockResolvedValueOnce({
        id: 700,
        title: 'Created Task',
        done: false,
        priority: 0,
        project_id: 1,
      });
      const forbiddenErr = Object.assign(new Error('Forbidden label creation'), { status: 403 });
      mockClient.setTaskLabels = jest.fn().mockRejectedValueOnce(forbiddenErr);

      queue.enqueue({
        id: 'create-lbl-403',
        type: 'CREATE_TASK',
        payload: {
          tempId: -700,
          projectId: 1,
          taskData: {
            title: 'Created Task',
            project_id: 1,
            labels: [{ id: -5, title: 'BlockedLabel' }],
          },
        },
        timestamp: 20,
      });

      await queue.processQueue();

      expect(createdSpy).toHaveBeenCalledTimes(1);
      expect(createdSpy.mock.calls[0][1].labels || []).toEqual([]);
      expect(labelsSyncedSpy).toHaveBeenCalledWith(700, []);
      expect(failedSpy).toHaveBeenCalledTimes(1);
      expect(failedSpy.mock.calls[0][0].type).toBe('SET_TASK_LABELS');
    });
  });
});
