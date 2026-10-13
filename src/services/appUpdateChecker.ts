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

const { InAppUpdate } = NativeModules;

export const isNativeUpdateSupported = (): boolean => {
  return Platform.OS === 'android' && !!InAppUpdate;
};

/**
 * Queries Google Play Services for an available in-app update.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  if (!isNativeUpdateSupported()) {
    return null;
  }

  try {
    const info: AppUpdateInfo = await InAppUpdate.checkForUpdate();
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
  if (!isNativeUpdateSupported()) {
    // Fallback: Open Google Play directly
    await openPlayStore();
    return 'accepted';
  }

  try {
    const result = await InAppUpdate.startUpdateFlow(type);
    return result?.status || 'accepted';
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[AppUpdateChecker] In-app update flow failed, falling back to Play Store:', error);
    }
    // Fallback to opening Play Store page
    await openPlayStore();
    return 'accepted';
  }
}

/**
 * For flexible updates: Triggers Google Play to complete the update and restart the app.
 */
export async function completeAppUpdate(): Promise<boolean> {
  if (!isNativeUpdateSupported()) return false;
  try {
    return await InAppUpdate.completeUpdate();
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
  if (isNativeUpdateSupported()) {
    try {
      return await InAppUpdate.openPlayStore();
    } catch {
      // Fallback
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
