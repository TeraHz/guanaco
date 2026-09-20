import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

export const STORAGE_KEY_AUTH_TOKEN = '@vikunja_auth_token';
export const STORAGE_KEY_SERVER_URL = '@vikunja_server_url';
export const STORAGE_KEY_BIOMETRIC_ENABLED = '@vikunja_biometric_enabled';

export async function checkBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return isEnrolled;
  } catch (_) {
    return false;
  }
}

export async function authenticateWithBiometrics(
  reason = 'Unlock Vikunja'
): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Enter PIN / Password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (_) {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY_BIOMETRIC_ENABLED);
    return value === 'true';
  } catch (_) {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
  } catch (_) {}
}

export async function getStoredAuth(): Promise<{ token: string | null; serverUrl: string | null }> {
  try {
    const [token, serverUrl] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN),
      AsyncStorage.getItem(STORAGE_KEY_SERVER_URL),
    ]);
    return { token, serverUrl };
  } catch (_) {
    return { token: null, serverUrl: null };
  }
}

export async function setStoredAuth(token: string, serverUrl: string): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token),
      AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, serverUrl),
    ]);
  } catch (_) {}
}

export async function clearStoredAuth(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
  } catch (_) {}
}
