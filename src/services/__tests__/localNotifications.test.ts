import * as Notifications from 'expo-notifications';
import {
  initNotifications,
  requestNotificationPermissions,
  scheduleTaskReminders,
  cancelTaskReminders,
  syncAllTaskReminders,
  shouldCompleteTaskFromNotification,
  syncAppBadgeCount,
  TASK_REMINDER_CATEGORY,
} from '../localNotifications';
import { Task, ReminderRelativeTo, RepeatMode } from '../../types/vikunja';

describe('Local Notifications Service (Zero-Telemetry On-Device Reminders)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
    });
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);
  });

  it('initializes notification channel and foreground handler', async () => {
    await initNotifications();
    expect(Notifications.setNotificationHandler).toHaveBeenCalled();
  });

  it('cancels existing reminders FIRST and requests permissions before scheduling future reminders', async () => {
    const callOrder: string[] = [];
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('getScheduled');
      return [{ identifier: 'old-notif-1', content: { data: { taskId: 42 } } }];
    });
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('cancelOld');
    });
    (Notifications.getPermissionsAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('checkPerm');
      return { status: 'undetermined', granted: false };
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('requestPerm');
      return { status: 'granted', granted: true };
    });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('scheduleNew');
      return 'new-notif-1';
    });

    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
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
          relative_period: -3600,
        },
      ],
    };

    await scheduleTaskReminders(task);

    expect(callOrder).toEqual([
      'getScheduled',
      'cancelOld',
      'checkPerm',
      'requestPerm',
      'scheduleNew',
    ]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-notif-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Submit Tax Forms',
          categoryIdentifier: TASK_REMINDER_CATEGORY,
          data: expect.objectContaining({
            taskId: 42,
            reminderIndex: 0,
            taskDueDate: futureDate.toISOString(),
          }),
        }),
        trigger: expect.objectContaining({
          date: expect.any(Date),
        }),
      })
    );
  });

  it('cancels existing notifications when task becomes done or reminders are cleared', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      { identifier: 'stale-done-notif', content: { data: { taskId: 43 } } },
      { identifier: 'other-task-notif', content: { data: { taskId: 99 } } },
    ]);

    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const doneTask: Task = {
      id: 43,
      project_id: 1,
      priority: 0,
      title: 'Completed Task',
      done: true,
      due_date: futureDate.toISOString(),
      reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
    };

    await scheduleTaskReminders(doneTask);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-done-notif');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    jest.clearAllMocks();
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      { identifier: 'cleared-reminder-notif', content: { data: { taskId: 44 } } },
    ]);

    const clearedRemindersTask: Task = {
      id: 44,
      project_id: 1,
      priority: 0,
      title: 'Reminders Removed',
      done: false,
      reminders: [],
    };

    await scheduleTaskReminders(clearedRemindersTask);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'cleared-reminder-notif'
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule notifications if user denies notification permission', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      granted: false,
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      granted: false,
    });

    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const task: Task = {
      id: 45,
      project_id: 1,
      priority: 0,
      title: 'Permission Denied Task',
      done: false,
      due_date: futureDate.toISOString(),
      reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: 0 }],
    };

    expect(await requestNotificationPermissions()).toBe(false);
    await scheduleTaskReminders(task);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels scheduled notifications matching only the target taskId', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      { identifier: 'n-42', content: { data: { taskId: 42 } } },
      { identifier: 'n-88', content: { data: { taskId: 88 } } },
    ]);

    await cancelTaskReminders(42);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n-42');
  });

  it('syncs reminders across all tasks, ignoring done tasks and requesting permission once', async () => {
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
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent scheduleTaskReminders calls so interleaved calls never schedule duplicate notifications', async () => {
    const activeScheduled: { identifier: string; content: any }[] = [];
    let nextId = 1;

    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 15));
      return [...activeScheduled];
    });
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
      async (id: string) => {
        const idx = activeScheduled.findIndex((n) => n.identifier === id);
        if (idx !== -1) activeScheduled.splice(idx, 1);
      }
    );
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(async (req: any) => {
      await new Promise((r) => setTimeout(r, 10));
      const identifier = `notif-${nextId++}`;
      activeScheduled.push({ identifier, content: req.content });
      return identifier;
    });

    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const taskV1: Task = {
      id: 77,
      project_id: 1,
      priority: 0,
      title: 'Draft Reminder',
      done: false,
      due_date: futureDate.toISOString(),
      reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: -900 }],
    };
    const taskV2: Task = {
      ...taskV1,
      title: 'Updated Reminder',
    };

    // Fire two concurrent schedule calls for the same task
    await Promise.all([scheduleTaskReminders(taskV1), scheduleTaskReminders(taskV2)]);

    // Only ONE notification remains scheduled (the latest one), never duplicates!
    expect(activeScheduled).toHaveLength(1);
    expect(activeScheduled[0].content.title).toBe('Updated Reminder');
  });

  it('dismisses already-presented tray notifications for taskId when cancelTaskReminders runs', async () => {
    (Notifications.getPresentedNotificationsAsync as jest.Mock).mockResolvedValueOnce([
      { request: { identifier: 'tray-42', content: { data: { taskId: 42 } } } },
      { request: { identifier: 'tray-99', content: { data: { taskId: 99 } } } },
    ]);

    await cancelTaskReminders(42);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('tray-42');
  });

  it('enforces idempotency on MARK_DONE notification actions for already-completed and advanced recurring tasks', () => {
    const baseDue = '2026-11-20T16:00:00.000Z';
    const nextDue = '2026-11-21T16:00:00.000Z';

    const activeRecurring: Task = {
      id: 10,
      title: 'Take Vitamins',
      done: false,
      priority: 0,
      project_id: 1,
      due_date: baseDue,
      repeat_after: 86400,
      repeat_mode: RepeatMode.FromDueDate,
    };

    // Matching occurrence -> allowed
    expect(shouldCompleteTaskFromNotification(activeRecurring, { taskId: 10, taskDueDate: baseDue })).toBe(true);

    // Already advanced to tomorrow's occurrence -> blocked (idempotent!)
    expect(
      shouldCompleteTaskFromNotification(
        { ...activeRecurring, due_date: nextDue },
        { taskId: 10, taskDueDate: baseDue }
      )
    ).toBe(false);

    // Already marked done -> blocked
    expect(
      shouldCompleteTaskFromNotification(
        { ...activeRecurring, done: true },
        { taskId: 10, taskDueDate: baseDue }
      )
    ).toBe(false);
  });

  it('computes and sets app icon badge counts for off, overdue, and due_today modes', async () => {
    const now = new Date(2026, 10, 20, 10, 0, 0, 0);
    const yesterdayIso = new Date(2026, 10, 19, 12, 0, 0, 0).toISOString();
    const laterTodayIso = new Date(2026, 10, 20, 18, 0, 0, 0).toISOString();
    const twoDaysAgoIso = new Date(2026, 10, 18, 12, 0, 0, 0).toISOString();
    const nextWeekIso = new Date(2026, 10, 27, 12, 0, 0, 0).toISOString();
    const tasks: Task[] = [
      { id: 1, title: 'Overdue', done: false, priority: 0, project_id: 1, due_date: yesterdayIso },
      { id: 2, title: 'Due Later Today', done: false, priority: 0, project_id: 1, due_date: laterTodayIso },
      { id: 3, title: 'Done Overdue', done: true, priority: 0, project_id: 1, due_date: twoDaysAgoIso },
      { id: 4, title: 'Next Week', done: false, priority: 0, project_id: 1, due_date: nextWeekIso },
    ];

    await syncAppBadgeCount(tasks, 'off', now);
    expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0);

    await syncAppBadgeCount(tasks, 'overdue', now);
    expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(1);

    await syncAppBadgeCount(tasks, 'due_today', now);
    expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(2);
  });
});
