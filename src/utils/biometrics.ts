import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { t } from '../i18n';

export const STORAGE_KEY_AUTH_TOKEN = '@vikunja_auth_token';
export const SECURE_KEY_AUTH_TOKEN = 'vikunja_auth_token';
export const STORAGE_KEY_REFRESH_TOKEN = '@vikunja_refresh_token';
export const SECURE_KEY_REFRESH_TOKEN = 'vikunja_refresh_token';
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

export interface AuthenticateBiometricsOptions {
  /** Cancels any hung native BiometricPrompt / orphaned BiometricFragment before prompting. */
  forceReset?: boolean;
}

/**
 * Cancels any in-flight native biometric prompt and detaches any orphaned AndroidX BiometricFragment
 * (for example if Android woke briefly behind a locked Keyguard and dropped the prompt callback).
 */
export async function cancelBiometricPrompt(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (typeof LocalAuthentication.cancelAuthenticate === 'function') {
      await LocalAuthentication.cancelAuthenticate();
    }
  } catch (_) {}
  if (Platform.OS === 'android') {
    try {
      const resetFn = NativeModules?.InAppUpdate?.resetOrphanedBiometricFragment;
      if (typeof resetFn === 'function') {
        await resetFn();
      }
    } catch (_) {}
  }
}

/**
 * Checks on Android whether the OS lockscreen (Keyguard) is unlocked, the Activity has window focus,
 * and FragmentManager state is not saved — preventing BiometricPrompt from silently hanging on screen wake.
 */
export async function isAndroidActivityReadyForBiometrics(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const checkFn = NativeModules?.InAppUpdate?.isActivityReadyForBiometrics;
    if (typeof checkFn === 'function') {
      return Boolean(await checkFn());
    }
    return true;
  } catch (_) {
    return true;
  }
}

export async function authenticateWithBiometrics(
  reason?: string,
  options?: AuthenticateBiometricsOptions
): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const promptConfig: LocalAuthentication.LocalAuthenticationOptions = {
    promptMessage: reason || t('lock.unlockGuanaco'),
    fallbackLabel: t('lock.enterPinOrPassword'),
    cancelLabel: t('common.cancel'),
    disableDeviceFallback: false,
  };

  try {
    if (options?.forceReset) {
      await cancelBiometricPrompt();
      await new Promise((r) => setTimeout(r, 60));
    }

    let result = await LocalAuthentication.authenticateAsync(promptConfig);

    // Self-heal if Expo's native `isAuthenticating` flag was left stuck (`error: "app_cancel"`)
    if (!result.success && (result as any).error === 'app_cancel') {
      await cancelBiometricPrompt();
      await new Promise((r) => setTimeout(r, 80));
      result = await LocalAuthentication.authenticateAsync(promptConfig);
    }

    return Boolean(result?.success);
  } catch (_) {
    return false;
  }
}

let cachedBiometricEnabled: boolean | null = null;

export function getCachedBiometricEnabled(): boolean | null {
  return cachedBiometricEnabled;
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY_BIOMETRIC_ENABLED);
    const enabled = value === 'true';
    cachedBiometricEnabled = enabled;
    return enabled;
  } catch (_) {
    cachedBiometricEnabled = false;
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  cachedBiometricEnabled = enabled;
  try {
    await AsyncStorage.setItem(STORAGE_KEY_BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
  } catch (err) {
    cachedBiometricEnabled = null;
    throw err;
  }
}

export interface StoredAuth {
  token: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  username: string | null;
  /** Always null — plaintext passwords are never persisted. Kept for backward compatibility. */
  password: null;
}

export interface SetStoredAuthOptions {
  refreshToken?: string | null;
}

export async function getStoredAuth(): Promise<StoredAuth> {
  try {
    const serverUrl = await AsyncStorage.getItem(STORAGE_KEY_SERVER_URL);
    let token: string | null = null;
    let refreshToken: string | null = null;
    let username: string | null = null;

    const secureAvailable = await isSecureStoreAvailable();
    await purgeLegacyPasswords(secureAvailable);

    if (secureAvailable) {
      try {
        token = await SecureStore.getItemAsync(SECURE_KEY_AUTH_TOKEN);
        refreshToken = await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN);
        username = await SecureStore.getItemAsync(SECURE_KEY_USERNAME);
      } catch (_) {
        token = null;
        refreshToken = null;
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

      if (!refreshToken) {
        const fallbackRefreshToken = await AsyncStorage.getItem(STORAGE_KEY_REFRESH_TOKEN);
        if (fallbackRefreshToken) {
          refreshToken = fallbackRefreshToken;
          try {
            await setSecureItem(SECURE_KEY_REFRESH_TOKEN, fallbackRefreshToken);
            await AsyncStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
          } catch (_) {}
        }
      }
    } else {
      token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      if (Platform.OS !== 'web') {
        refreshToken = await AsyncStorage.getItem(STORAGE_KEY_REFRESH_TOKEN);
      }
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
      refreshToken: refreshToken || null,
      serverUrl: serverUrl || null,
      username: username || null,
      password: null,
    };
  } catch (_) {
    return { token: null, refreshToken: null, serverUrl: null, username: null, password: null };
  }
}

/**
 * Persists or clears the rotating refresh token in hardware-backed SecureStore on Native.
 * On Web (`Platform.OS === 'web'`), browsers manage the `HttpOnly` `vikunja_refresh_token` cookie directly.
 */
export async function setStoredRefreshToken(refreshToken: string | null): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const secureAvailable = await isSecureStoreAvailable();
    if (secureAvailable) {
      if (refreshToken) {
        await setSecureItem(SECURE_KEY_REFRESH_TOKEN, refreshToken);
      } else {
        await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH_TOKEN);
      }
      await AsyncStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
    } else {
      if (refreshToken) {
        await AsyncStorage.setItem(STORAGE_KEY_REFRESH_TOKEN, refreshToken);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
      }
    }
  } catch (_) {}
}

/**
 * Persists the authentication token, server URL, optional username, and optional native refresh token.
 * Plaintext passwords are NEVER stored (any 4th string legacy parameter is ignored and legacy keys are purged).
 */
export async function setStoredAuth(
  token: string,
  serverUrl: string,
  username?: string,
  legacyPasswordOrOptions?: string | SetStoredAuthOptions,
  refreshTokenArg?: string | null
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, serverUrl);
    const secureAvailable = await isSecureStoreAvailable();
    await purgeLegacyPasswords(secureAvailable);

    const resolvedRefreshToken =
      typeof legacyPasswordOrOptions === 'object' && legacyPasswordOrOptions !== null
        ? legacyPasswordOrOptions.refreshToken
        : refreshTokenArg;

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

    if (isPersonalApiToken(token)) {
      await setStoredRefreshToken(null);
    } else if (resolvedRefreshToken !== undefined) {
      await setStoredRefreshToken(resolvedRefreshToken || null);
    }

    if (username) {
      await AsyncStorage.setItem(STORAGE_KEY_USERNAME, username);
      await AsyncStorage.setItem(STORAGE_KEY_SAVED_USERNAME, username);
    }
  } catch (_) {}
}

/**
 * Purges native OS HTTP cookies (`Android WebView CookieManager` / `iOS NSHTTPCookieStorage`)
 * via React Native's `RCTNetworking.clearCookies`. Includes a safe no-op/timeout guard for Jest mocks.
 */
export async function clearNativeCookies(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rctNetworkingMod = require('react-native/Libraries/Network/RCTNetworking');
    const rctNetworking = rctNetworkingMod?.default ?? rctNetworkingMod;
    if (rctNetworking && typeof rctNetworking.clearCookies === 'function') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const guardTimer = setTimeout(finish, 50);
        if (typeof (guardTimer as any)?.unref === 'function') {
          (guardTimer as any).unref();
        }
        try {
          const fn = rctNetworking.clearCookies as any;
          const isBareJestMock =
            Boolean(fn?._isMockFunction) &&
            typeof fn?.getMockImplementation === 'function' &&
            !fn.getMockImplementation();
          rctNetworking.clearCookies(() => {
            clearTimeout(guardTimer);
            finish();
          });
          if (isBareJestMock) {
            clearTimeout(guardTimer);
            finish();
          }
        } catch (_) {
          clearTimeout(guardTimer);
          finish();
        }
      });
    }
  } catch (_) {}
}

export async function clearStoredCredentialsOnly(): Promise<void> {
  cachedBiometricEnabled = false;
  try {
    const secureAvailable = await isSecureStoreAvailable();
    await purgeLegacyPasswords(secureAvailable);

    if (secureAvailable) {
      await SecureStore.deleteItemAsync(SECURE_KEY_AUTH_TOKEN);
      await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH_TOKEN);
      await SecureStore.deleteItemAsync(SECURE_KEY_USERNAME);
      await SecureStore.deleteItemAsync(SECURE_KEY_PASSWORD);
    }

    await AsyncStorage.multiRemove([
      STORAGE_KEY_AUTH_TOKEN,
      STORAGE_KEY_REFRESH_TOKEN,
      LEGACY_STORAGE_KEY_PASSWORD,
      STORAGE_KEY_USERNAME,
      STORAGE_KEY_SAVED_USERNAME,
      STORAGE_KEY_BIOMETRIC_ENABLED,
    ]);
  } catch (_) {}
}

export async function clearStoredAuth(): Promise<void> {
  try {
    await clearStoredCredentialsOnly();
    await clearNativeCookies();
  } catch (_) {}
}
