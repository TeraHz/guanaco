import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  checkBiometricAvailable,
  authenticateWithBiometrics,
  isBiometricEnabled,
  setBiometricEnabled,
  getStoredAuth,
  setStoredAuth,
  clearStoredAuth,
  isPersonalApiToken,
  SECURE_KEY_AUTH_TOKEN,
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

    it('enables and disables biometric lock in AsyncStorage', async () => {
      await setBiometricEnabled(true);
      expect(await isBiometricEnabled()).toBe(true);

      await setBiometricEnabled(false);
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
        serverUrl: 'https://vikunja.myorg.com',
        username: 'alice',
        password: null,
      });

      expect(await SecureStore.getItemAsync(SECURE_KEY_PASSWORD)).toBeNull();
      expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEY_PASSWORD)).toBeNull();
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
