import {
  secondsToInterval,
  intervalToSeconds,
  formatRepeatDescription,
  REPEAT_PRESETS,
} from '../repeat';

describe('repeat utils', () => {
  describe('intervalToSeconds & secondsToInterval', () => {
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

    it('converts months (30-day base) correctly', () => {
      const sec = intervalToSeconds(1, 'months');
      expect(sec).toBe(2592000);
      expect(secondsToInterval(sec)).toEqual({ amount: 1, unit: 'months' });
    });

    it('handles 0 or negative seconds', () => {
      expect(secondsToInterval(0)).toBeNull();
      expect(secondsToInterval(undefined)).toBeNull();
    });
  });

  describe('formatRepeatDescription', () => {
    it('returns "Never" when repeatAfter is 0 or undefined', () => {
      expect(formatRepeatDescription(0)).toBe('Never');
      expect(formatRepeatDescription(undefined)).toBe('Never');
    });

    it('formats preset intervals: daily, weekly', () => {
      expect(formatRepeatDescription(86400, 0)).toBe('Daily');
      expect(formatRepeatDescription(604800, 0)).toBe('Weekly');
    });

    it('formats monthly repeat with repeatMode 1', () => {
      expect(formatRepeatDescription(2592000, 1)).toBe('Monthly');
    });

    it('formats repeat from completion date (repeatMode 2)', () => {
      expect(formatRepeatDescription(86400, 2)).toBe('Daily (from completion)');
      expect(formatRepeatDescription(604800, 2)).toBe('Weekly (from completion)');
      expect(formatRepeatDescription(3 * 86400, 2)).toBe('Every 3 days (from completion)');
    });

    it('formats custom intervals', () => {
      expect(formatRepeatDescription(14 * 86400, 0)).toBe('Every 2 weeks');
      expect(formatRepeatDescription(5 * 86400, 0)).toBe('Every 5 days');
      expect(formatRepeatDescription(12 * 3600, 0)).toBe('Every 12 hours');
    });
  });

  describe('REPEAT_PRESETS', () => {
    it('provides standard presets', () => {
      expect(REPEAT_PRESETS).toHaveLength(5);
      expect(REPEAT_PRESETS.map((p) => p.label)).toEqual([
        'Never',
        'Daily',
        'Weekly',
        'Monthly',
        'Custom...',
      ]);
    });
  });
});
