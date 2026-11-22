import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

export interface AppUpdateInfo {
  isAvailable: boolean;
  availableVersionCode: number;
  currentVersionCode: number;
  updateAvailability: number;
  isImmediateAllowed: boolean;
  isFlexibleAllowed: boolean;
  clientVersionStalenessDays: number | null;
  updatePriority: number;
  inProgress: boolean;
  installStatus?: InstallStatus;
}

export type InstallStatus =
  | 'PENDING'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'INSTALLING'
  | 'INSTALLED'
  | 'FAILED'
  | 'CANCELED'
  | 'UNKNOWN';

export interface InstallProgress {
  status: InstallStatus;
  bytesDownloaded: number;
  totalBytesToDownload: number;
  errorCode: number;
}

const getInAppUpdateModule = () => NativeModules?.InAppUpdate;

export const isNativeUpdateSupported = (): boolean => {
  return Platform.OS === 'android' && !!getInAppUpdateModule();
};

/**
 * Queries Google Play Services for an available in-app update.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  const nativeModule = getInAppUpdateModule();
  if (Platform.OS !== 'android' || !nativeModule) {
    return null;
  }

  try {
    const info: AppUpdateInfo = await nativeModule.checkForUpdate();
    return info;
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[AppUpdateChecker] Failed to check for update:', error);
    }
    return null;
  }
}

/**
 * Initiates the Google Play In-App Update flow.
 * Defaults to 'flexible' update for a seamless non-blocking download.
 */
export async function startAppUpdate(
  type: 'flexible' | 'immediate' = 'flexible'
): Promise<'accepted' | 'canceled' | 'failed'> {
  const nativeModule = getInAppUpdateModule();
  if (Platform.OS !== 'android' || !nativeModule) {
    const opened = await openPlayStore();
    return opened ? 'accepted' : 'failed';
  }

  try {
    const result = await nativeModule.startUpdateFlow(type);
    const status = result?.status;
    if (status === 'accepted' || status === 'canceled' || status === 'failed') {
      return status;
    }
    return status ? 'failed' : 'accepted';
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[AppUpdateChecker] In-app update flow failed, falling back to Play Store:', error);
    }
    const opened = await openPlayStore();
    return opened ? 'accepted' : 'failed';
  }
}

/**
 * For flexible updates: Triggers Google Play to complete the update and restart the app.
 */
export async function completeAppUpdate(): Promise<boolean> {
  const nativeModule = getInAppUpdateModule();
  if (Platform.OS !== 'android' || !nativeModule) return false;
  try {
    return await nativeModule.completeUpdate();
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[AppUpdateChecker] completeAppUpdate failed:', error);
    }
    return false;
  }
}

/**
 * Opens Guanaco's Google Play Store listing.
 */
export async function openPlayStore(): Promise<boolean> {
  const nativeModule = getInAppUpdateModule();
  if (Platform.OS === 'android' && nativeModule) {
    try {
      return await nativeModule.openPlayStore();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Subscribes to Google Play download/install status updates.
 */
export function addInstallListener(
  callback: (progress: InstallProgress) => void
): () => void {
  if (!isNativeUpdateSupported()) {
    return () => {};
  }

  const subscription = DeviceEventEmitter.addListener(
    'onInstallStateChanged',
    callback
  );

  return () => {
    subscription.remove();
  };
}
