import { VikunjaClient } from '../api/client';
import { Task } from '../types/vikunja';

export type MutationType =
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'TOGGLE_TASK'
  | 'MOVE_TASK'
  | 'REORDER_TASK'
  | 'DELETE_TASK'
  | 'SET_TASK_LABELS'
  | 'SET_TASK_ASSIGNEES';

export interface Mutation {
  id: string;
  type: MutationType;
  payload: any;
  timestamp: number;
  retryCount?: number;
  onSuccess?: (result: any) => void;
  onError?: (err: any) => void;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline';

export type SyncStatusListener = (status: SyncStatus, pendingCount: number) => void;

export class SyncQueue {
  private queue: Mutation[] = [];
  private isProcessing = false;
  private status: SyncStatus = 'synced';
  private statusListeners: SyncStatusListener[] = [];

  constructor(private client: VikunjaClient) {}

  public getStatus(): SyncStatus {
    return this.status;
  }

  public onStatusChange(listener: SyncStatusListener): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const count = this.queue.length;
    this.statusListeners.forEach((l) => l(this.status, count));
  }

  public enqueue(mutation: Mutation): void {
    this.queue.push({
      ...mutation,
      retryCount: mutation.retryCount ?? 0,
    });
    this.setStatus('syncing');
  }

  public hasPendingForTask(taskId: number, mutationType?: MutationType): boolean {
    return this.queue.some((item) => {
      const matchType = mutationType ? item.type === mutationType : true;
      const matchTask =
        item.payload?.taskId === taskId ||
        item.payload?.id === taskId ||
        item.payload?.taskData?.id === taskId;
      return matchType && matchTask;
    });
  }

  public getQueue(): Mutation[] {
    return [...this.queue];
  }

  public setClient(client: VikunjaClient): void {
    this.client = client;
  }

  public async retry(): Promise<void> {
    if (this.queue.length > 0) {
      this.setStatus('syncing');
      await this.processQueue();
    } else {
      this.setStatus('synced');
    }
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      if (this.queue.length === 0 && this.status !== 'synced') {
        this.setStatus('synced');
      }
      return;
    }
    this.isProcessing = true;
    this.setStatus('syncing');

    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        try {
          let result: any = null;

          switch (item.type) {
            case 'CREATE_TASK': {
              const { projectId, taskData } = item.payload;
              const labels = item.payload.labels || taskData?.labels;
              const assignees = item.payload.assignees || taskData?.assignees;
              result = await this.client.createTask(projectId, taskData);

              // If task had labels attached at creation, sync them via setTaskLabels
              if (labels && labels.length > 0 && result && result.id > 0) {
                try {
                  const attachedLabels = await this.client.setTaskLabels(result.id, labels);
                  result.labels = attachedLabels;
                } catch (_) {
                  // Keep optimistic labels if server label association fails
                  result.labels = labels;
                }
              }

              // If task had assignees attached at creation, sync them via setTaskAssignees
              if (assignees && assignees.length > 0 && result && result.id > 0) {
                try {
                  const attachedAssignees = await this.client.setTaskAssignees(result.id, assignees);
                  result.assignees = attachedAssignees;
                } catch (_) {
                  result.assignees = assignees;
                }
              }
              break;
            }
            case 'UPDATE_TASK': {
              const { taskId, data } = item.payload;
              result = await this.client.updateTask(taskId, data);
              break;
            }
            case 'TOGGLE_TASK': {
              const { taskId, done } = item.payload;
              result = await this.client.toggleTaskDone(taskId, done);
              break;
            }
            case 'MOVE_TASK': {
              const { taskId, targetProjectId } = item.payload;
              result = await this.client.moveTask(taskId, targetProjectId);
              break;
            }
            case 'REORDER_TASK': {
              const { taskId, position } = item.payload;
              result = await this.client.reorderTask(taskId, position);
              break;
            }
            case 'SET_TASK_LABELS': {
              const { taskId, labels, previousLabels } = item.payload;
              const syncedLabels =
                previousLabels !== undefined
                  ? await this.client.setTaskLabels(taskId, labels, previousLabels)
                  : await this.client.setTaskLabels(taskId, labels);
              result = { taskId, labels: syncedLabels };
              break;
            }
            case 'SET_TASK_ASSIGNEES': {
              const { taskId, assignees, previousAssignees } = item.payload;
              const syncedAssignees =
                previousAssignees !== undefined
                  ? await this.client.setTaskAssignees(taskId, assignees, previousAssignees)
                  : await this.client.setTaskAssignees(taskId, assignees);
              result = { taskId, assignees: syncedAssignees };
              break;
            }
            case 'DELETE_TASK': {
              const { taskId } = item.payload;
              result = await this.client.deleteTask(taskId);
              break;
            }
          }

          if (item.onSuccess) {
            item.onSuccess(result);
          }

          // Successfully processed, remove from queue
          this.queue.shift();
        } catch (err: any) {
          // Network error or offline: increment retry count and mark offline
          item.retryCount = (item.retryCount || 0) + 1;
          this.setStatus('offline');
          if (item.onError) {
            item.onError(err);
          }
          break;
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length === 0) {
        this.setStatus('synced');
      }
    }
  }

  public clear(): void {
    this.queue = [];
  }
}
