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
  const initialStoreState = useUpdateStore.getState();

  beforeEach(async () => {
    await AsyncStorage.clear();
    useUpdateStore.setState(initialStoreState, true);
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

  it('honors 1-hour cooldown for non-forced checks even when updateInfo is null', async () => {
    const recentCheck = Date.now() - 10_000;
    await AsyncStorage.setItem('@guanaco_update_last_check', recentCheck.toString());

    useUpdateStore.setState({
      updateInfo: null,
      lastCheckedTime: null,
    });

    const result = await useUpdateStore.getState().checkForUpdate(false);

    expect(result).toBeNull();
    expect(appUpdateChecker.checkForAppUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().lastCheckedTime).toBe(recentCheck);
  });

  it('honors cooldown for non-forced checks when checked recently in memory', async () => {
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
      lastCheckedTime: Date.now() - 5000,
    });

    const result = await useUpdateStore.getState().checkForUpdate(false);

    expect(result).toEqual(mockInfo);
    expect(appUpdateChecker.checkForAppUpdate).not.toHaveBeenCalled();
  });

  it('bypasses cooldown and clears snooze when force is true', async () => {
    const futureTime = Date.now() + 10 * 3600 * 1000;
    await AsyncStorage.setItem('@guanaco_update_dismissed_until', futureTime.toString());
    await AsyncStorage.setItem(
      '@guanaco_update_downloaded_dismissed_until',
      futureTime.toString()
    );

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
      isDownloadedDismissed: true,
    });
    (appUpdateChecker.checkForAppUpdate as jest.Mock).mockResolvedValueOnce(newInfo);

    const result = await useUpdateStore.getState().checkForUpdate(true);

    expect(result).toEqual(newInfo);
    expect(appUpdateChecker.checkForAppUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().isPromptVisible).toBe(true);
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(false);
  });

  it('dismissPrompt snoozes prompt visibility and marks DOWNLOADED state dismissed', async () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      installProgress: {
        status: 'DOWNLOADED',
        bytesDownloaded: 100,
        totalBytesToDownload: 100,
        errorCode: 0,
      },
    });

    await useUpdateStore.getState().dismissPrompt(24);

    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(true);

    const stored = await AsyncStorage.getItem('@guanaco_update_dismissed_until');
    const dlStored = await AsyncStorage.getItem('@guanaco_update_downloaded_dismissed_until');
    expect(stored).toBeTruthy();
    expect(dlStored).toBeTruthy();
    expect(parseInt(stored!, 10)).toBeGreaterThan(Date.now());
    expect(parseInt(dlStored!, 10)).toBeGreaterThan(Date.now());
  });

  it('initialize listener respects DOWNLOADED snooze on cold start and wakes when active download finishes', async () => {
    let listenerCb: ((progress: appUpdateChecker.InstallProgress) => Promise<void> | void) | null = null;
    (appUpdateChecker.addInstallListener as jest.Mock).mockImplementation((cb) => {
      listenerCb = cb;
      return jest.fn();
    });

    // Simulate user previously snoozing a downloaded update
    await AsyncStorage.setItem(
      '@guanaco_update_downloaded_dismissed_until',
      (Date.now() + 3600_000).toString()
    );

    useUpdateStore.getState().initialize();
    expect(listenerCb).toBeTruthy();

    // Cold-start DOWNLOADED event while snoozed -> stays hidden
    await listenerCb!({
      status: 'DOWNLOADED',
      bytesDownloaded: 1000,
      totalBytesToDownload: 1000,
      errorCode: 0,
    });
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(true);

    // A new active download transitions DOWNLOADING -> DOWNLOADED -> surfaces restart prompt
    await listenerCb!({
      status: 'DOWNLOADING',
      bytesDownloaded: 500,
      totalBytesToDownload: 1000,
      errorCode: 0,
    });
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(false);

    await listenerCb!({
      status: 'DOWNLOADED',
      bytesDownloaded: 1000,
      totalBytesToDownload: 1000,
      errorCode: 0,
    });
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(false);
    expect(useUpdateStore.getState().isPromptVisible).toBe(true);
  });

  it('prevents race condition between concurrent DOWNLOADED event and checkForUpdate(false) when snoozed', async () => {
    let listenerCb: ((progress: appUpdateChecker.InstallProgress) => Promise<void> | void) | null = null;
    (appUpdateChecker.addInstallListener as jest.Mock).mockImplementation((cb) => {
      listenerCb = cb;
      return jest.fn();
    });

    const futureTime = Date.now() + 12 * 3600 * 1000;
    await AsyncStorage.setItem('@guanaco_update_dismissed_until', futureTime.toString());
    await AsyncStorage.setItem(
      '@guanaco_update_downloaded_dismissed_until',
      futureTime.toString()
    );

    (appUpdateChecker.checkForAppUpdate as jest.Mock).mockImplementation(async () => {
      // Simulate InAppUpdateModule.kt emitting DOWNLOADED right before resolving checkForUpdate
      const eventPromise = listenerCb!({
        status: 'DOWNLOADED',
        bytesDownloaded: 2048,
        totalBytesToDownload: 2048,
        errorCode: 0,
      });
      // Do NOT await eventPromise here so both async storage reads interleave concurrently
      void eventPromise;
      return {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 18,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 1,
        updatePriority: 0,
        inProgress: false,
        installStatus: 'DOWNLOADED',
      };
    });

    useUpdateStore.getState().initialize();
    await useUpdateStore.getState().checkForUpdate(false);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(useUpdateStore.getState().installProgress?.status).toBe('DOWNLOADED');
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(true);
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
  });

  it('preserves DOWNLOADED prompt visibility when concurrent DOWNLOADED event and checkForUpdate(false) run unsnoozed', async () => {
    let listenerCb: ((progress: appUpdateChecker.InstallProgress) => Promise<void> | void) | null = null;
    (appUpdateChecker.addInstallListener as jest.Mock).mockImplementation((cb) => {
      listenerCb = cb;
      return jest.fn();
    });

    (appUpdateChecker.checkForAppUpdate as jest.Mock).mockImplementation(async () => {
      void listenerCb!({
        status: 'DOWNLOADED',
        bytesDownloaded: 2048,
        totalBytesToDownload: 2048,
        errorCode: 0,
      });
      return {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 18,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 1,
        updatePriority: 0,
        inProgress: false,
        installStatus: 'DOWNLOADED',
      };
    });

    useUpdateStore.getState().initialize();
    await useUpdateStore.getState().checkForUpdate(false);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(useUpdateStore.getState().installProgress?.status).toBe('DOWNLOADED');
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(false);
    expect(useUpdateStore.getState().isPromptVisible).toBe(true);
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
