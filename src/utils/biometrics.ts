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

export interface AndroidBiometricSensorState {
  status:
    | 'ready'
    | 'hw_unavailable'
    | 'none_enrolled'
    | 'no_hardware'
    | 'security_update_required'
    | 'unknown';
  msSinceResume: number;
  decorReady: boolean;
  isDeviceSecure?: boolean;
}

export interface AppLockCapability {
  enforceable: boolean;
  biometricAvailable: boolean;
}

export interface UnlockWithBestAvailableResult {
  passed: boolean;
  autoDisabledNoDeviceLock?: boolean;
}

function syncNativeAppLockPrivacy(enabled: boolean): void {
  if (Platform.OS === 'web') return;
  try {
    const res = NativeModules?.InAppUpdate?.setAppLockPrivacyEnabled?.(enabled);
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  } catch (_) {}
}

/**
 * Minimum post-resume window-transition settle time on Android (ms) so Play Store / Play Core
 * update installer closing animations finish before BiometricPrompt attaches its fragment.
 */
const ANDROID_POST_RESUME_SETTLE_MS = 280;

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getAndroidBiometricSensorState(): Promise<AndroidBiometricSensorState | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const fn = NativeModules?.InAppUpdate?.getBiometricSensorState;
    if (typeof fn !== 'function') return null;
    const raw = await fn();
    if (!raw || typeof raw !== 'object') return null;
    return {
      status: raw.status || 'unknown',
      msSinceResume: typeof raw.msSinceResume === 'number' ? raw.msSinceResume : 1000,
      decorReady: raw.decorReady !== false,
      ...(typeof raw.isDeviceSecure === 'boolean' ? { isDeviceSecure: raw.isDeviceSecure } : {}),
    };
  } catch (_) {
    return null;
  }
}

export async function checkBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (isEnrolled) return true;

    if (Platform.OS === 'android') {
      // On Android, `LocalAuthentication.isEnrolledAsync()` checks `canAuthenticate == BIOMETRIC_SUCCESS`,
      // which transiently returns `false` when the sensor HAL reports `BIOMETRIC_ERROR_HW_UNAVAILABLE`
      // right after an APK update or screen wake even though biometrics ARE enrolled.
      const sensorState = await getAndroidBiometricSensorState();
      if (sensorState?.status === 'hw_unavailable' || sensorState?.status === 'ready') {
        return true;
      }
    }
    return false;
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
 * Checks on Android whether the OS lockscreen (Keyguard) is unlocked, the Activity is RESUMED and focused,
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

/**
 * Waits briefly on Android when cold-starting or resuming right after an app update so the incoming
 * Activity window transition and biometric sensor HAL (`BIOMETRIC_ERROR_HW_UNAVAILABLE`) settle
 * before `BiometricPrompt.authenticate()` is invoked.
 */
async function waitForAndroidBiometricReadiness(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (let i = 0; i < 6; i++) {
    const state = await getAndroidBiometricSensorState();
    if (!state) return;
    if (
      state.status === 'none_enrolled' ||
      state.status === 'no_hardware' ||
      state.status === 'security_update_required'
    ) {
      return;
    }

    if (state.msSinceResume < ANDROID_POST_RESUME_SETTLE_MS) {
      const remaining = Math.min(
        ANDROID_POST_RESUME_SETTLE_MS,
        Math.max(40, Math.ceil(ANDROID_POST_RESUME_SETTLE_MS - state.msSinceResume))
      );
      await delayMs(remaining);
      continue;
    }

    if (state.status === 'hw_unavailable' || !state.decorReady) {
      await delayMs(110);
      continue;
    }

    return;
  }
}

/**
 * Explicitly prompts for device credentials (PIN / Pattern / Passcode) when requested by the user
 * or when OS biometric lockout (`ERROR_LOCKOUT` / `ERROR_LOCKOUT_PERMANENT`) requires primary auth.
 */
export async function authenticateWithDeviceCredentials(reason?: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const credentialConfig: LocalAuthentication.LocalAuthenticationOptions = {
    promptMessage: reason || t('lock.unlockGuanaco'),
    fallbackLabel: t('lock.enterPinOrPassword'),
    cancelLabel: t('common.cancel'),
    disableDeviceFallback: false,
    requireConfirmation: false,
  };
  try {
    let result = await LocalAuthentication.authenticateAsync(credentialConfig);
    if (!result?.success && (result as any)?.error === 'app_cancel') {
      await cancelBiometricPrompt();
      await delayMs(80);
      result = await LocalAuthentication.authenticateAsync(credentialConfig);
    }
    if (result?.success) {
      return true;
    }
    const err = (result as any)?.error as string | undefined;
    if (
      (Platform.OS === 'android' && err === 'not_enrolled') ||
      (Platform.OS === 'ios' && err === 'passcode_not_set')
    ) {
      await setBiometricEnabled(false);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

export async function authenticateWithBiometrics(
  reason?: string,
  options?: AuthenticateBiometricsOptions
): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    if (options?.forceReset) {
      await cancelBiometricPrompt();
      await delayMs(60);
    }

    if (Platform.OS === 'android') {
      await waitForAndroidBiometricReadiness();

      // Strictly request BIOMETRIC authenticators (`disableDeviceFallback: true`) on Android!
      // Passing `disableDeviceFallback: false` sets `DEVICE_CREDENTIAL` on `BiometricPrompt` AND enables
      // `expo-local-authentication`'s `promptDeviceCredentialsFallback()`, which hijacks the prompt into
      // a PIN-only screen whenever the biometric HAL is momentarily busy right after an app update.
      const androidBiometricConfig: LocalAuthentication.LocalAuthenticationOptions = {
        promptMessage: reason || t('lock.unlockGuanaco'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: true,
        requireConfirmation: false,
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await LocalAuthentication.authenticateAsync(androidBiometricConfig);
        if (result?.success) {
          return true;
        }

        const errCode = (result as any)?.error as string | undefined;

        // If Android placed biometrics in lockout (5 failed scans or 72h / post-reboot StrongAuth),
        // biometrics cannot succeed until device PIN/Pattern/Password is entered.
        if (errCode === 'lockout') {
          await cancelBiometricPrompt();
          await delayMs(80);
          return await authenticateWithDeviceCredentials(reason);
        }

        const isTransientSensorError =
          errCode === 'app_cancel' ||
          errCode === 'not_available' ||
          errCode === 'unable_to_process' ||
          errCode === 'system_cancel';

        // `BiometricPrompt.ERROR_CANCELED` (5 = sensor unavailable) is mapped by Expo to `'user_cancel'`;
        // distinguish it from genuine user dismissal by checking whether the sensor is currently `hw_unavailable`.
        const sensorAfter =
          errCode === 'user_cancel' ? await getAndroidBiometricSensorState() : null;
        const wasSensorUnavailableCancel = sensorAfter?.status === 'hw_unavailable';

        if ((isTransientSensorError || wasSensorUnavailableCancel) && attempt < 2) {
          await cancelBiometricPrompt();
          await delayMs(attempt === 0 ? 180 : 280);
          await waitForAndroidBiometricReadiness();
          continue;
        }

        return false;
      }
      return false;
    }

    // iOS (`LAPolicyDeviceOwnerAuthentication` tries Face ID / Touch ID first before passcode fallback)
    const iosPromptConfig: LocalAuthentication.LocalAuthenticationOptions = {
      promptMessage: reason || t('lock.unlockGuanaco'),
      fallbackLabel: t('lock.enterPinOrPassword'),
      cancelLabel: t('common.cancel'),
      disableDeviceFallback: false,
    };

    let result = await LocalAuthentication.authenticateAsync(iosPromptConfig);
    if (!result.success && (result as any).error === 'app_cancel') {
      await cancelBiometricPrompt();
      await delayMs(80);
      result = await LocalAuthentication.authenticateAsync(iosPromptConfig);
    }

    return Boolean(result?.success);
  } catch (_) {
    return false;
  }
}

/**
 * Determines whether App Lock can be enforced on the current device (either via biometrics
 * or via OS device credentials / PIN / Pattern / Passcode) so sensor HAL hiccups or deleted
 * fingerprints never silently bypass App Lock when a device screen lock is still configured.
 */
export async function getAppLockCapability(): Promise<AppLockCapability> {
  if (Platform.OS === 'web') {
    return { enforceable: false, biometricAvailable: false };
  }
  try {
    if (await checkBiometricAvailable()) {
      return { enforceable: true, biometricAvailable: true };
    }

    const sensorState =
      Platform.OS === 'android' ? await getAndroidBiometricSensorState() : null;

    if (typeof LocalAuthentication.getEnrolledLevelAsync !== 'function') {
      if (sensorState?.isDeviceSecure === true) {
        return { enforceable: true, biometricAvailable: false };
      }
      if (sensorState?.isDeviceSecure === false) {
        return { enforceable: false, biometricAvailable: false };
      }
      return { enforceable: true, biometricAvailable: false };
    }

    const level = Number(await LocalAuthentication.getEnrolledLevelAsync());
    const secretLevel = Number(LocalAuthentication.SecurityLevel?.SECRET ?? 1);
    if (
      (!Number.isNaN(level) && level >= secretLevel) ||
      sensorState?.isDeviceSecure === true
    ) {
      return { enforceable: true, biometricAvailable: false };
    }
    if (level === 0) {
      return { enforceable: false, biometricAvailable: false };
    }
    return { enforceable: true, biometricAvailable: false };
  } catch (_) {
    return { enforceable: true, biometricAvailable: false };
  }
}

/**
 * Prompts biometric unlock when available, or falls back to OS device credentials (PIN / Passcode).
 * If the user removed their OS screen lock completely (`not_enrolled` / `passcode_not_set`),
 * automatically disables App Lock and passes so the user is never permanently locked out.
 */
export async function unlockWithBestAvailableMethod(
  reason?: string,
  options?: AuthenticateBiometricsOptions
): Promise<UnlockWithBestAvailableResult> {
  if (Platform.OS === 'web') {
    return { passed: false };
  }

  if (await checkBiometricAvailable()) {
    const passed = await authenticateWithBiometrics(reason, options);
    return { passed };
  }

  try {
    if (options?.forceReset) {
      await cancelBiometricPrompt();
      await delayMs(60);
    }

    const credentialConfig: LocalAuthentication.LocalAuthenticationOptions = {
      promptMessage: reason || t('lock.unlockGuanaco'),
      fallbackLabel: t('lock.enterPinOrPassword'),
      cancelLabel: t('common.cancel'),
      disableDeviceFallback: false,
      requireConfirmation: false,
    };

    let result = await LocalAuthentication.authenticateAsync(credentialConfig);
    if (!result?.success && (result as any)?.error === 'app_cancel') {
      await cancelBiometricPrompt();
      await delayMs(80);
      result = await LocalAuthentication.authenticateAsync(credentialConfig);
    }

    if (result?.success) {
      return { passed: true };
    }

    const err = (result as any)?.error as string | undefined;
    if (
      (Platform.OS === 'android' && err === 'not_enrolled') ||
      (Platform.OS === 'ios' && err === 'passcode_not_set')
    ) {
      await setBiometricEnabled(false);
      return { passed: true, autoDisabledNoDeviceLock: true };
    }

    return { passed: false };
  } catch (_) {
    return { passed: false };
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
    syncNativeAppLockPrivacy(enabled);
    return enabled;
  } catch (_) {
    cachedBiometricEnabled = false;
    syncNativeAppLockPrivacy(false);
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  cachedBiometricEnabled = enabled;
  try {
    await AsyncStorage.setItem(STORAGE_KEY_BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
    syncNativeAppLockPrivacy(enabled);
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
  syncNativeAppLockPrivacy(false);
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
