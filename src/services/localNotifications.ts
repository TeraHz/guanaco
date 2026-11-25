import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AppBadgeMode, RepeatMode, Task, TaskReminder } from '../types/vikunja';
import { calculateReminderTime, formatReminderDescription } from '../utils/reminders';
import { isOverdue, normalizeVikunjaDate } from '../utils/dates';
import { t } from '../i18n';

export const REMINDER_CHANNEL_ID = 'guanaco_task_reminders';
export const TASK_REMINDER_CATEGORY = 'GUANACO_TASK_REMINDER';
export const NOTIF_ACTION_MARK_DONE = 'MARK_DONE';
export const NOTIF_ACTION_SNOOZE_15M = 'SNOOZE_15M';

const MAX_SCHEDULED_NOTIFICATIONS_IOS = 60;
const MAX_SCHEDULED_NOTIFICATIONS_ANDROID = 240;

export function buildTaskOccurrenceAnchor(task: Pick<Task, 'due_date' | 'start_date' | 'updated'>): string | null {
  return (
    normalizeVikunjaDate(task.due_date) ||
    normalizeVikunjaDate(task.start_date) ||
    (typeof task.updated === 'string' && task.updated.trim() ? task.updated.trim() : null)
  );
}

let notifChain: Promise<void> = Promise.resolve();
let lastSyncedFingerprint: string | null = null;

export function __resetNotificationFingerprintForTesting(): void {
  lastSyncedFingerprint = null;
}

function serializeNotificationOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = notifChain.catch(() => {}).then(fn);
  notifChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Initializes local notifications handler, interactive category actions, and Android channel.
 * STRICT PRIVACY: Zero push tokens requested or sent externally. All notifications remain 100% on-device.
 */
export async function initNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (typeof Notifications.setNotificationCategoryAsync === 'function') {
    await Notifications.setNotificationCategoryAsync(TASK_REMINDER_CATEGORY, [
      {
        identifier: NOTIF_ACTION_MARK_DONE,
        buttonTitle: t('notifications.markComplete'),
        options: { opensAppToForeground: true },
      },
      {
        identifier: NOTIF_ACTION_SNOOZE_15M,
        buttonTitle: t('notifications.snooze15m'),
        options: { opensAppToForeground: true },
      },
    ]).catch(() => {});
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: t('notifications.channelName'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#007AFF',
    });
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return true;
    const request = await Notifications.requestPermissionsAsync();
    return request.status === 'granted';
  } catch (_) {
    return false;
  }
}

function collectFutureReminders(
  task: Task,
  nowMs: number
): { index: number; reminder: TaskReminder; triggerDate: Date }[] {
  if (task.done || !task.reminders || task.reminders.length === 0) {
    return [];
  }

  const upcoming: { index: number; reminder: TaskReminder; triggerDate: Date }[] = [];
  for (let i = 0; i < task.reminders.length; i++) {
    const reminder = task.reminders[i];
    if (!reminder) continue;
    const triggerDate = calculateReminderTime(reminder, {
      due_date: task.due_date,
      start_date: task.start_date,
      end_date: task.end_date,
    });

    if (triggerDate && !isNaN(triggerDate.getTime()) && triggerDate.getTime() > nowMs) {
      upcoming.push({ index: i, reminder, triggerDate });
    }
  }
  return upcoming;
}

async function scheduleUpcomingForTask(
  task: Task,
  upcoming: { index: number; reminder: TaskReminder; triggerDate: Date }[]
): Promise<void> {
  const normalizedTaskDue = normalizeVikunjaDate(task.due_date);
  const occurrenceAnchor = buildTaskOccurrenceAnchor(task);
  for (const { index, reminder, triggerDate } of upcoming) {
    const description = formatReminderDescription(reminder);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: task.title,
          body: t('notifications.reminderBody', { description }),
          categoryIdentifier: TASK_REMINDER_CATEGORY,
          data: {
            taskId: task.id,
            reminderIndex: index,
            taskDueDate: normalizedTaskDue,
            occurrenceAnchor,
          },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
        },
        trigger: {
          type: (Notifications.SchedulableTriggerInputTypes?.DATE ?? 'date') as any,
          date: triggerDate,
        },
      });
    } catch (_) {}
  }
}

async function cancelTaskRemindersInternal(taskId: number): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.content?.data?.taskId === taskId) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch (_) {}

  try {
    if (typeof Notifications.getPresentedNotificationsAsync === 'function') {
      const presented = await Notifications.getPresentedNotificationsAsync();
      for (const item of presented) {
        const id = item?.request?.identifier;
        const dataTaskId = item?.request?.content?.data?.taskId;
        if (id && dataTaskId === taskId && typeof Notifications.dismissNotificationAsync === 'function') {
          await Notifications.dismissNotificationAsync(id);
        }
      }
    }
  } catch (_) {}
}

export async function scheduleTaskReminders(task: Task): Promise<void> {
  if (Platform.OS === 'web') return;

  return serializeNotificationOp(async () => {
    lastSyncedFingerprint = null;
    // Always cancel existing scheduled & presented notifications for this task FIRST,
    // before checking `task.done` or empty `task.reminders`!
    await cancelTaskRemindersInternal(task.id);

    if (task.done) return;
    if (!task.reminders || task.reminders.length === 0) return;

    const upcoming = collectFutureReminders(task, Date.now());
    if (upcoming.length === 0) return;

    const granted = await requestNotificationPermissions();
    if (!granted) return;

    await scheduleUpcomingForTask(task, upcoming);
  });
}

export async function scheduleSnoozedReminder(task: Task, minutes = 15): Promise<void> {
  if (Platform.OS === 'web' || task.done) return;
  return serializeNotificationOp(async () => {
    const granted = await requestNotificationPermissions();
    if (!granted) return;

    const triggerDate = new Date(Date.now() + Math.max(1, minutes) * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: task.title,
        body: t('notifications.snoozedBody', { minutes }),
        categoryIdentifier: TASK_REMINDER_CATEGORY,
        data: {
          taskId: task.id,
          reminderIndex: -1,
          taskDueDate: normalizeVikunjaDate(task.due_date),
          occurrenceAnchor: buildTaskOccurrenceAnchor(task),
        },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
      trigger: {
        type: (Notifications.SchedulableTriggerInputTypes?.DATE ?? 'date') as any,
        date: triggerDate,
      },
    });
  });
}

export async function cancelTaskReminders(taskId: number): Promise<void> {
  if (Platform.OS === 'web') return;
  return serializeNotificationOp(async () => {
    lastSyncedFingerprint = null;
    await cancelTaskRemindersInternal(taskId);
  });
}

export async function clearAllNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  return serializeNotificationOp(async () => {
    lastSyncedFingerprint = null;
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (_) {}
    try {
      if (typeof Notifications.dismissAllNotificationsAsync === 'function') {
        await Notifications.dismissAllNotificationsAsync();
      }
    } catch (_) {}
  });
}

function isFutureSnoozedNotification(
  notif: any,
  nowMs: number,
  openTaskIds: Set<number>
): boolean {
  if (notif?.content?.data?.reminderIndex !== -1) return false;
  const snoozeTaskId = notif?.content?.data?.taskId;
  if (typeof snoozeTaskId !== 'number' || !openTaskIds.has(snoozeTaskId)) {
    return false;
  }
  const rawTrigger = notif?.trigger;
  if (rawTrigger && typeof rawTrigger === 'object') {
    const rawDate = rawTrigger.date ?? rawTrigger.value;
    if (rawDate !== undefined && rawDate !== null) {
      const triggerMs =
        rawDate instanceof Date
          ? rawDate.getTime()
          : typeof rawDate === 'number'
          ? rawDate > 1e11
            ? rawDate
            : rawDate * 1000
          : new Date(rawDate).getTime();
      if (!isNaN(triggerMs) && triggerMs <= nowMs) {
        return false;
      }
    }
  }
  return true;
}

export async function syncAllTaskReminders(tasks: Task[]): Promise<void> {
  if (Platform.OS === 'web') return;
  return serializeNotificationOp(async () => {
    try {
      const nowMs = Date.now();
      const flatTriggers: {
        task: Task;
        index: number;
        reminder: TaskReminder;
        triggerDate: Date;
      }[] = [];
      const openTaskIds = new Set<number>();

      for (const task of tasks) {
        if (!task || task.done) continue;
        if (typeof task.id === 'number') {
          openTaskIds.add(task.id);
        }
        if (task.reminders && task.reminders.length > 0) {
          const upcoming = collectFutureReminders(task, nowMs);
          for (const item of upcoming) {
            flatTriggers.push({
              task,
              index: item.index,
              reminder: item.reminder,
              triggerDate: item.triggerDate,
            });
          }
        }
      }

      flatTriggers.sort((a, b) => {
        const dt = a.triggerDate.getTime() - b.triggerDate.getTime();
        if (dt !== 0) return dt;
        if (a.task.id !== b.task.id) return a.task.id - b.task.id;
        return a.index - b.index;
      });

      const maxBudget =
        Platform.OS === 'ios'
          ? MAX_SCHEDULED_NOTIFICATIONS_IOS
          : MAX_SCHEDULED_NOTIFICATIONS_ANDROID;

      const capped =
        flatTriggers.length > maxBudget ? flatTriggers.slice(0, maxBudget) : flatTriggers;

      const fingerprint =
        capped.length === 0
          ? 'empty'
          : [
              Platform.OS,
              t('notifications.reminderBody', { description: '' }),
              ...capped.map(({ task, index, reminder, triggerDate }) =>
                JSON.stringify([
                  task.id,
                  index,
                  triggerDate.getTime(),
                  task.title,
                  formatReminderDescription(reminder),
                  normalizeVikunjaDate(task.due_date) ?? '',
                  buildTaskOccurrenceAnchor(task) ?? '',
                ])
              ),
            ].join('|');

      const rawExisting = await Notifications.getAllScheduledNotificationsAsync();
      const existingScheduled = Array.isArray(rawExisting) ? rawExisting : [];
      const activeSnoozes: any[] = [];
      const staleSnoozes: any[] = [];
      const regularScheduled: any[] = [];

      for (const notif of existingScheduled) {
        if (notif?.content?.data?.reminderIndex === -1) {
          if (isFutureSnoozedNotification(notif, nowMs, openTaskIds)) {
            activeSnoozes.push(notif);
          } else {
            staleSnoozes.push(notif);
          }
        } else {
          regularScheduled.push(notif);
        }
      }
      const nonActiveScheduled = [...regularScheduled, ...staleSnoozes];

      if (capped.length === 0) {
        if (lastSyncedFingerprint === 'empty' && nonActiveScheduled.length === 0) {
          return;
        }
        if (activeSnoozes.length === 0) {
          await Notifications.cancelAllScheduledNotificationsAsync();
        } else {
          for (const notif of nonActiveScheduled) {
            if (notif?.identifier) {
              await Notifications.cancelScheduledNotificationAsync(notif.identifier);
            }
          }
        }
        lastSyncedFingerprint = 'empty';
        return;
      }

      if (fingerprint === lastSyncedFingerprint && regularScheduled.length > 0) {
        for (const stale of staleSnoozes) {
          if (stale?.identifier) {
            await Notifications.cancelScheduledNotificationAsync(stale.identifier);
          }
        }
        return;
      }

      if (activeSnoozes.length === 0) {
        await Notifications.cancelAllScheduledNotificationsAsync();
      } else {
        for (const notif of nonActiveScheduled) {
          if (notif?.identifier) {
            await Notifications.cancelScheduledNotificationAsync(notif.identifier);
          }
        }
      }

      const granted = await requestNotificationPermissions();
      if (!granted) {
        lastSyncedFingerprint = null;
        return;
      }

      for (const { task, index, reminder, triggerDate } of capped) {
        await scheduleUpcomingForTask(task, [{ index, reminder, triggerDate }]);
      }
      lastSyncedFingerprint = fingerprint;
    } catch (_) {}
  });
}

/**
 * Idempotency guard for `MARK_DONE` and `SNOOZE_15M` notification actions:
 * Prevents double-completing or re-snoozing a recurring task if the user already completed that occurrence
 * (advancing `due_date`, `start_date`, or `updated` while an older notification remained in the tray).
 */
export function shouldCompleteTaskFromNotification(
  task: Task | null | undefined,
  notifData?: {
    taskId?: number;
    taskDueDate?: string | null;
    occurrenceAnchor?: string | null;
  } | null
): boolean {
  if (!task || task.done) return false;

  const isRecurring = Boolean(
    (task.repeat_after && task.repeat_after > 0) || task.repeat_mode === RepeatMode.Monthly
  );
  if (isRecurring) {
    if (notifData?.taskDueDate) {
      const currentDue = normalizeVikunjaDate(task.due_date);
      const notifDue = normalizeVikunjaDate(notifData.taskDueDate);
      if (notifDue && currentDue !== notifDue) {
        return false;
      }
    } else if (notifData?.occurrenceAnchor) {
      const currentAnchor = buildTaskOccurrenceAnchor(task);
      if (currentAnchor && currentAnchor !== notifData.occurrenceAnchor) {
        return false;
      }
    }
  }

  return true;
}

export function computeAppBadgeCount(
  tasks: Task[],
  mode: AppBadgeMode,
  now: Date = new Date()
): number {
  if (mode === 'off' || !Array.isArray(tasks) || tasks.length === 0) return 0;

  const nowMs = now.getTime();
  const endOfTodayMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

  let count = 0;
  for (const t of tasks) {
    if (!t || t.done) continue;
    const norm = normalizeVikunjaDate(t.due_date);
    if (!norm) continue;
    if (mode === 'overdue') {
      if (isOverdue(norm, nowMs)) count += 1;
    } else if (mode === 'due_today') {
      const dueMs = new Date(norm).getTime();
      if (dueMs <= endOfTodayMs) count += 1;
    }
  }
  return count;
}

export async function syncAppBadgeCount(
  tasks: Task[],
  mode: AppBadgeMode,
  now: Date = new Date()
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (typeof Notifications.setBadgeCountAsync === 'function') {
      const count = computeAppBadgeCount(tasks, mode, now);
      await Notifications.setBadgeCountAsync(count);
    }
  } catch (_) {}
}
