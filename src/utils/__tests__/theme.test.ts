import { getThemeTokens } from '../theme';

describe('theme utility', () => {
  it('returns appropriate dark theme tokens', () => {
    const tokens = getThemeTokens('dark');
    expect(tokens.isDark).toBe(true);
    expect(tokens.colors.background).toBe('#0D0D0E');
    expect(tokens.colors.card).toBe('#1C1C1E');
    expect(tokens.colors.text).toBe('#FFFFFF');
    expect(tokens.colors.border).toBe('#2C2C2E');
  });

  it('returns appropriate light theme tokens', () => {
    const tokens = getThemeTokens('light');
    expect(tokens.isDark).toBe(false);
    expect(tokens.colors.background).toBe('#F2F2F7');
    expect(tokens.colors.card).toBe('#FFFFFF');
    expect(tokens.colors.text).toBe('#000000');
    expect(tokens.colors.border).toBe('#E5E5EA');
  });

  it('defaults to dark theme when scheme is null or unspecified', () => {
    const tokens = getThemeTokens(null);
    expect(tokens.isDark).toBe(true);
    expect(tokens.colors.background).toBe('#0D0D0E');
  });
});
