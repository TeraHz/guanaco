import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

export const STORAGE_KEY_AUTH_TOKEN = '@vikunja_auth_token';
export const SECURE_KEY_AUTH_TOKEN = 'vikunja_auth_token';
export const SECURE_KEY_USERNAME = 'vikunja_auth_username';
/** Legacy key — NEVER written; actively purged on read, write, and logout. */
export const SECURE_KEY_PASSWORD = 'vikunja_auth_password';
export const LEGACY_STORAGE_KEY_PASSWORD = '@vikunja_password';
export const STORAGE_KEY_USERNAME = '@vikunja_username';
export const STORAGE_KEY_SAVED_USERNAME = '@vikunja_saved_username';
export const STORAGE_KEY_SERVER_URL = '@vikunja_server_url';
export const STORAGE_KEY_BIOMETRIC_ENABLED = '@vikunja_biometric_enabled';

/**
 * Returns true if the given token is a Vikunja Personal API Token (`tk_...`),
 * which authenticates via Bearer header directly and does NOT use `/user/token` JWT renewal.
 */
export function isPersonalApiToken(token?: string | null): boolean {
  return typeof token === 'string' && token.trim().startsWith('tk_');
}

async function isSecureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch (_) {
    return false;
  }
}

async function setSecureItem(key: string, value: string): Promise<void> {
  if (SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY) {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

/**
 * Actively purges any legacy plaintext password keys from SecureStore, AsyncStorage, and Web localStorage.
 */
async function purgeLegacyPasswords(secureAvailable: boolean): Promise<void> {
  if (secureAvailable) {
    try {
      await SecureStore.deleteItemAsync(SECURE_KEY_PASSWORD);
    } catch (_) {}
  }
  try {
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY_PASSWORD);
  } catch (_) {}
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY_PASSWORD);
      window.localStorage.removeItem(SECURE_KEY_PASSWORD);
    } catch (_) {}
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
  if (Platform.OS === 'web') return false;
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
  /** Always null — plaintext passwords are never persisted. Kept for backward compatibility. */
  password: null;
}

export async function getStoredAuth(): Promise<StoredAuth> {
  try {
    const serverUrl = await AsyncStorage.getItem(STORAGE_KEY_SERVER_URL);
    let token: string | null = null;
    let username: string | null = null;

    const secureAvailable = await isSecureStoreAvailable();
    await purgeLegacyPasswords(secureAvailable);

    if (secureAvailable) {
      try {
        token = await SecureStore.getItemAsync(SECURE_KEY_AUTH_TOKEN);
        username = await SecureStore.getItemAsync(SECURE_KEY_USERNAME);
      } catch (_) {
        token = null;
        username = null;
      }

      if (!token) {
        // Check for legacy token in AsyncStorage and migrate if found
        const legacyToken = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        if (legacyToken) {
          token = legacyToken;
          try {
            await setSecureItem(SECURE_KEY_AUTH_TOKEN, legacyToken);
            await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
          } catch (_) {}
        }
      }
    } else {
      token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      username = await AsyncStorage.getItem(STORAGE_KEY_USERNAME);
    }

    // Fallback to stored username in AsyncStorage if not yet in SecureStore
    if (!username) {
      username =
        (await AsyncStorage.getItem(STORAGE_KEY_USERNAME)) ||
        (await AsyncStorage.getItem(STORAGE_KEY_SAVED_USERNAME));
    }

    return {
      token: token || null,
      serverUrl: serverUrl || null,
      username: username || null,
      password: null,
    };
  } catch (_) {
    return { token: null, serverUrl: null, username: null, password: null };
  }
}

/**
 * Persists the authentication token, server URL, and optional username.
 * Plaintext passwords are NEVER stored (any 4th legacy parameter is ignored and legacy keys are purged).
 */
export async function setStoredAuth(
  token: string,
  serverUrl: string,
  username?: string,
  _legacyPasswordIgnored?: string
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, serverUrl);
    const secureAvailable = await isSecureStoreAvailable();
    await purgeLegacyPasswords(secureAvailable);

    if (secureAvailable) {
      if (token) {
        await setSecureItem(SECURE_KEY_AUTH_TOKEN, token);
      } else {
        await SecureStore.deleteItemAsync(SECURE_KEY_AUTH_TOKEN);
      }
      await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);

      if (username) {
        await setSecureItem(SECURE_KEY_USERNAME, username);
      }
    } else {
      if (token) {
        await AsyncStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
      }
      if (username) {
        await AsyncStorage.setItem(STORAGE_KEY_USERNAME, username);
      }
    }

    if (username) {
      await AsyncStorage.setItem(STORAGE_KEY_USERNAME, username);
      await AsyncStorage.setItem(STORAGE_KEY_SAVED_USERNAME, username);
    }
  } catch (_) {}
}

export async function clearStoredAuth(): Promise<void> {
  try {
    const secureAvailable = await isSecureStoreAvailable();
    await purgeLegacyPasswords(secureAvailable);

    if (secureAvailable) {
      await SecureStore.deleteItemAsync(SECURE_KEY_AUTH_TOKEN);
      await SecureStore.deleteItemAsync(SECURE_KEY_USERNAME);
      await SecureStore.deleteItemAsync(SECURE_KEY_PASSWORD);
    }

    await AsyncStorage.multiRemove([
      STORAGE_KEY_AUTH_TOKEN,
      LEGACY_STORAGE_KEY_PASSWORD,
      STORAGE_KEY_USERNAME,
      STORAGE_KEY_SAVED_USERNAME,
    ]);
  } catch (_) {}
}
