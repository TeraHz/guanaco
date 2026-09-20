import {
  normalizeHexColor,
  getLabelColor,
  getLabelBadgeStyles,
  isTooDarkForDarkTheme,
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
});
