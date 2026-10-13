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
const STORAGE_KEY_LAST_CHECK = '@guanaco_update_last_check';
const CHECK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for non-forced checks

interface UpdateState {
  updateInfo: AppUpdateInfo | null;
  isChecking: boolean;
  lastCheckedTime: number | null;
  installProgress: InstallProgress | null;
  isPromptVisible: boolean;

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

  initialize: () => {
    // Listen to Google Play install state changes
    const unsubscribe = addInstallListener((progress) => {
      set({ installProgress: progress });
      if (progress.status === 'DOWNLOADED') {
        // When download finishes, show prompt to restart
        set({ isPromptVisible: true });
      }
    });

    return unsubscribe;
  },

  checkForUpdate: async (force = false) => {
    const { isChecking, lastCheckedTime, updateInfo } = get();
    if (isChecking) return updateInfo;

    const now = Date.now();

    // Check cooldown for non-forced checks
    if (!force) {
      let cachedLastCheck = lastCheckedTime;
      if (!cachedLastCheck) {
        try {
          const stored = await AsyncStorage.getItem(STORAGE_KEY_LAST_CHECK);
          if (stored) cachedLastCheck = parseInt(stored, 10);
        } catch {}
      }

      if (cachedLastCheck && now - cachedLastCheck < CHECK_COOLDOWN_MS && updateInfo) {
        return updateInfo;
      }
    }

    set({ isChecking: true });

    try {
      const info = await checkForAppUpdate();
      await AsyncStorage.setItem(STORAGE_KEY_LAST_CHECK, now.toString());

      let shouldShowPrompt = false;

      if (info?.isAvailable) {
        if (force) {
          shouldShowPrompt = true;
        } else {
          try {
            const dismissedStr = await AsyncStorage.getItem(STORAGE_KEY_DISMISSED_UNTIL);
            const dismissedUntil = dismissedStr ? parseInt(dismissedStr, 10) : 0;
            if (now >= dismissedUntil) {
              shouldShowPrompt = true;
            }
          } catch {
            shouldShowPrompt = true;
          }
        }
      }

      set({
        updateInfo: info,
        isChecking: false,
        lastCheckedTime: now,
        isPromptVisible: shouldShowPrompt,
      });

      return info;
    } catch {
      set({ isChecking: false });
      return null;
    }
  },

  dismissPrompt: async (hours = 24) => {
    const snoozeUntil = Date.now() + hours * 60 * 60 * 1000;
    try {
      await AsyncStorage.setItem(STORAGE_KEY_DISMISSED_UNTIL, snoozeUntil.toString());
    } catch {}
    set({ isPromptVisible: false });
  },

  showPrompt: () => {
    set({ isPromptVisible: true });
  },

  hidePrompt: () => {
    set({ isPromptVisible: false });
  },

  startUpdate: async (type = 'flexible') => {
    await startAppUpdate(type);
  },

  completeDownloadedUpdate: async () => {
    return await completeAppUpdate();
  },

  openStore: async () => {
    return await openPlayStore();
  },
}));
