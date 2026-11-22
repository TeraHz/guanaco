import { useColorScheme, ColorSchemeName } from 'react-native';

export interface ThemeColors {
  background: string;
  card: string;
  cardBackground: string;
  cardSecondary: string;
  surfaceSecondary: string;
  secondaryButtonBg: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  placeholder: string;
  checkboxBorder: string;
  border: string;
  cardBorder: string;
  borderStrong: string;
  inputBg: string;
  accent: string;
  success: string;
  danger: string;
  warning: string;
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
  surfaceSecondary: '#2C2C2E',
  secondaryButtonBg: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#8E8E93',
  placeholder: '#8E8E93',
  checkboxBorder: '#A1A1AA',
  border: '#2C2C2E',
  cardBorder: '#2C2C2E',
  borderStrong: '#3F3F46',
  inputBg: '#2C2C2E',
  accent: '#0A84FF',
  success: '#30D158',
  danger: '#FF453A',
  warning: '#FF9F0A',
};

const LIGHT_COLORS: ThemeColors = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  cardBackground: '#FFFFFF',
  cardSecondary: '#F9F9FB',
  surfaceSecondary: '#E5E5EA',
  secondaryButtonBg: '#E5E5EA',
  text: '#000000',
  textSecondary: '#52525B',
  textTertiary: '#71717A',
  placeholder: '#71717A',
  checkboxBorder: '#71717A',
  border: '#E5E5EA',
  cardBorder: '#E5E5EA',
  borderStrong: '#D1D1D6',
  inputBg: '#E5E5EA',
  accent: '#007AFF',
  success: '#248A3D',
  danger: '#D70015',
  warning: '#B25000',
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
