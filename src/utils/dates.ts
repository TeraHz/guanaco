/**
 * Date normalization, formatting, and preset utilities for Vikunja dates.
 */
import { getFormattingLocale, getResolvedLocale, t } from '../i18n';

/**
 * Checks whether a date string represents a Vikunja / Go zero-date
 * (e.g. '0001-01-01T00:00:00Z', '0001-01-01T01:00:00+01:00', '0000-12-31T19:00:00-05:00').
 */
export function isZeroDate(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  if (!trimmed) return false;

  // Match literal 0001-01-01* or 0000-* strings (including non-UTC offsets or space separators)
  if (/^000[01]-\d{2}-\d{2}/.test(trimmed)) {
    return true;
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime()) && parsed.getUTCFullYear() <= 1) {
    return true;
  }

  return false;
}

/**
 * Normalizes a Vikunja date. Converts zero-dates ('0001-01-01...'), invalid dates, or empty strings to null.
 */
export function normalizeVikunjaDate(dateStr?: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed || isZeroDate(trimmed)) return null;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

/**
 * Formats a Date object or ISO string to ISO string for sending to Vikunja, or null if empty/zero.
 */
export function formatIsoForVikunja(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  if (typeof date === 'string') return normalizeVikunjaDate(date);
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() <= 1) return null;
  return date.toISOString();
}

/**
 * Checks if a date is in the past.
 */
export function isOverdue(dateStr?: string | null, nowMs: number = Date.now()): boolean {
  const norm = normalizeVikunjaDate(dateStr);
  if (!norm) return false;
  return new Date(norm).getTime() < nowMs;
}

/**
 * Checks if a date is within the next `hoursAhead` hours and not overdue.
 */
export function isDueSoon(
  dateStr?: string | null,
  hoursAhead = 24,
  nowMs: number = Date.now()
): boolean {
  const norm = normalizeVikunjaDate(dateStr);
  if (!norm) return false;
  const time = new Date(norm).getTime();
  const diffMs = time - nowMs;
  return diffMs > 0 && diffMs <= hoursAhead * 60 * 60 * 1000;
}

/**
 * Returns formatted human-readable date display (e.g. "Today, 5:00 PM", "Tomorrow", "Oct 15, 2026").
 */
export function formatDateDisplay(
  dateStr?: string | null,
  options?: { includeTime?: boolean; now?: Date }
): string {
  const norm = normalizeVikunjaDate(dateStr);
  if (!norm) return '';

  const d = new Date(norm);
  const now = options?.now ? new Date(options.now.getTime()) : new Date();

  // Normalize to local calendar day comparison (immune to DST hour shifts)
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const locale = getResolvedLocale();
  const fmtLocale = getFormattingLocale(locale);

  let dayLabel = '';
  if (isSameDay(d, now)) {
    dayLabel = t('schedule.today', undefined, locale);
  } else if (isSameDay(d, tomorrow)) {
    dayLabel = t('schedule.tomorrow', undefined, locale);
  } else if (isSameDay(d, yesterday)) {
    dayLabel = t('schedule.yesterday', undefined, locale);
  } else {
    const isCurrentYear = d.getFullYear() === now.getFullYear();
    if (locale === 'en') {
      const monthName = d.toLocaleDateString(fmtLocale, { month: 'short' });
      dayLabel = isCurrentYear
        ? `${monthName} ${d.getDate()}`
        : `${monthName} ${d.getDate()}, ${d.getFullYear()}`;
    } else {
      dayLabel = d.toLocaleDateString(
        fmtLocale,
        isCurrentYear
          ? { day: 'numeric', month: 'short' }
          : { day: 'numeric', month: 'short', year: 'numeric' }
      );
    }
  }

  const includeTime = options?.includeTime ?? true;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;

  if (includeTime && hasTime) {
    const timeStr = d.toLocaleTimeString(fmtLocale, { hour: 'numeric', minute: '2-digit' });
    return `${dayLabel}, ${timeStr}`;
  }

  return dayLabel;
}

export type DatePresetKey = 'today' | 'tomorrow' | 'this_weekend' | 'next_week';

/**
 * Calculates pre-defined date targets for quick date picking.
 * Guarantees 'today' never returns a timestamp in the past even late at night,
 * and respects user's configured `weekStartDay` (`0` = Sunday, `1` = Monday) for `next_week`.
 */
export function getDatePreset(
  preset: DatePresetKey,
  now: Date = new Date(),
  weekStartDay: 0 | 1 = 1
): Date | null {
  switch (preset) {
    case 'today': {
      const d = new Date(now.getTime());
      d.setHours(18, 0, 0, 0); // 6:00 PM
      if (d.getTime() <= now.getTime()) {
        d.setHours(21, 0, 0, 0); // 9:00 PM if already past 6 PM
      }
      if (d.getTime() <= now.getTime()) {
        // After 9:00 PM: now + 1 hour capped at 23:59:00 today (or 23:59:59.999 if >= 23:59)
        const plusOneHour = new Date(now.getTime() + 60 * 60 * 1000);
        const cap = new Date(now.getTime());
        cap.setHours(23, 59, 0, 0);
        if (cap.getTime() <= now.getTime()) {
          cap.setHours(23, 59, 59, 999);
        }
        return plusOneHour.getTime() <= cap.getTime() ? plusOneHour : cap;
      }
      return d;
    }
    case 'tomorrow': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
      return d;
    }
    case 'this_weekend': {
      const day = now.getDay(); // 0 is Sunday, 6 is Saturday
      const daysUntilSaturday = day === 6 ? 7 : 6 - day;
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysUntilSaturday,
        10,
        0,
        0,
        0
      );
      return d;
    }
    case 'next_week': {
      const day = now.getDay();
      const targetStart = weekStartDay === 0 ? 0 : 1;
      const rawDelta = (targetStart - day + 7) % 7;
      const daysUntilStart = rawDelta === 0 ? 7 : rawDelta;
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysUntilStart,
        9,
        0,
        0,
        0
      );
      return d;
    }
    default:
      return null;
  }
}

/**
 * Postpones a task's due date by `days` calendar days:
 * - If `currentDueIso` is in the future, shifts that date forward while keeping its exact local time.
 * - If `currentDueIso` is overdue or unset, advances `days` from `now` while preserving any non-midnight time set on `currentDueIso` (or defaulting to 9:00 AM).
 */
export function postponeDateByDays(
  currentDueIso: string | null | undefined,
  days: number,
  now: Date = new Date()
): Date {
  const norm = normalizeVikunjaDate(currentDueIso);
  const existing = norm ? new Date(norm) : null;

  if (existing && !isNaN(existing.getTime()) && existing.getTime() > now.getTime()) {
    const shifted = new Date(existing.getTime());
    shifted.setDate(shifted.getDate() + days);
    return shifted;
  }

  let hours = 9;
  let minutes = 0;
  if (
    existing &&
    !isNaN(existing.getTime()) &&
    (existing.getHours() !== 0 || existing.getMinutes() !== 0)
  ) {
    hours = existing.getHours();
    minutes = existing.getMinutes();
  }

  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes, 0, 0);
}
