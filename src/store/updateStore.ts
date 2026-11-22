import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppUpdateInfo,
  InstallProgress,
  checkForAppUpdate,
  startAppUpdate,
  completeAppUpdate,
  openPlayStore,
  addInstallListener,
} from '../services/appUpdateChecker';

const STORAGE_KEY_DISMISSED_UNTIL = '@guanaco_update_dismissed_until';
const STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL = '@guanaco_update_downloaded_dismissed_until';
const STORAGE_KEY_LAST_CHECK = '@guanaco_update_last_check';
const CHECK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for non-forced checks

// Tracks when an in-session active download (PENDING/DOWNLOADING -> DOWNLOADED) completed
// so an overlapping checkForUpdate(false) never suppresses a newly finished download.
let activeDownloadCompletedInSession = false;

interface UpdateState {
  updateInfo: AppUpdateInfo | null;
  isChecking: boolean;
  lastCheckedTime: number | null;
  installProgress: InstallProgress | null;
  isPromptVisible: boolean;
  isDownloadedDismissed: boolean;

  // Actions
  initialize: () => () => void;
  checkForUpdate: (force?: boolean) => Promise<AppUpdateInfo | null>;
  dismissPrompt: (hours?: number) => Promise<void>;
  showPrompt: () => void;
  hidePrompt: () => void;
  startUpdate: (type?: 'flexible' | 'immediate') => Promise<void>;
  completeDownloadedUpdate: () => Promise<boolean>;
  openStore: () => Promise<boolean>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  updateInfo: null,
  isChecking: false,
  lastCheckedTime: null,
  installProgress: null,
  isPromptVisible: false,
  isDownloadedDismissed: false,

  initialize: () => {
    activeDownloadCompletedInSession = false;

    // Listen to Google Play install state changes
    const unsubscribe = addInstallListener(async (progress) => {
      const prevStatus = get().installProgress?.status;

      if (progress.status === 'DOWNLOADED') {
        // An active download just completed — clear any prior snooze and prompt user to restart
        if (prevStatus === 'DOWNLOADING' || prevStatus === 'PENDING') {
          activeDownloadCompletedInSession = true;
          set({
            installProgress: progress,
            isDownloadedDismissed: false,
            isPromptVisible: true,
          });
          AsyncStorage.removeItem(STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL).catch(() => {});
          return;
        }

        // Already dismissed during this session — do not re-popup on duplicate Play Core events
        if (get().isDownloadedDismissed) {
          set({ installProgress: progress });
          return;
        }

        // Check persisted snooze timestamp (e.g. cold start after tapping "Later")
        let isSnoozedInStorage = false;
        try {
          const dismissedStr = await AsyncStorage.getItem(STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL);
          const dismissedUntil = dismissedStr ? parseInt(dismissedStr, 10) : 0;
          if (!Number.isNaN(dismissedUntil) && Date.now() < dismissedUntil) {
            isSnoozedInStorage = true;
          }
        } catch {}

        // Re-read live state after AsyncStorage await to avoid clobbering concurrent dismissal/completion
        set((state) => {
          if (activeDownloadCompletedInSession) {
            return {
              installProgress: progress,
              isDownloadedDismissed: false,
              isPromptVisible: true,
            };
          }
          const snoozed = state.isDownloadedDismissed || isSnoozedInStorage;
          return {
            installProgress: progress,
            isDownloadedDismissed: snoozed,
            isPromptVisible: snoozed ? false : true,
          };
        });
        return;
      }

      if (progress.status === 'DOWNLOADING' || progress.status === 'PENDING') {
        activeDownloadCompletedInSession = false;
        set({
          installProgress: progress,
          isDownloadedDismissed: false,
        });
        return;
      }

      if (progress.status === 'INSTALLED') {
        activeDownloadCompletedInSession = false;
        set({
          installProgress: progress,
          isDownloadedDismissed: false,
          isPromptVisible: false,
        });
        AsyncStorage.removeItem(STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL).catch(() => {});
        AsyncStorage.removeItem(STORAGE_KEY_DISMISSED_UNTIL).catch(() => {});
        return;
      }

      set({ installProgress: progress });
    });

    return unsubscribe;
  },

  checkForUpdate: async (force = false) => {
    const { isChecking, lastCheckedTime, updateInfo } = get();
    if (isChecking) return updateInfo;

    const now = Date.now();

    // Check 1-hour cooldown for non-forced checks (even when updateInfo is null)
    if (!force) {
      let cachedLastCheck = lastCheckedTime;
      if (cachedLastCheck === null) {
        try {
          const stored = await AsyncStorage.getItem(STORAGE_KEY_LAST_CHECK);
          if (stored) {
            const parsed = parseInt(stored, 10);
            if (!Number.isNaN(parsed)) {
              cachedLastCheck = parsed;
            }
          }
        } catch {}
      }

      if (cachedLastCheck !== null && now - cachedLastCheck < CHECK_COOLDOWN_MS) {
        if (lastCheckedTime === null) {
          set({ lastCheckedTime: cachedLastCheck });
        }
        return updateInfo;
      }
    }

    set({ isChecking: true });

    try {
      const info = await checkForAppUpdate();
      const completedAt = Date.now();
      try {
        await AsyncStorage.setItem(STORAGE_KEY_LAST_CHECK, completedAt.toString());
      } catch {}

      let dismissedUntil = 0;
      let dlDismissedUntil = 0;

      if (force) {
        if (
          info?.isAvailable ||
          info?.installStatus === 'DOWNLOADED' ||
          get().installProgress?.status === 'DOWNLOADED'
        ) {
          try {
            await AsyncStorage.removeItem(STORAGE_KEY_DISMISSED_UNTIL);
            await AsyncStorage.removeItem(STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL);
          } catch {}
        }
      } else {
        try {
          const [dismissedStr, dlDismissedStr] = await Promise.all([
            AsyncStorage.getItem(STORAGE_KEY_DISMISSED_UNTIL),
            AsyncStorage.getItem(STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL),
          ]);
          const parsedDismissed = dismissedStr ? parseInt(dismissedStr, 10) : 0;
          const parsedDlDismissed = dlDismissedStr ? parseInt(dlDismissedStr, 10) : 0;
          if (!Number.isNaN(parsedDismissed)) dismissedUntil = parsedDismissed;
          if (!Number.isNaN(parsedDlDismissed)) dlDismissedUntil = parsedDlDismissed;
        } catch {}
      }

      // Re-read live store state atomically AFTER all awaits so concurrent
      // onInstallStateChanged(DOWNLOADED) or dismissPrompt() updates are never clobbered.
      set((state) => {
        const synthesizedProgress: InstallProgress | null =
          state.installProgress ??
          (info?.installStatus === 'DOWNLOADED'
            ? {
                status: 'DOWNLOADED',
                bytesDownloaded: 0,
                totalBytesToDownload: 0,
                errorCode: 0,
              }
            : null);

        const isDownloadedNow = synthesizedProgress?.status === 'DOWNLOADED';

        if (force) {
          const canPrompt = Boolean(info?.isAvailable || isDownloadedNow);
          return {
            updateInfo: info,
            installProgress: synthesizedProgress,
            isChecking: false,
            lastCheckedTime: completedAt,
            isPromptVisible: canPrompt,
            isDownloadedDismissed: canPrompt ? false : state.isDownloadedDismissed,
          };
        }

        if (isDownloadedNow) {
          if (activeDownloadCompletedInSession) {
            return {
              updateInfo: info,
              installProgress: synthesizedProgress,
              isChecking: false,
              lastCheckedTime: completedAt,
              isPromptVisible: true,
              isDownloadedDismissed: false,
            };
          }

          const dlSnoozed = state.isDownloadedDismissed || completedAt < dlDismissedUntil;
          return {
            updateInfo: info,
            installProgress: synthesizedProgress,
            isChecking: false,
            lastCheckedTime: completedAt,
            isPromptVisible: !dlSnoozed,
            isDownloadedDismissed: dlSnoozed,
          };
        }

        const updateSnoozed = completedAt < dismissedUntil;
        const shouldShowPrompt = Boolean(info?.isAvailable && !updateSnoozed);

        return {
          updateInfo: info,
          installProgress: synthesizedProgress,
          isChecking: false,
          lastCheckedTime: completedAt,
          isPromptVisible: shouldShowPrompt,
          isDownloadedDismissed: state.isDownloadedDismissed,
        };
      });

      return info;
    } catch {
      set({ isChecking: false });
      return null;
    }
  },

  dismissPrompt: async (hours = 24) => {
    activeDownloadCompletedInSession = false;
    const snoozeUntil = Date.now() + hours * 60 * 60 * 1000;
    const isDownloaded = get().installProgress?.status === 'DOWNLOADED';
    set({
      isPromptVisible: false,
      ...(isDownloaded ? { isDownloadedDismissed: true } : {}),
    });
    try {
      await AsyncStorage.setItem(STORAGE_KEY_DISMISSED_UNTIL, snoozeUntil.toString());
      if (isDownloaded) {
        await AsyncStorage.setItem(
          STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL,
          snoozeUntil.toString()
        );
      }
    } catch {}
  },

  showPrompt: () => {
    set({ isPromptVisible: true, isDownloadedDismissed: false });
  },

  hidePrompt: () => {
    set({ isPromptVisible: false });
  },

  startUpdate: async (type = 'flexible') => {
    activeDownloadCompletedInSession = false;
    set({ isDownloadedDismissed: false });
    AsyncStorage.removeItem(STORAGE_KEY_DOWNLOADED_DISMISSED_UNTIL).catch(() => {});
    await startAppUpdate(type);
  },

  completeDownloadedUpdate: async () => {
    return await completeAppUpdate();
  },

  openStore: async () => {
    return await openPlayStore();
  },
}));
