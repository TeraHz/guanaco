import {
  isZeroDate,
  normalizeVikunjaDate,
  formatDateDisplay,
  isOverdue,
  isDueSoon,
  getDatePreset,
  postponeDateByDays,
  formatIsoForVikunja,
} from '../dates';

describe('dates utils', () => {
  describe('isZeroDate & normalizeVikunjaDate', () => {
    it('detects all Vikunja zero-date variants including non-UTC offsets', () => {
      expect(isZeroDate('0001-01-01T00:00:00Z')).toBe(true);
      expect(isZeroDate('0001-01-01T00:00:00.000Z')).toBe(true);
      expect(isZeroDate('0001-01-01T01:00:00+01:00')).toBe(true);
      expect(isZeroDate('0001-01-01T09:00:00+09:00')).toBe(true);
      expect(isZeroDate('0001-01-01 00:00:00')).toBe(true);
      expect(isZeroDate('0000-12-31T19:00:00-05:00')).toBe(true);

      expect(isZeroDate(null)).toBe(false);
      expect(isZeroDate(undefined)).toBe(false);
      expect(isZeroDate('')).toBe(false);
      expect(isZeroDate('2026-10-15T14:30:00Z')).toBe(false);
    });

    it('returns null for null, undefined, empty string or whitespace', () => {
      expect(normalizeVikunjaDate(null)).toBeNull();
      expect(normalizeVikunjaDate(undefined)).toBeNull();
      expect(normalizeVikunjaDate('')).toBeNull();
      expect(normalizeVikunjaDate('   ')).toBeNull();
    });

    it('returns null for Vikunja zero-dates across UTC and non-UTC offsets', () => {
      expect(normalizeVikunjaDate('0001-01-01T00:00:00Z')).toBeNull();
      expect(normalizeVikunjaDate('0001-01-01T00:00:00.000Z')).toBeNull();
      expect(normalizeVikunjaDate('0001-01-01T01:00:00+01:00')).toBeNull();
      expect(normalizeVikunjaDate('0000-12-31T16:00:00-08:00')).toBeNull();
    });

    it('returns the ISO string for valid UTC, -08:00, and +09:00 dates', () => {
      expect(normalizeVikunjaDate('2026-10-15T14:30:00.000Z')).toBe('2026-10-15T14:30:00.000Z');
      expect(normalizeVikunjaDate('2026-10-15T10:00:00-08:00')).toBe('2026-10-15T18:00:00.000Z');
      expect(normalizeVikunjaDate('2026-10-16T03:00:00+09:00')).toBe('2026-10-15T18:00:00.000Z');
    });

    it('returns null for invalid date strings', () => {
      expect(normalizeVikunjaDate('not-a-date')).toBeNull();
    });
  });

  describe('formatDateDisplay', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 9, 7, 12, 0, 0, 0));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns empty string when date is null, invalid, or non-UTC zero-date', () => {
      expect(formatDateDisplay(null)).toBe('');
      expect(formatDateDisplay('0001-01-01T00:00:00Z')).toBe('');
      expect(formatDateDisplay('0001-01-01T01:00:00+01:00')).toBe('');
    });

    it('formats today correctly', () => {
      const todayIso = new Date(2026, 9, 7, 18, 0, 0, 0).toISOString();
      expect(formatDateDisplay(todayIso)).toContain('Today');
    });

    it('formats tomorrow correctly', () => {
      const tomorrowIso = new Date(2026, 9, 8, 9, 0, 0, 0).toISOString();
      expect(formatDateDisplay(tomorrowIso)).toContain('Tomorrow');
    });

    it('formats yesterday correctly', () => {
      const yesterdayIso = new Date(2026, 9, 6, 15, 0, 0, 0).toISOString();
      expect(formatDateDisplay(yesterdayIso)).toContain('Yesterday');
    });

    it('formats distant future dates with month and day (and year when different)', () => {
      const futureSameYear = new Date(2026, 11, 25, 10, 0, 0, 0).toISOString();
      expect(formatDateDisplay(futureSameYear)).toMatch(/Dec\s+25/i);

      const futureDifferentYear = new Date(2028, 11, 25, 0, 0, 0, 0).toISOString();
      expect(formatDateDisplay(futureDifferentYear)).toMatch(/Dec\s+25,\s*2028/i);
    });
  });

  describe('isOverdue', () => {
    const fixedNow = new Date('2026-10-07T12:00:00Z').getTime();

    it('returns false for null or Vikunja zero-date', () => {
      expect(isOverdue(null, fixedNow)).toBe(false);
      expect(isOverdue('0001-01-01T00:00:00Z', fixedNow)).toBe(false);
      expect(isOverdue('0001-01-01T01:00:00+01:00', fixedNow)).toBe(false);
    });

    it('returns true if date is in the past (including negative UTC offsets)', () => {
      expect(isOverdue('2026-10-06T12:00:00Z', fixedNow)).toBe(true);
      expect(isOverdue('2026-10-07T03:00:00-08:00', fixedNow)).toBe(true);
    });

    it('returns false if date is in the future', () => {
      expect(isOverdue('2026-10-08T12:00:00Z', fixedNow)).toBe(false);
    });
  });

  describe('isDueSoon', () => {
    const fixedNow = new Date('2026-10-07T12:00:00Z').getTime();

    it('returns true if due within next 24 hours (including positive UTC offsets)', () => {
      expect(isDueSoon('2026-10-07T18:00:00Z', 24, fixedNow)).toBe(true);
      expect(isDueSoon('2026-10-07T23:00:00+09:00', 24, fixedNow)).toBe(true);
    });

    it('returns false if overdue or more than 24 hours away', () => {
      expect(isDueSoon('2026-10-06T12:00:00Z', 24, fixedNow)).toBe(false);
      expect(isDueSoon('2026-10-10T12:00:00Z', 24, fixedNow)).toBe(false);
    });
  });

  describe('getDatePreset', () => {
    it('computes today evening, tomorrow morning, weekend, and next week', () => {
      const morning = new Date(2026, 9, 7, 10, 0, 0, 0);
      const todayEve = getDatePreset('today', morning)!;
      expect(todayEve.getDate()).toBe(7);
      expect(todayEve.getHours()).toBe(18);

      const tomorrow = getDatePreset('tomorrow', morning)!;
      expect(tomorrow.getDate()).toBe(8);
      expect(tomorrow.getHours()).toBe(9);

      const weekend = getDatePreset('this_weekend', morning)!;
      expect(weekend.getDay()).toBe(6);

      const nextWeek = getDatePreset('next_week', morning)!;
      expect(nextWeek.getDay()).toBe(1);
      expect(nextWeek.getTime()).toBeGreaterThan(todayEve.getTime());
    });

    it('computes 9:00 PM when called between 6:00 PM and 9:00 PM', () => {
      const earlyEve = new Date(2026, 9, 7, 19, 30, 0, 0);
      const res = getDatePreset('today', earlyEve)!;
      expect(res.getDate()).toBe(7);
      expect(res.getHours()).toBe(21);
    });

    it('NEVER returns a past timestamp when called after 9:00 PM (caps within today)', () => {
      const nineThirtyPm = new Date(2026, 9, 7, 21, 30, 0, 0);
      const res1 = getDatePreset('today', nineThirtyPm)!;
      expect(res1.getDate()).toBe(7);
      expect(res1.getHours()).toBe(22);
      expect(res1.getMinutes()).toBe(30);
      expect(res1.getTime()).toBeGreaterThan(nineThirtyPm.getTime());

      const elevenThirtyPm = new Date(2026, 9, 7, 23, 30, 0, 0);
      const res2 = getDatePreset('today', elevenThirtyPm)!;
      expect(res2.getDate()).toBe(7);
      expect(res2.getHours()).toBe(23);
      expect(res2.getMinutes()).toBe(59);
      expect(res2.getTime()).toBeGreaterThan(elevenThirtyPm.getTime());

      const almostMidnight = new Date(2026, 9, 7, 23, 59, 30, 0);
      const res3 = getDatePreset('today', almostMidnight)!;
      expect(res3.getDate()).toBe(7);
      expect(res3.getTime()).toBeGreaterThan(almostMidnight.getTime());
    });

    it('respects configurable weekStartDay (0 = Sunday, 1 = Monday) for next_week', () => {
      // Wednesday Oct 7, 2026
      const wed = new Date(2026, 9, 7, 10, 0, 0, 0);
      const nextMonday = getDatePreset('next_week', wed, 1)!;
      expect(nextMonday.getDay()).toBe(1);
      expect(nextMonday.getDate()).toBe(12);

      const nextSunday = getDatePreset('next_week', wed, 0)!;
      expect(nextSunday.getDay()).toBe(0);
      expect(nextSunday.getDate()).toBe(11);

      // When called ON Sunday with weekStartDay = 0, advances a full 7 days to next Sunday
      const sun = new Date(2026, 9, 11, 10, 0, 0, 0);
      const followingSunday = getDatePreset('next_week', sun, 0)!;
      expect(followingSunday.getDay()).toBe(0);
      expect(followingSunday.getDate()).toBe(18);
    });
  });

  describe('postponeDateByDays', () => {
    it('shifts future due dates forward while preserving exact local time of day', () => {
      const now = new Date(2026, 9, 7, 10, 0, 0, 0);
      const futureDue = new Date(2026, 9, 9, 14, 45, 0, 0).toISOString();
      const shifted = postponeDateByDays(futureDue, 3, now);
      expect(shifted.getFullYear()).toBe(2026);
      expect(shifted.getMonth()).toBe(9);
      expect(shifted.getDate()).toBe(12);
      expect(shifted.getHours()).toBe(14);
      expect(shifted.getMinutes()).toBe(45);
    });

    it('advances from today when overdue or unset, preserving custom time if present or defaulting to 9:00 AM', () => {
      const now = new Date(2026, 9, 7, 11, 15, 0, 0);
      const overdueWithTime = new Date(2026, 9, 2, 16, 30, 0, 0).toISOString();
      const fromOverdue = postponeDateByDays(overdueWithTime, 2, now);
      expect(fromOverdue.getDate()).toBe(9);
      expect(fromOverdue.getHours()).toBe(16);
      expect(fromOverdue.getMinutes()).toBe(30);

      const fromUnset = postponeDateByDays(null, 7, now);
      expect(fromUnset.getDate()).toBe(14);
      expect(fromUnset.getHours()).toBe(9);
      expect(fromUnset.getMinutes()).toBe(0);
    });
  });

  describe('formatIsoForVikunja', () => {
    it('returns ISO string for valid dates and null for empty/zero dates', () => {
      const d = new Date('2026-10-07T15:30:00Z');
      expect(formatIsoForVikunja(d)).toBe('2026-10-07T15:30:00.000Z');
      expect(formatIsoForVikunja(new Date('0001-01-01T00:00:00Z'))).toBeNull();
      expect(formatIsoForVikunja('0001-01-01T01:00:00+01:00')).toBeNull();
      expect(formatIsoForVikunja(null)).toBeNull();
      expect(formatIsoForVikunja(undefined)).toBeNull();
    });
  });
});
