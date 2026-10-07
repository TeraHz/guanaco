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

/**
 * Calculates the exact target Date for a reminder, whether absolute or relative.
 */
export function calculateReminderTime(
  reminder: TaskReminder,
  taskDates: TaskDates
): Date | null {
  if (reminder.reminder) {
    const norm = normalizeVikunjaDate(reminder.reminder);
    if (norm) return new Date(norm);
  }

  if (reminder.relative_to) {
    const baseDateStr = taskDates[reminder.relative_to];
    const normBase = normalizeVikunjaDate(baseDateStr);
    if (!normBase) return null;

    const baseMs = new Date(normBase).getTime();
    const offsetMs = (reminder.relative_period || 0) * 1000;
    return new Date(baseMs + offsetMs);
  }

  return null;
}

/**
 * Produces a clear, human-readable description for a reminder.
 */
export function formatReminderDescription(reminder: TaskReminder): string {
  if (reminder.relative_to) {
    const targetLabel =
      reminder.relative_to === 'due_date'
        ? 'due'
        : reminder.relative_to === 'start_date'
        ? 'start'
        : 'end';

    const period = reminder.relative_period ?? 0;
    if (period === 0) {
      return `At ${targetLabel} time`;
    }

    const absSec = Math.abs(period);
    let timeUnitStr = '';
    if (absSec % 86400 === 0) {
      const days = absSec / 86400;
      timeUnitStr = `${days} ${days === 1 ? 'day' : 'days'}`;
    } else if (absSec % 3600 === 0) {
      const hours = absSec / 3600;
      timeUnitStr = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else {
      const mins = Math.round(absSec / 60);
      timeUnitStr = `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }

    return `${timeUnitStr} ${period < 0 ? 'before' : 'after'} ${targetLabel}`;
  }

  if (reminder.reminder) {
    return formatDateDisplay(reminder.reminder);
  }

  return 'Custom reminder';
}
