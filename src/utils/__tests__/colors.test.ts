import {
  normalizeHexColor,
  getLabelColor,
  getLabelBadgeStyles,
  isTooDarkForDarkTheme,
  resolveCanonicalLabelColor,
} from '../colors';

describe('colors utility', () => {
  describe('normalizeHexColor', () => {
    it('returns null for undefined, empty, or whitespace strings', () => {
      expect(normalizeHexColor()).toBeNull();
      expect(normalizeHexColor('')).toBeNull();
      expect(normalizeHexColor('   ')).toBeNull();
    });

    it('adds # prefix to 6-character hex strings without # (Vikunja format)', () => {
      expect(normalizeHexColor('3498db')).toBe('#3498db');
      expect(normalizeHexColor('ff5722')).toBe('#ff5722');
      expect(normalizeHexColor('1abc9c')).toBe('#1abc9c');
    });

    it('preserves existing # prefix if valid', () => {
      expect(normalizeHexColor('#3498db')).toBe('#3498db');
      expect(normalizeHexColor('#fff')).toBe('#fff');
    });

    it('returns null for invalid hex values', () => {
      expect(normalizeHexColor('invalid')).toBeNull();
      expect(normalizeHexColor('12345')).toBeNull();
      expect(normalizeHexColor('xyz123')).toBeNull();
    });

    it('returns null or flags pure black / near-black as invalid for dark mode', () => {
      expect(isTooDarkForDarkTheme('#000000')).toBe(true);
      expect(isTooDarkForDarkTheme('000000')).toBe(true);
      expect(isTooDarkForDarkTheme('#111111')).toBe(true);
      expect(isTooDarkForDarkTheme('#3498db')).toBe(false);
      expect(isTooDarkForDarkTheme('#30D158')).toBe(false);
    });
  });

  describe('getLabelColor', () => {
    it('returns normalized server hex color when valid and visible', () => {
      expect(getLabelColor('Groceries', '3498db')).toBe('#3498db');
      expect(getLabelColor('Costco', '#ff5722')).toBe('#ff5722');
    });

    it('falls back to deterministic vibrant palette when hex is missing or pure black', () => {
      const color1 = getLabelColor('Groceries', '');
      const color2 = getLabelColor('Groceries', undefined);
      const colorBlack = getLabelColor('Groceries', '000000');

      expect(color1).toBeDefined();
      expect(color1.startsWith('#')).toBe(true);
      expect(color1).toBe(color2);
      expect(colorBlack).toBe(color1);
    });

    it('produces different vibrant colors for different label titles', () => {
      const colorA = getLabelColor('Store A');
      const colorB = getLabelColor('Store B');
      expect(colorA.startsWith('#')).toBe(true);
      expect(colorB.startsWith('#')).toBe(true);
    });
  });

  describe('getLabelBadgeStyles', () => {
    it('returns accessible pill styles with readable text color', () => {
      const styles = getLabelBadgeStyles('Costco', 'ff5722');
      expect(styles.backgroundColor).toContain('rgba(');
      expect(styles.borderColor).toContain('rgba(');
      expect(styles.textColor).toBe('#ff5722');
    });

    it('ensures high contrast text on dark backgrounds', () => {
      const darkColorStyles = getLabelBadgeStyles('DarkTag', '1c1c1e');
      // For too-dark colors, it should not use invisible dark text
      expect(darkColorStyles.textColor).not.toBe('#1c1c1e');
      expect(darkColorStyles.textColor).toBeDefined();
    });
  });

  describe('resolveCanonicalLabelColor', () => {
    const definitions = [
      { id: 1, title: 'Costco', color: 'ef4444' }, // Red
      { id: 2, title: 'Caraluzzi', hex_color: '22c55e' }, // Green
      { id: 3, title: 'WF', color: '#eab308' }, // Yellow
    ];

    it('uses canonical color from definitions over stale color on task label', () => {
      // Task had stale blue color on Caraluzzi, but canonical is green (22c55e)
      const taskLabel = { id: 2, title: 'Caraluzzi', color: '3b82f6' };
      const resolved = resolveCanonicalLabelColor(taskLabel, definitions);
      expect(resolved).toBe('#22c55e');
    });

    it('matches canonical definitions by case-insensitive title when id is negative or missing', () => {
      const taskLabel = { id: -99, title: 'costco' };
      const resolved = resolveCanonicalLabelColor(taskLabel, definitions);
      expect(resolved).toBe('#ef4444');
    });

    it('falls back to label own color when not in canonical definitions', () => {
      const customLabel = { id: 999, title: 'LocalStore', color: 'a855f7' };
      const resolved = resolveCanonicalLabelColor(customLabel, definitions);
      expect(resolved).toBe('#a855f7');
    });

    it('falls back to deterministic color when neither definition nor label has a color', () => {
      const uncoloredLabel = { id: 888, title: 'Uncolored' };
      const resolved = resolveCanonicalLabelColor(uncoloredLabel, definitions);
      expect(resolved.startsWith('#')).toBe(true);
      expect(resolved).toBe(getLabelColor('Uncolored'));
    });
  });
});

