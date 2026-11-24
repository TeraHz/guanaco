import { useSyncExternalStore } from 'react';
import { useColorScheme, ColorSchemeName } from 'react-native';
import { ThemeMode } from '../types/vikunja';

export type { ThemeMode };

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
  isOled?: boolean;
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

const OLED_COLORS: ThemeColors = {
  background: '#000000',
  card: '#0A0A0C',
  cardBackground: '#0A0A0C',
  cardSecondary: '#141417',
  surfaceSecondary: '#1C1C1E',
  secondaryButtonBg: '#1C1C1E',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#8E8E93',
  placeholder: '#8E8E93',
  checkboxBorder: '#A1A1AA',
  border: '#222226',
  cardBorder: '#222226',
  borderStrong: '#3A3A3E',
  inputBg: '#141417',
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

let activeThemeMode: ThemeMode = 'system';
const themeListeners = new Set<() => void>();

export function setActiveThemeMode(mode: ThemeMode): void {
  const valid: ThemeMode =
    mode === 'light' || mode === 'dark' || mode === 'oled' || mode === 'system'
      ? mode
      : 'system';
  if (activeThemeMode !== valid) {
    activeThemeMode = valid;
    themeListeners.forEach((listener) => listener());
  }
}

export function getActiveThemeMode(): ThemeMode {
  return activeThemeMode;
}

function subscribeThemeMode(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function getThemeTokens(
  scheme?: ColorSchemeName | null,
  themeMode: ThemeMode = 'system'
): ThemeTokens {
  if (themeMode === 'oled') {
    return {
      isDark: true,
      isOled: true,
      colors: OLED_COLORS,
    };
  }
  if (themeMode === 'light') {
    return {
      isDark: false,
      isOled: false,
      colors: LIGHT_COLORS,
    };
  }
  if (themeMode === 'dark') {
    return {
      isDark: true,
      isOled: false,
      colors: DARK_COLORS,
    };
  }

  const isDark = scheme !== 'light';
  return {
    isDark,
    isOled: false,
    colors: isDark ? DARK_COLORS : LIGHT_COLORS,
  };
}

export function useAppTheme(): ThemeTokens {
  const scheme = useColorScheme();
  const mode = useSyncExternalStore(subscribeThemeMode, getActiveThemeMode, getActiveThemeMode);
  return getThemeTokens(scheme, mode);
}
