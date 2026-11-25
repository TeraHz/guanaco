import AsyncStorage from '@react-native-async-storage/async-storage';
import { VikunjaClient } from '../api/client';
import { Label, Task, UpdateTaskInput, User } from '../types/vikunja';

export const SYNC_QUEUE_STORAGE_KEY = '@vikunja_sync_queue';
export const MAX_SERVER_ERROR_RETRIES = 5;
export const SERVER_ERROR_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

export type MutationType =
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'TOGGLE_TASK'
  | 'MOVE_TASK'
  | 'REORDER_TASK'
  | 'DELETE_TASK'
  | 'SET_TASK_LABELS'
  | 'SET_TASK_ASSIGNEES'
  | 'CREATE_TASK_RELATION'
  | 'DELETE_TASK_RELATION';

export interface Mutation {
  id: string;
  type: MutationType;
  payload: any;
  timestamp: number;
  retryCount?: number;
  serverErrorCount?: number;
  nextRetryAt?: number;
  onSuccess?: (result: any) => void;
  onError?: (err: any) => void;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'auth_required';

export type SyncStatusListener = (status: SyncStatus, pendingCount: number) => void;

const RETRYABLE_CLIENT_STATUSES = new Set([401, 408, 429]);

function isProxyForbiddenError(err: any): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err.isProxyError === true) return true;
  if ('data' in err && err.data === null) return true;
  return false;
}

function isPermanent4xxError(errOrStatus: any): boolean {
  const status =
    typeof errOrStatus === 'number'
      ? errOrStatus
      : errOrStatus?.status ?? errOrStatus?.response?.status;
  if (typeof status !== 'number' || status < 400 || status >= 500) {
    return false;
  }
  if (RETRYABLE_CLIENT_STATUSES.has(status)) {
    return false;
  }
  if (status === 403 && isProxyForbiddenError(errOrStatus)) {
    return false;
  }
  return true;
}

function isDeterministicServerError(status: unknown): boolean {
  return (
    typeof status === 'number' &&
    status >= 500 &&
    status !== 502 &&
    status !== 503 &&
    status !== 504
  );
}

/**
 * Counts logical unsynced user changes in `queue`:
 * - Deduplicates task mutations by task ID
 * - Folds `CREATE_TASK_RELATION` when `otherTaskId` is already a pending task
 * - Counts `REORDER_TASK` per view as 1 change
 */
export function countDistinctPendingChanges(queue: Mutation[]): number {
  if (!Array.isArray(queue) || queue.length === 0) return 0;

  const pendingTaskIds = new Set<number>();
  const reorderViews = new Set<string>();
  const standaloneRelations = new Set<string>();

  for (const m of queue) {
    if (!m || !m.payload) continue;
    switch (m.type) {
      case 'CREATE_TASK': {
        const tid = m.payload.tempId ?? m.payload.taskData?.id;
        if (typeof tid === 'number') pendingTaskIds.add(tid);
        break;
      }
      case 'UPDATE_TASK':
      case 'TOGGLE_TASK':
      case 'MOVE_TASK':
      case 'DELETE_TASK':
      case 'SET_TASK_LABELS':
      case 'SET_TASK_ASSIGNEES': {
        const tid = m.payload.taskId ?? m.payload.id ?? m.payload.data?.id;
        if (typeof tid === 'number') pendingTaskIds.add(tid);
        break;
      }
      default:
        break;
    }
  }

  for (const m of queue) {
    if (!m || !m.payload) continue;
    if (m.type === 'REORDER_TASK') {
      const viewScope = String(
        m.payload.projectViewId ?? m.payload.data?.project_id ?? 'default'
      );
      reorderViews.add(viewScope);
    } else if (m.type === 'CREATE_TASK_RELATION') {
      const otherId = m.payload.otherTaskId;
      if (typeof otherId === 'number' && pendingTaskIds.has(otherId)) {
        continue;
      }
      standaloneRelations.add(
        `create:${m.payload.taskId}:${otherId}:${m.payload.relationKind || 'subtask'}`
      );
    } else if (m.type === 'DELETE_TASK_RELATION') {
      const otherId = m.payload.otherTaskId;
      if (typeof otherId === 'number' && pendingTaskIds.has(otherId)) {
        continue;
      }
      standaloneRelations.add(
        `delete:${m.payload.taskId}:${otherId}:${m.payload.relationKind || 'subtask'}`
      );
    }
  }

  return pendingTaskIds.size + reorderViews.size + standaloneRelations.size;
}

/**
 * Strips negative temporary IDs from task snapshots before sending to Vikunja's REST API.
 */
function sanitizeTaskSnapshot<T extends Record<string, any> | undefined>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const clean: Record<string, any> = { ...snapshot };
  delete clean.related_tasks;
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
    p.otherTaskId === taskId ||
    p.id === taskId ||
    p.tempId === taskId ||
    p.data?.id === taskId ||
    p.taskData?.id === taskId
  );
}

function isValidRemoteTask(task: any): task is Task {
  return Boolean(
    task &&
      typeof task === 'object' &&
      typeof task.id === 'number' &&
      typeof task.title === 'string' &&
      task.title.length > 0
  );
}

function preserveTaskSlices(
  updated: any,
  sliceSource: Partial<Task> | undefined,
  patch?: UpdateTaskInput
): any {
  if (!updated || typeof updated !== 'object' || !sliceSource || typeof sliceSource !== 'object') {
    return updated;
  }
  const result = { ...updated };
  if (
    (result.labels === null || result.labels === undefined) &&
    patch?.labels === undefined &&
    Array.isArray(sliceSource.labels)
  ) {
    result.labels = sliceSource.labels;
  }
  if (
    (result.assignees === null || result.assignees === undefined) &&
    patch?.assignees === undefined &&
    Array.isArray(sliceSource.assignees)
  ) {
    result.assignees = sliceSource.assignees;
  }
  if (
    (result.reminders === null || result.reminders === undefined) &&
    patch?.reminders === undefined &&
    Array.isArray(sliceSource.reminders)
  ) {
    result.reminders = sliceSource.reminders;
  }
  if (
    (result.related_tasks === null || result.related_tasks === undefined) &&
    sliceSource.related_tasks &&
    typeof sliceSource.related_tasks === 'object'
  ) {
    result.related_tasks = sliceSource.related_tasks;
  }
  return result;
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
  public onTaskUpdated?: (taskId: number, remoteTask: Task) => void;
  public onTaskLabelsSynced?: (taskId: number, labels: Label[]) => void;
  public onTaskAssigneesSynced?: (taskId: number, assignees: User[]) => void;
  public onTaskRelationSynced?: (taskId: number, otherTaskId: number, relationKind: string) => void;
  public onMutationFailed?: (
    mutation: Mutation,
    error: any,
    droppedDependents: Mutation[]
  ) => void;

  constructor(private client: VikunjaClient) {}

  public getStatus(): SyncStatus {
    return this.status;
  }

  public getPendingCount(): number {
    return countDistinctPendingChanges(this.queue);
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
    const count = this.getPendingCount();
    this.statusListeners.forEach((l) => l(this.status, count));
  }

  /**
   * Serializes AsyncStorage writes in strict FIFO order so overlapping persists
   * never overwrite newer state with older snapshots.
   */
  private persistQueue(): Promise<void> {
    const snapshot = this.queue.map(
      ({ id, type, payload, timestamp, retryCount, serverErrorCount }) => ({
        id,
        type,
        payload,
        timestamp,
        retryCount,
        ...(serverErrorCount !== undefined ? { serverErrorCount } : {}),
      })
    );

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

  private dropDependentTempTaskMutations(tempId: number): Mutation[] {
    if (typeof tempId !== 'number' || tempId >= 0) return [];
    const dropped: Mutation[] = [];
    this.queue = this.queue.filter((m) => {
      if (m.id === this.inFlightMutationId) return true;
      if (matchesTaskId(m, tempId)) {
        dropped.push(m);
        return false;
      }
      return true;
    });
    return dropped;
  }

  /**
   * Returns the accumulated dirty scalar/reminder patch across pending mutations for `taskId`,
   * or `null` when no patch-based mutations exist (or a legacy full-snapshot `UPDATE_TASK` lacks `patch`).
   */
  public getPendingPatchForTask(taskId: number): Partial<Task> | null {
    let accumulated: Partial<Task> | null = null;
    for (const m of this.queue) {
      if (!m || !m.payload) continue;
      if (m.type === 'UPDATE_TASK' && m.payload.taskId === taskId) {
        if (m.payload.patch && typeof m.payload.patch === 'object') {
          accumulated = { ...(accumulated || {}), ...m.payload.patch };
        } else {
          return null;
        }
      } else if (m.type === 'TOGGLE_TASK' && m.payload.taskId === taskId) {
        const togglePatch: Partial<Task> =
          m.payload.patch && typeof m.payload.patch === 'object'
            ? { ...m.payload.patch, done: m.payload.done }
            : {
                done: m.payload.done,
                ...(m.payload.data?.done_at !== undefined
                  ? { done_at: m.payload.data.done_at }
                  : {}),
              };
        accumulated = { ...(accumulated || {}), ...togglePatch };
      } else if (m.type === 'MOVE_TASK' && m.payload.taskId === taskId) {
        const movePatch: Partial<Task> =
          m.payload.patch && typeof m.payload.patch === 'object'
            ? { ...m.payload.patch, project_id: m.payload.targetProjectId }
            : { project_id: m.payload.targetProjectId };
        accumulated = { ...(accumulated || {}), ...movePatch };
      }
    }
    return accumulated;
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
      } else if (typeof targetId === 'number' && targetId > 0) {
        // Prune prior non-in-flight pending mutations for positive server taskId before DELETE_TASK
        this.queue = this.queue.filter(
          (m) => m.id === this.inFlightMutationId || !matchesTaskId(m, targetId)
        );
      }
    }

    const stripKeysFromPendingUpdatePatches = (
      targetTaskId: number,
      keysToStrip: (keyof UpdateTaskInput)[]
    ): void => {
      const nextQueue: Mutation[] = [];
      for (const m of this.queue) {
        if (
          m.id !== this.inFlightMutationId &&
          m.type === 'UPDATE_TASK' &&
          m.payload?.taskId === targetTaskId &&
          m.payload.patch &&
          typeof m.payload.patch === 'object'
        ) {
          const nextPatch: Record<string, any> = { ...m.payload.patch };
          let strippedAny = false;
          for (const k of keysToStrip) {
            if (k in nextPatch) {
              delete nextPatch[k as string];
              strippedAny = true;
            }
          }
          if (strippedAny) {
            if (Object.keys(nextPatch).length === 0) {
              continue;
            }
            nextQueue.push({
              ...m,
              payload: { ...m.payload, patch: nextPatch },
            });
            continue;
          }
        }
        nextQueue.push(m);
      }
      this.queue = nextQueue;
    };

    const coalesceTaskId = mutation.payload?.taskId;
    if (typeof coalesceTaskId === 'number' && coalesceTaskId > 0) {
      if (mutation.type === 'UPDATE_TASK') {
        const incomingPatch: UpdateTaskInput | undefined = mutation.payload?.patch;
        const incomingData: Record<string, any> | undefined = mutation.payload?.data;
        const supersedesDone = incomingPatch
          ? incomingPatch.done !== undefined
          : incomingData?.done !== undefined;
        const supersedesProject = incomingPatch
          ? incomingPatch.project_id !== undefined
          : incomingData?.project_id !== undefined;
        const supersedesPosition = incomingPatch
          ? incomingPatch.position !== undefined
          : incomingData?.position !== undefined;

        if (supersedesDone || supersedesProject || supersedesPosition) {
          this.queue = this.queue.filter((m) => {
            if (m.id === this.inFlightMutationId || m.payload?.taskId !== coalesceTaskId) {
              return true;
            }
            if (supersedesDone && m.type === 'TOGGLE_TASK') return false;
            if (supersedesProject && m.type === 'MOVE_TASK') return false;
            if (supersedesPosition && m.type === 'REORDER_TASK') return false;
            return true;
          });
        }

        const existingIdx = this.queue.findIndex(
          (m) =>
            m.id !== this.inFlightMutationId &&
            m.type === 'UPDATE_TASK' &&
            m.payload?.taskId === coalesceTaskId
        );
        if (existingIdx !== -1) {
          const prev = this.queue[existingIdx];
          const prevPatch: UpdateTaskInput | undefined = prev.payload?.patch;
          const nextPatch: UpdateTaskInput | undefined = mutation.payload?.patch;
          const mergedPatch =
            prevPatch && nextPatch
              ? { ...prevPatch, ...nextPatch }
              : nextPatch && !prev.payload?.data
              ? { ...nextPatch }
              : undefined;
          const mergedData =
            prev.payload?.data || mutation.payload?.data
              ? {
                  ...(prev.payload?.data || {}),
                  ...(mutation.payload?.data || {}),
                  ...(mergedPatch || {}),
                }
              : undefined;
          const coalesced: Mutation = {
            ...prev,
            payload: {
              ...prev.payload,
              ...mutation.payload,
              taskId: coalesceTaskId,
              ...(mergedPatch !== undefined ? { patch: mergedPatch } : { patch: undefined }),
              ...(mergedData !== undefined ? { data: mergedData } : {}),
            },
            timestamp: mutation.timestamp,
            onSuccess: mutation.onSuccess ?? prev.onSuccess,
            onError: mutation.onError ?? prev.onError,
          };
          this.queue.splice(existingIdx, 1);
          this.queue.push(coalesced);
          if (this.status !== 'auth_required') {
            this.setStatus('syncing');
          } else {
            this.notifyListeners();
          }
          this.persistQueue();
          return;
        }
      } else if (mutation.type === 'TOGGLE_TASK') {
        stripKeysFromPendingUpdatePatches(coalesceTaskId, ['done', 'done_at']);
        const existingIdx = this.queue.findIndex(
          (m) =>
            m.id !== this.inFlightMutationId &&
            m.type === 'TOGGLE_TASK' &&
            m.payload?.taskId === coalesceTaskId
        );
        if (existingIdx !== -1) {
          const prev = this.queue[existingIdx];
          const mergedPatch =
            prev.payload?.patch || mutation.payload?.patch
              ? {
                  ...(prev.payload?.patch || {}),
                  ...(mutation.payload?.patch || {}),
                  done: mutation.payload.done,
                }
              : undefined;
          const mergedData =
            prev.payload?.data || mutation.payload?.data
              ? {
                  ...(prev.payload?.data || {}),
                  ...(mutation.payload?.data || {}),
                  done: mutation.payload.done,
                }
              : undefined;
          const coalesced: Mutation = {
            ...prev,
            payload: {
              ...prev.payload,
              ...mutation.payload,
              taskId: coalesceTaskId,
              done: mutation.payload.done,
              ...(mergedPatch !== undefined ? { patch: mergedPatch } : {}),
              ...(mergedData !== undefined ? { data: mergedData } : {}),
            },
            timestamp: mutation.timestamp,
            onSuccess: mutation.onSuccess ?? prev.onSuccess,
            onError: mutation.onError ?? prev.onError,
          };
          this.queue.splice(existingIdx, 1);
          this.queue.push(coalesced);
          if (this.status !== 'auth_required') {
            this.setStatus('syncing');
          } else {
            this.notifyListeners();
          }
          this.persistQueue();
          return;
        }
      } else if (mutation.type === 'MOVE_TASK') {
        stripKeysFromPendingUpdatePatches(coalesceTaskId, ['project_id']);
        const existingIdx = this.queue.findIndex(
          (m) =>
            m.id !== this.inFlightMutationId &&
            m.type === 'MOVE_TASK' &&
            m.payload?.taskId === coalesceTaskId
        );
        if (existingIdx !== -1) {
          const prev = this.queue[existingIdx];
          const mergedPatch =
            prev.payload?.patch || mutation.payload?.patch
              ? {
                  ...(prev.payload?.patch || {}),
                  ...(mutation.payload?.patch || {}),
                  project_id: mutation.payload.targetProjectId,
                }
              : undefined;
          const mergedData =
            prev.payload?.data || mutation.payload?.data
              ? {
                  ...(prev.payload?.data || {}),
                  ...(mutation.payload?.data || {}),
                  project_id: mutation.payload.targetProjectId,
                }
              : undefined;
          const coalesced: Mutation = {
            ...prev,
            payload: {
              ...prev.payload,
              ...mutation.payload,
              taskId: coalesceTaskId,
              targetProjectId: mutation.payload.targetProjectId,
              ...(mergedPatch !== undefined ? { patch: mergedPatch } : {}),
              ...(mergedData !== undefined ? { data: mergedData } : {}),
            },
            timestamp: mutation.timestamp,
            onSuccess: mutation.onSuccess ?? prev.onSuccess,
            onError: mutation.onError ?? prev.onError,
          };
          this.queue.splice(existingIdx, 1);
          this.queue.push(coalesced);
          if (this.status !== 'auth_required') {
            this.setStatus('syncing');
          } else {
            this.notifyListeners();
          }
          this.persistQueue();
          return;
        }
      } else if (mutation.type === 'SET_TASK_LABELS') {
        const existingIdx = this.queue.findIndex(
          (m) =>
            m.id !== this.inFlightMutationId &&
            m.type === 'SET_TASK_LABELS' &&
            m.payload?.taskId === coalesceTaskId
        );
        if (existingIdx !== -1) {
          const prev = this.queue[existingIdx];
          const coalesced: Mutation = {
            ...prev,
            payload: {
              ...prev.payload,
              taskId: coalesceTaskId,
              labels: mutation.payload.labels,
              ...(prev.payload.previousLabels !== undefined
                ? { previousLabels: prev.payload.previousLabels }
                : mutation.payload.previousLabels !== undefined
                ? { previousLabels: mutation.payload.previousLabels }
                : {}),
            },
            timestamp: mutation.timestamp,
            onSuccess: mutation.onSuccess ?? prev.onSuccess,
            onError: mutation.onError ?? prev.onError,
          };
          this.queue.splice(existingIdx, 1);
          this.queue.push(coalesced);
          if (this.status !== 'auth_required') {
            this.setStatus('syncing');
          } else {
            this.notifyListeners();
          }
          this.persistQueue();
          return;
        }
      } else if (mutation.type === 'SET_TASK_ASSIGNEES') {
        const existingIdx = this.queue.findIndex(
          (m) =>
            m.id !== this.inFlightMutationId &&
            m.type === 'SET_TASK_ASSIGNEES' &&
            m.payload?.taskId === coalesceTaskId
        );
        if (existingIdx !== -1) {
          const prev = this.queue[existingIdx];
          const coalesced: Mutation = {
            ...prev,
            payload: {
              ...prev.payload,
              taskId: coalesceTaskId,
              assignees: mutation.payload.assignees,
              ...(prev.payload.previousAssignees !== undefined
                ? { previousAssignees: prev.payload.previousAssignees }
                : mutation.payload.previousAssignees !== undefined
                ? { previousAssignees: mutation.payload.previousAssignees }
                : {}),
            },
            timestamp: mutation.timestamp,
            onSuccess: mutation.onSuccess ?? prev.onSuccess,
            onError: mutation.onError ?? prev.onError,
          };
          this.queue.splice(existingIdx, 1);
          this.queue.push(coalesced);
          if (this.status !== 'auth_required') {
            this.setStatus('syncing');
          } else {
            this.notifyListeners();
          }
          this.persistQueue();
          return;
        }
      }
    }

    if (mutation.type === 'REORDER_TASK') {
      const taskId = mutation.payload?.taskId;
      if (typeof taskId === 'number' && taskId > 0) {
        stripKeysFromPendingUpdatePatches(taskId, ['position']);
      }
      // NEVER overwrite an in-flight queue item!
      const existingIdx = this.queue.findIndex(
        (m) =>
          m.id !== this.inFlightMutationId &&
          m.type === 'REORDER_TASK' &&
          m.payload?.taskId === taskId
      );
      if (existingIdx !== -1) {
        const prev = this.queue[existingIdx];
        const coalesced: Mutation = {
          ...prev,
          payload: {
            ...prev.payload,
            position: mutation.payload.position,
            projectViewId: mutation.payload.projectViewId || prev.payload.projectViewId,
            data: mutation.payload.data || prev.payload.data,
          },
          timestamp: mutation.timestamp,
        };
        this.queue.splice(existingIdx, 1);
        this.queue.push(coalesced);
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
      ...(mutation.serverErrorCount !== undefined
        ? { serverErrorCount: mutation.serverErrorCount }
        : {}),
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
      await this.processQueue({ force: true });
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
        if (q.payload.otherTaskId === oldId) {
          q.payload.otherTaskId = newId;
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

  public async processQueue(options?: { force?: boolean }): Promise<void> {
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
        if (
          !options?.force &&
          typeof item.nextRetryAt === 'number' &&
          Date.now() < item.nextRetryAt
        ) {
          this.setStatus('offline');
          break;
        }
        this.inFlightMutationId = item.id;

        try {
          let result: any = null;
          let resolvedCreateTempId: number | undefined;
          let rejectedCreateLabels = false;
          let rejectedCreateAssignees = false;
          const followUpMutations: Mutation[] = [];
          const deferredSubStepFailures: { subMutation: Mutation; err: any }[] = [];

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

              // Ensure done: true persists even on Vikunja versions where PUT /projects/:id/tasks defaults done=false
              if (
                sanitizedCreateData?.done &&
                result &&
                result.id > 0 &&
                !result.done &&
                typeof this.client.updateTask === 'function'
              ) {
                try {
                  const toggled = await this.client.updateTask(result.id, {
                    ...sanitizedCreateData,
                    id: result.id,
                    done: true,
                  });
                  if (toggled && typeof toggled.id === 'number') {
                    result = { ...result, ...toggled };
                  } else {
                    result = { ...result, done: true };
                  }
                } catch (doneErr: any) {
                  if (!isPermanent4xxError(doneErr)) {
                    result = {
                      ...result,
                      done: true,
                      done_at: sanitizedCreateData.done_at ?? result.done_at,
                    };
                    followUpMutations.push({
                      id: `create-done-${result.id}-${Date.now()}`,
                      type: 'TOGGLE_TASK',
                      payload: {
                        taskId: result.id,
                        done: true,
                        patch: {
                          done: true,
                          done_at: sanitizedCreateData.done_at ?? result.done_at ?? null,
                        },
                        data: { ...sanitizedCreateData, id: result.id, done: true },
                      },
                      timestamp: Date.now(),
                    });
                  } else {
                    deferredSubStepFailures.push({
                      subMutation: {
                        id: `create-done-${result.id}-${Date.now()}`,
                        type: 'TOGGLE_TASK',
                        payload: {
                          taskId: result.id,
                          done: true,
                          data: {
                            ...result,
                            title: result.title || sanitizedCreateData?.title,
                            project_id: result.project_id ?? projectId,
                          },
                        },
                        timestamp: Date.now(),
                      },
                      err: doneErr,
                    });
                  }
                }
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
                    if (!isPermanent4xxError(labelErr)) {
                      result.labels = labels;
                      followUpMutations.push({
                        id: `create-labels-${result.id}-${Date.now()}`,
                        type: 'SET_TASK_LABELS',
                        payload: { taskId: result.id, labels, previousLabels: [] },
                        timestamp: Date.now(),
                      });
                    } else {
                      rejectedCreateLabels = true;
                      result.labels = Array.isArray(result.labels)
                        ? result.labels.filter((l: any) => l && typeof l.id === 'number' && l.id > 0)
                        : [];
                      deferredSubStepFailures.push({
                        subMutation: {
                          id: `create-labels-${result.id}-${Date.now()}`,
                          type: 'SET_TASK_LABELS',
                          payload: {
                            taskId: result.id,
                            labels,
                            previousLabels: [],
                            data: {
                              ...result,
                              title: result.title || sanitizedCreateData?.title,
                              project_id: result.project_id ?? projectId,
                            },
                          },
                          timestamp: Date.now(),
                        },
                        err: labelErr,
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
                    if (!isPermanent4xxError(assigneeErr)) {
                      result.assignees = assignees;
                      followUpMutations.push({
                        id: `create-assignees-${result.id}-${Date.now()}`,
                        type: 'SET_TASK_ASSIGNEES',
                        payload: { taskId: result.id, assignees, previousAssignees: [] },
                        timestamp: Date.now(),
                      });
                    } else {
                      rejectedCreateAssignees = true;
                      result.assignees = Array.isArray(result.assignees)
                        ? result.assignees.filter(
                            (u: any) => u && typeof u.id === 'number' && u.id > 0
                          )
                        : [];
                      deferredSubStepFailures.push({
                        subMutation: {
                          id: `create-assignees-${result.id}-${Date.now()}`,
                          type: 'SET_TASK_ASSIGNEES',
                          payload: {
                            taskId: result.id,
                            assignees,
                            previousAssignees: [],
                            data: {
                              ...result,
                              title: result.title || sanitizedCreateData?.title,
                              project_id: result.project_id ?? projectId,
                            },
                          },
                          timestamp: Date.now(),
                        },
                        err: assigneeErr,
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
              const { taskId, patch, data } = item.payload;
              if (typeof taskId !== 'number' || taskId <= 0) {
                result = null;
                break;
              }
              if (patch && typeof this.client.getTask === 'function') {
                const remoteTask = await this.client.getTask(taskId);
                const validRemote = isValidRemoteTask(remoteTask) ? remoteTask : undefined;
                const sliceSource = validRemote || data;
                const base = sliceSource || {};
                const rawUpdated = await this.client.updateTask(
                  taskId,
                  sanitizeTaskSnapshot({ ...base, ...patch })
                );
                result = preserveTaskSlices(rawUpdated, sliceSource, patch);
              } else {
                const rawUpdated = await this.client.updateTask(
                  taskId,
                  sanitizeTaskSnapshot(data ?? patch ?? {})
                );
                result = preserveTaskSlices(rawUpdated, data, patch);
              }
              break;
            }
            case 'TOGGLE_TASK': {
              const { taskId, done, patch, data } = item.payload;
              if (typeof taskId !== 'number' || taskId <= 0) {
                result = null;
                break;
              }
              const effectivePatch: UpdateTaskInput = patch
                ? { ...patch, done }
                : {
                    done,
                    ...(data?.done_at !== undefined ? { done_at: data.done_at } : {}),
                  };
              if (typeof this.client.getTask === 'function') {
                const remoteTask = await this.client.getTask(taskId);
                const validRemote = isValidRemoteTask(remoteTask) ? remoteTask : undefined;
                const sliceSource = validRemote || data;
                if (sliceSource) {
                  const rawUpdated = await this.client.updateTask(
                    taskId,
                    sanitizeTaskSnapshot({ ...sliceSource, ...effectivePatch })
                  );
                  result = preserveTaskSlices(rawUpdated, sliceSource, effectivePatch);
                } else {
                  result = await this.client.toggleTaskDone(taskId, done);
                }
              } else if (data) {
                const rawUpdated = await this.client.updateTask(
                  taskId,
                  sanitizeTaskSnapshot({ ...data, ...effectivePatch })
                );
                result = preserveTaskSlices(rawUpdated, data, effectivePatch);
              } else {
                result = await this.client.toggleTaskDone(taskId, done);
              }
              break;
            }
            case 'MOVE_TASK': {
              const { taskId, targetProjectId, patch, data } = item.payload;
              if (typeof taskId !== 'number' || taskId <= 0) {
                result = null;
                break;
              }
              const effectivePatch: UpdateTaskInput = patch
                ? { ...patch, project_id: targetProjectId }
                : { project_id: targetProjectId };
              if (typeof this.client.getTask === 'function') {
                const remoteTask = await this.client.getTask(taskId);
                const validRemote = isValidRemoteTask(remoteTask) ? remoteTask : undefined;
                const sliceSource = validRemote || data;
                if (sliceSource) {
                  const rawUpdated = await this.client.updateTask(
                    taskId,
                    sanitizeTaskSnapshot({ ...sliceSource, ...effectivePatch })
                  );
                  result = preserveTaskSlices(rawUpdated, sliceSource, effectivePatch);
                } else {
                  result = await this.client.moveTask(taskId, targetProjectId);
                }
              } else if (data) {
                const rawUpdated = await this.client.updateTask(
                  taskId,
                  sanitizeTaskSnapshot({ ...data, ...effectivePatch })
                );
                result = preserveTaskSlices(rawUpdated, data, effectivePatch);
              } else {
                result = await this.client.moveTask(taskId, targetProjectId);
              }
              break;
            }
            case 'REORDER_TASK': {
              const { taskId, position, projectViewId, data } = item.payload;
              if (typeof taskId !== 'number' || taskId <= 0) {
                result = null;
                break;
              }
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
              if (typeof taskId !== 'number' || taskId <= 0) {
                result = null;
                break;
              }
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
              if (typeof taskId !== 'number' || taskId <= 0) {
                result = null;
                break;
              }
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
              if (typeof taskId !== 'number' || taskId <= 0) {
                // Never send DELETE /tasks/-tempId to the server
                result = { message: 'Removed unsynced local task' };
              } else {
                try {
                  result = await this.client.deleteTask(taskId);
                } catch (delErr: any) {
                  const delStatus = delErr?.status ?? delErr?.response?.status;
                  if (delStatus === 404) {
                    result = { message: 'Task already deleted' };
                  } else {
                    throw delErr;
                  }
                }
              }
              break;
            }
            case 'CREATE_TASK_RELATION': {
              const { taskId, otherTaskId, relationKind = 'subtask' } = item.payload;
              if (
                typeof taskId === 'number' &&
                taskId > 0 &&
                typeof otherTaskId === 'number' &&
                otherTaskId > 0
              ) {
                try {
                  result = await this.client.createTaskRelation(taskId, otherTaskId, relationKind);
                } catch (relErr: any) {
                  if (relErr?.status === 409) {
                    result = {
                      task_id: taskId,
                      other_task_id: otherTaskId,
                      relation_kind: relationKind,
                    };
                  } else {
                    throw relErr;
                  }
                }
                if (this.generation === startGen) {
                  this.onTaskRelationSynced?.(taskId, otherTaskId, relationKind);
                }
              }
              break;
            }
            case 'DELETE_TASK_RELATION': {
              const { taskId, otherTaskId, relationKind = 'subtask' } = item.payload;
              if (
                typeof taskId === 'number' &&
                taskId > 0 &&
                typeof otherTaskId === 'number' &&
                otherTaskId > 0
              ) {
                try {
                  result = await this.client.deleteTaskRelation(taskId, relationKind, otherTaskId);
                } catch (relErr: any) {
                  if (relErr?.status === 404) {
                    result = { message: 'Relation already removed' };
                  } else {
                    throw relErr;
                  }
                }
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

          if (item.type === 'CREATE_TASK' && result && result.id > 0) {
            if (rejectedCreateLabels) {
              try {
                this.onTaskLabelsSynced?.(result.id, result.labels || []);
              } catch (_) {}
            }
            if (rejectedCreateAssignees) {
              try {
                this.onTaskAssigneesSynced?.(result.id, result.assignees || []);
              } catch (_) {}
            }
            if (deferredSubStepFailures.length > 0 && this.onMutationFailed) {
              for (const { subMutation, err } of deferredSubStepFailures) {
                try {
                  this.onMutationFailed(subMutation, err, []);
                } catch (_) {}
              }
            }
          }

          if (
            (item.type === 'TOGGLE_TASK' ||
              item.type === 'UPDATE_TASK' ||
              item.type === 'MOVE_TASK') &&
            this.onTaskUpdated &&
            typeof item.payload?.taskId === 'number' &&
            item.payload.taskId > 0 &&
            result &&
            typeof result.id === 'number' &&
            !this.hasPendingForTask(item.payload.taskId)
          ) {
            try {
              this.onTaskUpdated(item.payload.taskId, result);
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

          const isDeterministic5xx = isDeterministicServerError(status);
          const nextServerErrorCount = isDeterministic5xx
            ? (item.serverErrorCount || 0) + 1
            : item.serverErrorCount;

          if (
            isPermanent4xxError(err) ||
            (isDeterministic5xx && (nextServerErrorCount ?? 0) >= MAX_SERVER_ERROR_RETRIES)
          ) {
            if (isDeterministic5xx) {
              item.serverErrorCount = nextServerErrorCount;
              item.retryCount = (item.retryCount || 0) + 1;
            }
            this.removeById(item.id);
            const failedTempId =
              item.type === 'CREATE_TASK'
                ? item.payload?.tempId ?? item.payload?.taskData?.id
                : undefined;
            const droppedDependents =
              typeof failedTempId === 'number' && failedTempId < 0
                ? this.dropDependentTempTaskMutations(failedTempId)
                : [];
            await this.persistQueue();
            this.notifyListeners();
            if (this.onMutationFailed) {
              try {
                this.onMutationFailed(item, err, droppedDependents);
              } catch (_) {}
            }
            if (item.onError) {
              try {
                item.onError(err);
              } catch (_) {}
            }
            continue;
          }

          // Preserve queue on network, timeout (408), rate-limit (429), auth (401), proxy 403, gateway (502/503/504), or < MAX_SERVER_ERROR_RETRIES 5xx
          item.retryCount = (item.retryCount || 0) + 1;
          if (isDeterministic5xx) {
            item.serverErrorCount = nextServerErrorCount;
            const backoffIdx = Math.min(
              Math.max(0, (nextServerErrorCount ?? 1) - 1),
              SERVER_ERROR_BACKOFF_MS.length - 1
            );
            item.nextRetryAt = Date.now() + SERVER_ERROR_BACKOFF_MS[backoffIdx];
          }
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
