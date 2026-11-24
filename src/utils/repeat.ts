import { RepeatMode } from '../types/vikunja';
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
