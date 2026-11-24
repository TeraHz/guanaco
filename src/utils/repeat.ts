import { RepeatMode, Task, TaskReminder } from '../types/vikunja';
import { normalizeVikunjaDate } from './dates';
import { t, TranslationKey } from '../i18n';

export type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

const UNIT_SECONDS: Record<TimeUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
  months: 2592000, // 30 days
  years: 31536000, // 365 days
};

export interface RepeatInterval {
  amount: number;
  unit: TimeUnit;
}

export function intervalToSeconds(amount: number, unit: TimeUnit): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unitSec = Object.prototype.hasOwnProperty.call(UNIT_SECONDS, unit)
    ? UNIT_SECONDS[unit]
    : 86400;
  return Math.round(amount * unitSec);
}

export function secondsToInterval(
  seconds?: number | null,
  repeatMode?: RepeatMode
): RepeatInterval | null {
  if (repeatMode === RepeatMode.Monthly) {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
      return { amount: 1, unit: 'months' };
    }
    const wholeMonthly = Math.max(1, Math.round(seconds));
    if (wholeMonthly % UNIT_SECONDS.months === 0) {
      return { amount: Math.floor(wholeMonthly / UNIT_SECONDS.months), unit: 'months' };
    }
    return { amount: 1, unit: 'months' };
  }

  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;

  const wholeSeconds = Math.max(1, Math.round(seconds));

  if (wholeSeconds % UNIT_SECONDS.years === 0) {
    return { amount: Math.floor(wholeSeconds / UNIT_SECONDS.years), unit: 'years' };
  }

  // Check weeks BEFORE months when not in RepeatMode.Monthly so 30 weeks (210 days)
  // is reported as 30 weeks rather than 7 months, while 30 days (2592000s) still maps to 1 month.
  if (wholeSeconds % UNIT_SECONDS.weeks === 0) {
    return { amount: Math.floor(wholeSeconds / UNIT_SECONDS.weeks), unit: 'weeks' };
  }

  if (wholeSeconds % UNIT_SECONDS.months === 0) {
    return { amount: Math.floor(wholeSeconds / UNIT_SECONDS.months), unit: 'months' };
  }

  if (wholeSeconds % UNIT_SECONDS.days === 0) {
    return { amount: Math.floor(wholeSeconds / UNIT_SECONDS.days), unit: 'days' };
  }

  if (wholeSeconds % UNIT_SECONDS.hours === 0) {
    return { amount: Math.floor(wholeSeconds / UNIT_SECONDS.hours), unit: 'hours' };
  }

  if (wholeSeconds % UNIT_SECONDS.minutes === 0) {
    return { amount: Math.floor(wholeSeconds / UNIT_SECONDS.minutes), unit: 'minutes' };
  }

  return { amount: wholeSeconds, unit: 'seconds' };
}

export const REPEAT_PRESETS = [
  { label: 'Never', seconds: 0, repeatMode: RepeatMode.FromDueDate },
  { label: 'Daily', seconds: 86400, repeatMode: RepeatMode.FromDueDate },
  { label: 'Weekly', seconds: 604800, repeatMode: RepeatMode.FromDueDate },
  { label: 'Monthly', seconds: 2592000, repeatMode: RepeatMode.Monthly },
  { label: 'Custom...', seconds: -1, repeatMode: RepeatMode.FromDueDate },
];

const SINGULAR_UNIT_KEYS: Record<TimeUnit, TranslationKey> = {
  seconds: 'schedule.everyOneSecond',
  minutes: 'schedule.everyOneMinute',
  hours: 'schedule.everyOneHour',
  days: 'schedule.everyOneDay',
  weeks: 'schedule.everyOneWeek',
  months: 'schedule.everyOneMonth',
  years: 'schedule.everyOneYear',
};

const PLURAL_UNIT_KEYS: Record<TimeUnit, TranslationKey> = {
  seconds: 'schedule.everyNSeconds',
  minutes: 'schedule.everyNMinutes',
  hours: 'schedule.everyNHours',
  days: 'schedule.everyNDays',
  weeks: 'schedule.everyNWeeks',
  months: 'schedule.everyNMonths',
  years: 'schedule.everyNYears',
};

export function formatRepeatDescription(
  repeatAfter?: number | null,
  repeatMode: RepeatMode = RepeatMode.FromDueDate
): string {
  // Vikunja's RepeatMode.Monthly (1) repeats on the same calendar day each month even when repeat_after is 0
  if (repeatMode === RepeatMode.Monthly) {
    if (repeatAfter && Number.isFinite(repeatAfter) && repeatAfter > 0) {
      const whole = Math.round(repeatAfter);
      if (whole > UNIT_SECONDS.months && whole % UNIT_SECONDS.months === 0) {
        return t('schedule.everyNMonths', { count: Math.floor(whole / UNIT_SECONDS.months) });
      }
    }
    return t('schedule.monthly');
  }

  if (!repeatAfter || !Number.isFinite(repeatAfter) || repeatAfter <= 0) {
    return t('schedule.never');
  }

  let base = '';
  if (repeatAfter === UNIT_SECONDS.days) {
    base = t('schedule.daily');
  } else if (repeatAfter === UNIT_SECONDS.weeks) {
    base = t('schedule.weekly');
  } else {
    const parsed = secondsToInterval(repeatAfter, repeatMode);
    if (parsed) {
      if (parsed.amount === 1) {
        base = t(SINGULAR_UNIT_KEYS[parsed.unit]);
      } else {
        base = t(PLURAL_UNIT_KEYS[parsed.unit], { count: parsed.amount });
      }
    } else {
      base = t('schedule.everyNSeconds', { count: Math.round(repeatAfter) });
    }
  }

  if (repeatMode === RepeatMode.FromCompletion) {
    return `${base} ${t('schedule.fromCompletionSuffix')}`;
  }

  return base;
}

export function isTaskRecurring(
  task?: Pick<Task, 'repeat_after' | 'repeat_mode'> | null
): boolean {
  if (!task) return false;
  if (task.repeat_mode === RepeatMode.Monthly) return true;
  return Boolean(
    typeof task.repeat_after === 'number' &&
      Number.isFinite(task.repeat_after) &&
      task.repeat_after > 0
  );
}

/**
 * Adds `months` calendar months in local wall-clock time while clamping day-of-month
 * to the end of the target month (e.g. Jan 31 + 1 month -> Feb 28/29 instead of Mar 3).
 */
export function addCalendarMonthsClamped(anchor: Date, months: number): Date {
  const origYear = anchor.getFullYear();
  const origMonth = anchor.getMonth();
  const origDay = anchor.getDate();

  const totalMonths = origMonth + months;
  const targetYear = origYear + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(origDay, daysInTargetMonth);

  return new Date(
    targetYear,
    targetMonth,
    clampedDay,
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds()
  );
}

function addLocalCalendarDays(anchor: Date, days: number): Date {
  return new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + days,
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds()
  );
}

const MAX_SAFE_REPEAT_SECONDS = 100 * 365 * 86400; // 100 years

/**
 * Rolls a completed recurring task forward to its next occurrence for standalone on-device mode,
 * keeping `done: false`, resetting `percent_done: 0`, preserving wall-clock time across DST boundaries
 * for whole-day/month intervals, and accurately shifting `start_date`, `end_date`, and absolute `reminders`
 * across `FromDueDate`, `Monthly`, and `FromCompletion` modes (even when `due_date` is `null`).
 */
export function computeNextRecurringTaskState(task: Task, now: Date = new Date()): Task {
  const safeNow = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  if (!isTaskRecurring(task)) {
    const nowIso = safeNow.toISOString();
    return {
      ...task,
      done: true,
      done_at: nowIso,
      updated: nowIso,
    };
  }

  const nowMs = safeNow.getTime();
  const normDue = normalizeVikunjaDate(task.due_date);
  const normStart = normalizeVikunjaDate(task.start_date);
  const normEnd = normalizeVikunjaDate(task.end_date);

  const existingDue = normDue ? new Date(normDue) : null;
  const existingStart = normStart ? new Date(normStart) : null;
  const existingEnd = normEnd ? new Date(normEnd) : null;

  let earliestAbsReminder: Date | null = null;
  if (Array.isArray(task.reminders)) {
    for (const r of task.reminders) {
      if (r && !r.relative_to && r.reminder) {
        const nr = normalizeVikunjaDate(r.reminder);
        if (nr) {
          const rd = new Date(nr);
          if (!earliestAbsReminder || rd.getTime() < earliestAbsReminder.getTime()) {
            earliestAbsReminder = rd;
          }
        }
      }
    }
  }

  const priorScheduleAnchor =
    existingDue ?? existingStart ?? existingEnd ?? earliestAbsReminder;
  const shouldWriteDueDate = existingDue !== null || priorScheduleAnchor === null;

  const repeatMode = task.repeat_mode ?? RepeatMode.FromDueDate;
  const rawAfter =
    typeof task.repeat_after === 'number' &&
    Number.isFinite(task.repeat_after) &&
    task.repeat_after > 0
      ? Math.min(MAX_SAFE_REPEAT_SECONDS, Math.round(task.repeat_after))
      : 0;

  const stepBaseDate =
    repeatMode === RepeatMode.FromCompletion || !priorScheduleAnchor
      ? safeNow
      : priorScheduleAnchor;

  let nextTarget: Date;
  let calendarMonthsApplied = 0;
  let calendarDaysApplied = 0;

  if (repeatMode === RepeatMode.Monthly) {
    const monthsStep =
      rawAfter >= UNIT_SECONDS.months && rawAfter % UNIT_SECONDS.months === 0
        ? Math.max(1, Math.round(rawAfter / UNIT_SECONDS.months))
        : 1;
    let k = 1;
    nextTarget = addCalendarMonthsClamped(stepBaseDate, monthsStep * k);
    while (nextTarget.getTime() <= nowMs && k < 1200) {
      k += 1;
      nextTarget = addCalendarMonthsClamped(stepBaseDate, monthsStep * k);
    }
    calendarMonthsApplied = monthsStep * k;
  } else if (rawAfter > 0 && rawAfter % UNIT_SECONDS.days === 0) {
    const daysStep = Math.max(1, Math.round(rawAfter / UNIT_SECONDS.days));
    let k = 1;
    if (stepBaseDate.getTime() < nowMs) {
      const approxDiffDays = Math.floor(
        (nowMs - stepBaseDate.getTime()) / (UNIT_SECONDS.days * 1000)
      );
      k = Math.max(1, Math.floor(approxDiffDays / daysStep));
    }
    nextTarget = addLocalCalendarDays(stepBaseDate, daysStep * k);
    let guard = 0;
    while (nextTarget.getTime() <= nowMs && guard < 10000) {
      k += 1;
      guard += 1;
      nextTarget = addLocalCalendarDays(stepBaseDate, daysStep * k);
    }
    calendarDaysApplied = daysStep * k;
  } else {
    const stepMs = Math.max(1000, rawAfter * 1000);
    const baseMs = stepBaseDate.getTime();
    const k = baseMs <= nowMs ? Math.floor((nowMs - baseMs) / stepMs) + 1 : 1;
    nextTarget = new Date(baseMs + k * stepMs);
  }

  if (isNaN(nextTarget.getTime())) {
    nextTarget = new Date(nowMs + UNIT_SECONDS.days * 1000);
  }

  const effectiveAnchorDeltaMs = priorScheduleAnchor
    ? nextTarget.getTime() - priorScheduleAnchor.getTime()
    : nextTarget.getTime() - stepBaseDate.getTime();
  const isFromCompletionWithPrior =
    repeatMode === RepeatMode.FromCompletion && priorScheduleAnchor !== null;

  const shiftCompanionDate = (iso?: string | null): string | null => {
    const norm = normalizeVikunjaDate(iso);
    if (!norm) return null;
    const orig = new Date(norm);
    let shifted: Date;
    if (isFromCompletionWithPrior) {
      shifted = new Date(orig.getTime() + effectiveAnchorDeltaMs);
    } else if (calendarMonthsApplied > 0) {
      shifted = addCalendarMonthsClamped(orig, calendarMonthsApplied);
    } else if (calendarDaysApplied > 0) {
      shifted = addLocalCalendarDays(orig, calendarDaysApplied);
    } else {
      shifted = new Date(orig.getTime() + effectiveAnchorDeltaMs);
    }
    return isNaN(shifted.getTime()) ? norm : shifted.toISOString();
  };

  let nextReminders: TaskReminder[] | null | undefined = task.reminders;
  if (Array.isArray(task.reminders) && task.reminders.length > 0) {
    nextReminders = task.reminders.map((rem) => {
      if (!rem) return rem;
      if (!rem.relative_to && rem.reminder) {
        const shifted = shiftCompanionDate(rem.reminder);
        return shifted ? { ...rem, reminder: shifted } : rem;
      }
      return { ...rem };
    });
  }

  return {
    ...task,
    done: false,
    done_at: null,
    percent_done: task.percent_done !== undefined ? 0 : undefined,
    due_date: shouldWriteDueDate ? nextTarget.toISOString() : null,
    start_date: shiftCompanionDate(task.start_date),
    end_date: shiftCompanionDate(task.end_date),
    reminders: nextReminders,
    updated: safeNow.toISOString(),
  };
}
