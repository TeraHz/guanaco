import { RepeatMode } from '../types/vikunja';

export type TimeUnit = 'hours' | 'days' | 'weeks' | 'months';

const UNIT_SECONDS: Record<TimeUnit, number> = {
  hours: 3600,
  days: 86400,
  weeks: 604800,
  months: 2592000, // 30 days
};

export interface RepeatInterval {
  amount: number;
  unit: TimeUnit;
}

export function intervalToSeconds(amount: number, unit: TimeUnit): number {
  if (amount <= 0) return 0;
  return amount * (UNIT_SECONDS[unit] || 86400);
}

export function secondsToInterval(seconds?: number | null): RepeatInterval | null {
  if (!seconds || seconds <= 0) return null;

  if (seconds % UNIT_SECONDS.months === 0) {
    return { amount: Math.floor(seconds / UNIT_SECONDS.months), unit: 'months' };
  }
  if (seconds % UNIT_SECONDS.weeks === 0) {
    return { amount: Math.floor(seconds / UNIT_SECONDS.weeks), unit: 'weeks' };
  }
  if (seconds % UNIT_SECONDS.days === 0) {
    return { amount: Math.floor(seconds / UNIT_SECONDS.days), unit: 'days' };
  }
  if (seconds % UNIT_SECONDS.hours === 0) {
    return { amount: Math.floor(seconds / UNIT_SECONDS.hours), unit: 'hours' };
  }

  // Default to days
  return { amount: Math.max(1, Math.round(seconds / 86400)), unit: 'days' };
}

export const REPEAT_PRESETS = [
  { label: 'Never', seconds: 0, repeatMode: 0 as RepeatMode },
  { label: 'Daily', seconds: 86400, repeatMode: 0 as RepeatMode },
  { label: 'Weekly', seconds: 604800, repeatMode: 0 as RepeatMode },
  { label: 'Monthly', seconds: 2592000, repeatMode: 1 as RepeatMode },
  { label: 'Custom...', seconds: -1, repeatMode: 0 as RepeatMode },
];

export function formatRepeatDescription(
  repeatAfter?: number | null,
  repeatMode: RepeatMode = 0
): string {
  if (!repeatAfter || repeatAfter <= 0) {
    return 'Never';
  }

  let base = '';
  if (repeatMode === 1 && repeatAfter === 2592000) {
    base = 'Monthly';
  } else if (repeatAfter === 86400) {
    base = 'Daily';
  } else if (repeatAfter === 604800) {
    base = 'Weekly';
  } else {
    const parsed = secondsToInterval(repeatAfter);
    if (parsed) {
      if (parsed.amount === 1) {
        const singularUnit = parsed.unit.replace(/s$/, '');
        base = `Every ${singularUnit}`;
      } else {
        base = `Every ${parsed.amount} ${parsed.unit}`;
      }
    } else {
      base = `Every ${repeatAfter}s`;
    }
  }

  if (repeatMode === 2) {
    return `${base} (from completion)`;
  }

  return base;
}
