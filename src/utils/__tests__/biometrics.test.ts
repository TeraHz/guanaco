import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  checkBiometricAvailable,
  authenticateWithBiometrics,
  isBiometricEnabled,
  setBiometricEnabled,
  getStoredAuth,
  setStoredAuth,
  clearStoredAuth,
} from '../biometrics';

describe('Biometrics & Auth Persistence', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  describe('Biometrics Hardware & Authentication', () => {
    it('returns true when hardware and enrollment exist', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

      const available = await checkBiometricAvailable();
      expect(available).toBe(true);
    });

    it('returns false when not enrolled or no hardware', async () => {
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

      const available = await checkBiometricAvailable();
      expect(available).toBe(false);
    });

    it('authenticates with biometrics successfully', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });

      const success = await authenticateWithBiometrics('Unlock Vikunja');
      expect(success).toBe(true);
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Unlock Vikunja' })
      );
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

  describe('Auth Token Persistence', () => {
    it('saves and restores auth token and server URL', async () => {
      await setStoredAuth('jwt-xyz', 'https://vikunja.myorg.com');

      const auth = await getStoredAuth();
      expect(auth).toEqual({
        token: 'jwt-xyz',
        serverUrl: 'https://vikunja.myorg.com',
      });
    });

    it('clears auth token on logout', async () => {
      await setStoredAuth('jwt-xyz', 'https://vikunja.myorg.com');
      await clearStoredAuth();

      const auth = await getStoredAuth();
      expect(auth.token).toBeNull();
      // Keeps server URL for convenience
      expect(auth.serverUrl).toBe('https://vikunja.myorg.com');
    });
  });
});
