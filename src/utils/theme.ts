import { useColorScheme, ColorSchemeName } from 'react-native';

export interface ThemeColors {
  background: string;
  card: string;
  cardBackground: string;
  cardSecondary: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  cardBorder: string;
  inputBg: string;
  accent: string;
}

export interface ThemeTokens {
  isDark: boolean;
  colors: ThemeColors;
}

const DARK_COLORS: ThemeColors = {
  background: '#0D0D0E',
  card: '#1C1C1E',
  cardBackground: '#1C1C1E',
  cardSecondary: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
  border: '#2C2C2E',
  cardBorder: '#2C2C2E',
  inputBg: '#2C2C2E',
  accent: '#0A84FF',
};

const LIGHT_COLORS: ThemeColors = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  cardBackground: '#FFFFFF',
  cardSecondary: '#F9F9FB',
  text: '#000000',
  textSecondary: '#6C6C70',
  textTertiary: '#8E8E93',
  border: '#E5E5EA',
  cardBorder: '#E5E5EA',
  inputBg: '#E5E5EA',
  accent: '#007AFF',
};

export function getThemeTokens(scheme?: ColorSchemeName | null): ThemeTokens {
  const isDark = scheme !== 'light';
  return {
    isDark,
    colors: isDark ? DARK_COLORS : LIGHT_COLORS,
  };
}

export function useAppTheme(): ThemeTokens {
  const scheme = useColorScheme();
  return getThemeTokens(scheme);
}
