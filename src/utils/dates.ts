/**
 * Date normalization, formatting, and preset utilities for Vikunja dates.
 */

const VIKUNJA_ZERO_DATE_PREFIX = '0001-01-01';

/**
 * Normalizes a Vikunja date. Converts zero-dates ('0001-01-01...'), invalid dates, or empty strings to null.
 */
export function normalizeVikunjaDate(dateStr?: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.startsWith(VIKUNJA_ZERO_DATE_PREFIX)) return null;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

/**
 * Formats a Date object or ISO string to ISO string for sending to Vikunja, or null if empty.
 */
export function formatIsoForVikunja(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  if (typeof date === 'string') return normalizeVikunjaDate(date);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Checks if a date is in the past.
 */
export function isOverdue(dateStr?: string | null): boolean {
  const norm = normalizeVikunjaDate(dateStr);
  if (!norm) return false;
  return new Date(norm).getTime() < Date.now();
}

/**
 * Checks if a date is within the next `hoursAhead` hours and not overdue.
 */
export function isDueSoon(dateStr?: string | null, hoursAhead = 24): boolean {
  const norm = normalizeVikunjaDate(dateStr);
  if (!norm) return false;
  const now = Date.now();
  const time = new Date(norm).getTime();
  const diffMs = time - now;
  return diffMs > 0 && diffMs <= hoursAhead * 60 * 60 * 1000;
}

/**
 * Returns formatted human-readable date display (e.g. "Today, 5:00 PM", "Tomorrow", "Oct 15, 2026").
 */
export function formatDateDisplay(
  dateStr?: string | null,
  options?: { includeTime?: boolean }
): string {
  const norm = normalizeVikunjaDate(dateStr);
  if (!norm) return '';

  const d = new Date(norm);
  const now = new Date();

  // Normalize to local calendar day comparison
  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  let dayLabel = '';
  if (isSameDay(d, now)) {
    dayLabel = 'Today';
  } else if (isSameDay(d, tomorrow)) {
    dayLabel = 'Tomorrow';
  } else if (isSameDay(d, yesterday)) {
    dayLabel = 'Yesterday';
  } else {
    const isCurrentYear = d.getFullYear() === now.getFullYear();
    const monthName = d.toLocaleDateString(undefined, { month: 'short' });
    dayLabel = isCurrentYear
      ? `${monthName} ${d.getDate()}`
      : `${monthName} ${d.getDate()}, ${d.getFullYear()}`;
  }

  const includeTime = options?.includeTime ?? true;
  // Check if date has non-zero time (or includeTime is explicitly requested)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;

  if (includeTime && hasTime) {
    const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${dayLabel}, ${timeStr}`;
  }

  return dayLabel;
}

export type DatePresetKey = 'today' | 'tomorrow' | 'this_weekend' | 'next_week';

/**
 * Calculates pre-defined date targets for quick date picking.
 */
export function getDatePreset(preset: DatePresetKey): Date | null {
  const now = new Date();

  switch (preset) {
    case 'today': {
      const d = new Date(now);
      d.setHours(18, 0, 0, 0); // 6:00 PM
      if (d.getTime() <= now.getTime()) {
        d.setHours(21, 0, 0, 0); // 9:00 PM if already past 6 PM
      }
      return d;
    }
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0); // 9:00 AM
      return d;
    }
    case 'this_weekend': {
      const d = new Date(now);
      const day = d.getDay(); // 0 is Sunday, 6 is Saturday
      const daysUntilSaturday = day === 6 ? 7 : (6 - day);
      d.setDate(d.getDate() + daysUntilSaturday);
      d.setHours(10, 0, 0, 0); // 10:00 AM
      return d;
    }
    case 'next_week': {
      const d = new Date(now);
      const day = d.getDay();
      // Next Monday
      const daysUntilMonday = day === 0 ? 1 : (8 - day);
      d.setDate(d.getDate() + daysUntilMonday);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    default:
      return null;
  }
}
