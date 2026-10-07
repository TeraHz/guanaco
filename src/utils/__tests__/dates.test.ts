import {
  normalizeVikunjaDate,
  formatDateDisplay,
  isOverdue,
  isDueSoon,
  getDatePreset,
  formatIsoForVikunja,
} from '../dates';

describe('dates utils', () => {
  describe('normalizeVikunjaDate', () => {
    it('returns null for null, undefined, empty string or whitespace', () => {
      expect(normalizeVikunjaDate(null)).toBeNull();
      expect(normalizeVikunjaDate(undefined)).toBeNull();
      expect(normalizeVikunjaDate('')).toBeNull();
      expect(normalizeVikunjaDate('   ')).toBeNull();
    });

    it('returns null for Vikunja zero-date "0001-01-01T00:00:00Z"', () => {
      expect(normalizeVikunjaDate('0001-01-01T00:00:00Z')).toBeNull();
      expect(normalizeVikunjaDate('0001-01-01T00:00:00.000Z')).toBeNull();
    });

    it('returns the ISO string for valid dates', () => {
      const valid = '2026-10-15T14:30:00.000Z';
      expect(normalizeVikunjaDate(valid)).toBe(new Date(valid).toISOString());
    });

    it('returns null for invalid date strings', () => {
      expect(normalizeVikunjaDate('not-a-date')).toBeNull();
    });
  });

  describe('formatDateDisplay', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('returns empty string when date is null or invalid', () => {
      expect(formatDateDisplay(null)).toBe('');
      expect(formatDateDisplay('0001-01-01T00:00:00Z')).toBe('');
    });

    it('formats today correctly', () => {
      const todayIso = new Date('2026-10-07T18:00:00Z').toISOString();
      expect(formatDateDisplay(todayIso)).toContain('Today');
    });

    it('formats tomorrow correctly', () => {
      const tomorrowIso = new Date('2026-10-08T09:00:00Z').toISOString();
      expect(formatDateDisplay(tomorrowIso)).toContain('Tomorrow');
    });

    it('formats yesterday correctly', () => {
      const yesterdayIso = new Date('2026-10-06T15:00:00Z').toISOString();
      expect(formatDateDisplay(yesterdayIso)).toContain('Yesterday');
    });

    it('formats distant future dates with month and day', () => {
      const futureIso = new Date('2026-12-25T10:00:00Z').toISOString();
      const formatted = formatDateDisplay(futureIso);
      expect(formatted).toMatch(/Dec/i);
    });
  });

  describe('isOverdue', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('returns false for null or Vikunja zero-date', () => {
      expect(isOverdue(null)).toBe(false);
      expect(isOverdue('0001-01-01T00:00:00Z')).toBe(false);
    });

    it('returns true if date is in the past', () => {
      expect(isOverdue('2026-10-06T12:00:00Z')).toBe(true);
    });

    it('returns false if date is in the future', () => {
      expect(isOverdue('2026-10-08T12:00:00Z')).toBe(false);
    });
  });

  describe('isDueSoon', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('returns true if due within next 24 hours', () => {
      expect(isDueSoon('2026-10-07T18:00:00Z', 24)).toBe(true);
    });

    it('returns false if overdue or more than 24 hours away', () => {
      expect(isDueSoon('2026-10-06T12:00:00Z', 24)).toBe(false); // overdue
      expect(isDueSoon('2026-10-10T12:00:00Z', 24)).toBe(false); // > 24h
    });
  });

  describe('getDatePreset', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('computes today evening, tomorrow morning, and next week', () => {
      const todayEve = getDatePreset('today');
      expect(todayEve).not.toBeNull();
      expect(todayEve!.getDate()).toBe(7);

      const tomorrow = getDatePreset('tomorrow');
      expect(tomorrow!.getDate()).toBe(8);

      const nextWeek = getDatePreset('next_week');
      expect(nextWeek!.getTime()).toBeGreaterThan(todayEve!.getTime());
    });
  });

  describe('formatIsoForVikunja', () => {
    it('returns ISO string or null', () => {
      const d = new Date('2026-10-07T15:30:00Z');
      expect(formatIsoForVikunja(d)).toBe('2026-10-07T15:30:00.000Z');
      expect(formatIsoForVikunja(null)).toBeNull();
      expect(formatIsoForVikunja(undefined)).toBeNull();
    });
  });
});
