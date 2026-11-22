import {
  secondsToInterval,
  intervalToSeconds,
  formatRepeatDescription,
  REPEAT_PRESETS,
} from '../repeat';
import { RepeatMode } from '../../types/vikunja';

describe('repeat utils', () => {
  describe('intervalToSeconds & secondsToInterval', () => {
    it('converts sub-hour intervals (minutes & seconds) accurately instead of rounding to 1 day', () => {
      expect(secondsToInterval(1800)).toEqual({ amount: 30, unit: 'minutes' });
      expect(secondsToInterval(60)).toEqual({ amount: 1, unit: 'minutes' });
      expect(secondsToInterval(45)).toEqual({ amount: 45, unit: 'seconds' });
      expect(intervalToSeconds(30, 'minutes')).toBe(1800);
    });

    it('converts hours correctly', () => {
      const sec = intervalToSeconds(3, 'hours');
      expect(sec).toBe(3 * 3600);
      expect(secondsToInterval(sec)).toEqual({ amount: 3, unit: 'hours' });
    });

    it('converts days correctly', () => {
      const sec = intervalToSeconds(2, 'days');
      expect(sec).toBe(2 * 86400);
      expect(secondsToInterval(sec)).toEqual({ amount: 2, unit: 'days' });
    });

    it('converts weeks correctly', () => {
      const sec = intervalToSeconds(1, 'weeks');
      expect(sec).toBe(604800);
      expect(secondsToInterval(sec)).toEqual({ amount: 1, unit: 'weeks' });
    });

    it('converts months (30-day base) and years correctly while guarding Object.prototype keys', () => {
      const sec = intervalToSeconds(1, 'months');
      expect(sec).toBe(2592000);
      expect(secondsToInterval(sec)).toEqual({ amount: 1, unit: 'months' });
      expect(secondsToInterval(intervalToSeconds(1, 'years'))).toEqual({ amount: 1, unit: 'years' });
      expect(intervalToSeconds(2, 'constructor' as any)).toBe(2 * 86400);
    });

    it('keeps week multiples like 30 weeks (210 days) as weeks unless RepeatMode.Monthly is set', () => {
      const thirtyWeeksSec = 30 * 604800;
      expect(secondsToInterval(thirtyWeeksSec)).toEqual({ amount: 30, unit: 'weeks' });
      expect(secondsToInterval(thirtyWeeksSec, RepeatMode.FromDueDate)).toEqual({
        amount: 30,
        unit: 'weeks',
      });
      expect(secondsToInterval(thirtyWeeksSec, RepeatMode.Monthly)).toEqual({
        amount: 7,
        unit: 'months',
      });
    });

    it('handles 0, negative, or missing seconds (while preserving RepeatMode.Monthly)', () => {
      expect(secondsToInterval(0)).toBeNull();
      expect(secondsToInterval(-60)).toBeNull();
      expect(secondsToInterval(undefined)).toBeNull();
      expect(secondsToInterval(0, RepeatMode.FromCompletion)).toBeNull();
      expect(secondsToInterval(0, RepeatMode.Monthly)).toEqual({ amount: 1, unit: 'months' });
      expect(secondsToInterval(undefined, RepeatMode.Monthly)).toEqual({
        amount: 1,
        unit: 'months',
      });
    });
  });

  describe('formatRepeatDescription', () => {
    it('returns "Never" when repeatAfter is 0 or undefined (except RepeatMode.Monthly)', () => {
      expect(formatRepeatDescription(0)).toBe('Never');
      expect(formatRepeatDescription(undefined)).toBe('Never');
      expect(formatRepeatDescription(0, RepeatMode.FromCompletion)).toBe('Never');
    });

    it('formats preset intervals: daily, weekly', () => {
      expect(formatRepeatDescription(86400, RepeatMode.FromDueDate)).toBe('Daily');
      expect(formatRepeatDescription(604800, RepeatMode.FromDueDate)).toBe('Weekly');
    });

    it('formats monthly repeat with RepeatMode.Monthly (1), including server repeat_after=0', () => {
      expect(formatRepeatDescription(2592000, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(0, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(undefined, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(86400, RepeatMode.Monthly)).toBe('Monthly');
      expect(formatRepeatDescription(2 * 2592000, RepeatMode.Monthly)).toBe('Every 2 months');
    });

    it('formats sub-hour and week-multiple intervals accurately', () => {
      expect(formatRepeatDescription(1800, RepeatMode.FromDueDate)).toBe('Every 30 minutes');
      expect(formatRepeatDescription(60, RepeatMode.FromDueDate)).toBe('Every minute');
      expect(formatRepeatDescription(30 * 604800, RepeatMode.FromDueDate)).toBe('Every 30 weeks');
      expect(formatRepeatDescription(30 * 604800, RepeatMode.Monthly)).toBe('Every 7 months');
    });

    it('formats repeat from completion date (repeatMode 2)', () => {
      expect(formatRepeatDescription(86400, RepeatMode.FromCompletion)).toBe(
        'Daily (from completion)'
      );
      expect(formatRepeatDescription(604800, RepeatMode.FromCompletion)).toBe(
        'Weekly (from completion)'
      );
      expect(formatRepeatDescription(3 * 86400, RepeatMode.FromCompletion)).toBe(
        'Every 3 days (from completion)'
      );
    });

    it('formats custom intervals', () => {
      expect(formatRepeatDescription(14 * 86400, 0)).toBe('Every 2 weeks');
      expect(formatRepeatDescription(5 * 86400, 0)).toBe('Every 5 days');
      expect(formatRepeatDescription(12 * 3600, 0)).toBe('Every 12 hours');
      expect(formatRepeatDescription(31536000, 0)).toBe('Every year');
    });
  });

  describe('REPEAT_PRESETS', () => {
    it('provides standard presets with Monthly using RepeatMode.Monthly (1)', () => {
      expect(REPEAT_PRESETS).toHaveLength(5);
      expect(REPEAT_PRESETS.map((p) => p.label)).toEqual([
        'Never',
        'Daily',
        'Weekly',
        'Monthly',
        'Custom...',
      ]);
      expect(REPEAT_PRESETS.find((p) => p.label === 'Monthly')?.repeatMode).toBe(
        RepeatMode.Monthly
      );
    });
  });
});
