import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import {
  checkForAppUpdate,
  startAppUpdate,
  completeAppUpdate,
  openPlayStore,
  addInstallListener,
  isNativeUpdateSupported,
} from '../appUpdateChecker';

describe('appUpdateChecker service', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
    jest.clearAllMocks();
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  it('checks if native update is supported on Android with InAppUpdate module', () => {
    expect(isNativeUpdateSupported()).toBe(true);

    Platform.OS = 'ios';
    expect(isNativeUpdateSupported()).toBe(false);
  });

  it('checkForAppUpdate returns update info when available', async () => {
    const mockInfo = {
      isAvailable: true,
      availableVersionCode: 18,
      currentVersionCode: 16,
      updateAvailability: 2,
      isImmediateAllowed: true,
      isFlexibleAllowed: true,
      clientVersionStalenessDays: 1,
      updatePriority: 3,
      inProgress: false,
    };
    (NativeModules.InAppUpdate.checkForUpdate as jest.Mock).mockResolvedValueOnce(mockInfo);

    const result = await checkForAppUpdate();
    expect(result).toEqual(mockInfo);
    expect(NativeModules.InAppUpdate.checkForUpdate).toHaveBeenCalled();
  });

  it('checkForAppUpdate returns null on non-android platform', async () => {
    Platform.OS = 'ios';
    const result = await checkForAppUpdate();
    expect(result).toBeNull();
  });

  it('checkForAppUpdate safely returns null when native call rejects', async () => {
    (NativeModules.InAppUpdate.checkForUpdate as jest.Mock).mockRejectedValueOnce(
      new Error('Play Store error')
    );

    const result = await checkForAppUpdate();
    expect(result).toBeNull();
  });

  it('startAppUpdate invokes startUpdateFlow on native module', async () => {
    (NativeModules.InAppUpdate.startUpdateFlow as jest.Mock).mockResolvedValueOnce({
      status: 'accepted',
    });

    const status = await startAppUpdate('flexible');
    expect(status).toBe('accepted');
    expect(NativeModules.InAppUpdate.startUpdateFlow).toHaveBeenCalledWith('flexible');
  });

  it('startAppUpdate falls back to openPlayStore when native flow fails', async () => {
    (NativeModules.InAppUpdate.startUpdateFlow as jest.Mock).mockRejectedValueOnce(
      new Error('Activity not found')
    );
    (NativeModules.InAppUpdate.openPlayStore as jest.Mock).mockResolvedValueOnce(true);

    const status = await startAppUpdate('flexible');
    expect(status).toBe('accepted');
    expect(NativeModules.InAppUpdate.openPlayStore).toHaveBeenCalled();
  });

  it('completeAppUpdate calls completeUpdate on native module', async () => {
    (NativeModules.InAppUpdate.completeUpdate as jest.Mock).mockResolvedValueOnce(true);

    const result = await completeAppUpdate();
    expect(result).toBe(true);
    expect(NativeModules.InAppUpdate.completeUpdate).toHaveBeenCalled();
  });

  it('openPlayStore calls openPlayStore on native module', async () => {
    (NativeModules.InAppUpdate.openPlayStore as jest.Mock).mockResolvedValueOnce(true);

    const result = await openPlayStore();
    expect(result).toBe(true);
    expect(NativeModules.InAppUpdate.openPlayStore).toHaveBeenCalled();
  });

  it('addInstallListener subscribes to onInstallStateChanged events', () => {
    const callback = jest.fn();
    const unsubscribe = addInstallListener(callback);

    DeviceEventEmitter.emit('onInstallStateChanged', {
      status: 'DOWNLOADING',
      bytesDownloaded: 500,
      totalBytesToDownload: 1000,
      errorCode: 0,
    });

    expect(callback).toHaveBeenCalledWith({
      status: 'DOWNLOADING',
      bytesDownloaded: 500,
      totalBytesToDownload: 1000,
      errorCode: 0,
    });

    unsubscribe();

    DeviceEventEmitter.emit('onInstallStateChanged', {
      status: 'DOWNLOADED',
      bytesDownloaded: 1000,
      totalBytesToDownload: 1000,
      errorCode: 0,
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
