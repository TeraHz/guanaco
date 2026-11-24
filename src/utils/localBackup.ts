import { Platform, NativeModules, Share } from 'react-native';
import {
  AppBadgeMode,
  Label,
  LanguagePreference,
  Project,
  RepeatMode,
  Task,
  TaskReminder,
  ThemeMode,
  User,
  WeekStartDay,
} from '../types/vikunja';
import { APP_VERSION } from '../constants/version';
import { normalizeHexColor } from './colors';
import { normalizeVikunjaDate } from './dates';
import { isValidLanguagePreference, t } from '../i18n';

export const GUANACO_BACKUP_FORMAT = 'guanaco-backup' as const;
export const GUANACO_BACKUP_VERSION = 1 as const;
export const MAX_BACKUP_JSON_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_JSON_DEPTH = 64;
const MAX_BACKUP_PROJECTS = 2000;
const MAX_BACKUP_TASKS = 50_000;
const MAX_BACKUP_LABELS = 5000;
const MAX_TASK_REMINDERS = 20;
const MAX_RELATIVE_REMINDER_SECONDS = 100 * 365 * 86400; // 100 years
const MAX_SYSTEM_DIALOG_GRACE_MS = 3 * 60 * 1000; // 3 minutes while user browses SAF/Share
const POST_SYSTEM_DIALOG_GRACE_MS = 5000; // 5s after returning from SAF/Share

let activeSystemDialogCount = 0;
let activeSystemDialogStartedAt = 0;
let lastSystemDialogEndedAt = 0;

function beginSystemDialog(): void {
  if (activeSystemDialogCount === 0) {
    activeSystemDialogStartedAt = Date.now();
  }
  activeSystemDialogCount += 1;
}

function endSystemDialog(): void {
  const now = Date.now();
  const elapsed = now - activeSystemDialogStartedAt;
  const wasWithinGrace =
    activeSystemDialogStartedAt > 0 &&
    elapsed >= 0 &&
    elapsed <= MAX_SYSTEM_DIALOG_GRACE_MS;
  activeSystemDialogCount = Math.max(0, activeSystemDialogCount - 1);
  if (wasWithinGrace) {
    lastSystemDialogEndedAt = now;
  }
  if (activeSystemDialogCount === 0) {
    activeSystemDialogStartedAt = 0;
  }
}

/**
 * Returns true while an Android SAF file picker / OS Share sheet is open (up to 3 minutes)
 * or within 5 seconds of returning to the app, preventing AppState resume from locking/unmounting
 * SettingsModal mid-export/import.
 */
export function isSystemFileDialogRecentlyActive(nowMs: number = Date.now()): boolean {
  if (activeSystemDialogCount > 0 && activeSystemDialogStartedAt > 0) {
    const activeElapsed = nowMs - activeSystemDialogStartedAt;
    if (activeElapsed >= 0 && activeElapsed <= MAX_SYSTEM_DIALOG_GRACE_MS) {
      return true;
    }
  }
  if (lastSystemDialogEndedAt > 0) {
    const postElapsed = nowMs - lastSystemDialogEndedAt;
    if (postElapsed >= 0 && postElapsed <= POST_SYSTEM_DIALOG_GRACE_MS) {
      return true;
    }
  }
  return false;
}

export interface GuanacoBackupPreferences {
  reenableStaples?: boolean;
  taskItemScale?: number;
  taskItemTextScale?: number;
  themeMode?: ThemeMode;
  languagePreference?: LanguagePreference;
  weekStartDay?: WeekStartDay;
  appBadgeMode?: AppBadgeMode;
}

export interface GuanacoBackupPayload {
  format: typeof GUANACO_BACKUP_FORMAT;
  version: typeof GUANACO_BACKUP_VERSION;
  exportedAt: string;
  appVersion: string;
  data: {
    projects: Project[];
    tasks: Task[];
    labels: Label[];
    preferences?: GuanacoBackupPreferences;
  };
}

export interface ValidatedBackupData {
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  preferences: GuanacoBackupPreferences;
}

function isPlainObject(val: unknown): val is Record<string, any> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

function exceedsMaxJsonDepth(raw: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === 92) {
        // '\'
        escaped = true;
      } else if (ch === 34) {
        // '"'
        inString = false;
      }
      continue;
    }
    if (ch === 34) {
      inString = true;
    } else if (ch === 123 || ch === 91) {
      // '{' or '['
      depth += 1;
      if (depth > maxDepth) return true;
    } else if (ch === 125 || ch === 93) {
      // '}' or ']'
      if (depth > 0) depth -= 1;
    }
  }
  return false;
}

function sanitizeReminders(
  rawReminders: unknown,
  anchorDates?: {
    due_date: string | null;
    start_date: string | null;
    end_date: string | null;
  }
): TaskReminder[] | null {
  if (!Array.isArray(rawReminders)) return null;
  const valid: TaskReminder[] = [];
  for (const r of rawReminders) {
    if (valid.length >= MAX_TASK_REMINDERS) break;
    if (!isPlainObject(r)) continue;
    const relTo: 'due_date' | 'start_date' | 'end_date' | '' =
      r.relative_to === 'due_date' ||
      r.relative_to === 'start_date' ||
      r.relative_to === 'end_date'
        ? r.relative_to
        : '';
    let relPeriod: number | undefined;
    if (typeof r.relative_period === 'number' && Number.isFinite(r.relative_period)) {
      const rounded = Math.round(r.relative_period);
      if (Math.abs(rounded) <= MAX_RELATIVE_REMINDER_SECONDS) {
        relPeriod = rounded;
      }
    } else if (relTo && (r.relative_period === undefined || r.relative_period === null)) {
      // Vikunja omits relative_period when 0 ("At time of event") due to Go omitempty
      relPeriod = 0;
    }

    const absReminder = normalizeVikunjaDate(
      typeof r.reminder === 'string' ? r.reminder : null
    );

    if (relTo && relPeriod !== undefined) {
      const hasAnchor = !anchorDates || Boolean(anchorDates[relTo]);
      if (hasAnchor) {
        valid.push({
          relative_to: relTo,
          relative_period: relPeriod,
          ...(absReminder ? { reminder: absReminder } : {}),
        });
      } else if (absReminder) {
        valid.push({ reminder: absReminder, relative_to: '' });
      }
    } else if (absReminder) {
      valid.push({ reminder: absReminder, relative_to: '' });
    }
  }
  return valid.length > 0 ? valid : null;
}

function sanitizeAssignees(rawAssignees: unknown): User[] {
  if (!Array.isArray(rawAssignees)) return [];
  const seen = new Set<string>();
  const out: User[] = [];
  let nextNegId = -1;
  for (const u of rawAssignees) {
    if (!isPlainObject(u) || typeof u.username !== 'string') continue;
    const username = u.username.trim();
    if (!username) continue;
    const lower = username.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push({
      id: typeof u.id === 'number' && Number.isInteger(u.id) && u.id !== 0 ? u.id : nextNegId--,
      username,
      ...(typeof u.name === 'string' && u.name.trim() ? { name: u.name.trim() } : {}),
      ...(typeof u.email === 'string' && u.email.trim() ? { email: u.email.trim() } : {}),
    });
  }
  return out;
}

export function createBackupPayload(input: {
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  preferences?: GuanacoBackupPreferences;
  now?: Date;
}): GuanacoBackupPayload {
  const nowIso = (input.now || new Date()).toISOString();

  const cleanProjects: Project[] = (Array.isArray(input.projects) ? input.projects : [])
    .filter((p) => p && typeof p.id === 'number' && p.id > 0 && !p.is_saved_filter)
    .map((p) => {
      const hex = normalizeHexColor(p.hex_color, true);
      return {
        id: p.id,
        title: (p.title || '').trim() || 'Untitled List',
        ...(p.description ? { description: String(p.description) } : {}),
        ...(hex ? { hex_color: hex } : {}),
        ...(p.parent_project_id && p.parent_project_id > 0
          ? { parent_project_id: p.parent_project_id }
          : {}),
        is_archived: Boolean(p.is_archived),
        is_favorite: Boolean(p.is_favorite),
        ...(typeof p.position === 'number' && Number.isFinite(p.position)
          ? { position: p.position }
          : {}),
        created: normalizeVikunjaDate(p.created) || nowIso,
        updated: normalizeVikunjaDate(p.updated) || nowIso,
      };
    });

  const cleanLabels: Label[] = [];
  const seenLabels = new Set<string>();
  for (const l of Array.isArray(input.labels) ? input.labels : []) {
    if (!l || typeof l.title !== 'string') continue;
    const title = l.title.trim();
    if (!title) continue;
    const lower = title.toLowerCase();
    if (seenLabels.has(lower)) continue;
    seenLabels.add(lower);
    const hex = normalizeHexColor(l.hex_color || l.color, true);
    cleanLabels.push({
      id: l.id,
      title,
      ...(hex ? { hex_color: hex, color: hex } : {}),
      ...(l.description ? { description: String(l.description) } : {}),
    });
  }

  const cleanTasks: Task[] = (Array.isArray(input.tasks) ? input.tasks : [])
    .filter((task) => task && typeof task.id === 'number' && typeof task.title === 'string' && task.title.trim())
    .map((task) => {
      const hex = normalizeHexColor(task.hex_color || task.color, true);
      const normDue = normalizeVikunjaDate(task.due_date);
      const normStart = normalizeVikunjaDate(task.start_date);
      const normEnd = normalizeVikunjaDate(task.end_date);
      const normPct =
        typeof task.percent_done === 'number' && Number.isFinite(task.percent_done)
          ? task.percent_done > 1
            ? Math.min(1, task.percent_done / 100)
            : Math.max(0, Math.min(1, task.percent_done))
          : undefined;

      const subtaskRefs = Array.isArray(task.related_tasks?.subtask)
        ? task.related_tasks!.subtask!.filter((s) => s && typeof s.id === 'number').map((s) => ({
            id: s.id,
            title: String(s.title || '').trim(),
            done: Boolean(s.done),
            priority: typeof s.priority === 'number' ? s.priority : 0,
            project_id: s.project_id || task.project_id,
          }))
        : [];
      const parentRefs = Array.isArray(task.related_tasks?.parenttask)
        ? task.related_tasks!.parenttask!.filter((p) => p && typeof p.id === 'number').map((p) => ({
            id: p.id,
            title: String(p.title || '').trim(),
            done: Boolean(p.done),
            priority: typeof p.priority === 'number' ? p.priority : 0,
            project_id: p.project_id || task.project_id,
          }))
        : [];

      return {
        id: task.id,
        title: task.title.trim(),
        ...(task.description ? { description: String(task.description) } : {}),
        done: Boolean(task.done),
        done_at: task.done ? normalizeVikunjaDate(task.done_at) || nowIso : null,
        due_date: normDue,
        start_date: normStart,
        end_date: normEnd,
        ...(typeof task.repeat_after === 'number' && Number.isFinite(task.repeat_after) && task.repeat_after > 0
          ? { repeat_after: Math.round(task.repeat_after) }
          : {}),
        ...(task.repeat_mode === RepeatMode.FromDueDate ||
        task.repeat_mode === RepeatMode.Monthly ||
        task.repeat_mode === RepeatMode.FromCompletion
          ? { repeat_mode: task.repeat_mode }
          : {}),
        reminders: sanitizeReminders(task.reminders, {
          due_date: normDue,
          start_date: normStart,
          end_date: normEnd,
        }),
        priority: Math.max(0, Math.min(5, Math.round(task.priority || 0))),
        project_id: task.project_id,
        ...(typeof task.position === 'number' && Number.isFinite(task.position)
          ? { position: task.position }
          : {}),
        ...(normPct !== undefined ? { percent_done: normPct } : {}),
        ...(hex ? { color: hex, hex_color: hex } : {}),
        labels: (Array.isArray(task.labels) ? task.labels : [])
          .filter((l) => l && typeof l.title === 'string' && l.title.trim())
          .map((l) => {
            const lHex = normalizeHexColor(l.hex_color || l.color, true);
            return {
              id: l.id,
              title: l.title.trim(),
              ...(lHex ? { hex_color: lHex, color: lHex } : {}),
            };
          }),
        ...(Array.isArray(task.assignees) && task.assignees.length > 0
          ? { assignees: sanitizeAssignees(task.assignees) }
          : {}),
        ...(subtaskRefs.length > 0 || parentRefs.length > 0
          ? {
              related_tasks: {
                ...(subtaskRefs.length > 0 ? { subtask: subtaskRefs } : {}),
                ...(parentRefs.length > 0 ? { parenttask: parentRefs } : {}),
              },
            }
          : {}),
        created: normalizeVikunjaDate(task.created) || nowIso,
        updated: normalizeVikunjaDate(task.updated) || nowIso,
      };
    });

  return {
    format: GUANACO_BACKUP_FORMAT,
    version: GUANACO_BACKUP_VERSION,
    exportedAt: nowIso,
    appVersion: APP_VERSION,
    data: {
      projects: cleanProjects,
      tasks: cleanTasks,
      labels: cleanLabels,
      ...(input.preferences ? { preferences: input.preferences } : {}),
    },
  };
}

export function serializeLocalBackup(input: {
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  preferences?: GuanacoBackupPreferences;
  now?: Date;
}): string {
  return JSON.stringify(createBackupPayload(input), null, 2);
}

/**
 * Strictly validates and normalizes an imported JSON backup string.
 * Assigns clean positive IDs (1..N) to projects and negative local IDs to labels and tasks
 * so imported items never collide or masquerade as server-synced positive IDs.
 */
export function parseAndValidateBackup(rawJson: string): ValidatedBackupData {
  const cleanRaw = typeof rawJson === 'string' ? rawJson.replace(/^\uFEFF/, '') : '';
  if (!cleanRaw.trim()) {
    throw new Error(t('backupError.empty'));
  }

  if (cleanRaw.length > MAX_BACKUP_JSON_BYTES) {
    throw new Error(t('backupError.tooLarge'));
  }
  if (
    cleanRaw.length > Math.floor(MAX_BACKUP_JSON_BYTES / 3) &&
    typeof TextEncoder !== 'undefined' &&
    new TextEncoder().encode(cleanRaw).length > MAX_BACKUP_JSON_BYTES
  ) {
    throw new Error(t('backupError.tooLarge'));
  }

  if (exceedsMaxJsonDepth(cleanRaw, MAX_JSON_DEPTH)) {
    throw new Error(t('backupError.tooDeep'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanRaw);
  } catch {
    throw new Error(t('backupError.invalidJson'));
  }

  if (!isPlainObject(parsed)) {
    throw new Error(t('backupError.invalidRoot'));
  }

  if (parsed.format !== undefined && parsed.format !== GUANACO_BACKUP_FORMAT) {
    throw new Error(t('backupError.unrecognizedFormat'));
  }
  if (
    parsed.version !== undefined &&
    (typeof parsed.version !== 'number' ||
      !Number.isInteger(parsed.version) ||
      parsed.version < 1 ||
      parsed.version > GUANACO_BACKUP_VERSION)
  ) {
    throw new Error(t('backupError.unsupportedVersion', { version: String(parsed.version) }));
  }

  const container = isPlainObject(parsed.data) ? parsed.data : parsed;
  if (!Array.isArray(container.projects) || !Array.isArray(container.tasks)) {
    throw new Error(t('backupError.missingArrays'));
  }

  if (
    container.projects.length > MAX_BACKUP_PROJECTS ||
    container.tasks.length > MAX_BACKUP_TASKS ||
    (Array.isArray(container.labels) && container.labels.length > MAX_BACKUP_LABELS)
  ) {
    throw new Error(t('backupError.tooManyItems'));
  }

  const nowIso = new Date().toISOString();

  // 1. Sanitize & remap Projects -> 1..P
  const oldToNewProjectId = new Map<number, number>();
  const rawParentByNewId = new Map<number, number>();
  const projects: Project[] = [];
  let nextProjId = 1;

  for (const rawProj of container.projects) {
    if (!isPlainObject(rawProj)) continue;
    if (rawProj.is_saved_filter) continue;
    const rawId = typeof rawProj.id === 'number' && Number.isFinite(rawProj.id) ? rawProj.id : 0;
    if (rawId < 0) continue; // Skip pseudo/saved-filter entries
    const title = typeof rawProj.title === 'string' ? rawProj.title.trim() : '';
    if (!title) continue;

    const newId = nextProjId++;
    if (rawId > 0 && !oldToNewProjectId.has(rawId)) {
      oldToNewProjectId.set(rawId, newId);
    }
    if (typeof rawProj.parent_project_id === 'number' && rawProj.parent_project_id > 0) {
      rawParentByNewId.set(newId, rawProj.parent_project_id);
    }

    const hex = normalizeHexColor(
      typeof rawProj.hex_color === 'string' ? rawProj.hex_color : undefined,
      true
    );

    projects.push({
      id: newId,
      title,
      description: typeof rawProj.description === 'string' ? rawProj.description : '',
      ...(hex ? { hex_color: hex } : {}),
      is_archived: Boolean(rawProj.is_archived),
      is_favorite: Boolean(rawProj.is_favorite),
      position:
        typeof rawProj.position === 'number' && Number.isFinite(rawProj.position)
          ? rawProj.position
          : newId * 1000,
      created: normalizeVikunjaDate(rawProj.created) || nowIso,
      updated: normalizeVikunjaDate(rawProj.updated) || nowIso,
    });
  }

  // Wire parent_project_id in O(P * depth) while preventing self-parenting or cycles
  const acceptedParentById = new Map<number, number>();
  const createsAcceptedCycle = (childId: number, candidateParentId: number): boolean => {
    let cursor: number | undefined = candidateParentId;
    let hops = 0;
    while (cursor !== undefined && hops <= projects.length) {
      if (cursor === childId) return true;
      cursor = acceptedParentById.get(cursor);
      hops += 1;
    }
    return hops > projects.length;
  };

  for (const proj of projects) {
    const oldParent = rawParentByNewId.get(proj.id);
    if (!oldParent) continue;
    const mappedParent = oldToNewProjectId.get(oldParent);
    if (mappedParent && mappedParent !== proj.id && !createsAcceptedCycle(proj.id, mappedParent)) {
      proj.parent_project_id = mappedParent;
      acceptedParentById.set(proj.id, mappedParent);
    }
  }

  // Ensure at least one target project exists if backup has tasks
  if (projects.length === 0 && container.tasks.length > 0) {
    projects.push({
      id: 1,
      title: 'Tasks',
      hex_color: '#0A84FF',
      is_archived: false,
      is_favorite: false,
      position: 1000,
      created: nowIso,
      updated: nowIso,
    });
  }

  const fallbackProjectId =
    projects.find((p) => !p.is_archived)?.id || projects[0]?.id || 1;

  // 2. Sanitize & deduplicate Labels -> local negative IDs (-1, -2, ...)
  const labelByLowerTitle = new Map<string, Label>();
  let nextLabelId = -1;

  const registerLabel = (rawLbl: unknown): Label | null => {
    if (!isPlainObject(rawLbl) || typeof rawLbl.title !== 'string') return null;
    const title = rawLbl.title.trim();
    if (!title) return null;
    const lower = title.toLowerCase();
    const existing = labelByLowerTitle.get(lower);
    const hex = normalizeHexColor(
      typeof (rawLbl.hex_color ?? rawLbl.color) === 'string'
        ? (rawLbl.hex_color ?? rawLbl.color)
        : undefined,
      true
    );
    if (existing) {
      if (!existing.hex_color && hex) {
        existing.hex_color = hex;
        existing.color = hex;
      }
      return existing;
    }
    const created: Label = {
      id: nextLabelId--,
      title,
      ...(hex ? { hex_color: hex, color: hex } : {}),
      ...(typeof rawLbl.description === 'string' && rawLbl.description.trim()
        ? { description: rawLbl.description.trim() }
        : {}),
    };
    labelByLowerTitle.set(lower, created);
    return created;
  };

  if (Array.isArray(container.labels)) {
    for (const rawLbl of container.labels) {
      registerLabel(rawLbl);
    }
  }

  // 3. Sanitize Tasks -> local negative IDs (-1001, -1002, ...)
  const oldToNewTaskId = new Map<number, number>();
  const rawSubtasksByNewParentId = new Map<number, number[]>();
  const rawParentsByNewChildId = new Map<number, number[]>();
  const tasks: Task[] = [];
  let nextTaskId = -1001;

  // Also collect any subtasks that were only embedded inside `related_tasks.subtask`
  const allRawTasks: Record<string, any>[] = [];
  const seenRawTaskIds = new Set<number>();

  for (const rt of container.tasks) {
    if (!isPlainObject(rt)) continue;
    allRawTasks.push(rt);
    if (typeof rt.id === 'number' && Number.isFinite(rt.id) && rt.id !== 0) {
      seenRawTaskIds.add(rt.id);
    }
  }
  for (const rt of container.tasks) {
    if (!isPlainObject(rt) || !isPlainObject(rt.related_tasks)) continue;
    const subs = rt.related_tasks.subtask;
    if (!Array.isArray(subs)) continue;
    for (const sub of subs) {
      if (allRawTasks.length >= MAX_BACKUP_TASKS) break;
      if (
        isPlainObject(sub) &&
        typeof sub.id === 'number' &&
        Number.isFinite(sub.id) &&
        sub.id !== 0 &&
        !seenRawTaskIds.has(sub.id)
      ) {
        seenRawTaskIds.add(sub.id);
        allRawTasks.push({
          ...sub,
          project_id: sub.project_id ?? rt.project_id,
        });
      }
    }
  }

  for (const rawTask of allRawTasks) {
    const title = typeof rawTask.title === 'string' ? rawTask.title.trim() : '';
    if (!title) continue;

    const newTaskId = nextTaskId--;
    if (typeof rawTask.id === 'number' && Number.isFinite(rawTask.id) && rawTask.id !== 0) {
      if (!oldToNewTaskId.has(rawTask.id)) {
        oldToNewTaskId.set(rawTask.id, newTaskId);
      }
    }

    if (isPlainObject(rawTask.related_tasks)) {
      if (Array.isArray(rawTask.related_tasks.subtask)) {
        const subOldIds = rawTask.related_tasks.subtask
          .filter((s: any) => isPlainObject(s) && typeof s.id === 'number' && s.id !== 0)
          .map((s: any) => s.id as number);
        if (subOldIds.length > 0) {
          rawSubtasksByNewParentId.set(newTaskId, subOldIds);
        }
      }
      if (Array.isArray(rawTask.related_tasks.parenttask)) {
        const parOldIds = rawTask.related_tasks.parenttask
          .filter((p: any) => isPlainObject(p) && typeof p.id === 'number' && p.id !== 0)
          .map((p: any) => p.id as number);
        if (parOldIds.length > 0) {
          rawParentsByNewChildId.set(newTaskId, parOldIds);
        }
      }
    }

    const rawPid =
      typeof rawTask.project_id === 'number' && Number.isFinite(rawTask.project_id)
        ? rawTask.project_id
        : 0;
    const mappedPid = oldToNewProjectId.get(rawPid) || fallbackProjectId;

    const taskLabels: Label[] = [];
    const seenTaskLabels = new Set<string>();
    if (Array.isArray(rawTask.labels)) {
      for (const rl of rawTask.labels) {
        const reg = registerLabel(rl);
        if (reg && !seenTaskLabels.has(reg.title.toLowerCase())) {
          seenTaskLabels.add(reg.title.toLowerCase());
          taskLabels.push({ ...reg });
        }
      }
    }

    const done = Boolean(rawTask.done);
    const hex = normalizeHexColor(
      typeof (rawTask.hex_color ?? rawTask.color) === 'string'
        ? (rawTask.hex_color ?? rawTask.color)
        : undefined,
      true
    );
    const rawPriority =
      typeof rawTask.priority === 'number' && Number.isFinite(rawTask.priority)
        ? Math.max(0, Math.min(5, Math.round(rawTask.priority)))
        : 0;
    const rawPct =
      typeof rawTask.percent_done === 'number' && Number.isFinite(rawTask.percent_done)
        ? rawTask.percent_done > 1
          ? Math.min(1, rawTask.percent_done / 100)
          : Math.max(0, Math.min(1, rawTask.percent_done))
        : undefined;
    const repeatMode: RepeatMode | undefined =
      rawTask.repeat_mode === RepeatMode.FromDueDate ||
      rawTask.repeat_mode === RepeatMode.Monthly ||
      rawTask.repeat_mode === RepeatMode.FromCompletion
        ? rawTask.repeat_mode
        : undefined;
    const repeatAfter =
      typeof rawTask.repeat_after === 'number' &&
      Number.isFinite(rawTask.repeat_after) &&
      rawTask.repeat_after >= 0
        ? Math.round(rawTask.repeat_after)
        : undefined;

    const normDue = normalizeVikunjaDate(rawTask.due_date);
    const normStart = normalizeVikunjaDate(rawTask.start_date);
    const normEnd = normalizeVikunjaDate(rawTask.end_date);

    tasks.push({
      id: newTaskId,
      title,
      ...(typeof rawTask.description === 'string' && rawTask.description
        ? { description: rawTask.description }
        : {}),
      done,
      done_at: done ? normalizeVikunjaDate(rawTask.done_at) || nowIso : null,
      due_date: normDue,
      start_date: normStart,
      end_date: normEnd,
      ...(repeatAfter !== undefined ? { repeat_after: repeatAfter } : {}),
      ...(repeatMode !== undefined ? { repeat_mode: repeatMode } : {}),
      reminders: sanitizeReminders(rawTask.reminders, {
        due_date: normDue,
        start_date: normStart,
        end_date: normEnd,
      }),
      priority: rawPriority,
      project_id: mappedPid,
      position:
        typeof rawTask.position === 'number' && Number.isFinite(rawTask.position)
          ? rawTask.position
          : tasks.length * 1000 + 1000,
      ...(rawPct !== undefined ? { percent_done: rawPct } : {}),
      ...(hex ? { color: hex, hex_color: hex } : {}),
      labels: taskLabels,
      assignees: sanitizeAssignees(rawTask.assignees),
      created: normalizeVikunjaDate(rawTask.created) || nowIso,
      updated: normalizeVikunjaDate(rawTask.updated) || nowIso,
    });
  }

  // Reconstruct bidirectional `related_tasks.subtask` and `related_tasks.parenttask`
  // from both `subtask` and one-sided `parenttask` references
  const newChildrenByNewParentId = new Map<number, number[]>();
  const addParentChildPair = (parentId: number, childId: number) => {
    if (!parentId || !childId || parentId === childId) return;
    const list = newChildrenByNewParentId.get(parentId) || [];
    if (!list.includes(childId)) {
      list.push(childId);
      newChildrenByNewParentId.set(parentId, list);
    }
  };

  for (const [newParentId, oldSubIds] of rawSubtasksByNewParentId.entries()) {
    for (const oldSubId of oldSubIds) {
      const newSubId = oldToNewTaskId.get(oldSubId);
      if (newSubId) addParentChildPair(newParentId, newSubId);
    }
  }
  for (const [newChildId, oldParentIds] of rawParentsByNewChildId.entries()) {
    for (const oldParentId of oldParentIds) {
      const newParentId = oldToNewTaskId.get(oldParentId);
      if (newParentId) addParentChildPair(newParentId, newChildId);
    }
  }

  const taskById = new Map<number, Task>(tasks.map((task) => [task.id, task]));
  for (const [parentId, childIds] of newChildrenByNewParentId.entries()) {
    const parent = taskById.get(parentId);
    if (!parent) continue;
    const subSnapshots: Task[] = [];

    for (const childId of childIds) {
      const child = taskById.get(childId);
      if (!child) continue;

      subSnapshots.push({
        id: child.id,
        title: child.title,
        done: child.done,
        done_at: child.done_at,
        priority: child.priority,
        project_id: child.project_id,
      });

      const existingParents = child.related_tasks?.parenttask || [];
      if (!existingParents.some((p) => p.id === parent.id)) {
        child.related_tasks = {
          ...(child.related_tasks || {}),
          parenttask: [
            ...existingParents,
            {
              id: parent.id,
              title: parent.title,
              done: parent.done,
              done_at: parent.done_at,
              priority: parent.priority,
              project_id: parent.project_id,
            },
          ],
        };
      }
    }

    if (subSnapshots.length > 0) {
      parent.related_tasks = {
        ...(parent.related_tasks || {}),
        subtask: subSnapshots,
      };
    }
  }

  // 4. Sanitize Preferences (optional)
  const preferences: GuanacoBackupPreferences = {};
  if (isPlainObject(container.preferences)) {
    const p = container.preferences;
    if (typeof p.reenableStaples === 'boolean') {
      preferences.reenableStaples = p.reenableStaples;
    }
    if (typeof p.taskItemScale === 'number' && p.taskItemScale >= 100 && p.taskItemScale <= 200) {
      preferences.taskItemScale = Math.round(p.taskItemScale);
    }
    if (
      typeof p.taskItemTextScale === 'number' &&
      p.taskItemTextScale >= 100 &&
      p.taskItemTextScale <= 200
    ) {
      preferences.taskItemTextScale = Math.round(p.taskItemTextScale);
    }
    if (
      p.themeMode === 'system' ||
      p.themeMode === 'light' ||
      p.themeMode === 'dark' ||
      p.themeMode === 'oled'
    ) {
      preferences.themeMode = p.themeMode;
    }
    if (isValidLanguagePreference(p.languagePreference)) {
      preferences.languagePreference = p.languagePreference;
    }
    if (p.weekStartDay === 0 || p.weekStartDay === 1) {
      preferences.weekStartDay = p.weekStartDay;
    }
    if (
      p.appBadgeMode === 'off' ||
      p.appBadgeMode === 'overdue' ||
      p.appBadgeMode === 'due_today'
    ) {
      preferences.appBadgeMode = p.appBadgeMode;
    }
  }

  return {
    projects,
    tasks,
    labels: Array.from(labelByLowerTitle.values()),
    preferences,
  };
}

/**
 * Merges validated backup items into existing local projects, tasks, and labels without ID collisions.
 */
export function mergeBackupIntoLocalState(
  existing: { projects: Project[]; tasks: Task[]; labels: Label[] },
  imported: ValidatedBackupData
): { projects: Project[]; tasks: Task[]; labels: Label[] } {
  const mergedProjects = [...(existing.projects || [])];
  let nextProjId = mergedProjects.reduce((max, p) => Math.max(max, p.id > 0 ? p.id : 0), 0) + 1;

  // Map imported projects in parent-first order, matching existing lists by (title, resolvedParentId, is_archived)
  const importedProjMap = new Map<number, number>();
  const remainingProjs = [...imported.projects];
  let safetyPasses = remainingProjs.length + 2;

  while (remainingProjs.length > 0 && safetyPasses-- > 0) {
    const readyIdx = remainingProjs.findIndex(
      (p) => !p.parent_project_id || importedProjMap.has(p.parent_project_id)
    );
    const target = readyIdx >= 0 ? remainingProjs.splice(readyIdx, 1)[0] : remainingProjs.shift()!;
    const resolvedParentId = target.parent_project_id
      ? importedProjMap.get(target.parent_project_id) || 0
      : 0;

    const matchedExisting = mergedProjects.find(
      (ep) =>
        ep.id > 0 &&
        !ep.is_saved_filter &&
        ep.title.trim().toLowerCase() === target.title.trim().toLowerCase() &&
        (ep.parent_project_id || 0) === resolvedParentId &&
        Boolean(ep.is_archived) === Boolean(target.is_archived)
    );

    if (matchedExisting) {
      importedProjMap.set(target.id, matchedExisting.id);
    } else {
      const assignedId = nextProjId++;
      importedProjMap.set(target.id, assignedId);
      mergedProjects.push({
        ...target,
        id: assignedId,
        ...(resolvedParentId > 0
          ? { parent_project_id: resolvedParentId }
          : { parent_project_id: undefined }),
      });
    }
  }

  // Merge labels case-insensitively
  const mergedLabels = [...(existing.labels || [])];
  const labelByLower = new Map<string, Label>(
    mergedLabels.map((l) => [l.title.trim().toLowerCase(), l])
  );
  let minNegLabelId = mergedLabels.reduce((min, l) => Math.min(min, l.id < 0 ? l.id : 0), 0) - 1;

  for (const impLbl of imported.labels) {
    const key = impLbl.title.trim().toLowerCase();
    if (!labelByLower.has(key)) {
      const added: Label = { ...impLbl, id: minNegLabelId-- };
      mergedLabels.push(added);
      labelByLower.set(key, added);
    }
  }

  // Merge tasks with fresh negative IDs so existing tasks are never overwritten
  const existingTasks = [...(existing.tasks || [])];
  let minNegTaskId = existingTasks.reduce((min, task) => Math.min(min, task.id < 0 ? task.id : 0), -1000) - 1;
  const fallbackPid =
    mergedProjects.find((p) => p.id > 0 && !p.is_archived)?.id ||
    mergedProjects.find((p) => p.id > 0)?.id ||
    1;

  const taskIdRemap = new Map<number, number>();
  for (const task of imported.tasks) {
    taskIdRemap.set(task.id, minNegTaskId--);
  }

  const remappedImportedTasks: Task[] = imported.tasks.map((task) => {
    const newId = taskIdRemap.get(task.id)!;
    const newPid = importedProjMap.get(task.project_id) || fallbackPid;
    const remappedLabels = (task.labels || []).map(
      (l) => labelByLower.get(l.title.trim().toLowerCase()) || l
    );

    const nextRel = task.related_tasks ? { ...task.related_tasks } : undefined;
    if (nextRel?.subtask) {
      nextRel.subtask = nextRel.subtask
        .filter((s) => taskIdRemap.has(s.id))
        .map((s) => ({
          ...s,
          id: taskIdRemap.get(s.id)!,
          project_id: importedProjMap.get(s.project_id) || newPid,
        }));
    }
    if (nextRel?.parenttask) {
      nextRel.parenttask = nextRel.parenttask
        .filter((p) => taskIdRemap.has(p.id))
        .map((p) => ({
          ...p,
          id: taskIdRemap.get(p.id)!,
          project_id: importedProjMap.get(p.project_id) || newPid,
        }));
    }

    return {
      ...task,
      id: newId,
      project_id: newPid,
      labels: remappedLabels,
      ...(nextRel ? { related_tasks: nextRel } : {}),
    };
  });

  return {
    projects: mergedProjects,
    tasks: [...existingTasks, ...remappedImportedTasks],
    labels: mergedLabels,
  };
}

export function buildBackupFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `guanaco-backup-${yyyy}-${mm}-${dd}.json`;
}

export async function exportBackupToSystem(
  jsonContent: string,
  fileName: string = buildBackupFilename()
): Promise<'saved' | 'shared' | 'canceled'> {
  if (Platform.OS === 'web' && typeof document !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return 'saved';
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  if (Platform.OS === 'android') {
    const saveFn = NativeModules?.InAppUpdate?.saveJsonDocument;
    if (typeof saveFn === 'function') {
      beginSystemDialog();
      try {
        const res = await saveFn(fileName, jsonContent);
        if (res?.status === 'canceled') return 'canceled';
        if (res?.status === 'saved') return 'saved';
      } catch (err: any) {
        const code = err?.code;
        if (code === 'DOC_PICKER_SUPERSEDED') {
          return 'canceled';
        }
        // Only fall back to Share sheet if device genuinely lacks an ACTION_CREATE_DOCUMENT Activity
        if (code !== 'CREATE_DOC_UNAVAILABLE' && code !== 'NO_ACTIVITY') {
          throw err;
        }
      } finally {
        endSystemDialog();
      }
    }
  }

  beginSystemDialog();
  try {
    const shareRes = await Share.share({
      title: fileName,
      message: jsonContent,
    });
    if (shareRes?.action === Share.dismissedAction) {
      return 'canceled';
    }
    return 'shared';
  } finally {
    endSystemDialog();
  }
}

export function isNativeFileImportAvailable(): boolean {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return true;
  }
  if (Platform.OS === 'android' && typeof NativeModules?.InAppUpdate?.openJsonDocument === 'function') {
    return true;
  }
  return false;
}

export async function pickBackupFileFromSystem(): Promise<{
  status: 'loaded' | 'canceled';
  content?: string;
}> {
  if (Platform.OS === 'android') {
    const openFn = NativeModules?.InAppUpdate?.openJsonDocument;
    if (typeof openFn === 'function') {
      beginSystemDialog();
      try {
        const res = await openFn();
        if (res?.status === 'loaded' && typeof res.content === 'string') {
          return { status: 'loaded', content: res.content };
        }
        return { status: 'canceled' };
      } catch (err: any) {
        if (err?.code === 'DOC_PICKER_SUPERSEDED') {
          return { status: 'canceled' };
        }
        throw err;
      } finally {
        endSystemDialog();
      }
    }
  }

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json,text/plain';
      input.style.display = 'none';

      let settled = false;
      const cleanup = () => {
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
      };
      const finish = (result: { status: 'loaded' | 'canceled'; content?: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          finish({ status: 'canceled' });
          return;
        }
        if (file.size > MAX_BACKUP_JSON_BYTES) {
          fail(new Error(t('backupError.tooLarge')));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          finish({
            status: 'loaded',
            content: typeof reader.result === 'string' ? reader.result : '',
          });
        };
        reader.onerror = () => fail(new Error(t('settings.backupReadError')));
        reader.readAsText(file);
      };

      input.oncancel = () => finish({ status: 'canceled' });
      document.body.appendChild(input);
      input.click();
    });
  }

  return { status: 'canceled' };
}
