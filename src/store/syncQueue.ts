import AsyncStorage from '@react-native-async-storage/async-storage';
import { VikunjaClient } from '../api/client';
import { Label, Task, User } from '../types/vikunja';

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

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'auth_required';

export type SyncStatusListener = (status: SyncStatus, pendingCount: number) => void;

const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 408, 429]);

function isPermanent4xxError(status: unknown): boolean {
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(status)
  );
}

/**
 * Strips negative temporary IDs from task snapshots before sending to Vikunja's REST API.
 */
function sanitizeTaskSnapshot<T extends Record<string, any> | undefined>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const clean: Record<string, any> = { ...snapshot };
  if (typeof clean.id === 'number' && clean.id < 0) {
    delete clean.id;
  }
  if (Array.isArray(clean.labels)) {
    clean.labels = clean.labels.filter((l: any) => l && typeof l.id === 'number' && l.id > 0);
  }
  if (Array.isArray(clean.assignees)) {
    clean.assignees = clean.assignees.filter((u: any) => u && typeof u.id === 'number' && u.id > 0);
  }
  return clean as T;
}

function matchesTaskId(item: Mutation, taskId: number): boolean {
  const p = item.payload;
  if (!p) return false;
  return (
    p.taskId === taskId ||
    p.id === taskId ||
    p.tempId === taskId ||
    p.data?.id === taskId ||
    p.taskData?.id === taskId
  );
}

export class SyncQueue {
  private queue: Mutation[] = [];
  private isProcessing = false;
  private inFlightMutationId: string | null = null;
  private generation = 0;
  private persistChain: Promise<void> = Promise.resolve();
  private status: SyncStatus = 'synced';
  private statusListeners: SyncStatusListener[] = [];

  /** Persistent store-level callbacks that survive cold app restarts (`loadFromStorage`). */
  public onTaskCreated?: (tempId: number, remoteTask: Task) => void;
  public onTaskLabelsSynced?: (taskId: number, labels: Label[]) => void;
  public onTaskAssigneesSynced?: (taskId: number, assignees: User[]) => void;

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

  public pauseForAuth(): void {
    this.setStatus('auth_required');
  }

  private notifyListeners(): void {
    const count = this.queue.length;
    this.statusListeners.forEach((l) => l(this.status, count));
  }

  /**
   * Serializes AsyncStorage writes in strict FIFO order so overlapping persists
   * never overwrite newer state with older snapshots.
   */
  private persistQueue(): Promise<void> {
    const snapshot = this.queue.map(({ id, type, payload, timestamp, retryCount }) => ({
      id,
      type,
      payload,
      timestamp,
      retryCount,
    }));

    this.persistChain = this.persistChain
      .catch(() => {})
      .then(async () => {
        try {
          if (snapshot.length === 0) {
            await AsyncStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
          } else {
            await AsyncStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(snapshot));
          }
        } catch (_) {
          // Storage errors must not break in-memory queue operation
        }
      });

    return this.persistChain;
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

  private removeById(mutationId: string): void {
    this.queue = this.queue.filter((m) => m.id !== mutationId);
  }

  public removePendingForTasks(taskIds: number[]): void {
    if (!taskIds.length) return;
    const idSet = new Set(taskIds);
    const before = this.queue.length;
    this.queue = this.queue.filter(
      (m) =>
        m.id === this.inFlightMutationId ||
        !Array.from(idSet).some((tid) => matchesTaskId(m, tid))
    );
    if (this.queue.length !== before) {
      if (this.queue.length === 0 && !this.isProcessing) {
        this.setStatus('synced');
      } else {
        this.notifyListeners();
      }
      this.persistQueue();
    }
  }

  public enqueue(mutation: Mutation): void {
    // If deleting an unsynced local task (`tempId < 0`), cancel its pending CREATE_TASK
    // and any dependent mutations instead of sending `DELETE /tasks/-tempId` to the server.
    if (mutation.type === 'DELETE_TASK') {
      const targetId = mutation.payload?.taskId;
      if (typeof targetId === 'number' && targetId < 0) {
        const inFlightCreate = this.queue.find(
          (m) =>
            m.id === this.inFlightMutationId &&
            m.type === 'CREATE_TASK' &&
            matchesTaskId(m, targetId)
        );

        if (!inFlightCreate) {
          // Remove pending CREATE_TASK and all queued mutations for this negative tempId
          this.queue = this.queue.filter(
            (m) => m.id === this.inFlightMutationId || !matchesTaskId(m, targetId)
          );
          this.setStatus(this.queue.length === 0 ? 'synced' : this.status);
          this.persistQueue();
          return;
        }
        // If CREATE_TASK is currently in-flight, drop non-in-flight mutations for tempId
        // and append DELETE_TASK so remapTaskIdInQueue will remap it to the server ID and delete it.
        this.queue = this.queue.filter(
          (m) => m.id === this.inFlightMutationId || !matchesTaskId(m, targetId)
        );
      }
    }

    if (mutation.type === 'REORDER_TASK') {
      const taskId = mutation.payload?.taskId;
      // NEVER overwrite an in-flight queue item!
      const existingIdx = this.queue.findIndex(
        (m) =>
          m.id !== this.inFlightMutationId &&
          m.type === 'REORDER_TASK' &&
          m.payload?.taskId === taskId
      );
      if (existingIdx !== -1) {
        this.queue[existingIdx] = {
          ...this.queue[existingIdx],
          payload: {
            ...this.queue[existingIdx].payload,
            position: mutation.payload.position,
            projectViewId:
              mutation.payload.projectViewId || this.queue[existingIdx].payload.projectViewId,
            data: mutation.payload.data || this.queue[existingIdx].payload.data,
          },
          timestamp: mutation.timestamp,
        };
        if (this.status !== 'auth_required') {
          this.setStatus('syncing');
        } else {
          this.notifyListeners();
        }
        this.persistQueue();
        return;
      }
    }

    this.queue.push({
      ...mutation,
      retryCount: mutation.retryCount ?? 0,
    });
    if (this.status !== 'auth_required') {
      this.setStatus('syncing');
    } else {
      this.notifyListeners();
    }
    this.persistQueue();
  }

  public hasPendingForTask(taskId: number, mutationType?: MutationType): boolean {
    return this.queue.some((item) => {
      const matchType = mutationType ? item.type === mutationType : true;
      return matchType && matchesTaskId(item, taskId);
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
        if (q.payload.id === oldId) {
          q.payload.id = newId;
        }
        if (q.payload.data && q.payload.data.id === oldId) {
          q.payload.data.id = newId;
        }
        if (q.payload.taskData && q.payload.taskData.id === oldId) {
          q.payload.taskData.id = newId;
        }
        if (q.payload.tempId === oldId) {
          q.payload.tempId = newId;
        }
      }
    }
    this.persistQueue();
  }

  public async processQueue(): Promise<void> {
    const initialStatus: SyncStatus = this.status;
    if (this.isProcessing || initialStatus === 'auth_required' || this.queue.length === 0) {
      if (this.queue.length === 0 && initialStatus !== 'synced' && initialStatus !== 'auth_required') {
        this.setStatus('synced');
      }
      return;
    }

    const startGen = this.generation;
    this.isProcessing = true;
    this.setStatus('syncing');

    try {
      while (this.queue.length > 0 && this.generation === startGen) {
        const item = this.queue[0];
        this.inFlightMutationId = item.id;

        try {
          let result: any = null;
          let resolvedCreateTempId: number | undefined;
          const followUpMutations: Mutation[] = [];

          switch (item.type) {
            case 'CREATE_TASK': {
              const { projectId, taskData } = item.payload;
              const tempId: number | undefined = item.payload.tempId ?? taskData?.id;
              resolvedCreateTempId = tempId;
              const labels: Label[] | undefined = item.payload.labels ?? taskData?.labels;
              const assignees: User[] | undefined = item.payload.assignees ?? taskData?.assignees;

              const sanitizedCreateData = sanitizeTaskSnapshot(taskData);
              result = await this.client.createTask(projectId, sanitizedCreateData);

              if (this.generation !== startGen) return;

              // Remap temporary negative ID across subsequent queued mutations immediately
              if (result && result.id > 0 && typeof tempId === 'number' && tempId < 0) {
                this.remapTaskIdInQueue(tempId, result.id);
              }

              // Sync labels attached at creation; if this sub-step fails transiently,
              // propagate into a retryable SET_TASK_LABELS mutation so labels are never lost
              // and CREATE_TASK is never re-run (which would duplicate the task).
              if (labels && labels.length > 0 && result && result.id > 0) {
                if (typeof this.client.setTaskLabels === 'function') {
                  try {
                    const attachedLabels = await this.client.setTaskLabels(result.id, labels);
                    result.labels = attachedLabels;
                    this.onTaskLabelsSynced?.(result.id, attachedLabels);
                  } catch (labelErr: any) {
                    result.labels = labels;
                    const errStatus = labelErr?.status || labelErr?.response?.status;
                    if (!isPermanent4xxError(errStatus)) {
                      followUpMutations.push({
                        id: `create-labels-${result.id}-${Date.now()}`,
                        type: 'SET_TASK_LABELS',
                        payload: { taskId: result.id, labels, previousLabels: [] },
                        timestamp: Date.now(),
                      });
                    }
                  }
                } else {
                  result.labels = labels;
                }
              }

              // Sync assignees attached at creation; propagate transient failures into SET_TASK_ASSIGNEES
              if (assignees && assignees.length > 0 && result && result.id > 0) {
                if (typeof this.client.setTaskAssignees === 'function') {
                  try {
                    const attachedAssignees = await this.client.setTaskAssignees(
                      result.id,
                      assignees
                    );
                    result.assignees = attachedAssignees;
                    this.onTaskAssigneesSynced?.(result.id, attachedAssignees);
                  } catch (assigneeErr: any) {
                    result.assignees = assignees;
                    const errStatus = assigneeErr?.status || assigneeErr?.response?.status;
                    if (!isPermanent4xxError(errStatus)) {
                      followUpMutations.push({
                        id: `create-assignees-${result.id}-${Date.now()}`,
                        type: 'SET_TASK_ASSIGNEES',
                        payload: { taskId: result.id, assignees, previousAssignees: [] },
                        timestamp: Date.now(),
                      });
                    }
                  }
                } else {
                  result.assignees = assignees;
                }
              }
              break;
            }
            case 'UPDATE_TASK': {
              const { taskId, data } = item.payload;
              result = await this.client.updateTask(taskId, sanitizeTaskSnapshot(data));
              break;
            }
            case 'TOGGLE_TASK': {
              const { taskId, done, data } = item.payload;
              if (data) {
                result = await this.client.updateTask(
                  taskId,
                  sanitizeTaskSnapshot({ ...data, done })
                );
              } else {
                result = await this.client.toggleTaskDone(taskId, done);
              }
              break;
            }
            case 'MOVE_TASK': {
              const { taskId, targetProjectId, data } = item.payload;
              if (data) {
                result = await this.client.updateTask(
                  taskId,
                  sanitizeTaskSnapshot({ ...data, project_id: targetProjectId })
                );
              } else {
                result = await this.client.moveTask(taskId, targetProjectId);
              }
              break;
            }
            case 'REORDER_TASK': {
              const { taskId, position, projectViewId, data } = item.payload;
              if (data !== undefined) {
                result = await this.client.reorderTask(
                  taskId,
                  position,
                  projectViewId,
                  sanitizeTaskSnapshot(data)
                );
              } else {
                result = await this.client.reorderTask(taskId, position, projectViewId);
              }
              break;
            }
            case 'SET_TASK_LABELS': {
              const { taskId, labels, previousLabels } = item.payload;
              const syncedLabels =
                previousLabels !== undefined
                  ? await this.client.setTaskLabels(taskId, labels, previousLabels)
                  : await this.client.setTaskLabels(taskId, labels);
              result = { taskId, labels: syncedLabels };
              if (this.generation === startGen) {
                this.onTaskLabelsSynced?.(taskId, syncedLabels);
              }
              break;
            }
            case 'SET_TASK_ASSIGNEES': {
              const { taskId, assignees, previousAssignees } = item.payload;
              const syncedAssignees =
                previousAssignees !== undefined
                  ? await this.client.setTaskAssignees(taskId, assignees, previousAssignees)
                  : await this.client.setTaskAssignees(taskId, assignees);
              result = { taskId, assignees: syncedAssignees };
              if (this.generation === startGen) {
                this.onTaskAssigneesSynced?.(taskId, syncedAssignees);
              }
              break;
            }
            case 'DELETE_TASK': {
              const { taskId } = item.payload;
              if (typeof taskId === 'number' && taskId < 0) {
                // Never send DELETE /tasks/-tempId to the server
                result = { message: 'Removed unsynced local task' };
              } else {
                result = await this.client.deleteTask(taskId);
              }
              break;
            }
          }

          if (this.generation !== startGen) return;

          // Remove completed item by ID (never blind shift) and insert any follow-up retry items at head
          this.inFlightMutationId = null;
          this.removeById(item.id);
          if (followUpMutations.length > 0) {
            this.queue.unshift(...followUpMutations);
          }
          await this.persistQueue();

          if (
            item.type === 'CREATE_TASK' &&
            this.onTaskCreated &&
            typeof resolvedCreateTempId === 'number' &&
            result
          ) {
            try {
              this.onTaskCreated(resolvedCreateTempId, result);
            } catch (_) {}
          }

          if (item.onSuccess) {
            try {
              item.onSuccess(result);
            } catch (_) {
              // Callback failure must not re-trigger network mutation
            }
          }

          // If follow-up label/assignee mutations were queued due to transient failure, pause after persisting
          if (followUpMutations.length > 0) {
            this.setStatus('offline');
            break;
          }
        } catch (err: any) {
          this.inFlightMutationId = null;
          if (this.generation !== startGen) return;

          if (err?.name === 'AbortError') {
            this.setStatus('offline');
            break;
          }

          const status = err?.status || err?.response?.status;

          if (isPermanent4xxError(status)) {
            // Drop genuine permanent 4xx errors (e.g. 400/404/422) by ID, never 401/403/408/429
            this.removeById(item.id);
            await this.persistQueue();
            if (item.onError) {
              try {
                item.onError(err);
              } catch (_) {}
            }
            continue;
          }

          // Preserve queue on network, timeout (408), rate-limit (429), auth (401/403), or 5xx errors
          item.retryCount = (item.retryCount || 0) + 1;
          await this.persistQueue();
          this.setStatus(status === 401 ? 'auth_required' : 'offline');
          if (item.onError) {
            try {
              item.onError(err);
            } catch (_) {}
          }
          break;
        }
      }
    } finally {
      this.inFlightMutationId = null;
      this.isProcessing = false;
      if (this.generation === startGen) {
        if (this.queue.length === 0 && this.status !== 'auth_required') {
          this.setStatus('synced');
        }
        await this.persistQueue();
      }
    }
  }

  public async clear(): Promise<void> {
    this.generation += 1;
    this.inFlightMutationId = null;
    this.queue = [];
    this.setStatus('synced');
    await this.persistQueue();
  }
}
