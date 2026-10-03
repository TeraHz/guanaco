import { SyncQueue, Mutation } from '../syncQueue';
import { VikunjaClient } from '../../api/client';

describe('SyncQueue', () => {
  let queue: SyncQueue;
  let mockClient: jest.Mocked<VikunjaClient>;

  beforeEach(() => {
    mockClient = {
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      toggleTaskDone: jest.fn(),
      moveTask: jest.fn(),
      reorderTask: jest.fn(),
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

  it('should process CREATE_TASK and execute onResolved callback with remote task', async () => {
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

  it('should synchronize task labels when CREATE_TASK contains labels', async () => {
    mockClient.setTaskLabels = jest.fn().mockResolvedValue([
      { id: 1, title: 'Costco' },
      { id: 2, title: 'Groceries' },
    ]);
    mockClient.createTask.mockResolvedValue({
      id: 50,
      title: 'Buy Milk',
      done: false,
      priority: 1,
      project_id: 1,
      labels: null as any, // Vikunja returns null labels from createTask
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
          labels: [{ id: -1, title: 'Costco' }, { id: -2, title: 'Groceries' }],
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
    // The resolved task must have labels attached!
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
    mockClient.setTaskLabels = jest.fn().mockResolvedValue([
      { id: 1, title: 'Costco' },
    ]);

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

    expect(mockClient.setTaskLabels).toHaveBeenCalledWith(50, [
      { id: 1, title: 'Costco' },
    ]);
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

    // Queue should still hold m1 because network failed
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

    // Make network fail initially
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

    // Connection restored
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

    // Enqueue create followed by toggle on the tempId
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

    expect(mockClient.createTask).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Offline Created Task' }));
    // updateTask should have been called with the remapped real remoteId, NOT tempId!
    expect(mockClient.updateTask).toHaveBeenCalledWith(remoteId, expect.objectContaining({ done: true }));
    expect(queue.getQueue()).toHaveLength(0);
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

    // Enqueue an invalid task followed by a valid task
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

    // 404 item was notified of error and discarded
    expect(onError).toHaveBeenCalledWith(error404);
    // Queue did NOT get stuck; valid item was processed!
    expect(mockClient.toggleTaskDone).toHaveBeenCalledWith(2, true);
    expect(queue.getQueue()).toHaveLength(0);
    expect(queue.getStatus()).toBe('synced');
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

    // Item must be removed from queue so it is not re-executed creating duplicate tasks
    expect(queue.getQueue()).toHaveLength(0);
  });
});
