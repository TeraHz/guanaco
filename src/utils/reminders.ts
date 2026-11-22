import { TaskReminder } from '../types/vikunja';
import { normalizeVikunjaDate, formatDateDisplay } from './dates';

export interface TaskDates {
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export const PRESET_RELATIVE_PERIODS = [
  { label: 'At time of event', seconds: 0 },
  { label: '15 minutes before', seconds: -900 },
  { label: '30 minutes before', seconds: -1800 },
  { label: '1 hour before', seconds: -3600 },
  { label: '2 hours before', seconds: -7200 },
  { label: '1 day before', seconds: -86400 },
  { label: '2 days before', seconds: -172800 },
  { label: '1 week before', seconds: -604800 },
];

const ALLOWED_RELATIVE_TO = new Set(['due_date', 'start_date', 'end_date']);
const MAX_RELATIVE_PERIOD_SECONDS = 100 * 365 * 86400; // 100 years

/**
 * Calculates the exact target Date for a reminder, whether relative or absolute.
 * Evaluates `relative_to` BEFORE `reminder.reminder` so updating a task's due/start/end date
 * recalculates the live trigger time instead of using Vikunja's stale pre-computed timestamp.
 */
export function calculateReminderTime(
  reminder: TaskReminder,
  taskDates: TaskDates
): Date | null {
  if (!reminder) return null;

  if (reminder.relative_to && ALLOWED_RELATIVE_TO.has(reminder.relative_to)) {
    const baseDateStr = taskDates?.[reminder.relative_to];
    const normBase = normalizeVikunjaDate(baseDateStr);
    if (!normBase) return null;

    const rawPeriod = reminder.relative_period ?? 0;
    if (!Number.isFinite(rawPeriod) || Math.abs(rawPeriod) > MAX_RELATIVE_PERIOD_SECONDS) {
      return null;
    }

    const baseMs = new Date(normBase).getTime();
    const offsetMs = rawPeriod * 1000;
    const result = new Date(baseMs + offsetMs);
    return isNaN(result.getTime()) ? null : result;
  }

  if (reminder.reminder) {
    const norm = normalizeVikunjaDate(reminder.reminder);
    if (norm) return new Date(norm);
  }

  return null;
}

/**
 * Produces a clear, human-readable description for a reminder.
 */
export function formatReminderDescription(reminder: TaskReminder): string {
  if (!reminder) return 'Custom reminder';

  if (reminder.relative_to && ALLOWED_RELATIVE_TO.has(reminder.relative_to)) {
    const targetLabel =
      reminder.relative_to === 'due_date'
        ? 'due'
        : reminder.relative_to === 'start_date'
        ? 'start'
        : 'end';

    const period = reminder.relative_period ?? 0;
    if (!Number.isFinite(period) || Math.abs(period) > MAX_RELATIVE_PERIOD_SECONDS) {
      return 'Custom reminder';
    }
    if (period === 0) {
      return `At ${targetLabel} time`;
    }

    const absSec = Math.abs(period);
    let timeUnitStr = '';
    if (absSec % 604800 === 0) {
      const weeks = absSec / 604800;
      timeUnitStr = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    } else if (absSec % 86400 === 0) {
      const days = absSec / 86400;
      timeUnitStr = `${days} ${days === 1 ? 'day' : 'days'}`;
    } else if (absSec % 3600 === 0) {
      const hours = absSec / 3600;
      timeUnitStr = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else if (absSec < 60) {
      const secs = Math.round(absSec);
      timeUnitStr = `${secs} ${secs === 1 ? 'second' : 'seconds'}`;
    } else {
      const mins = Math.round(absSec / 60);
      timeUnitStr = `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }

    return `${timeUnitStr} ${period < 0 ? 'before' : 'after'} ${targetLabel}`;
  }

  if (reminder.reminder) {
    const formatted = formatDateDisplay(reminder.reminder);
    if (formatted) return formatted;
  }

  return 'Custom reminder';
}
