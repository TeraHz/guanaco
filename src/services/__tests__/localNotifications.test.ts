import * as Notifications from 'expo-notifications';
import {
  initNotifications,
  scheduleTaskReminders,
  cancelTaskReminders,
  syncAllTaskReminders,
} from '../localNotifications';
import { Task, ReminderRelativeTo } from '../../types/vikunja';

describe('Local Notifications Service (Zero-Telemetry On-Device Reminders)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes notification channel and foreground handler', async () => {
    await initNotifications();
    expect(Notifications.setNotificationHandler).toHaveBeenCalled();
  });

  it('schedules notifications for future task reminders', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24); // Tomorrow
    const task: Task = {
      id: 42,
      project_id: 1,
      priority: 0,
      title: 'Submit Tax Forms',
      done: false,
      due_date: futureDate.toISOString(),
      reminders: [
        {
          relative_to: ReminderRelativeTo.DueDate,
          relative_period: -3600, // 1 hour before
        },
      ],
    };

    await scheduleTaskReminders(task);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Submit Tax Forms',
        }),
        trigger: expect.objectContaining({
          date: expect.any(Date),
        }),
      })
    );
  });

  it('does NOT schedule notifications for done tasks', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const task: Task = {
      id: 43,
      project_id: 1,
      priority: 0,
      title: 'Completed Task',
      done: true,
      due_date: futureDate.toISOString(),
      reminders: [
        {
          relative_to: ReminderRelativeTo.DueDate,
          relative_period: 0,
        },
      ],
    };

    await scheduleTaskReminders(task);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels scheduled notifications for a task', async () => {
    await cancelTaskReminders(42);
    // Should cancel without errors
    expect(Notifications.getAllScheduledNotificationsAsync).toHaveBeenCalled();
  });

  it('syncs reminders across all tasks', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const tasks: Task[] = [
      {
        id: 101,
        project_id: 1,
        priority: 0,
        title: 'Task 1',
        done: false,
        due_date: futureDate.toISOString(),
        reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
      },
      {
        id: 102,
        project_id: 1,
        priority: 0,
        title: 'Task 2 Done',
        done: true,
        due_date: futureDate.toISOString(),
        reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
      },
    ];

    await syncAllTaskReminders(tasks);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
