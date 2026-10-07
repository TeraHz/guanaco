import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

export const STORAGE_KEY_AUTH_TOKEN = '@vikunja_auth_token';
export const SECURE_KEY_AUTH_TOKEN = 'vikunja_auth_token';
export const SECURE_KEY_USERNAME = 'vikunja_auth_username';
export const SECURE_KEY_PASSWORD = 'vikunja_auth_password';
export const STORAGE_KEY_SERVER_URL = '@vikunja_server_url';
export const STORAGE_KEY_BIOMETRIC_ENABLED = '@vikunja_biometric_enabled';

async function isSecureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch (_) {
    return false;
  }
}

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
  reason = 'Unlock Guanaco'
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

export interface StoredAuth {
  token: string | null;
  serverUrl: string | null;
  username: string | null;
  password: string | null;
}

export async function getStoredAuth(): Promise<StoredAuth> {
  try {
    const serverUrl = await AsyncStorage.getItem(STORAGE_KEY_SERVER_URL);
    let token: string | null = null;
    let username: string | null = null;
    let password: string | null = null;

    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      token = await SecureStore.getItemAsync(SECURE_KEY_AUTH_TOKEN);
      username = await SecureStore.getItemAsync(SECURE_KEY_USERNAME);
      password = await SecureStore.getItemAsync(SECURE_KEY_PASSWORD);

      if (!token) {
        // Check for legacy token in AsyncStorage and migrate if found
        const legacyToken = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        if (legacyToken) {
          token = legacyToken;
          await SecureStore.setItemAsync(SECURE_KEY_AUTH_TOKEN, legacyToken);
          await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
        }
      }
    } else {
      token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      username = await AsyncStorage.getItem('@vikunja_username');
      password = await AsyncStorage.getItem('@vikunja_password');
    }

    // Fallback to legacy stored username in AsyncStorage if not yet in SecureStore
    if (!username) {
      username = await AsyncStorage.getItem('@vikunja_username');
    }

    return { token, serverUrl, username, password };
  } catch (_) {
    return { token: null, serverUrl: null, username: null, password: null };
  }
}

export async function setStoredAuth(
  token: string,
  serverUrl: string,
  username?: string,
  password?: string
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, serverUrl);
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      await SecureStore.setItemAsync(SECURE_KEY_AUTH_TOKEN, token);
      await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);

      if (username) {
        await SecureStore.setItemAsync(SECURE_KEY_USERNAME, username);
      }
      if (password) {
        await SecureStore.setItemAsync(SECURE_KEY_PASSWORD, password);
      }
    } else {
      await AsyncStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token);
      if (username) {
        await AsyncStorage.setItem('@vikunja_username', username);
      }
      if (password) {
        await AsyncStorage.setItem('@vikunja_password', password);
      }
    }
  } catch (_) {}
}

export async function clearStoredAuth(): Promise<void> {
  try {
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      await SecureStore.deleteItemAsync(SECURE_KEY_AUTH_TOKEN);
      await SecureStore.deleteItemAsync(SECURE_KEY_USERNAME);
      await SecureStore.deleteItemAsync(SECURE_KEY_PASSWORD);
    }
    await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    await AsyncStorage.removeItem('@vikunja_password');
  } catch (_) {}
}

