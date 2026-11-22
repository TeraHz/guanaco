import { getThemeTokens } from '../theme';

describe('theme utility', () => {
  it('returns appropriate dark theme tokens with night-legible contrast and semantic colors', () => {
    const tokens = getThemeTokens('dark');
    expect(tokens.isDark).toBe(true);
    expect(tokens.colors.background).toBe('#0D0D0E');
    expect(tokens.colors.card).toBe('#1C1C1E');
    expect(tokens.colors.surfaceSecondary).toBe('#2C2C2E');
    expect(tokens.colors.secondaryButtonBg).toBe('#2C2C2E');
    expect(tokens.colors.text).toBe('#FFFFFF');
    expect(tokens.colors.textSecondary).toBe('#A1A1AA');
    expect(tokens.colors.textTertiary).toBe('#8E8E93');
    expect(tokens.colors.placeholder).toBe('#8E8E93');
    expect(tokens.colors.checkboxBorder).toBe('#A1A1AA');
    expect(tokens.colors.border).toBe('#2C2C2E');
    expect(tokens.colors.borderStrong).toBe('#3F3F46');
    expect(tokens.colors.accent).toBe('#0A84FF');
    expect(tokens.colors.success).toBe('#30D158');
    expect(tokens.colors.danger).toBe('#FF453A');
    expect(tokens.colors.warning).toBe('#FF9F0A');
  });

  it('returns appropriate light theme tokens with semantic colors', () => {
    const tokens = getThemeTokens('light');
    expect(tokens.isDark).toBe(false);
    expect(tokens.colors.background).toBe('#F2F2F7');
    expect(tokens.colors.card).toBe('#FFFFFF');
    expect(tokens.colors.surfaceSecondary).toBe('#E5E5EA');
    expect(tokens.colors.secondaryButtonBg).toBe('#E5E5EA');
    expect(tokens.colors.text).toBe('#000000');
    expect(tokens.colors.textSecondary).toBe('#52525B');
    expect(tokens.colors.textTertiary).toBe('#71717A');
    expect(tokens.colors.placeholder).toBe('#71717A');
    expect(tokens.colors.checkboxBorder).toBe('#71717A');
    expect(tokens.colors.border).toBe('#E5E5EA');
    expect(tokens.colors.borderStrong).toBe('#D1D1D6');
    expect(tokens.colors.accent).toBe('#007AFF');
    expect(tokens.colors.success).toBe('#248A3D');
    expect(tokens.colors.danger).toBe('#D70015');
    expect(tokens.colors.warning).toBe('#B25000');
  });

  it('defaults to dark theme when scheme is null or unspecified', () => {
    const tokens = getThemeTokens(null);
    expect(tokens.isDark).toBe(true);
    expect(tokens.colors.background).toBe('#0D0D0E');
  });
});
