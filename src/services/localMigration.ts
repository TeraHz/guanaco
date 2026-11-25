import AsyncStorage from '@react-native-async-storage/async-storage';
import { VikunjaApiError, VikunjaClient } from '../api/client';
import {
  CreateTaskInput,
  Label,
  Project,
  SkippedMigrationTask,
  Task,
  TaskReminder,
} from '../types/vikunja';
import { normalizeHexColor } from '../utils/colors';
import { normalizeVikunjaDate } from '../utils/dates';
import { containsHtmlMarkup, plainTextToVikunjaHtml } from '../utils/htmlDescription';
import { canWriteProject } from '../utils/permissions';
import { buildProjectTree, flattenProjectTree } from '../utils/projectTree';
import { t } from '../i18n';

export const MIGRATION_CHECKPOINT_STORAGE_KEY = '@vikunja_migration_checkpoint';

/**
 * Default localized starter list titles across English, Bulgarian, and Spanish.
 * An untouched empty starter list (0 tasks, 0 sub-lists, no description, not favorited/archived)
 * will NOT be duplicated onto a Vikunja server that already has projects.
 */
export const DEFAULT_STARTER_LIST_TITLES = new Set<string>([
  'tasks',
  'groceries',
  'задачи',
  'списък за пазар',
  'хранителни стоки',
  'tareas',
  'compras',
  'lista de compras',
]);

interface CheckpointTaskEntry {
  serverTaskId: number;
  serverProjectId: number;
  title: string;
}

interface MigrationCheckpoint {
  serverApiUrl: string;
  userScope: string;
  projectMap: Record<string, number>;
  taskMap: Record<string, CheckpointTaskEntry | number>;
  completedRelations: string[];
  updatedAt: number;
}

export interface DeferredMigrationTask {
  localTaskId: number;
  serverProjectId: number;
  taskData: CreateTaskInput;
  labels: Label[];
}

export interface DeferredMigrationRelation {
  parentServerId?: number;
  parentLocalId?: number;
  childServerId?: number;
  childLocalId?: number;
  parentLocalOrServerId: number;
  childLocalOrServerId: number;
}

export type DeferredMigrationFollowUp =
  | {
      type: 'TOGGLE_TASK';
      taskId: number;
      done: boolean;
      data: CreateTaskInput & { id: number };
    }
  | {
      type: 'SET_TASK_LABELS';
      taskId: number;
      labels: Label[];
    };

export interface LocalMigrationResult {
  uploadedProjects: number;
  uploadedLabels: number;
  uploadedTasks: number;
  mappedSelectedProjectId: number | null;
  projectIdMap: Map<number, number>;
  taskIdMap: Map<number, number>;
  mergedProjects: Project[];
  mergedLabels: Label[];
  uploadedServerTasks: Task[];
  deferredTasks: DeferredMigrationTask[];
  deferredRelations: DeferredMigrationRelation[];
  deferredFollowUps: DeferredMigrationFollowUp[];
  skippedTasks: SkippedMigrationTask[];
}

export function isUntouchedEmptyStarterProject(
  proj: Project,
  allProjects: Project[],
  allTasks: Task[]
): boolean {
  const titleLower = (proj.title || '').trim().toLowerCase();
  if (!DEFAULT_STARTER_LIST_TITLES.has(titleLower)) return false;
  if ((proj.description || '').trim().length > 0) return false;
  if (proj.is_archived || proj.is_favorite) return false;
  if (proj.parent_project_id && proj.parent_project_id > 0) return false;

  const hasTasks = allTasks.some((t) => t && t.project_id === proj.id);
  if (hasTasks) return false;

  const hasChildren = allProjects.some(
    (p) => p && p.id > 0 && p.parent_project_id === proj.id
  );
  if (hasChildren) return false;

  return true;
}

function isPermanentClientError(err: unknown): boolean {
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  if (typeof status !== 'number') return false;
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

function hasOwn(obj: Record<string, any> | null | undefined, key: string): boolean {
  return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
}

function sanitizeMigrationReminders(
  reminders: TaskReminder[] | null | undefined,
  anchors: {
    due_date: string | null;
    start_date: string | null;
    end_date: string | null;
  }
): TaskReminder[] | undefined {
  if (!Array.isArray(reminders) || reminders.length === 0) return undefined;
  const clean: TaskReminder[] = [];

  for (const r of reminders) {
    if (!r || typeof r !== 'object') continue;
    const relTo =
      r.relative_to === 'due_date' ||
      r.relative_to === 'start_date' ||
      r.relative_to === 'end_date'
        ? r.relative_to
        : '';
    const absIso = normalizeVikunjaDate(typeof r.reminder === 'string' ? r.reminder : null);

    if (relTo) {
      const anchorIso = anchors[relTo];
      const periodSec =
        typeof r.relative_period === 'number' && Number.isFinite(r.relative_period)
          ? Math.round(r.relative_period)
          : 0;
      if (anchorIso) {
        const triggerMs = new Date(anchorIso).getTime() + periodSec * 1000;
        const computedIso = Number.isFinite(triggerMs) ? new Date(triggerMs).toISOString() : absIso;
        clean.push({
          relative_to: relTo,
          relative_period: periodSec,
          ...(computedIso ? { reminder: computedIso } : {}),
        });
      } else if (absIso) {
        // Strip orphaned relative_to when anchor date is null so Vikunja does not reject with HTTP 400
        clean.push({ reminder: absIso, relative_to: '' });
      }
    } else if (absIso) {
      clean.push({ reminder: absIso, relative_to: '' });
    }
  }

  return clean.length > 0 ? clean : undefined;
}

async function loadCheckpoint(
  serverApiUrl: string,
  userScope: string
): Promise<MigrationCheckpoint> {
  try {
    const raw = await AsyncStorage.getItem(MIGRATION_CHECKPOINT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        parsed.serverApiUrl === serverApiUrl &&
        (parsed.userScope ?? '') === userScope &&
        parsed.projectMap &&
        typeof parsed.projectMap === 'object' &&
        parsed.taskMap &&
        typeof parsed.taskMap === 'object'
      ) {
        return {
          serverApiUrl,
          userScope,
          projectMap: parsed.projectMap,
          taskMap: parsed.taskMap,
          completedRelations: Array.isArray(parsed.completedRelations)
            ? parsed.completedRelations
            : [],
          updatedAt: Date.now(),
        };
      }
    }
  } catch (_) {}

  return {
    serverApiUrl,
    userScope,
    projectMap: {},
    taskMap: {},
    completedRelations: [],
    updatedAt: Date.now(),
  };
}

async function saveCheckpoint(cp: MigrationCheckpoint): Promise<void> {
  try {
    cp.updatedAt = Date.now();
    await AsyncStorage.setItem(MIGRATION_CHECKPOINT_STORAGE_KEY, JSON.stringify(cp));
  } catch (_) {}
}

export async function clearMigrationCheckpoint(): Promise<void> {
  try {
    await AsyncStorage.removeItem(MIGRATION_CHECKPOINT_STORAGE_KEY);
  } catch (_) {}
}

/**
 * Migrates standalone local-mode projects (preserving parent-child hierarchy, colors, favorites, archive status),
 * global labels, tasks (open & done, priorities, dates, recurrence, reminders, progress), and subtask relations
 * onto a newly connected Vikunja server without duplicates or orphans.
 *
 * Idempotent across retries via `@vikunja_migration_checkpoint`, and if connectivity drops mid-task-upload
 * after projects/labels exist, safely returns remaining tasks/relations/follow-ups for `SyncQueue` handoff.
 */
export async function migrateLocalDataToServer(params: {
  client: VikunjaClient;
  localProjects: Project[];
  localTasks: Task[];
  localLabels: Label[];
  selectedProjectId: number | null;
  userScope?: string;
}): Promise<LocalMigrationResult> {
  const { client, selectedProjectId } = params;
  const normalizedUserScope = (params.userScope || '').trim().toLowerCase();
  const localProjects = (Array.isArray(params.localProjects) ? params.localProjects : []).filter(
    (p) => p && p.id > 0 && !p.is_saved_filter
  );

  // Deduplicate tasks including any embedded-only subtasks
  const rawTasksList = Array.isArray(params.localTasks) ? params.localTasks.filter(Boolean) : [];
  const uniqueTaskMap = new Map<number, Task>();
  for (const t of rawTasksList) {
    if (typeof t.id === 'number' && (t.title || '').trim()) {
      uniqueTaskMap.set(t.id, t);
    }
  }
  for (const t of rawTasksList) {
    const subs = t.related_tasks?.subtask;
    if (!Array.isArray(subs)) continue;
    for (const sub of subs) {
      if (
        sub &&
        typeof sub.id === 'number' &&
        (sub.title || '').trim() &&
        !uniqueTaskMap.has(sub.id)
      ) {
        uniqueTaskMap.set(sub.id, {
          ...sub,
          project_id: sub.project_id || t.project_id,
        });
      }
    }
  }
  const localTasks = Array.from(uniqueTaskMap.values());
  const localLabels = Array.isArray(params.localLabels) ? params.localLabels.filter(Boolean) : [];

  const projectIdMap = new Map<number, number>();
  const taskIdMap = new Map<number, number>();

  // Fast path: completely empty local state
  if (localProjects.length === 0 && localTasks.length === 0 && localLabels.length === 0) {
    await clearMigrationCheckpoint();
    return {
      uploadedProjects: 0,
      uploadedLabels: 0,
      uploadedTasks: 0,
      mappedSelectedProjectId: null,
      projectIdMap,
      taskIdMap,
      mergedProjects: [],
      mergedLabels: [],
      uploadedServerTasks: [],
      deferredTasks: [],
      deferredRelations: [],
      deferredFollowUps: [],
      skippedTasks: [],
    };
  }

  const serverApiUrl = client.getBaseApiUrl();
  const checkpoint = await loadCheckpoint(serverApiUrl, normalizedUserScope);

  // 1. Fetch existing server projects & labels BEFORE writing anything.
  // If network fails here, throw cleanly so caller keeps Local Mode 100% intact.
  const [rawServerProjects, rawServerLabels] = await Promise.all([
    client.getProjects(),
    client.getLabels(),
  ]);

  const serverProjects = (Array.isArray(rawServerProjects) ? rawServerProjects : []).filter(
    (p) => p && p.id > 0 && !p.is_saved_filter
  );
  const serverProjectIds = new Set<number>(serverProjects.map((p) => p.id));
  const preExistingServerProjects = [...serverProjects];
  const serverOriginallyHadWritableProjects = preExistingServerProjects.some((p) =>
    canWriteProject(p)
  );
  const claimedServerProjectIds = new Set<number>();

  let uploadedProjects = 0;
  let uploadedLabels = 0;
  let uploadedTasks = 0;

  // 2. Topologically order local projects (parents before children, including archived)
  const orderedProjectNodes = flattenProjectTree(
    buildProjectTree(localProjects, { showArchived: true })
  );
  const visitedProjIds = new Set<number>();
  const orderedLocalProjects: Project[] = [];
  for (const node of orderedProjectNodes) {
    visitedProjIds.add(node.project.id);
    orderedLocalProjects.push(node.project);
  }
  for (const p of localProjects) {
    if (!visitedProjIds.has(p.id)) {
      orderedLocalProjects.push(p);
    }
  }

  for (const localProj of orderedLocalProjects) {
    const projKey = String(localProj.id);
    const cpMappedId = hasOwn(checkpoint.projectMap, projKey)
      ? checkpoint.projectMap[projKey]
      : undefined;

    const existingCpProj =
      typeof cpMappedId === 'number' && serverProjectIds.has(cpMappedId)
        ? serverProjects.find((sp) => sp.id === cpMappedId)
        : undefined;

    if (typeof cpMappedId === 'number' && existingCpProj && canWriteProject(existingCpProj)) {
      projectIdMap.set(localProj.id, cpMappedId);
      claimedServerProjectIds.add(cpMappedId);
      if (
        localProj.is_archived &&
        !existingCpProj.is_archived &&
        typeof client.updateProject === 'function'
      ) {
        try {
          const hex = normalizeHexColor(existingCpProj.hex_color, true);
          await client.updateProject(cpMappedId, {
            title:
              (existingCpProj.title || localProj.title || '').trim() ||
              t('local.starterTasksList'),
            description: existingCpProj.description ?? localProj.description ?? '',
            ...(hex ? { hex_color: hex } : {}),
            ...(existingCpProj.parent_project_id && existingCpProj.parent_project_id > 0
              ? { parent_project_id: existingCpProj.parent_project_id }
              : {}),
            is_favorite: Boolean(existingCpProj.is_favorite),
            is_archived: true,
          });
          existingCpProj.is_archived = true;
        } catch (_) {}
      }
      continue;
    }

    const resolvedServerParentId =
      localProj.parent_project_id && localProj.parent_project_id > 0
        ? projectIdMap.get(localProj.parent_project_id) || 0
        : 0;

    // Match a pre-existing unclaimed WRITABLE server project with the exact same case-insensitive title, parent, and archive state
    const matchingServerProj = preExistingServerProjects.find(
      (sp) =>
        canWriteProject(sp) &&
        !claimedServerProjectIds.has(sp.id) &&
        (sp.title || '').trim().toLowerCase() === (localProj.title || '').trim().toLowerCase() &&
        (sp.parent_project_id || 0) === resolvedServerParentId &&
        Boolean(sp.is_archived) === Boolean(localProj.is_archived)
    );

    if (matchingServerProj) {
      claimedServerProjectIds.add(matchingServerProj.id);
      projectIdMap.set(localProj.id, matchingServerProj.id);
      checkpoint.projectMap[projKey] = matchingServerProj.id;
      await saveCheckpoint(checkpoint);
      continue;
    }

    // Skip creating untouched empty starter lists ONLY if the server originally already had writable projects
    if (
      serverOriginallyHadWritableProjects &&
      isUntouchedEmptyStarterProject(localProj, localProjects, localTasks)
    ) {
      continue;
    }

    const cleanHex = normalizeHexColor(localProj.hex_color, true);
    const cleanTitle = (localProj.title || '').trim() || t('local.starterTasksList');
    const createdProj = await client.createProject({
      title: cleanTitle,
      description: localProj.description || '',
      ...(cleanHex ? { hex_color: cleanHex } : {}),
      ...(resolvedServerParentId > 0 ? { parent_project_id: resolvedServerParentId } : {}),
      is_favorite: Boolean(localProj.is_favorite),
    });

    if (
      localProj.is_archived &&
      !createdProj.is_archived &&
      typeof client.updateProject === 'function'
    ) {
      try {
        await client.updateProject(createdProj.id, {
          title: createdProj.title || cleanTitle,
          description: createdProj.description ?? localProj.description ?? '',
          ...(cleanHex ? { hex_color: cleanHex } : {}),
          ...(resolvedServerParentId > 0 ? { parent_project_id: resolvedServerParentId } : {}),
          is_favorite: Boolean(localProj.is_favorite),
          is_archived: true,
        });
        createdProj.is_archived = true;
      } catch (_) {}
    }

    uploadedProjects += 1;
    claimedServerProjectIds.add(createdProj.id);
    serverProjects.push(createdProj);
    serverProjectIds.add(createdProj.id);
    projectIdMap.set(localProj.id, createdProj.id);
    checkpoint.projectMap[projKey] = createdProj.id;
    await saveCheckpoint(checkpoint);
  }

  // Ensure a writable fallback server project exists if any local task references an unmapped project_id
  const writableServerProjects = serverProjects.filter((p) => canWriteProject(p));
  let fallbackServerProjectId =
    writableServerProjects.find((p) => !p.is_archived)?.id ||
    writableServerProjects[0]?.id ||
    0;
  if (localTasks.length > 0 && fallbackServerProjectId <= 0) {
    const fallbackCreated = await client.createProject({
      title: t('local.starterTasksList'),
      hex_color: '#0A84FF',
    });
    uploadedProjects += 1;
    serverProjects.push(fallbackCreated);
    serverProjectIds.add(fallbackCreated.id);
    fallbackServerProjectId = fallbackCreated.id;
  }

  // 3. Deduplicate & create Global Labels once upfront
  const labelByTitle = new Map<string, Label>();
  for (const sl of Array.isArray(rawServerLabels) ? rawServerLabels : []) {
    if (sl && sl.id > 0 && (sl.title || '').trim()) {
      const hex = normalizeHexColor(sl.hex_color || sl.color, true);
      labelByTitle.set(sl.title.trim().toLowerCase(), {
        ...sl,
        ...(hex ? { hex_color: hex, color: hex } : {}),
      });
    }
  }

  const candidateLocalLabels: Label[] = [
    ...localLabels,
    ...localTasks.flatMap((t) => (Array.isArray(t.labels) ? t.labels : [])),
  ];

  for (const cand of candidateLocalLabels) {
    if (!cand || typeof cand.title !== 'string') continue;
    const trimmed = cand.title.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (labelByTitle.has(lower)) continue;

    const hex = normalizeHexColor(cand.hex_color || cand.color, true);
    try {
      const createdLabel = await client.createLabel(trimmed, hex || undefined);
      if (createdLabel && createdLabel.id > 0) {
        uploadedLabels += 1;
        labelByTitle.set(lower, {
          ...createdLabel,
          hex_color: createdLabel.hex_color || hex || undefined,
          color: createdLabel.hex_color || hex || undefined,
        });
      }
    } catch (err: any) {
      if (err instanceof VikunjaApiError && (err.status === 400 || err.status === 409)) {
        try {
          const refreshed = await client.getLabels();
          for (const rl of refreshed || []) {
            if (rl && rl.id > 0 && rl.title) {
              labelByTitle.set(rl.title.trim().toLowerCase(), rl);
            }
          }
        } catch (_) {}
      }
      // If transient label error occurs, task label attachment or deferred follow-up can create it later
    }
  }

  // 4. Collect subtask relations & sort tasks by (project_id, position) so creation order preserves list order
  const subtaskPairs: { parentLocalId: number; childLocalId: number }[] = [];
  const seenRelationKeys = new Set<string>();
  for (const t of localTasks) {
    const subs = t.related_tasks?.subtask;
    if (!Array.isArray(subs)) continue;
    for (const s of subs) {
      if (!s || typeof s.id !== 'number' || s.id === t.id) continue;
      const key = `${t.id}->${s.id}`;
      if (!seenRelationKeys.has(key)) {
        seenRelationKeys.add(key);
        subtaskPairs.push({ parentLocalId: t.id, childLocalId: s.id });
      }
    }
    const pars = t.related_tasks?.parenttask;
    if (Array.isArray(pars)) {
      for (const p of pars) {
        if (!p || typeof p.id !== 'number' || p.id === t.id) continue;
        const key = `${p.id}->${t.id}`;
        if (!seenRelationKeys.has(key)) {
          seenRelationKeys.add(key);
          subtaskPairs.push({ parentLocalId: p.id, childLocalId: t.id });
        }
      }
    }
  }

  const sortedLocalTasks = [...localTasks].sort((a, b) => {
    if (a.project_id !== b.project_id) return a.project_id - b.project_id;
    const posA = a.position ?? Number.MAX_SAFE_INTEGER;
    const posB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    if (a.id < 0 && b.id < 0) return b.id - a.id;
    return a.id - b.id;
  });

  const deferredTasks: DeferredMigrationTask[] = [];
  const deferredFollowUps: DeferredMigrationFollowUp[] = [];
  const skippedTasks: SkippedMigrationTask[] = [];
  const uploadedServerTasks: Task[] = [];
  const cachedListViewIdByProject = new Map<number, number | null>();
  let hitTransientNetworkDrop = false;
  const nowIso = new Date().toISOString();

  const getListViewId = async (serverProjId: number): Promise<number | null> => {
    if (cachedListViewIdByProject.has(serverProjId)) {
      return cachedListViewIdByProject.get(serverProjId) ?? null;
    }
    if (typeof client.getProjectViews !== 'function') {
      cachedListViewIdByProject.set(serverProjId, null);
      return null;
    }
    try {
      const views = await client.getProjectViews(serverProjId);
      const listId =
        (Array.isArray(views) ? views.find((v) => v.view_kind === 'list')?.id : undefined) ??
        (Array.isArray(views) ? views[0]?.id : undefined) ??
        null;
      cachedListViewIdByProject.set(serverProjId, listId);
      return listId;
    } catch {
      cachedListViewIdByProject.set(serverProjId, null);
      return null;
    }
  };

  for (const localTask of sortedLocalTasks) {
    const mappedProjId = projectIdMap.get(localTask.project_id);
    const mappedProjObj = mappedProjId
      ? serverProjects.find((sp) => sp.id === mappedProjId)
      : undefined;
    const targetServerProjectId =
      mappedProjId && (!mappedProjObj || canWriteProject(mappedProjObj))
        ? mappedProjId
        : fallbackServerProjectId;
    const cleanTitle = localTask.title.trim();
    const taskKey = String(localTask.id);
    const rawCpEntry = hasOwn(checkpoint.taskMap, taskKey) ? checkpoint.taskMap[taskKey] : undefined;

    let cpServerTaskId: number | null = null;
    if (typeof rawCpEntry === 'number' && rawCpEntry > 0) {
      cpServerTaskId = rawCpEntry;
    } else if (
      rawCpEntry &&
      typeof rawCpEntry === 'object' &&
      typeof rawCpEntry.serverTaskId === 'number' &&
      rawCpEntry.serverTaskId > 0 &&
      serverProjectIds.has(rawCpEntry.serverProjectId) &&
      rawCpEntry.title === cleanTitle
    ) {
      cpServerTaskId = rawCpEntry.serverTaskId;
    }

    const resolvedLabels: Label[] = [];
    const seenTaskLbl = new Set<string>();
    for (const tl of localTask.labels || []) {
      if (!tl || !tl.title) continue;
      const lower = tl.title.trim().toLowerCase();
      if (!lower || seenTaskLbl.has(lower)) continue;
      seenTaskLbl.add(lower);
      const serverLbl = labelByTitle.get(lower);
      resolvedLabels.push(
        serverLbl || {
          id: tl.id < 0 ? tl.id : -Math.abs(tl.id || 1),
          title: tl.title.trim(),
          hex_color: normalizeHexColor(tl.hex_color || tl.color, true) || undefined,
        }
      );
    }

    const normDue = normalizeVikunjaDate(localTask.due_date);
    const normStart = normalizeVikunjaDate(localTask.start_date);
    const normEnd = normalizeVikunjaDate(localTask.end_date);
    const normDoneAt = localTask.done
      ? normalizeVikunjaDate(localTask.done_at) || nowIso
      : null;
    const cleanReminders = sanitizeMigrationReminders(localTask.reminders, {
      due_date: normDue,
      start_date: normStart,
      end_date: normEnd,
    });

    if (cpServerTaskId !== null) {
      taskIdMap.set(localTask.id, cpServerTaskId);
      uploadedServerTasks.push({
        ...localTask,
        id: cpServerTaskId,
        project_id: targetServerProjectId,
        due_date: normDue,
        start_date: normStart,
        end_date: normEnd,
        reminders: cleanReminders ?? null,
        labels: resolvedLabels,
        related_tasks: undefined,
      });
      continue;
    }
    const cleanDesc = localTask.description
      ? containsHtmlMarkup(localTask.description)
        ? localTask.description
        : plainTextToVikunjaHtml(localTask.description)
      : undefined;
    const cleanColor = normalizeHexColor(localTask.hex_color || localTask.color, true) || undefined;
    const normPct =
      typeof localTask.percent_done === 'number' && Number.isFinite(localTask.percent_done)
        ? localTask.percent_done > 1
          ? Math.min(1, localTask.percent_done / 100)
          : Math.max(0, Math.min(1, localTask.percent_done))
        : undefined;

    const taskData: CreateTaskInput = {
      title: cleanTitle,
      ...(cleanDesc ? { description: cleanDesc } : {}),
      done: Boolean(localTask.done),
      done_at: normDoneAt,
      due_date: normDue,
      start_date: normStart,
      end_date: normEnd,
      priority: Math.max(0, Math.min(5, Math.round(localTask.priority ?? 0))),
      project_id: targetServerProjectId,
      ...(typeof localTask.position === 'number' && Number.isFinite(localTask.position)
        ? { position: localTask.position }
        : {}),
      ...(normPct !== undefined ? { percent_done: normPct } : {}),
      ...(cleanColor ? { color: cleanColor, hex_color: cleanColor } : {}),
      ...(typeof localTask.repeat_after === 'number' && localTask.repeat_after > 0
        ? { repeat_after: Math.round(localTask.repeat_after) }
        : {}),
      ...(localTask.repeat_mode !== undefined ? { repeat_mode: localTask.repeat_mode } : {}),
      ...(cleanReminders ? { reminders: cleanReminders } : {}),
    };

    if (hitTransientNetworkDrop) {
      deferredTasks.push({
        localTaskId: localTask.id,
        serverProjectId: targetServerProjectId,
        taskData,
        labels: resolvedLabels,
      });
      continue;
    }

    let createdTask: Task | null = null;
    try {
      createdTask = await client.createTask(targetServerProjectId, taskData);
    } catch (err) {
      if (isPermanentClientError(err)) {
        // Retry once with minimal safe core fields (truncating >250 char titles) so unusual metadata never silently loses a user's task!
        const fallbackTitle = cleanTitle.length > 250 ? cleanTitle.slice(0, 250) : cleanTitle;
        try {
          createdTask = await client.createTask(targetServerProjectId, {
            title: fallbackTitle,
            ...(cleanDesc ? { description: cleanDesc } : {}),
            done: Boolean(localTask.done),
            priority: taskData.priority,
            project_id: targetServerProjectId,
          });
        } catch (fallbackErr: any) {
          if (isPermanentClientError(fallbackErr)) {
            const errStatus =
              fallbackErr?.status ??
              fallbackErr?.response?.status ??
              (err as any)?.status ??
              (err as any)?.response?.status;
            const errMsg =
              (typeof fallbackErr?.message === 'string' && fallbackErr.message) ||
              (typeof (err as any)?.message === 'string' && (err as any).message) ||
              'Rejected by server';
            skippedTasks.push({
              localTask,
              serverProjectId: targetServerProjectId,
              errorMessage: errMsg,
              ...(typeof errStatus === 'number' ? { status: errStatus } : {}),
            });
            continue;
          }
          hitTransientNetworkDrop = true;
          deferredTasks.push({
            localTaskId: localTask.id,
            serverProjectId: targetServerProjectId,
            taskData,
            labels: resolvedLabels,
          });
          continue;
        }
      } else {
        // Transient drop mid-stream: queue this and all subsequent tasks into SyncQueue!
        hitTransientNetworkDrop = true;
        deferredTasks.push({
          localTaskId: localTask.id,
          serverProjectId: targetServerProjectId,
          taskData,
          labels: resolvedLabels,
        });
        continue;
      }
    }

    if (createdTask && createdTask.id > 0) {
      uploadedTasks += 1;
      taskIdMap.set(localTask.id, createdTask.id);
      checkpoint.taskMap[taskKey] = {
        serverTaskId: createdTask.id,
        serverProjectId: targetServerProjectId,
        title: cleanTitle,
      };
      await saveCheckpoint(checkpoint);

      let finalDone = Boolean(localTask.done || createdTask.done);
      // Ensure `done: true` persists even on Vikunja versions where PUT /projects/:id/tasks defaults done=false
      if (localTask.done && !createdTask.done) {
        if (typeof client.updateTask === 'function') {
          try {
            await client.updateTask(createdTask.id, {
              ...taskData,
              done: true,
              done_at: normDoneAt || nowIso,
            });
            finalDone = true;
          } catch (doneErr) {
            if (!isPermanentClientError(doneErr)) {
              hitTransientNetworkDrop = true;
              deferredFollowUps.push({
                type: 'TOGGLE_TASK',
                taskId: createdTask.id,
                done: true,
                data: {
                  ...taskData,
                  id: createdTask.id,
                  done: true,
                  done_at: normDoneAt || nowIso,
                },
              });
            }
          }
        }
      }

      // Attach labels without N+1 GET /labels lookups, deferring to SyncQueue on transient network drop
      if (resolvedLabels.length > 0) {
        if (hitTransientNetworkDrop) {
          deferredFollowUps.push({
            type: 'SET_TASK_LABELS',
            taskId: createdTask.id,
            labels: resolvedLabels,
          });
        } else {
          const hasUnresolvedNeg = resolvedLabels.some((l) => l.id <= 0);
          if (hasUnresolvedNeg && typeof client.setTaskLabels === 'function') {
            try {
              const attached = await client.setTaskLabels(createdTask.id, resolvedLabels, []);
              for (const al of attached || []) {
                if (al && al.id > 0 && al.title) {
                  labelByTitle.set(al.title.trim().toLowerCase(), al);
                }
              }
            } catch (lblErr) {
              if (!isPermanentClientError(lblErr)) {
                hitTransientNetworkDrop = true;
                deferredFollowUps.push({
                  type: 'SET_TASK_LABELS',
                  taskId: createdTask.id,
                  labels: resolvedLabels,
                });
              }
            }
          } else if (typeof client.addLabelToTask === 'function') {
            for (const lbl of resolvedLabels) {
              if (lbl.id <= 0) continue;
              try {
                await client.addLabelToTask(createdTask.id, lbl.id);
              } catch (lblErr: any) {
                const isAlreadyAttached =
                  lblErr instanceof VikunjaApiError &&
                  (lblErr.status === 400 || lblErr.status === 409);
                if (!isAlreadyAttached && !isPermanentClientError(lblErr)) {
                  hitTransientNetworkDrop = true;
                  deferredFollowUps.push({
                    type: 'SET_TASK_LABELS',
                    taskId: createdTask.id,
                    labels: resolvedLabels,
                  });
                  break;
                }
              }
            }
          }
        }
      }

      // Best-effort preserve custom manual list ordering on Vikunja 0.23+/1.x/2.x view positions
      if (
        !hitTransientNetworkDrop &&
        typeof localTask.position === 'number' &&
        localTask.position > 0 &&
        typeof client.setTaskPosition === 'function'
      ) {
        const viewId = await getListViewId(targetServerProjectId);
        if (viewId && viewId > 0) {
          await client.setTaskPosition(createdTask.id, viewId, localTask.position).catch(() => {});
        }
      }

      uploadedServerTasks.push({
        ...localTask,
        ...createdTask,
        id: createdTask.id,
        project_id: targetServerProjectId,
        done: finalDone,
        done_at: finalDone ? normDoneAt || nowIso : null,
        reminders:
          (Array.isArray(createdTask.reminders) && createdTask.reminders.length > 0
            ? createdTask.reminders
            : cleanReminders) ?? null,
        position:
          typeof localTask.position === 'number' ? localTask.position : createdTask.position,
        labels: resolvedLabels.map(
          (l) => labelByTitle.get(l.title.trim().toLowerCase()) || l
        ),
        related_tasks: undefined,
      });
    }
  }

  // 5. Create subtask relations on server (or defer to SyncQueue if parent/child was deferred)
  const completedRelSet = new Set<string>(checkpoint.completedRelations);
  const deferredRelations: DeferredMigrationRelation[] = [];
  const deferredLocalIds = new Set<number>(deferredTasks.map((d) => d.localTaskId));

  for (const { parentLocalId, childLocalId } of subtaskPairs) {
    const relKey = `${parentLocalId}->${childLocalId}`;
    if (completedRelSet.has(relKey)) continue;

    const serverParentId = taskIdMap.get(parentLocalId);
    const serverChildId = taskIdMap.get(childLocalId);

    if (serverParentId && serverChildId && !hitTransientNetworkDrop) {
      try {
        await client.createTaskRelation(serverParentId, serverChildId, 'subtask');
        completedRelSet.add(relKey);
        checkpoint.completedRelations = Array.from(completedRelSet);
        await saveCheckpoint(checkpoint);
      } catch (relErr: any) {
        if (relErr instanceof VikunjaApiError && relErr.status === 409) {
          completedRelSet.add(relKey);
          checkpoint.completedRelations = Array.from(completedRelSet);
          await saveCheckpoint(checkpoint);
        } else if (!isPermanentClientError(relErr)) {
          deferredRelations.push({
            parentServerId: serverParentId,
            childServerId: serverChildId,
            parentLocalOrServerId: serverParentId,
            childLocalOrServerId: serverChildId,
          });
        }
      }
    } else {
      const hasParent = Boolean(serverParentId) || deferredLocalIds.has(parentLocalId);
      const hasChild = Boolean(serverChildId) || deferredLocalIds.has(childLocalId);
      if (hasParent && hasChild) {
        deferredRelations.push({
          ...(serverParentId ? { parentServerId: serverParentId } : { parentLocalId }),
          ...(serverChildId ? { childServerId: serverChildId } : { childLocalId }),
          parentLocalOrServerId: serverParentId ?? parentLocalId,
          childLocalOrServerId: serverChildId ?? childLocalId,
        });
      }
    }
  }

  // Remap embedded `related_tasks` on `uploadedServerTasks` for immediate UI consistency
  const uploadedById = new Map<number, Task>(uploadedServerTasks.map((t) => [t.id, t]));
  for (const { parentLocalId, childLocalId } of subtaskPairs) {
    const sPid = taskIdMap.get(parentLocalId);
    const sCid = taskIdMap.get(childLocalId);
    if (!sPid || !sCid) continue;
    const pTask = uploadedById.get(sPid);
    const cTask = uploadedById.get(sCid);
    if (pTask && cTask) {
      const existingSubs = pTask.related_tasks?.subtask || [];
      if (!existingSubs.some((s) => s.id === sCid)) {
        pTask.related_tasks = {
          ...(pTask.related_tasks || {}),
          subtask: [
            ...existingSubs.filter((s) => s.id !== childLocalId),
            {
              id: cTask.id,
              title: cTask.title,
              done: cTask.done,
              done_at: cTask.done_at,
              priority: cTask.priority,
              project_id: cTask.project_id,
            },
          ],
        };
      }
      const existingPars = cTask.related_tasks?.parenttask || [];
      if (!existingPars.some((p) => p.id === sPid)) {
        cTask.related_tasks = {
          ...(cTask.related_tasks || {}),
          parenttask: [
            ...existingPars.filter((p) => p.id !== parentLocalId),
            {
              id: pTask.id,
              title: pTask.title,
              done: pTask.done,
              done_at: pTask.done_at,
              priority: pTask.priority,
              project_id: pTask.project_id,
            },
          ],
        };
      }
    }
  }

  const fallbackSelection = fallbackServerProjectId > 0 ? fallbackServerProjectId : null;
  const mappedSelectedProjectId =
    selectedProjectId !== null && selectedProjectId > 0
      ? projectIdMap.get(selectedProjectId) ?? fallbackSelection
      : null;

  if (
    deferredTasks.length === 0 &&
    deferredRelations.length === 0 &&
    deferredFollowUps.length === 0
  ) {
    await clearMigrationCheckpoint();
  }

  return {
    uploadedProjects,
    uploadedLabels,
    uploadedTasks,
    mappedSelectedProjectId,
    projectIdMap,
    taskIdMap,
    mergedProjects: serverProjects,
    mergedLabels: Array.from(labelByTitle.values()),
    uploadedServerTasks,
    deferredTasks,
    deferredRelations,
    deferredFollowUps,
    skippedTasks,
  };
}
