import { TaskReminder } from '../types/vikunja';
import { normalizeVikunjaDate, formatDateDisplay } from './dates';
import { t } from '../i18n';

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
  if (!reminder) return t('schedule.customReminder');

  if (reminder.relative_to && ALLOWED_RELATIVE_TO.has(reminder.relative_to)) {
    const period = reminder.relative_period ?? 0;
    if (!Number.isFinite(period) || Math.abs(period) > MAX_RELATIVE_PERIOD_SECONDS) {
      return t('schedule.customReminder');
    }
    if (period === 0) {
      if (reminder.relative_to === 'due_date') return t('schedule.atDueTime');
      if (reminder.relative_to === 'start_date') return t('schedule.atStartTime');
      return t('schedule.atEndTime');
    }

    const absSec = Math.abs(period);
    let timeUnitStr = '';
    if (absSec % 604800 === 0) {
      const weeks = absSec / 604800;
      timeUnitStr = weeks === 1 ? t('schedule.oneWeek') : t('schedule.nWeeks', { count: weeks });
    } else if (absSec % 86400 === 0) {
      const days = absSec / 86400;
      timeUnitStr = days === 1 ? t('schedule.oneDay') : t('schedule.nDays', { count: days });
    } else if (absSec % 3600 === 0) {
      const hours = absSec / 3600;
      timeUnitStr = hours === 1 ? t('schedule.oneHour') : t('schedule.nHours', { count: hours });
    } else if (absSec < 60) {
      const secs = Math.round(absSec);
      timeUnitStr = secs === 1 ? t('schedule.oneSecond') : t('schedule.nSeconds', { count: secs });
    } else {
      const mins = Math.round(absSec / 60);
      timeUnitStr = mins === 1 ? t('schedule.oneMinute') : t('schedule.nMinutes', { count: mins });
    }

    const isBefore = period < 0;
    if (reminder.relative_to === 'due_date') {
      return t(isBefore ? 'schedule.relativeBeforeDue' : 'schedule.relativeAfterDue', {
        time: timeUnitStr,
      });
    }
    if (reminder.relative_to === 'start_date') {
      return t(isBefore ? 'schedule.relativeBeforeStart' : 'schedule.relativeAfterStart', {
        time: timeUnitStr,
      });
    }
    return t(isBefore ? 'schedule.relativeBeforeEnd' : 'schedule.relativeAfterEnd', {
      time: timeUnitStr,
    });
  }

  if (reminder.reminder) {
    const formatted = formatDateDisplay(reminder.reminder);
    if (formatted) return formatted;
  }

  return t('schedule.customReminder');
}
