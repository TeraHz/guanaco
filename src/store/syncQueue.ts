import AsyncStorage from '@react-native-async-storage/async-storage';
import { VikunjaClient } from '../api/client';
import { Task } from '../types/vikunja';

export const SYNC_QUEUE_STORAGE_KEY = '@vikunja_sync_queue';

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

  private async persistQueue(): Promise<void> {
    try {
      if (this.queue.length === 0) {
        await AsyncStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
      } else {
        const serializable = this.queue.map(({ id, type, payload, timestamp, retryCount }) => ({
          id,
          type,
          payload,
          timestamp,
          retryCount,
        }));
        await AsyncStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(serializable));
      }
    } catch (_) {
      // Storage errors should not break in-memory queue operation
    }
  }

  public async loadFromStorage(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
      if (data) {
        const parsed: Mutation[] = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.queue = parsed;
          this.setStatus('syncing');
        }
      }
    } catch (_) {}
  }

  public enqueue(mutation: Mutation): void {
    if (mutation.type === 'REORDER_TASK') {
      const taskId = mutation.payload?.taskId;
      const existingIdx = this.queue.findIndex(
        (m) => m.type === 'REORDER_TASK' && m.payload?.taskId === taskId
      );
      if (existingIdx !== -1) {
        this.queue[existingIdx] = {
          ...this.queue[existingIdx],
          payload: {
            ...this.queue[existingIdx].payload,
            position: mutation.payload.position,
            projectViewId:
              mutation.payload.projectViewId || this.queue[existingIdx].payload.projectViewId,
          },
          timestamp: mutation.timestamp,
        };
        this.setStatus('syncing');
        this.persistQueue();
        return;
      }
    }

    this.queue.push({
      ...mutation,
      retryCount: mutation.retryCount ?? 0,
    });
    this.setStatus('syncing');
    this.persistQueue();
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

  public remapTaskIdInQueue(oldId: number, newId: number): void {
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.payload) {
        if (q.payload.taskId === oldId) {
          q.payload.taskId = newId;
        }
        if (q.payload.data && q.payload.data.id === oldId) {
          q.payload.data.id = newId;
        }
        if (q.payload.tempId === oldId) {
          q.payload.tempId = newId;
        }
      }
    }
    this.persistQueue();
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
              const tempId = item.payload.tempId || taskData?.id;
              const labels = item.payload.labels || taskData?.labels;
              const assignees = item.payload.assignees || taskData?.assignees;
              result = await this.client.createTask(projectId, taskData);

              // If task had labels attached at creation, sync them via setTaskLabels
              if (labels && labels.length > 0 && result && result.id > 0) {
                try {
                  const attachedLabels = await this.client.setTaskLabels(result.id, labels);
                  result.labels = attachedLabels;
                } catch (_) {
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

              // Remap temporary ID across all subsequent queued mutations
              if (result && result.id > 0 && tempId && tempId < 0) {
                this.remapTaskIdInQueue(tempId, result.id);
              }
              break;
            }
            case 'UPDATE_TASK': {
              const { taskId, data } = item.payload;
              result = await this.client.updateTask(taskId, data);
              break;
            }
            case 'TOGGLE_TASK': {
              const { taskId, done, data } = item.payload;
              if (data) {
                result = await this.client.updateTask(taskId, { ...data, done });
              } else {
                result = await this.client.toggleTaskDone(taskId, done);
              }
              break;
            }
            case 'MOVE_TASK': {
              const { taskId, targetProjectId, data } = item.payload;
              if (data) {
                result = await this.client.updateTask(taskId, { ...data, project_id: targetProjectId });
              } else {
                result = await this.client.moveTask(taskId, targetProjectId);
              }
              break;
            }
            case 'REORDER_TASK': {
              const { taskId, position, projectViewId } = item.payload;
              result = await this.client.reorderTask(taskId, position, projectViewId);
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

          // Successfully processed by server: remove from queue first
          this.queue.shift();
          await this.persistQueue();

          if (item.onSuccess) {
            try {
              item.onSuccess(result);
            } catch (_) {
              // Callback failure must not re-trigger network mutation
            }
          }
        } catch (err: any) {
          const status = err?.status || err?.response?.status;
          const isPermanentClientError =
            status && typeof status === 'number' && status >= 400 && status < 500 && status !== 429;

          if (isPermanentClientError) {
            // Drop permanent 4xx error (e.g. 404 Not Found) so queue doesn't get blocked forever
            this.queue.shift();
            await this.persistQueue();
            if (item.onError) {
              try {
                item.onError(err);
              } catch (_) {}
            }
            continue;
          }

          // Network error or 5xx/429: increment retry count and mark offline
          item.retryCount = (item.retryCount || 0) + 1;
          await this.persistQueue();
          this.setStatus('offline');
          if (item.onError) {
            try {
              item.onError(err);
            } catch (_) {}
          }
          break;
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length === 0) {
        this.setStatus('synced');
      }
      await this.persistQueue();
    }
  }

  public async clear(): Promise<void> {
    this.queue = [];
    await this.persistQueue();
  }
}
