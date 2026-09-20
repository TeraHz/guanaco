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
});
