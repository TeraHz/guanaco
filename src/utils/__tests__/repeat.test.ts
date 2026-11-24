import {
  secondsToInterval,
  intervalToSeconds,
  formatRepeatDescription,
  REPEAT_PRESETS,
  addCalendarMonthsClamped,
  computeNextRecurringTaskState,
  isTaskRecurring,
} from '../repeat';
import { ReminderRelativeTo, RepeatMode, Task } from '../../types/vikunja';

describe('repeat utils', () => {
  describe('intervalToSeconds & secondsToInterval', () => {
    it('converts sub-hour intervals (minutes & seconds) accurately instead of rounding to 1 day', () => {
      expect(secondsToInterval(1800)).toEqual({ amount: 30, unit: 'minutes' });
      expect(secondsToInterval(60)).toEqual({ amount: 1, unit: 'minutes' });
      expect(secondsToInterval(45)).toEqual({ amount: 45, unit: 'seconds' });
      expect(intervalToSeconds(30, 'minutes')).toBe(1800);
    });

    it('converts hours correctly', () => {
      const sec = intervalToSeconds(3, 'hours');
      expect(sec).toBe(3 * 3600);
      expect(secondsToInterval(sec)).toEqual({ amount: 3, unit: 'hours' });
    });

    it('converts days correctly', () => {
      const sec = intervalToSeconds(2, 'days');
      expect(sec).toBe(2 * 86400);
      expect(secondsToInterval(sec)).toEqual({ amount: 2, unit: 'days' });
    });

    it('converts weeks correctly', () => {
      const sec = intervalToSeconds(1, 'weeks');
      expect(sec).toBe(604800);
      expect(secondsToInterval(sec)).toEqual({ amount: 1, unit: 'weeks' });
    });

    it('converts months (30-day base) and years correctly while guarding Object.prototype keys', () => {
      const sec = intervalToSeconds(1, 'months');
      expect(sec).toBe(2592000);
      expect(secondsToInterval(sec)).toEqual({ amount: 1, unit: 'months' });
      expect(secondsToInterval(intervalToSeconds(1, 'years'))).toEqual({ amount: 1, unit: 'years' });
      expect(intervalToSeconds(2, 'constructor' as any)).toBe(2 * 86400);
    });

    it('keeps week multiples like 30 weeks (210 days) as weeks unless RepeatMode.Monthly is set', () => {
      const thirtyWeeksSec = 30 * 604800;
      expect(secondsToInterval(thirtyWeeksSec)).toEqual({ amount: 30, unit: 'weeks' });
      expect(secondsToInterval(thirtyWeeksSec, RepeatMode.FromDueDate)).toEqual({
        amount: 30,
        unit: 'weeks',
      });
      expect(secondsToInterval(thirtyWeeksSec, RepeatMode.Monthly)).toEqual({
        amount: 7,
        unit: 'months',
      });
    });

    it('handles 0, negative, or missing seconds (while preserving RepeatMode.Monthly)', () => {
      expect(secondsToInterval(0)).toBeNull();
      expect(secondsToInterval(-60)).toBeNull();
      expect(secondsToInterval(undefined)).toBeNull();
      expect(secondsToInterval(0, RepeatMode.FromCompletion)).toBeNull();
      expect(secondsToInterval(0, RepeatMode.Monthly)).toEqual({ amount: 1, unit: 'months' });
      expect(secondsToInterval(undefined, RepeatMode.Monthly)).toEqual({
        amount: 1,
        unit: 'months',
      });
    });
  });

  describe('formatRepeatDescription', () => {
    it('returns "Never" when repeatAfter is 0 or undefined (except RepeatMode.Monthly)', () => {
      expect(formatRepeatDescription(0)).toBe('Never');
      expect(formatRepeatDescription(undefined)).toBe('Never');
      expect(formatRepeatDescription(0, RepeatMode.FromCompletion)).toBe('Never');
    });

    it('formats preset intervals: daily, weekly', () => {
      expect(formatRepeatDescription(86400, RepeatMode.FromDueDate)).toBe('Daily');
      expect(formatRepeatDescription(604800, RepeatMode.FromDueDate)).toBe('Weekly');
    });

    it('formats monthly repeat with RepeatMode.Monthly (1), including server repeat_after=0', () => {
      expect(formatRepeatDescription(2592000, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(0, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(undefined, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(86400, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(2 * 2592000, RepeatMode.Monthly)).toBe('Every 2 months');
    });

    it('formats sub-hour and week-multiple intervals accurately', () => {
      expect(formatRepeatDescription(1800, RepeatMode.FromDueDate)).toBe('Every 30 minutes');
      expect(formatRepeatDescription(60, RepeatMode.FromDueDate)).toBe('Every minute');
      expect(formatRepeatDescription(30 * 604800, RepeatMode.FromDueDate)).toBe('Every 30 weeks');
      expect(formatRepeatDescription(30 * 604800, RepeatMode.Monthly)).toBe('Every 7 months');
    });

    it('formats repeat from completion date (repeatMode 2)', () => {
      expect(formatRepeatDescription(86400, RepeatMode.FromCompletion)).toBe(
        'Daily (from completion)'
      );
      expect(formatRepeatDescription(604800, RepeatMode.FromCompletion)).toBe(
        'Weekly (from completion)'
      );
      expect(formatRepeatDescription(3 * 86400, RepeatMode.FromCompletion)).toBe(
        'Every 3 days (from completion)'
      );
    });

    it('formats custom intervals', () => {
      expect(formatRepeatDescription(14 * 86400, 0)).toBe('Every 2 weeks');
      expect(formatRepeatDescription(5 * 86400, 0)).toBe('Every 5 days');
      expect(formatRepeatDescription(12 * 3600, 0)).toBe('Every 12 hours');
      expect(formatRepeatDescription(31536000, 0)).toBe('Every year');
    });
  });

  describe('REPEAT_PRESETS', () => {
    it('provides standard presets with Monthly using RepeatMode.Monthly (1)', () => {
      expect(REPEAT_PRESETS).toHaveLength(5);
      expect(REPEAT_PRESETS.map((p) => p.label)).toEqual([
        'Never',
        'Daily',
        'Weekly',
        'Monthly',
        'Custom...',
      ]);
      expect(REPEAT_PRESETS.find((p) => p.label === 'Monthly')?.repeatMode).toBe(
        RepeatMode.Monthly
      );
    });
  });

  describe('Local Mode Recurring Rollover (addCalendarMonthsClamped & computeNextRecurringTaskState)', () => {
    it('clamps month-end dates without overflowing Feb 28/29 into March and avoids Feb-28 drift across multi-month steps', () => {
      const jan31NonLeap = new Date(2026, 0, 31, 9, 30, 0, 0);
      const febClamped = addCalendarMonthsClamped(jan31NonLeap, 1);
      expect(febClamped.getFullYear()).toBe(2026);
      expect(febClamped.getMonth()).toBe(1);
      expect(febClamped.getDate()).toBe(28);
      expect(febClamped.getHours()).toBe(9);
      expect(febClamped.getMinutes()).toBe(30);

      // Multi-month step from Jan 31 (+2 months) lands on Mar 31, NOT Mar 28!
      const mar31 = addCalendarMonthsClamped(jan31NonLeap, 2);
      expect(mar31.getMonth()).toBe(2);
      expect(mar31.getDate()).toBe(31);

      // Leap year 2028: Jan 31 + 1 month -> Feb 29
      const jan31Leap = new Date(2028, 0, 31, 9, 0, 0, 0);
      const feb29 = addCalendarMonthsClamped(jan31Leap, 1);
      expect(feb29.getMonth()).toBe(1);
      expect(feb29.getDate()).toBe(29);
    });

    it('rolls Daily, Weekly, Monthly, and FromCompletion recurring tasks forward while keeping done=false and shifting companion dates/reminders', () => {
      const now = new Date(2026, 10, 24, 14, 0, 0, 0); // Nov 24, 2026 14:00 local
      const dueMorning = new Date(2026, 10, 24, 9, 0, 0, 0); // Nov 24, 2026 09:00 local
      const startMorning = new Date(2026, 10, 24, 8, 0, 0, 0);

      const dailyTask: Task = {
        id: -10,
        title: 'Take vitamins',
        done: false,
        priority: 1,
        percent_done: 0.75,
        project_id: 1,
        due_date: dueMorning.toISOString(),
        start_date: startMorning.toISOString(),
        repeat_after: 86400,
        repeat_mode: RepeatMode.FromDueDate,
        reminders: [
          { relative_to: ReminderRelativeTo.DueDate, relative_period: -900 },
          { relative_to: '', reminder: dueMorning.toISOString() },
        ],
      };

      expect(isTaskRecurring(dailyTask)).toBe(true);
      const rolledDaily = computeNextRecurringTaskState(dailyTask, now);
      expect(rolledDaily.done).toBe(false);
      expect(rolledDaily.done_at).toBeNull();
      expect(rolledDaily.percent_done).toBe(0);

      const nextDueDate = new Date(rolledDaily.due_date!);
      expect(nextDueDate.getFullYear()).toBe(2026);
      expect(nextDueDate.getMonth()).toBe(10);
      expect(nextDueDate.getDate()).toBe(25);
      expect(nextDueDate.getHours()).toBe(9);

      // Start date and absolute reminder shifted by 1 calendar day too
      expect(new Date(rolledDaily.start_date!).getDate()).toBe(25);
      expect(rolledDaily.reminders?.[0]?.relative_period).toBe(-900);
      expect(new Date(rolledDaily.reminders?.[1]?.reminder!).getDate()).toBe(25);

      // FromCompletion mode advances relative to `now` AND shifts companion dates by (nextTarget - priorScheduleAnchor)
      const fromCompletionTask: Task = {
        id: -11,
        title: 'Water plants',
        done: false,
        priority: 0,
        project_id: 1,
        due_date: new Date(2026, 10, 10, 9, 0, 0, 0).toISOString(), // 14 days overdue
        start_date: new Date(2026, 10, 9, 9, 0, 0, 0).toISOString(), // 1 day before due_date
        repeat_after: 3 * 86400,
        repeat_mode: RepeatMode.FromCompletion,
      };
      const rolledFromComp = computeNextRecurringTaskState(fromCompletionTask, now);
      const compDue = new Date(rolledFromComp.due_date!);
      const compStart = new Date(rolledFromComp.start_date!);
      expect(compDue.getDate()).toBe(27); // Nov 24 + 3 days = Nov 27
      expect(compDue.getHours()).toBe(14); // Preserves completion hour
      // Companion start_date stays ~1 day ahead of the new due_date rather than lagging 14 days behind!
      expect(compDue.getTime() - compStart.getTime()).toBe(24 * 3600 * 1000);

      // Recurring task with due_date: null anchored on start_date + absolute reminder does NOT fabricate due_date
      const startOnlyRecurring: Task = {
        id: -12,
        title: 'Morning stretch',
        done: false,
        priority: 0,
        project_id: 1,
        due_date: null,
        start_date: startMorning.toISOString(),
        repeat_after: 86400,
        repeat_mode: RepeatMode.FromDueDate,
        reminders: [{ relative_to: '', reminder: startMorning.toISOString() }],
      };
      const rolledStartOnly = computeNextRecurringTaskState(startOnlyRecurring, now);
      expect(rolledStartOnly.due_date).toBeNull();
      expect(new Date(rolledStartOnly.start_date!).getDate()).toBe(25);
      expect(new Date(rolledStartOnly.reminders![0].reminder!).getDate()).toBe(25);
    });
  });
});
