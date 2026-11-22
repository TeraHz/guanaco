import { RepeatMode } from '../types/vikunja';

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

export function formatRepeatDescription(
  repeatAfter?: number | null,
  repeatMode: RepeatMode = RepeatMode.FromDueDate
): string {
  // Vikunja's RepeatMode.Monthly (1) repeats on the same calendar day each month even when repeat_after is 0
  if (repeatMode === RepeatMode.Monthly) {
    if (repeatAfter && Number.isFinite(repeatAfter) && repeatAfter > 0) {
      const whole = Math.round(repeatAfter);
      if (whole > UNIT_SECONDS.months && whole % UNIT_SECONDS.months === 0) {
        return `Every ${Math.floor(whole / UNIT_SECONDS.months)} months`;
      }
    }
    return 'Monthly';
  }

  if (!repeatAfter || !Number.isFinite(repeatAfter) || repeatAfter <= 0) {
    return 'Never';
  }

  let base = '';
  if (repeatAfter === UNIT_SECONDS.days) {
    base = 'Daily';
  } else if (repeatAfter === UNIT_SECONDS.weeks) {
    base = 'Weekly';
  } else {
    const parsed = secondsToInterval(repeatAfter, repeatMode);
    if (parsed) {
      if (parsed.amount === 1) {
        const singularUnit = parsed.unit.replace(/s$/, '');
        base = `Every ${singularUnit}`;
      } else {
        base = `Every ${parsed.amount} ${parsed.unit}`;
      }
    } else {
      base = `Every ${Math.round(repeatAfter)} seconds`;
    }
  }

  if (repeatMode === RepeatMode.FromCompletion) {
    return `${base} (from completion)`;
  }

  return base;
}
