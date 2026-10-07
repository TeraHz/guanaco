import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Task } from '../types/vikunja';
import { calculateReminderTime, formatReminderDescription } from '../utils/reminders';

export const REMINDER_CHANNEL_ID = 'guanaco_task_reminders';

/**
 * Initializes local notifications handler and channel.
 * STRICT PRIVACY: Zero push tokens requested or sent externally. All notifications remain 100% on-device.
 */
export async function initNotifications(): Promise<void> {
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
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const request = await Notifications.requestPermissionsAsync();
  return request.status === 'granted';
}

export async function scheduleTaskReminders(task: Task): Promise<void> {
  if (task.done) return;
  if (!task.reminders || task.reminders.length === 0) return;

  await cancelTaskReminders(task.id);

  const now = Date.now();
  for (let i = 0; i < task.reminders.length; i++) {
    const reminder = task.reminders[i];
    const triggerDate = calculateReminderTime(reminder, {
      due_date: task.due_date,
      start_date: task.start_date,
      end_date: task.end_date,
    });

    if (triggerDate && triggerDate.getTime() > now) {
      const description = formatReminderDescription(reminder);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: task.title,
          body: `Reminder: ${description}`,
          data: { taskId: task.id, reminderIndex: i },
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
}

export async function cancelTaskReminders(taskId: number): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.content.data?.taskId === taskId) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch (_) {}
}

export async function syncAllTaskReminders(tasks: Task[]): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const task of tasks) {
      if (!task.done && task.reminders && task.reminders.length > 0) {
        await scheduleTaskReminders(task);
      }
    }
  } catch (_) {}
}
