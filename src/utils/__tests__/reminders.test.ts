import {
  calculateReminderTime,
  formatReminderDescription,
  PRESET_RELATIVE_PERIODS,
} from '../reminders';
import { TaskReminder } from '../../types/vikunja';

describe('reminders utils', () => {
  describe('calculateReminderTime', () => {
    it('returns absolute reminder Date if only absolute reminder ISO string is provided', () => {
      const reminder: TaskReminder = {
        reminder: '2026-10-15T09:00:00.000Z',
      };
      const res = calculateReminderTime(reminder, {});
      expect(res).toEqual(new Date('2026-10-15T09:00:00.000Z'));
    });

    it('prioritizes relative_to BEFORE stale server reminder.reminder when task due_date changes', () => {
      // Server previously pre-computed reminder for old due_date (Oct 15 10:00Z -> Oct 15 09:00Z)
      const serverRelativeReminder: TaskReminder = {
        reminder: '2026-10-15T09:00:00.000Z',
        relative_to: 'due_date',
        relative_period: -3600, // 1 hour before
      };

      // User reschedules due_date to Oct 20 15:00Z -> trigger MUST recalculate to Oct 20 14:00Z!
      const updated = calculateReminderTime(serverRelativeReminder, {
        due_date: '2026-10-20T15:00:00.000Z',
      });
      expect(updated).toEqual(new Date('2026-10-20T14:00:00.000Z'));

      // User clears due_date -> relative reminder must return null rather than firing at stale timestamp
      const cleared = calculateReminderTime(serverRelativeReminder, {
        due_date: null,
      });
      expect(cleared).toBeNull();
    });

    it('calculates time relative to due_date, start_date, and end_date', () => {
      expect(
        calculateReminderTime(
          { relative_to: 'due_date', relative_period: -3600 },
          { due_date: '2026-10-15T10:00:00.000Z' }
        )
      ).toEqual(new Date('2026-10-15T09:00:00.000Z'));

      expect(
        calculateReminderTime(
          { relative_to: 'start_date', relative_period: -86400 },
          { start_date: '2026-10-16T10:00:00.000Z' }
        )
      ).toEqual(new Date('2026-10-15T10:00:00.000Z'));

      expect(
        calculateReminderTime(
          { relative_to: 'end_date', relative_period: -1800 },
          { end_date: '2026-10-16T12:00:00.000Z' }
        )
      ).toEqual(new Date('2026-10-16T11:30:00.000Z'));
    });

    it('returns null if relative_to base date is missing or Vikunja zero-date', () => {
      const reminder: TaskReminder = {
        relative_to: 'due_date',
        relative_period: -3600,
      };
      expect(calculateReminderTime(reminder, { due_date: null })).toBeNull();
      expect(calculateReminderTime(reminder, { due_date: '0001-01-01T01:00:00+01:00' })).toBeNull();
    });

    it('guards against overflowing/NaN relative_period and invalid relative_to prototype keys', () => {
      expect(
        calculateReminderTime(
          { relative_to: 'due_date', relative_period: Number.NaN },
          { due_date: '2026-10-15T10:00:00.000Z' }
        )
      ).toBeNull();
      expect(
        calculateReminderTime(
          { relative_to: 'due_date', relative_period: 1e20 },
          { due_date: '2026-10-15T10:00:00.000Z' }
        )
      ).toBeNull();
      expect(
        calculateReminderTime(
          { relative_to: 'constructor' as any, relative_period: -3600 },
          { due_date: '2026-10-15T10:00:00.000Z' }
        )
      ).toBeNull();
      expect(
        formatReminderDescription({ relative_to: 'due_date', relative_period: Number.NaN })
      ).toBe('Custom reminder');
    });
  });

  describe('formatReminderDescription', () => {
    it('formats relative reminders accurately', () => {
      expect(formatReminderDescription({ relative_to: 'due_date', relative_period: 0 })).toBe(
        'At due time'
      );
      expect(formatReminderDescription({ relative_to: 'due_date', relative_period: -900 })).toBe(
        '15 minutes before due'
      );
      expect(formatReminderDescription({ relative_to: 'due_date', relative_period: -3600 })).toBe(
        '1 hour before due'
      );
      expect(formatReminderDescription({ relative_to: 'due_date', relative_period: -86400 })).toBe(
        '1 day before due'
      );
      expect(
        formatReminderDescription({ relative_to: 'due_date', relative_period: -604800 })
      ).toBe('1 week before due');
      expect(
        formatReminderDescription({ relative_to: 'start_date', relative_period: -3600 })
      ).toBe('1 hour before start');
    });

    it('formats absolute reminder and handles zero-date fallback cleanly', () => {
      const localMidday = new Date(2026, 9, 15, 14, 30, 0).toISOString();
      expect(formatReminderDescription({ reminder: localMidday })).toContain('Oct 15');
      expect(formatReminderDescription({ reminder: '0001-01-01T00:00:00Z' })).toBe(
        'Custom reminder'
      );
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
