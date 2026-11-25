import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  checkBiometricAvailable,
  getAppLockCapability,
  unlockWithBestAvailableMethod,
  authenticateWithBiometrics,
  authenticateWithDeviceCredentials,
  isAndroidActivityReadyForBiometrics,
  isBiometricEnabled,
  setBiometricEnabled,
  getStoredAuth,
  setStoredAuth,
  setStoredRefreshToken,
  clearStoredAuth,
  isPersonalApiToken,
  SECURE_KEY_AUTH_TOKEN,
  SECURE_KEY_REFRESH_TOKEN,
  STORAGE_KEY_REFRESH_TOKEN,
  SECURE_KEY_USERNAME,
  SECURE_KEY_PASSWORD,
  LEGACY_STORAGE_KEY_PASSWORD,
  STORAGE_KEY_USERNAME,
  STORAGE_KEY_SAVED_USERNAME,
} from '../biometrics';

describe('Biometrics & Auth Persistence', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(async () => {
    jest.clearAllMocks();
    (Platform as any).OS = originalPlatformOS;
    await AsyncStorage.clear();
    await SecureStore.deleteItemAsync(SECURE_KEY_AUTH_TOKEN);
    await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH_TOKEN);
    await SecureStore.deleteItemAsync(SECURE_KEY_USERNAME);
    await SecureStore.deleteItemAsync(SECURE_KEY_PASSWORD);
  });

  afterAll(() => {
    (Platform as any).OS = originalPlatformOS;
  });

  describe('Biometrics Hardware & Authentication', () => {
    it('returns true when hardware and enrollment exist', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

      const available = await checkBiometricAvailable();
      expect(available).toBe(true);
    });

    it('returns false when not enrolled or no hardware', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

      const available = await checkBiometricAvailable();
      expect(available).toBe(false);
    });

    it('authenticates with biometrics successfully', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });

      const success = await authenticateWithBiometrics('Unlock Guanaco');
      expect(success).toBe(true);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Unlock Guanaco' })
      );
    });

    it('fails closed (returns false) on web platform', async () => {
      (Platform as any).OS = 'web';
      expect(await checkBiometricAvailable()).toBe(false);
      expect(await authenticateWithBiometrics('Unlock Guanaco')).toBe(false);
    });

    it('cancels stale native prompt before authenticating when forceReset is true, and self-heals on app_cancel', async () => {
      (Platform as any).OS = 'android';
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });

      expect(await authenticateWithBiometrics('Unlock Guanaco', { forceReset: true })).toBe(true);
      expect(LocalAuthentication.cancelAuthenticate).toHaveBeenCalledTimes(1);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);

      // Self-heal when native LocalAuthenticationModule.isAuthenticating was stuck and returned app_cancel
      jest.clearAllMocks();
      (LocalAuthentication.authenticateAsync as jest.Mock)
        .mockResolvedValueOnce({ success: false, error: 'app_cancel' })
        .mockResolvedValueOnce({ success: true });

      expect(await authenticateWithBiometrics('Unlock Guanaco')).toBe(true);
      expect(LocalAuthentication.cancelAuthenticate).toHaveBeenCalledTimes(1);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
    });

    it('checks native Android keyguard/window readiness via isAndroidActivityReadyForBiometrics', async () => {
      (Platform as any).OS = 'android';
      (NativeModules.InAppUpdate.isActivityReadyForBiometrics as jest.Mock).mockResolvedValueOnce(
        false
      );
      expect(await isAndroidActivityReadyForBiometrics()).toBe(false);

      (Platform as any).OS = 'ios';
      expect(await isAndroidActivityReadyForBiometrics()).toBe(true);
    });

    it('prevents Android post-update PIN prompt hijack by disabling automatic device-credential fallback and retrying transient sensor busy states', async () => {
      (Platform as any).OS = 'android';
      const sensorSpy = NativeModules.InAppUpdate.getBiometricSensorState as jest.Mock;

      // 1. Transient `hw_unavailable` during APK update launch (when Expo's `isEnrolledAsync` transiently returns false)
      // still reports biometric available so lock screen is never bypassed
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValueOnce(false);
      sensorSpy.mockResolvedValueOnce({
        status: 'hw_unavailable',
        msSinceResume: 40,
        decorReady: false,
      });
      expect(await checkBiometricAvailable()).toBe(true);

      // 2. Post-update cold start: window just resumed (40ms < 280ms) and sensor is briefly `hw_unavailable`,
      // then Attempt #1 returns `not_available` (ERROR_HW_UNAVAILABLE), then Attempt #2 succeeds with BIOMETRICS!
      sensorSpy
        .mockResolvedValueOnce({ status: 'hw_unavailable', msSinceResume: 80, decorReady: false })
        .mockResolvedValueOnce({ status: 'ready', msSinceResume: 320, decorReady: true })
        .mockResolvedValue({ status: 'ready', msSinceResume: 500, decorReady: true });

      (LocalAuthentication.authenticateAsync as jest.Mock)
        .mockResolvedValueOnce({ success: false, error: 'not_available' })
        .mockResolvedValueOnce({ success: true });

      expect(await authenticateWithBiometrics('Unlock Guanaco')).toBe(true);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
      // Every biometric attempt on Android MUST pass disableDeviceFallback: true so Expo/Android never opens a PIN-only prompt!
      for (const [opts] of (LocalAuthentication.authenticateAsync as jest.Mock).mock.calls) {
        expect(opts).toEqual(
          expect.objectContaining({
            promptMessage: 'Unlock Guanaco',
            disableDeviceFallback: true,
            requireConfirmation: false,
          })
        );
      }

      // 3. Only genuine OS biometric `lockout` falls back to device credentials (PIN/Pattern/Password)
      jest.clearAllMocks();
      sensorSpy.mockResolvedValue({ status: 'ready', msSinceResume: 5000, decorReady: true });
      (LocalAuthentication.authenticateAsync as jest.Mock)
        .mockResolvedValueOnce({ success: false, error: 'lockout' })
        .mockResolvedValueOnce({ success: true });

      expect(await authenticateWithBiometrics('Unlock Guanaco')).toBe(true);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
      expect((LocalAuthentication.authenticateAsync as jest.Mock).mock.calls[0][0]).toEqual(
        expect.objectContaining({ disableDeviceFallback: true })
      );
      expect((LocalAuthentication.authenticateAsync as jest.Mock).mock.calls[1][0]).toEqual(
        expect.objectContaining({ disableDeviceFallback: false })
      );

      // 4. Explicit manual PIN fallback (`authenticateWithDeviceCredentials`) requests device credentials directly
      jest.clearAllMocks();
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
      expect(await authenticateWithDeviceCredentials('Unlock Guanaco')).toBe(true);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          promptMessage: 'Unlock Guanaco',
          disableDeviceFallback: false,
        })
      );
    });
  });

  describe('Personal API Token Detection', () => {
    it('identifies Vikunja tk_ Personal API Tokens accurately', () => {
      expect(isPersonalApiToken('tk_abcdef123456')).toBe(true);
      expect(isPersonalApiToken('  tk_trimmed999  ')).toBe(true);
      expect(isPersonalApiToken('eyJhbGciOiJIUzI1NiJ9.jwt')).toBe(false);
      expect(isPersonalApiToken('')).toBe(false);
      expect(isPersonalApiToken(null)).toBe(false);
    });
  });

  describe('Biometric Settings Persistence', () => {
    it('defaults to false when not configured', async () => {
      const enabled = await isBiometricEnabled();
      expect(enabled).toBe(false);
    });

    it('enables and disables biometric lock in AsyncStorage and syncs native Recents privacy', async () => {
      (Platform as any).OS = 'android';
      await setBiometricEnabled(true);
      expect(NativeModules.InAppUpdate.setAppLockPrivacyEnabled).toHaveBeenLastCalledWith(true);
      expect(await isBiometricEnabled()).toBe(true);

      await setBiometricEnabled(false);
      expect(NativeModules.InAppUpdate.setAppLockPrivacyEnabled).toHaveBeenLastCalledWith(false);
      expect(await isBiometricEnabled()).toBe(false);

      await setBiometricEnabled(true);
      await clearStoredAuth();
      expect(NativeModules.InAppUpdate.setAppLockPrivacyEnabled).toHaveBeenLastCalledWith(false);
    });

    it('resolves getAppLockCapability and unlockWithBestAvailableMethod across PIN fallback and removed-PIN edge cases', async () => {
      // 1. Web is never enforceable
      (Platform as any).OS = 'web';
      expect(await getAppLockCapability()).toEqual({
        enforceable: false,
        biometricAvailable: false,
      });
      expect(await unlockWithBestAvailableMethod()).toEqual({ passed: false });

      // 2. Biometrics enrolled -> enforceable with biometricAvailable: true
      (Platform as any).OS = 'android';
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
      expect(await getAppLockCapability()).toEqual({
        enforceable: true,
        biometricAvailable: true,
      });

      // 3. Fingerprints deleted or sensor unavailable (`none_enrolled`), but OS PIN/Pattern is still set -> enforceable!
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
      (NativeModules.InAppUpdate.getBiometricSensorState as jest.Mock).mockResolvedValue({
        status: 'none_enrolled',
        msSinceResume: 5000,
        decorReady: true,
        isDeviceSecure: true,
      });
      (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(1);
      expect(await getAppLockCapability()).toEqual({
        enforceable: true,
        biometricAvailable: false,
      });

      // Fallback unlock uses device credentials (`disableDeviceFallback: false`)
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
      expect(await unlockWithBestAvailableMethod('Unlock Guanaco')).toEqual({ passed: true });
      expect(LocalAuthentication.authenticateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          promptMessage: 'Unlock Guanaco',
          disableDeviceFallback: false,
          requireConfirmation: false,
        })
      );

      // 4. User deleted ALL screen locks at OS level -> auto-disables App Lock instead of bricking the user!
      await setBiometricEnabled(true);
      (NativeModules.InAppUpdate.getBiometricSensorState as jest.Mock).mockResolvedValue({
        status: 'none_enrolled',
        msSinceResume: 5000,
        decorReady: true,
        isDeviceSecure: false,
      });
      (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(0);
      expect(await getAppLockCapability()).toEqual({
        enforceable: false,
        biometricAvailable: false,
      });

      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'not_enrolled',
      });
      expect(await unlockWithBestAvailableMethod('Unlock Guanaco')).toEqual({
        passed: true,
        autoDisabledNoDeviceLock: true,
      });
      expect(await isBiometricEnabled()).toBe(false);

      // iOS `passcode_not_set` also auto-disables cleanly
      (Platform as any).OS = 'ios';
      await setBiometricEnabled(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'passcode_not_set',
      });
      expect(await unlockWithBestAvailableMethod('Unlock Guanaco')).toEqual({
        passed: true,
        autoDisabledNoDeviceLock: true,
      });
      expect(await isBiometricEnabled()).toBe(false);

      // Explicit manual PIN fallback (`authenticateWithDeviceCredentials`) also auto-clears when OS has zero screen lock
      (Platform as any).OS = 'android';
      await setBiometricEnabled(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'not_enrolled',
      });
      expect(await authenticateWithDeviceCredentials('Unlock Guanaco')).toBe(true);
      expect(await isBiometricEnabled()).toBe(false);

      (Platform as any).OS = 'ios';
      await setBiometricEnabled(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'passcode_not_set',
      });
      expect(await authenticateWithDeviceCredentials('Unlock Guanaco')).toBe(true);
      expect(await isBiometricEnabled()).toBe(false);
    });
  });

  describe('Zero-Plaintext-Password Auth Persistence & Legacy Purge', () => {
    it('saves and restores auth token, server URL, and username without ever storing plaintext passwords', async () => {
      await setStoredAuth(
        'jwt-xyz',
        'https://vikunja.myorg.com',
        'alice',
        'supersecretpassword'
      );

      const auth = await getStoredAuth();
      expect(auth).toEqual({
        token: 'jwt-xyz',
        refreshToken: null,
        serverUrl: 'https://vikunja.myorg.com',
        username: 'alice',
        password: null,
      });

      expect(await SecureStore.getItemAsync(SECURE_KEY_PASSWORD)).toBeNull();
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBeNull();
      expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY_PASSWORD)).toBeNull();
    });

    it('persists, rotates, and purges vikunja_refresh_token in SecureStore on native while never storing it in Web localStorage', async () => {
      await setStoredAuth('jwt-10m', 'https://vikunja.myorg.com', 'alice', {
        refreshToken: 'rt_initial_1',
      });

      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBe('rt_initial_1');
      expect((await getStoredAuth()).refreshToken).toBe('rt_initial_1');

      // Rotate refresh token via setStoredRefreshToken
      await setStoredRefreshToken('rt_rotated_2');
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBe('rt_rotated_2');
      expect((await getStoredAuth()).refreshToken).toBe('rt_rotated_2');

      // Switching to a Personal API Token (`tk_...`) automatically purges any old refresh token
      await setStoredAuth('tk_personal_token_abc', 'https://vikunja.myorg.com', 'alice');
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBeNull();
      expect((await getStoredAuth()).refreshToken).toBeNull();

      // On Web, browsers manage HttpOnly cookies directly — refresh tokens are never written to storage
      (Platform as any).OS = 'web';
      await setStoredAuth('jwt-web', 'https://vikunja.myorg.com', 'alice', {
        refreshToken: 'rt_should_not_persist_on_web',
      });
      expect(await AsyncStorage.getItem(STORAGE_KEY_REFRESH_TOKEN)).toBeNull();
      expect((await getStoredAuth()).refreshToken).toBeNull();
    });

    it('migrates fallback refresh token from AsyncStorage to SecureStore and purges on clearStoredAuth()', async () => {
      await AsyncStorage.setItem(STORAGE_KEY_REFRESH_TOKEN, 'rt_migrated_99');
      await AsyncStorage.setItem('@vikunja_server_url', 'https://vikunja.example.com');

      const migrated = await getStoredAuth();
      expect(migrated.refreshToken).toBe('rt_migrated_99');
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBe('rt_migrated_99');
      expect(await AsyncStorage.getItem(STORAGE_KEY_REFRESH_TOKEN)).toBeNull();

      await clearStoredAuth();
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBeNull();
      expect((await getStoredAuth()).refreshToken).toBeNull();
    });

    it('purges native OS cookies via RCTNetworking.clearCookies on clearStoredAuth() while skipping on Web', async () => {
      const rctNetworkingMod = require('react-native/Libraries/Network/RCTNetworking');
      const rctNetworking = rctNetworkingMod?.default ?? rctNetworkingMod;
      const origClearCookies = rctNetworking.clearCookies;
      const clearCookiesSpy = jest.fn((cb?: (cleared: boolean) => void) => cb?.(true));
      rctNetworking.clearCookies = clearCookiesSpy;

      try {
        await setStoredAuth('jwt-native', 'https://vikunja.example.com', 'alice', {
          refreshToken: 'rt_native_cookie',
        });
        await clearStoredAuth();
        expect(clearCookiesSpy).toHaveBeenCalledTimes(1);

        clearCookiesSpy.mockClear();
        (Platform as any).OS = 'web';
        await clearStoredAuth();
        expect(clearCookiesSpy).not.toHaveBeenCalled();
      } finally {
        rctNetworking.clearCookies = origClearCookies;
      }
    });

    it('actively purges legacy plaintext passwords from SecureStore and AsyncStorage on read', async () => {
      await SecureStore.setItemAsync(SECURE_KEY_AUTH_TOKEN, 'jwt-valid');
      await SecureStore.setItemAsync(SECURE_KEY_PASSWORD, 'legacy-plaintext-sec-pass');
      await AsyncStorage.setItem(LEGACY_STORAGE_KEY_PASSWORD, 'legacy-plaintext-async-pass');
      await AsyncStorage.setItem('@vikunja_server_url', 'https://vikunja.myorg.com');

      const auth = await getStoredAuth();
      expect(auth.token).toBe('jwt-valid');
      expect(auth.password).toBeNull();

      // Legacy plaintext passwords must have been actively wiped!
      expect(await SecureStore.getItemAsync(SECURE_KEY_PASSWORD)).toBeNull();
      expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY_PASSWORD)).toBeNull();
    });

    it('migrates legacy tokens from AsyncStorage to SecureStore automatically', async () => {
      await AsyncStorage.setItem('@vikunja_auth_token', 'legacy-secret-token');
      await AsyncStorage.setItem('@vikunja_server_url', 'https://vikunja.example.com');

      const auth = await getStoredAuth();
      expect(auth.token).toBe('legacy-secret-token');
      expect(auth.serverUrl).toBe('https://vikunja.example.com');

      expect(await SecureStore.getItemAsync(SECURE_KEY_AUTH_TOKEN)).toBe('legacy-secret-token');
      expect(await AsyncStorage.getItem('@vikunja_auth_token')).toBeNull();
    });

    it('clears token, SecureStore credentials, and all cached username keys on logout while keeping server URL', async () => {
      await setStoredAuth('jwt-secret-123', 'https://vikunja.myorg.com', 'alice');
      await SecureStore.setItemAsync(SECURE_KEY_PASSWORD, 'leftover-pass');
      await AsyncStorage.setItem(LEGACY_STORAGE_KEY_PASSWORD, 'leftover-web-pass');

      expect(await AsyncStorage.getItem(STORAGE_KEY_USERNAME)).toBe('alice');
      expect(await AsyncStorage.getItem(STORAGE_KEY_SAVED_USERNAME)).toBe('alice');

      await clearStoredAuth();

      const cleared = await getStoredAuth();
      expect(cleared.token).toBeNull();
      expect(cleared.username).toBeNull();
      expect(cleared.password).toBeNull();
      expect(cleared.serverUrl).toBe('https://vikunja.myorg.com');

      expect(await SecureStore.getItemAsync(SECURE_KEY_AUTH_TOKEN)).toBeNull();
      expect(await SecureStore.getItemAsync(SECURE_KEY_USERNAME)).toBeNull();
      expect(await SecureStore.getItemAsync(SECURE_KEY_PASSWORD)).toBeNull();
      expect(await AsyncStorage.getItem(STORAGE_KEY_USERNAME)).toBeNull();
      expect(await AsyncStorage.getItem(STORAGE_KEY_SAVED_USERNAME)).toBeNull();
      expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY_PASSWORD)).toBeNull();
    });
  });
});
