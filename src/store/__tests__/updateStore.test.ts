import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUpdateStore } from '../updateStore';
import * as appUpdateChecker from '../../services/appUpdateChecker';

jest.mock('../../services/appUpdateChecker', () => ({
  checkForAppUpdate: jest.fn(),
  startAppUpdate: jest.fn(),
  completeAppUpdate: jest.fn(),
  openPlayStore: jest.fn(),
  addInstallListener: jest.fn(() => jest.fn()),
  isNativeUpdateSupported: jest.fn(() => true),
}));

describe('updateStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useUpdateStore.setState({
      updateInfo: null,
      isChecking: false,
      lastCheckedTime: null,
      installProgress: null,
      isPromptVisible: false,
    });
    jest.clearAllMocks();
  });

  it('checks for update and sets isPromptVisible when update is available', async () => {
    const mockInfo = {
      isAvailable: true,
      availableVersionCode: 19,
      currentVersionCode: 16,
      updateAvailability: 2,
      isImmediateAllowed: true,
      isFlexibleAllowed: true,
      clientVersionStalenessDays: 2,
      updatePriority: 0,
      inProgress: false,
    };
    (appUpdateChecker.checkForAppUpdate as jest.Mock).mockResolvedValueOnce(mockInfo);

    const result = await useUpdateStore.getState().checkForUpdate();

    expect(result).toEqual(mockInfo);
    expect(useUpdateStore.getState().updateInfo).toEqual(mockInfo);
    expect(useUpdateStore.getState().isPromptVisible).toBe(true);
  });

  it('honors cooldown for non-forced checks when checked recently', async () => {
    const mockInfo = {
      isAvailable: true,
      availableVersionCode: 19,
      currentVersionCode: 16,
      updateAvailability: 2,
      isImmediateAllowed: true,
      isFlexibleAllowed: true,
      clientVersionStalenessDays: 2,
      updatePriority: 0,
      inProgress: false,
    };
    useUpdateStore.setState({
      updateInfo: mockInfo,
      lastCheckedTime: Date.now() - 5000, // 5 seconds ago
    });

    const result = await useUpdateStore.getState().checkForUpdate(false);

    expect(result).toEqual(mockInfo);
    expect(appUpdateChecker.checkForAppUpdate).not.toHaveBeenCalled();
  });

  it('bypasses cooldown when force is true', async () => {
    const oldInfo = {
      isAvailable: false,
      availableVersionCode: 16,
      currentVersionCode: 16,
      updateAvailability: 1,
      isImmediateAllowed: true,
      isFlexibleAllowed: true,
      clientVersionStalenessDays: 0,
      updatePriority: 0,
      inProgress: false,
    };
    const newInfo = {
      ...oldInfo,
      isAvailable: true,
      availableVersionCode: 17,
    };
    useUpdateStore.setState({
      updateInfo: oldInfo,
      lastCheckedTime: Date.now() - 5000,
    });
    (appUpdateChecker.checkForAppUpdate as jest.Mock).mockResolvedValueOnce(newInfo);

    const result = await useUpdateStore.getState().checkForUpdate(true);

    expect(result).toEqual(newInfo);
    expect(appUpdateChecker.checkForAppUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().isPromptVisible).toBe(true);
  });

  it('dismissPrompt snoozes prompt visibility and saves timestamp in AsyncStorage', async () => {
    useUpdateStore.setState({ isPromptVisible: true });

    await useUpdateStore.getState().dismissPrompt(24);

    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    const stored = await AsyncStorage.getItem('@guanaco_update_dismissed_until');
    expect(stored).toBeTruthy();
    expect(parseInt(stored!, 10)).toBeGreaterThan(Date.now());
  });

  it('does not show prompt if user dismissed it within snooze period on normal check', async () => {
    const futureTime = Date.now() + 10 * 3600 * 1000;
    await AsyncStorage.setItem('@guanaco_update_dismissed_until', futureTime.toString());

    const mockInfo = {
      isAvailable: true,
      availableVersionCode: 19,
      currentVersionCode: 16,
      updateAvailability: 2,
      isImmediateAllowed: true,
      isFlexibleAllowed: true,
      clientVersionStalenessDays: 1,
      updatePriority: 0,
      inProgress: false,
    };
    (appUpdateChecker.checkForAppUpdate as jest.Mock).mockResolvedValueOnce(mockInfo);

    await useUpdateStore.getState().checkForUpdate(false);

    expect(useUpdateStore.getState().updateInfo).toEqual(mockInfo);
    // Snoozed, so prompt modal should not pop up automatically
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
  });

  it('starts update and completes downloaded update', async () => {
    (appUpdateChecker.startAppUpdate as jest.Mock).mockResolvedValueOnce('accepted');
    (appUpdateChecker.completeAppUpdate as jest.Mock).mockResolvedValueOnce(true);

    await useUpdateStore.getState().startUpdate('flexible');
    expect(appUpdateChecker.startAppUpdate).toHaveBeenCalledWith('flexible');

    const completed = await useUpdateStore.getState().completeDownloadedUpdate();
    expect(completed).toBe(true);
    expect(appUpdateChecker.completeAppUpdate).toHaveBeenCalled();
  });
});
