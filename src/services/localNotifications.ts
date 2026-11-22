import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Task, TaskReminder } from '../types/vikunja';
import { calculateReminderTime, formatReminderDescription } from '../utils/reminders';

export const REMINDER_CHANNEL_ID = 'guanaco_task_reminders';

let notifChain: Promise<void> = Promise.resolve();

function serializeNotificationOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = notifChain.catch(() => {}).then(fn);
  notifChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Initializes local notifications handler and channel.
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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: 'Task Reminders',
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
  for (const { index, reminder, triggerDate } of upcoming) {
    const description = formatReminderDescription(reminder);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: task.title,
        body: `Reminder: ${description}`,
        data: { taskId: task.id, reminderIndex: index },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
      trigger: {
        type: (Notifications.SchedulableTriggerInputTypes?.DATE ?? 'date') as any,
        date: triggerDate,
      },
    });
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
}

export async function scheduleTaskReminders(task: Task): Promise<void> {
  if (Platform.OS === 'web') return;

  return serializeNotificationOp(async () => {
    // Always cancel existing scheduled notifications for this task FIRST,
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

export async function cancelTaskReminders(taskId: number): Promise<void> {
  if (Platform.OS === 'web') return;
  return serializeNotificationOp(() => cancelTaskRemindersInternal(taskId));
}

export async function syncAllTaskReminders(tasks: Task[]): Promise<void> {
  if (Platform.OS === 'web') return;
  return serializeNotificationOp(async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();

      const nowMs = Date.now();
      const tasksToSchedule: {
        task: Task;
        upcoming: { index: number; reminder: TaskReminder; triggerDate: Date }[];
      }[] = [];

      for (const task of tasks) {
        if (!task.done && task.reminders && task.reminders.length > 0) {
          const upcoming = collectFutureReminders(task, nowMs);
          if (upcoming.length > 0) {
            tasksToSchedule.push({ task, upcoming });
          }
        }
      }

      if (tasksToSchedule.length === 0) return;

      const granted = await requestNotificationPermissions();
      if (!granted) return;

      for (const { task, upcoming } of tasksToSchedule) {
        await scheduleUpcomingForTask(task, upcoming);
      }
    } catch (_) {}
  });
}
