import {
  normalizeHexColor,
  ensureHexColor,
  hexToRgba,
  getDeterministicColor,
  getLabelColor,
  getLabelBadgeStyles,
  getLuminance,
  isTooDarkForDarkTheme,
  isTooLightForLightTheme,
  resolveCanonicalLabelColor,
} from '../colors';

describe('colors utility', () => {
  describe('normalizeHexColor & ensureHexColor', () => {
    it('returns undefined for undefined, null, empty, or whitespace strings', () => {
      expect(normalizeHexColor()).toBeUndefined();
      expect(normalizeHexColor(null)).toBeUndefined();
      expect(normalizeHexColor('')).toBeUndefined();
      expect(normalizeHexColor('   ')).toBeUndefined();
    });

    it('adds # prefix to 6-character hex strings without # (Vikunja format)', () => {
      expect(normalizeHexColor('3498db')).toBe('#3498db');
      expect(normalizeHexColor('ff5722')).toBe('#ff5722');
      expect(normalizeHexColor('1abc9c')).toBe('#1abc9c');
    });

    it('preserves existing # prefix and 3/8-character hex formats if valid', () => {
      expect(normalizeHexColor('#3498db')).toBe('#3498db');
      expect(normalizeHexColor('#fff')).toBe('#fff');
      expect(normalizeHexColor('3498dbff')).toBe('#3498db');
    });

    it('returns undefined for invalid hex values and fully transparent 8-hex', () => {
      expect(normalizeHexColor('invalid')).toBeUndefined();
      expect(normalizeHexColor('12345')).toBeUndefined();
      expect(normalizeHexColor('xyz123')).toBeUndefined();
      expect(normalizeHexColor('00000000')).toBeUndefined();
    });

    it('supports ignoreBlackDefault to treat Vikunja unset "000000"/"#000000" as undefined', () => {
      expect(normalizeHexColor('000000')).toBe('#000000');
      expect(normalizeHexColor('000000', true)).toBeUndefined();
      expect(normalizeHexColor('#000000', true)).toBeUndefined();
      expect(normalizeHexColor('#000', true)).toBeUndefined();
    });

    it('clamps NaN and out-of-range alpha values in hexToRgba and resolves fallbacks in ensureHexColor', () => {
      expect(ensureHexColor('3498db', '#007AFF', true)).toBe('#3498db');
      expect(ensureHexColor('000000', '#007AFF', true)).toBe('#007AFF');
      expect(hexToRgba('#3498db', Number.NaN)).toBe('rgba(52, 152, 219, 1)');
      expect(hexToRgba('#3498db', 2.5)).toBe('rgba(52, 152, 219, 1)');
      expect(hexToRgba('#3498db', -0.4)).toBe('rgba(52, 152, 219, 0)');
    });

    it('flags pure black / near-black for dark mode and bright yellow/white for light mode', () => {
      expect(isTooDarkForDarkTheme('#000000')).toBe(true);
      expect(isTooDarkForDarkTheme('000000')).toBe(true);
      expect(isTooDarkForDarkTheme('#111111')).toBe(true);
      expect(isTooDarkForDarkTheme('#3498db')).toBe(false);
      expect(isTooDarkForDarkTheme('#30D158')).toBe(false);

      expect(isTooLightForLightTheme('#ffffff')).toBe(true);
      expect(isTooLightForLightTheme('FFD60A')).toBe(true);
      expect(isTooLightForLightTheme('#3498db')).toBe(false);
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

    it('produces deterministic vibrant colors across different label titles', () => {
      const colorA = getDeterministicColor('Store A');
      const colorB = getDeterministicColor('Urgent Produce');
      expect(colorA.startsWith('#')).toBe(true);
      expect(colorB.startsWith('#')).toBe(true);
      expect(getDeterministicColor('Store A')).toBe(colorA);
      expect(colorA).not.toBe(colorB);
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
      const darkColorStyles = getLabelBadgeStyles('DarkTag', '1c1c1e', true);
      expect(darkColorStyles.textColor).not.toBe('#1c1c1e');
      expect(getLuminance(darkColorStyles.textColor)).toBeGreaterThanOrEqual(0.18);
    });

    it('protects contrast on Light Mode so yellow (#FFD60A) and white (#FFFFFF) labels are legible on white cards', () => {
      const yellowLight = getLabelBadgeStyles('Warning', '#FFD60A', false);
      expect(yellowLight.textColor).not.toBe('#FFD60A');
      expect(isTooLightForLightTheme(yellowLight.textColor)).toBe(false);
      expect(getLuminance(yellowLight.textColor)).toBeLessThanOrEqual(0.5);

      const whiteLight = getLabelBadgeStyles(
        { id: 100, title: 'Dairy', hex_color: '#ffffff' },
        [],
        false
      );
      expect(whiteLight.textColor.toLowerCase()).not.toBe('#ffffff');
      expect(isTooLightForLightTheme(whiteLight.textColor)).toBe(false);
    });
  });

  describe('resolveCanonicalLabelColor', () => {
    const definitions = [
      { id: 1, title: 'Costco', color: 'ef4444' },
      { id: 2, title: 'Caraluzzi', hex_color: '22c55e' },
      { id: 3, title: 'WF', color: '#FFD60A' },
    ];

    it('uses canonical color from definitions over stale color on task label', () => {
      const taskLabel = { id: 2, title: 'Caraluzzi', color: '3b82f6' };
      expect(resolveCanonicalLabelColor(taskLabel, definitions, true)).toBe('#22c55e');
    });

    it('matches canonical definitions by case-insensitive title when id is negative or missing', () => {
      const taskLabel = { id: -99, title: 'costco' };
      expect(resolveCanonicalLabelColor(taskLabel, definitions, true)).toBe('#ef4444');
    });

    it('falls back to label own color when not in canonical definitions', () => {
      const customLabel = { id: 999, title: 'LocalStore', color: 'a855f7' };
      expect(resolveCanonicalLabelColor(customLabel, definitions, true)).toBe('#a855f7');
    });

    it('falls back to deterministic color when neither definition nor label has a color', () => {
      const uncoloredLabel = { id: 888, title: 'Uncolored' };
      const resolved = resolveCanonicalLabelColor(uncoloredLabel, definitions, true);
      expect(resolved.startsWith('#')).toBe(true);
      expect(resolved).toBe(getLabelColor('Uncolored'));
    });

    it('adapts bright canonical colors for Light Mode when isDark=false', () => {
      expect(resolveCanonicalLabelColor({ id: 3, title: 'WF' }, definitions, true)).toBe('#FFD60A');
      const wfLight = resolveCanonicalLabelColor({ id: 3, title: 'WF' }, definitions, false);
      expect(isTooLightForLightTheme(wfLight)).toBe(false);
    });
  });
});
