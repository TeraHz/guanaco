import {
  calculateReminderTime,
  formatReminderDescription,
  PRESET_RELATIVE_PERIODS,
} from '../reminders';
import { TaskReminder } from '../../types/vikunja';

describe('reminders utils', () => {
  describe('calculateReminderTime', () => {
    it('returns absolute reminder Date if reminder ISO string is provided', () => {
      const reminder: TaskReminder = {
        reminder: '2026-10-15T09:00:00.000Z',
      };
      const res = calculateReminderTime(reminder, {});
      expect(res).toEqual(new Date('2026-10-15T09:00:00.000Z'));
    });

    it('calculates time relative to due_date with negative offset (before)', () => {
      const reminder: TaskReminder = {
        relative_to: 'due_date',
        relative_period: -3600, // 1 hour before
      };
      const res = calculateReminderTime(reminder, {
        due_date: '2026-10-15T10:00:00.000Z',
      });
      expect(res).toEqual(new Date('2026-10-15T09:00:00.000Z'));
    });

    it('returns null if relative_to base date is missing or invalid', () => {
      const reminder: TaskReminder = {
        relative_to: 'due_date',
        relative_period: -3600,
      };
      const res = calculateReminderTime(reminder, {
        due_date: null,
      });
      expect(res).toBeNull();
    });

    it('calculates time relative to start_date', () => {
      const reminder: TaskReminder = {
        relative_to: 'start_date',
        relative_period: -86400, // 1 day before
      };
      const res = calculateReminderTime(reminder, {
        start_date: '2026-10-16T10:00:00.000Z',
      });
      expect(res).toEqual(new Date('2026-10-15T10:00:00.000Z'));
    });
  });

  describe('formatReminderDescription', () => {
    it('formats relative reminder: at time of due date', () => {
      const reminder: TaskReminder = {
        relative_to: 'due_date',
        relative_period: 0,
      };
      expect(formatReminderDescription(reminder)).toBe('At due time');
    });

    it('formats relative reminder: minutes, hours, days before due date', () => {
      expect(
        formatReminderDescription({ relative_to: 'due_date', relative_period: -900 })
      ).toBe('15 minutes before due');

      expect(
        formatReminderDescription({ relative_to: 'due_date', relative_period: -3600 })
      ).toBe('1 hour before due');

      expect(
        formatReminderDescription({ relative_to: 'due_date', relative_period: -86400 })
      ).toBe('1 day before due');

      expect(
        formatReminderDescription({ relative_to: 'start_date', relative_period: -3600 })
      ).toBe('1 hour before start');
    });

    it('formats absolute reminder with date display', () => {
      const reminder: TaskReminder = {
        reminder: '2026-10-15T14:30:00.000Z',
      };
      const text = formatReminderDescription(reminder);
      expect(text).toContain('Oct 15');
    });
  });

  describe('PRESET_RELATIVE_PERIODS', () => {
    it('has standard choices', () => {
      expect(PRESET_RELATIVE_PERIODS.map((p) => p.seconds)).toEqual([
        0, -900, -1800, -3600, -7200, -86400, -172800, -604800,
      ]);
    });
  });
});
