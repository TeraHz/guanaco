import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  AppState,
  Platform,
  useWindowDimensions,
  Image,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useShallow } from 'zustand/react/shallow';
import {
  useTaskStore,
  CACHE_KEY_LOCAL_MODE,
  CACHE_KEY_SYNC_FAILURES,
} from './store/taskStore';
import { countDistinctPendingChanges, SYNC_QUEUE_STORAGE_KEY } from './store/syncQueue';
import {
  clearMigrationCheckpoint,
  isUntouchedEmptyStarterProject,
  migrateLocalDataToServer,
} from './services/localMigration';
import { LoginScreen, LoginConnectOptions } from './screens/LoginScreen';
import { ProjectTasksScreen } from './screens/ProjectTasksScreen';
import { ProjectDrawer } from './screens/ProjectDrawer';
import { VikunjaClient, parseAndValidateServerUrl } from './api/client';
import { User } from './types/vikunja';
import { useAppTheme } from './utils/theme';
import { hexToRgba } from './utils/colors';
import {
  getStoredAuth,
  setStoredAuth,
  setStoredRefreshToken,
  clearStoredAuth,
  clearStoredCredentialsOnly,
  clearNativeCookies,
  getAppLockCapability,
  isBiometricEnabled,
  getCachedBiometricEnabled,
  setBiometricEnabled,
  unlockWithBestAvailableMethod,
  authenticateWithDeviceCredentials,
  cancelBiometricPrompt,
  isAndroidActivityReadyForBiometrics,
  isPersonalApiToken,
} from './utils/biometrics';
import * as Notifications from 'expo-notifications';
import {
  initNotifications,
  NOTIF_ACTION_MARK_DONE,
  NOTIF_ACTION_SNOOZE_15M,
  scheduleSnoozedReminder,
  shouldCompleteTaskFromNotification,
  syncAppBadgeCount,
} from './services/localNotifications';
import { isSystemFileDialogRecentlyActive } from './utils/localBackup';
import { useUpdateStore } from './store/updateStore';
import { AppUpdatePromptModal } from './components/AppUpdatePromptModal';
import { loadStoredLanguagePreference, t as translate, useTranslation } from './i18n';

/** Grace period in milliseconds in background before requiring biometric re-unlock on resume. */
export const BIOMETRIC_LOCK_GRACE_MS = 15_000;

interface PendingNotificationAction {
  actionId: string;
  notifId: string;
  taskId: number;
  data: {
    taskId?: number;
    taskDueDate?: string | null;
    occurrenceAnchor?: string | null;
  };
}

type UnsyncedSwitchDecision = 'cancel' | 'discard' | 'keep_and_sync';

export default function App() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isIosInactive, setIsIosInactive] = useState(
    () =>
      Platform.OS === 'ios' &&
      (AppState.currentState === 'inactive' || AppState.currentState === 'background')
  );
  const [lockError, setLockError] = useState<string | null>(null);
  const [pendingLockLogoutCount, setPendingLockLogoutCount] = useState<number | null>(null);
  const [pendingLockEraseLocal, setPendingLockEraseLocal] = useState(false);
  const [showReauthLogin, setShowReauthLogin] = useState(false);
  const [showConnectServerFromLocal, setShowConnectServerFromLocal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingLocalSession, setPendingLocalSession] = useState(false);
  const [pendingStoredSession, setPendingStoredSession] = useState<{
    serverUrl: string;
    token: string;
    refreshToken: string | null;
    username: string | null;
  } | null>(null);
  const [pendingNotifActionCount, setPendingNotifActionCount] = useState(0);
  const [webUnsyncedSwitchPrompt, setWebUnsyncedSwitchPrompt] = useState<{
    title: string;
    message: string;
    allowKeepAndSync: boolean;
    resolve: (decision: UnsyncedSwitchDecision) => void;
  } | null>(null);

  const backgroundedAtRef = useRef<number | null>(null);
  const biometricPromptInFlightRef = useRef(false);
  const biometricAttemptSeqRef = useRef(0);
  const needsAutoUnlockPromptRef = useRef(false);
  const isConnectingRef = useRef(false);
  const logoutEpochRef = useRef(0);
  const handledNotifKeysRef = useRef<Set<string>>(new Set());
  const pendingNotifActionsRef = useRef<PendingNotificationAction[]>([]);
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  const {
    initialize,
    initializeLocalMode,
    syncAll,
    authRequired,
    pendingSyncCount,
    isLocalMode,
    hasClient,
    isLoading,
    isSyncingAll,
  } = useTaskStore(
    useShallow((state) => ({
      initialize: state.initialize,
      initializeLocalMode: state.initializeLocalMode,
      syncAll: state.syncAll,
      authRequired: state.authRequired,
      pendingSyncCount: state.pendingSyncCount,
      isLocalMode: state.isLocalMode,
      hasClient: Boolean(state.client),
      isLoading: pendingNotifActionCount > 0 ? state.isLoading : false,
      isSyncingAll: pendingNotifActionCount > 0 ? Boolean(state.isSyncingAll) : false,
    }))
  );

  const localMigrationStats = useTaskStore(
    useShallow((state) => {
      if (!showConnectServerFromLocal || !state.isLocalMode) {
        return undefined;
      }
      const safeProjs = Array.isArray(state.projects)
        ? state.projects.filter((p) => p && p.id > 0 && !p.is_saved_filter)
        : [];
      const safeTasks = Array.isArray(state.tasks) ? state.tasks.filter(Boolean) : [];
      const nonEmptyOrCustomLists = safeProjs.filter(
        (p) => !isUntouchedEmptyStarterProject(p, safeProjs, safeTasks)
      ).length;
      return {
        lists: nonEmptyOrCustomLists,
        tasks: safeTasks.length,
      };
    })
  );

  useEffect(() => {
    const unsub = useTaskStore.subscribe((state, prev) => {
      if (
        (prev.client || prev.isLocalMode) &&
        !state.client &&
        !state.isLocalMode &&
        !isConnectingRef.current
      ) {
        pendingNotifActionsRef.current = [];
        setPendingNotifActionCount(0);
        setIsDrawerOpen(false);
        setShowReauthLogin(false);
        setShowConnectServerFromLocal(false);
        setLockError(null);
        setPendingLockLogoutCount(null);
        setPendingLockEraseLocal(false);
        isLockedRef.current = false;
        setIsLocked(false);
        setIsAuthenticated(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    initNotifications().catch(() => {});
    loadStoredLanguagePreference()
      .then((pref) => {
        if (pref !== 'system' && useTaskStore.getState().languagePreference !== pref) {
          useTaskStore.setState({ languagePreference: pref });
          return initNotifications();
        }
      })
      .catch(() => {});
  }, []);

  // Handle interactive local reminder actions (Mark Complete, Snooze 15m) & cold-start / live tap-to-open safely
  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      typeof Notifications.addNotificationResponseReceivedListener !== 'function'
    ) {
      return;
    }

    const handleNotificationResponse = (response: any) => {
      if (!response) return;
      const actionId = response?.actionIdentifier || 'DEFAULT';
      const notifId = response?.notification?.request?.identifier || '';
      const data = (response?.notification?.request?.content?.data || {}) as {
        taskId?: number;
        taskDueDate?: string | null;
        occurrenceAnchor?: string | null;
      };
      const taskId = typeof data.taskId === 'number' ? data.taskId : null;
      if (taskId === null) return;

      const dedupeKey = notifId
        ? `${notifId}:${actionId}`
        : `${actionId}:${taskId}:${data.taskDueDate ?? ''}:${data.occurrenceAnchor ?? ''}`;
      if (dedupeKey && handledNotifKeysRef.current.has(dedupeKey)) {
        return;
      }

      const isBgPastLockGrace = Boolean(
        backgroundedAtRef.current !== null &&
          Date.now() - backgroundedAtRef.current >= BIOMETRIC_LOCK_GRACE_MS &&
          getCachedBiometricEnabled()
      );

      if (isBgPastLockGrace && !isSystemFileDialogRecentlyActive()) {
        isLockedRef.current = true;
        setLockError(null);
        setPendingLockLogoutCount(null);
        setPendingLockEraseLocal(false);
        setIsLocked(true);
        setIsDrawerOpen(false);
      }

      if (actionId === NOTIF_ACTION_MARK_DONE || actionId === NOTIF_ACTION_SNOOZE_15M) {
        if (dedupeKey) handledNotifKeysRef.current.add(dedupeKey);
        (Notifications as any).clearLastNotificationResponseAsync?.().catch(() => {});
        const store = useTaskStore.getState();
        const target = (store.tasks || []).find((t) => t.id === taskId);
        const shouldQueue =
          isLockedRef.current ||
          isBgPastLockGrace ||
          !isAuthenticatedRef.current ||
          (!store.client && !store.isLocalMode) ||
          (!target && (Boolean(store.isLoading) || Boolean(store.isSyncingAll)));

        if (shouldQueue) {
          pendingNotifActionsRef.current.push({ actionId, notifId, taskId, data });
          setPendingNotifActionCount((c) => c + 1);
          return;
        }

        if (notifId && typeof Notifications.dismissNotificationAsync === 'function') {
          Notifications.dismissNotificationAsync(notifId).catch(() => {});
        }
        if (shouldCompleteTaskFromNotification(target, data)) {
          if (actionId === NOTIF_ACTION_MARK_DONE) {
            store.toggleTask(taskId);
          } else if (target) {
            scheduleSnoozedReminder(target, 15).catch(() => {});
          }
        }
        return;
      }

      // Default notification tap: stage taskId and close any open overlays so ProjectTasksScreen opens it cleanly
      if (dedupeKey) handledNotifKeysRef.current.add(dedupeKey);
      (Notifications as any).clearLastNotificationResponseAsync?.().catch(() => {});
      setIsDrawerOpen(false);
      if (!isConnectingRef.current) {
        setShowReauthLogin(false);
        setShowConnectServerFromLocal(false);
      }
      useTaskStore.getState().setPendingOpenTaskId(taskId);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    if (typeof Notifications.getLastNotificationResponseAsync === 'function') {
      Notifications.getLastNotificationResponseAsync()
        .then((lastResp) => {
          if (!lastResp) return;
          handleNotificationResponse(lastResp);
        })
        .catch(() => {});
    }

    return () => {
      sub?.remove?.();
    };
  }, []);

  // Flush queued cold-start or locked notification actions as soon as session is unlocked and hydrated
  useEffect(() => {
    const isBgPastLockGraceNow = Boolean(
      backgroundedAtRef.current !== null &&
        Date.now() - backgroundedAtRef.current >= BIOMETRIC_LOCK_GRACE_MS &&
        getCachedBiometricEnabled() &&
        !isSystemFileDialogRecentlyActive()
    );
    if (
      pendingNotifActionsRef.current.length === 0 ||
      !isAuthenticated ||
      isLocked ||
      isLockedRef.current ||
      isBgPastLockGraceNow ||
      (!hasClient && !isLocalMode)
    ) {
      return;
    }

    const queued = [...pendingNotifActionsRef.current];
    const remaining: PendingNotificationAction[] = [];

    for (const item of queued) {
      const store = useTaskStore.getState();
      const target = (store.tasks || []).find((t) => t.id === item.taskId);
      if (!target && (store.isLoading || store.isSyncingAll)) {
        remaining.push(item);
        continue;
      }

      if (item.notifId && typeof Notifications.dismissNotificationAsync === 'function') {
        Notifications.dismissNotificationAsync(item.notifId).catch(() => {});
      }
      if (shouldCompleteTaskFromNotification(target, item.data)) {
        if (item.actionId === NOTIF_ACTION_MARK_DONE) {
          store.toggleTask(item.taskId);
        } else if (item.actionId === NOTIF_ACTION_SNOOZE_15M && target) {
          scheduleSnoozedReminder(target, 15).catch(() => {});
        }
      }
    }

    pendingNotifActionsRef.current = remaining;
    if (remaining.length !== pendingNotifActionCount) {
      setPendingNotifActionCount(remaining.length);
    }
  }, [
    hasClient,
    isAuthenticated,
    isLoading,
    isLocalMode,
    isLocked,
    isSyncingAll,
    pendingNotifActionCount,
  ]);

  const promptBiometricUnlock = useCallback(
    async (options?: { forceReset?: boolean }): Promise<boolean> => {
      if (biometricPromptInFlightRef.current && !options?.forceReset) {
        return false;
      }
      const hadInFlight = biometricPromptInFlightRef.current;
      const seq = ++biometricAttemptSeqRef.current;
      biometricPromptInFlightRef.current = true;
      try {
        const result = await unlockWithBestAvailableMethod(translate('lock.unlockGuanaco'), {
          forceReset: Boolean(options?.forceReset || hadInFlight),
        });
        return result.passed;
      } finally {
        if (biometricAttemptSeqRef.current === seq) {
          biometricPromptInFlightRef.current = false;
        }
      }
    },
    []
  );

  const unlockOfflineSession = useCallback(
    async (sessionOverride?: {
      serverUrl: string;
      token: string;
      refreshToken: string | null;
      username: string | null;
    }) => {
      const target = sessionOverride || pendingStoredSession;
      if (!isAuthenticated && target) {
        await initialize(target.serverUrl, target.token, target.refreshToken);
        setIsAuthenticated(true);
        setPendingStoredSession(null);
      } else if (!isAuthenticated && pendingLocalSession) {
        await initializeLocalMode({ seedDefaultsIfEmpty: false });
        setIsAuthenticated(true);
        setPendingLocalSession(false);
      }
      setLockError(null);
      setPendingLockLogoutCount(null);
      setPendingLockEraseLocal(false);
      isLockedRef.current = false;
      setIsLocked(false);
      if (useTaskStore.getState().client) {
        syncAll().catch(() => {});
      }
    },
    [
      initialize,
      initializeLocalMode,
      isAuthenticated,
      pendingLocalSession,
      pendingStoredSession,
      syncAll,
    ]
  );

  // Google Play In-App Updates lifecycle & listeners (only check when authenticated & unlocked)
  useEffect(() => {
    if (!isAuthenticated || isLocked) return;

    const unsub = useUpdateStore.getState().initialize();

    const initialCheckTimer = setTimeout(() => {
      useUpdateStore.getState().checkForUpdate().catch(() => {});
    }, 2500);

    const periodicCheckTimer = setInterval(() => {
      useUpdateStore.getState().checkForUpdate().catch(() => {});
    }, 3 * 60 * 60 * 1000);

    return () => {
      clearTimeout(initialCheckTimer);
      clearInterval(periodicCheckTimer);
      unsub();
    };
  }, [isAuthenticated, isLocked]);

  // Cold-start session restoration & offline-capable biometric gate
  useEffect(() => {
    let mounted = true;
    async function restoreSession() {
      const stored = await getStoredAuth();
      if (!mounted || isConnectingRef.current) return;

      if (!stored.serverUrl || !stored.token) {
        const storedLocalMode = await AsyncStorage.getItem(CACHE_KEY_LOCAL_MODE).catch(
          () => null
        );
        if (!mounted || isConnectingRef.current || storedLocalMode !== 'true') return;

        const bioEnabled = await isBiometricEnabled();
        const lockCap = bioEnabled
          ? await getAppLockCapability()
          : { enforceable: false, biometricAvailable: false };
        if (!mounted || isConnectingRef.current) return;

        if (bioEnabled && !lockCap.enforceable) {
          await setBiometricEnabled(false).catch(() => {});
        }

        if (bioEnabled && lockCap.enforceable) {
          setPendingLocalSession(true);
          setLockError(null);
          isLockedRef.current = true;
          setIsLocked(true);

          const readyForPrompt = await isAndroidActivityReadyForBiometrics();
          if (!mounted || isConnectingRef.current) return;
          if (!readyForPrompt) {
            needsAutoUnlockPromptRef.current = true;
            return;
          }

          const passed = await promptBiometricUnlock();
          if (!mounted || isConnectingRef.current) return;
          if (!passed) {
            return;
          }

          await initializeLocalMode({ seedDefaultsIfEmpty: false });
          if (!mounted || isConnectingRef.current) return;
          setPendingLocalSession(false);
          setIsAuthenticated(true);
          isLockedRef.current = false;
          setIsLocked(false);
          return;
        }

        await initializeLocalMode({ seedDefaultsIfEmpty: false });
        if (!mounted || isConnectingRef.current) return;
        setIsAuthenticated(true);
        setIsLocked(false);
        return;
      }

      const bioEnabled = await isBiometricEnabled();
      const lockCap = bioEnabled
        ? await getAppLockCapability()
        : { enforceable: false, biometricAvailable: false };
      if (!mounted || isConnectingRef.current) return;

      if (bioEnabled && !lockCap.enforceable) {
        await setBiometricEnabled(false).catch(() => {});
      }

      if (bioEnabled && lockCap.enforceable) {
        const sessionData = {
          serverUrl: stored.serverUrl,
          token: stored.token,
          refreshToken: stored.refreshToken,
          username: stored.username,
        };
        setPendingStoredSession(sessionData);
        setLockError(null);
        isLockedRef.current = true;
        setIsLocked(true);

        const readyForPrompt = await isAndroidActivityReadyForBiometrics();
        if (!mounted || isConnectingRef.current) return;
        if (!readyForPrompt) {
          // Device Keyguard is still locked — defer auto-prompt until Android window focus arrives
          needsAutoUnlockPromptRef.current = true;
          return;
        }

        const passed = await promptBiometricUnlock();
        if (!mounted || isConnectingRef.current) return;
        if (!passed) {
          // Stay on the biometric lock gate without exposing cached tasks or requiring network login
          return;
        }

        await initialize(stored.serverUrl, stored.token, stored.refreshToken);
        if (!mounted || isConnectingRef.current) return;
        setPendingStoredSession(null);
        setIsAuthenticated(true);
        isLockedRef.current = false;
        setIsLocked(false);
        syncAll().catch(() => {});
        return;
      }

      // Biometrics disabled or unavailable on device: restore offline cached data in 0ms
      await initialize(stored.serverUrl, stored.token, stored.refreshToken);
      if (!mounted || isConnectingRef.current) return;
      setIsAuthenticated(true);
      setIsLocked(false);
      syncAll().catch(() => {});
    }
    restoreSession();
    return () => {
      mounted = false;
    };
  }, [initialize, initializeLocalMode, promptBiometricUnlock, syncAll]);

  // On Android, when the screen wakes behind a locked Keyguard, defer auto-prompt until window focus arrives
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const focusSub = AppState.addEventListener('focus', () => {
      if (!isLockedRef.current || !needsAutoUnlockPromptRef.current) return;

      (async () => {
        const ready = await isAndroidActivityReadyForBiometrics();
        if (!ready || !isLockedRef.current || !needsAutoUnlockPromptRef.current) return;
        needsAutoUnlockPromptRef.current = false;

        const passed = await promptBiometricUnlock();
        if (!passed) return;

        isLockedRef.current = false;
        await unlockOfflineSession();
      })().catch(() => {});
    });

    return () => {
      focusSub?.remove?.();
    };
  }, [promptBiometricUnlock, unlockOfflineSession]);

  // Resume-aware biometric lock (grace period), iOS switcher privacy curtain & bi-directional foreground sync
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const refreshForegroundState = () => {
      const st = useTaskStore.getState();
      if (st.isLocalMode && !st.client) {
        syncAppBadgeCount(st.tasks || [], st.appBadgeMode).catch(() => {});
      } else {
        (syncAll as any)({ silent: true }).catch(() => {});
      }
    };

    const startPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        if (AppState.currentState === 'active' && !isLockedRef.current) {
          refreshForegroundState();
        }
      }, 120000);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    if (Platform.OS === 'ios') {
      setIsIosInactive(
        AppState.currentState === 'inactive' || AppState.currentState === 'background'
      );
    }

    if (isAuthenticated && AppState.currentState === 'active' && !isLockedRef.current) {
      startPolling();
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (Platform.OS === 'ios') {
        setIsIosInactive(nextAppState === 'inactive' || nextAppState === 'background');
      }

      if (!isAuthenticated) {
        return;
      }

      if (nextAppState === 'background') {
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
        if (biometricPromptInFlightRef.current) {
          biometricAttemptSeqRef.current += 1;
          biometricPromptInFlightRef.current = false;
          cancelBiometricPrompt().catch(() => {});
        }
        stopPolling();
        return;
      }

      if (nextAppState === 'active') {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        const elapsedMs = bgAt !== null ? Date.now() - bgAt : 0;

        // Do not lock & unmount SettingsModal while returning from Android SAF / Share picker
        const skipLockForSystemDialog = isSystemFileDialogRecentlyActive();

        // Synchronously conceal task list on frame 0 if biometrics were cached as enabled
        if (
          !skipLockForSystemDialog &&
          bgAt !== null &&
          elapsedMs >= BIOMETRIC_LOCK_GRACE_MS &&
          getCachedBiometricEnabled()
        ) {
          isLockedRef.current = true;
          setLockError(null);
          setPendingLockLogoutCount(null);
          setPendingLockEraseLocal(false);
          setIsLocked(true);
          setIsDrawerOpen(false);
          stopPolling();
        }

        (async () => {
          if (!skipLockForSystemDialog && bgAt !== null && elapsedMs >= BIOMETRIC_LOCK_GRACE_MS) {
            const bioEnabled = await isBiometricEnabled();
            const lockCap = bioEnabled
              ? await getAppLockCapability()
              : { enforceable: false, biometricAvailable: false };
            if (bioEnabled && lockCap.enforceable) {
              isLockedRef.current = true;
              setLockError(null);
              setPendingLockLogoutCount(null);
              setPendingLockEraseLocal(false);
              setIsLocked(true);
              setIsDrawerOpen(false);
              stopPolling();

              const readyNow = await isAndroidActivityReadyForBiometrics();
              if (!readyNow) {
                needsAutoUnlockPromptRef.current = true;
                return;
              }

              needsAutoUnlockPromptRef.current = false;
              const passed = await promptBiometricUnlock();
              if (!passed) {
                return;
              }
              isLockedRef.current = false;
              setIsLocked(false);
            } else {
              if (bioEnabled && !lockCap.enforceable) {
                await setBiometricEnabled(false).catch(() => {});
              }
              if (isLockedRef.current) {
                // Zero biometric AND zero OS PIN configured while backgrounded
                isLockedRef.current = false;
                setIsLocked(false);
              }
            }
          }

          if (!isLockedRef.current) {
            refreshForegroundState();
            useUpdateStore.getState().checkForUpdate().catch(() => {});
            startPolling();
          }
        })().catch(() => {});
      }
    });

    let handleFocus: (() => void) | null = null;
    let handleBlur: (() => void) | null = null;
    if (
      isAuthenticated &&
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      handleFocus = () => {
        if (!isLockedRef.current) {
          refreshForegroundState();
          startPolling();
        }
      };
      handleBlur = () => {
        stopPolling();
      };
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
    }

    return () => {
      subscription?.remove?.();
      stopPolling();
      if (handleFocus && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', handleFocus);
      }
      if (handleBlur && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('blur', handleBlur);
      }
    };
  }, [isAuthenticated, promptBiometricUnlock, syncAll]);

  const handleStartLocalMode = async () => {
    logoutEpochRef.current += 1;
    isConnectingRef.current = true;
    setIsConnecting(true);
    try {
      // Never allow tapping "Use Offline" during cold-start microtasks to bypass an existing lock-protected session
      const [stored, storedLocalFlag, bioEnabled] = await Promise.all([
        getStoredAuth().catch(() => null),
        AsyncStorage.getItem(CACHE_KEY_LOCAL_MODE).catch(() => null),
        isBiometricEnabled().catch(() => false),
      ]);
      const lockCap = bioEnabled
        ? await getAppLockCapability().catch(() => ({
            enforceable: true,
            biometricAvailable: false,
          }))
        : { enforceable: false, biometricAvailable: false };

      const hasProtectedExistingSession =
        bioEnabled &&
        lockCap.enforceable &&
        ((stored && stored.serverUrl && stored.token) || storedLocalFlag === 'true');

      if (hasProtectedExistingSession) {
        const passed = await promptBiometricUnlock({ forceReset: true });
        if (!passed) {
          if (stored && stored.serverUrl && stored.token) {
            setPendingStoredSession({
              serverUrl: stored.serverUrl,
              token: stored.token,
              refreshToken: stored.refreshToken,
              username: stored.username,
            });
          } else {
            setPendingLocalSession(true);
          }
          isLockedRef.current = true;
          setIsLocked(true);
          return;
        }
        if (storedLocalFlag === 'true' && (!stored || !stored.token)) {
          await initializeLocalMode({ seedDefaultsIfEmpty: false });
          setPendingLocalSession(false);
          isLockedRef.current = false;
          setIsLocked(false);
          setIsAuthenticated(true);
          return;
        }
      }

      // Starting fresh Local Mode: wipe any leftover server tokens/sessions cleanly
      pendingNotifActionsRef.current = [];
      setPendingNotifActionCount(0);
      await Promise.all([
        clearStoredAuth(),
        useTaskStore.getState().clearSession(),
      ]);
      await initializeLocalMode({ seedDefaultsIfEmpty: true });
      setPendingStoredSession(null);
      setPendingLocalSession(false);
      setShowReauthLogin(false);
      setShowConnectServerFromLocal(false);
      setLockError(null);
      setPendingLockLogoutCount(null);
      setPendingLockEraseLocal(false);
      isLockedRef.current = false;
      setIsLocked(false);
      setIsAuthenticated(true);
    } finally {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  };

  const computeUnsyncedChangesCount = async (
    extraPendingSyncCount = 0
  ): Promise<number> => {
    const liveSnap = useTaskStore.getState();
    const liveQueuePending =
      typeof liveSnap.syncQueue?.getPendingCount === 'function'
        ? liveSnap.syncQueue.getPendingCount()
        : 0;

    let storedQueuePending = 0;
    try {
      const rawQueue = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
      if (rawQueue) {
        const parsedQueue = JSON.parse(rawQueue);
        if (Array.isArray(parsedQueue)) {
          storedQueuePending = countDistinctPendingChanges(parsedQueue);
        }
      }
    } catch (_) {}

    const memNegTaskCount = Array.isArray(liveSnap.tasks)
      ? liveSnap.tasks.filter((item) => item && typeof item.id === 'number' && item.id < 0).length
      : 0;
    let cachedNegTaskCount = 0;
    if (memNegTaskCount === 0 && liveQueuePending === 0 && storedQueuePending === 0) {
      try {
        const rawTasks = await AsyncStorage.getItem('@vikunja_cached_tasks');
        if (rawTasks) {
          const parsedTasks = JSON.parse(rawTasks);
          if (Array.isArray(parsedTasks)) {
            cachedNegTaskCount = parsedTasks.filter(
              (item: any) => item && typeof item.id === 'number' && item.id < 0
            ).length;
          }
        }
      } catch (_) {}
    }

    const pendingQueueChanges = Math.max(
      Number(liveSnap.pendingSyncCount || 0),
      Number(extraPendingSyncCount || 0),
      liveQueuePending,
      storedQueuePending,
      memNegTaskCount,
      cachedNegTaskCount
    );

    const memFailuresCount = Array.isArray((liveSnap as any).syncFailures)
      ? (liveSnap as any).syncFailures.length
      : 0;
    let storedFailuresCount = 0;
    if (memFailuresCount === 0) {
      try {
        const rawFailures = await AsyncStorage.getItem(CACHE_KEY_SYNC_FAILURES);
        if (rawFailures) {
          const parsedFailures = JSON.parse(rawFailures);
          if (Array.isArray(parsedFailures)) {
            storedFailuresCount = parsedFailures.length;
          }
        }
      } catch (_) {}
    }

    return pendingQueueChanges + (memFailuresCount || storedFailuresCount);
  };

  const handleConnect = async (
    rawServerUrl: string,
    username: string,
    secret: string,
    options?: LoginConnectOptions
  ): Promise<void | { cancelled?: boolean }> => {
    const parsedUrl = parseAndValidateServerUrl(rawServerUrl);
    if (parsedUrl.isInsecureHttp && !options?.allowInsecureHttp) {
      throw new Error(t('auth.insecureHttpError'));
    }

    const normalizedUrl = parsedUrl.serverUrl;
    const isTokenAuth =
      options?.authMethod === 'api_token' || isPersonalApiToken(secret);

    logoutEpochRef.current += 1;
    isConnectingRef.current = true;
    setIsConnecting(true);

    try {
      const initialStoreSnap = useTaskStore.getState();
      const wasLocalMode = Boolean(initialStoreSnap.isLocalMode);

      // Only clear native cookies up-front when coming from standalone Local Mode;
      // in Server Mode, defer clearNativeCookies() until after user confirms any unsynced switch!
      if (wasLocalMode) {
        await clearNativeCookies();
      }

      let activeToken: string;
      let activeRefreshToken: string | null = null;
      let resolvedUsername = username.trim();
      let authUser: User | null = null;
      let passwordAuthClient: VikunjaClient | null = null;

      if (isTokenAuth) {
        const candidateToken = secret.trim();
        const tempClient = new VikunjaClient({
          baseUrl: normalizedUrl,
          token: candidateToken,
        });
        const user = await tempClient.getCurrentUser();
        if (!user || (!user.id && !user.username)) {
          throw new Error(t('auth.invalidApiToken'));
        }
        authUser = user;
        activeToken = candidateToken;
        activeRefreshToken = null;
        if (user.username) {
          resolvedUsername = user.username;
        }
      } else {
        const tempClient = new VikunjaClient({ baseUrl: normalizedUrl });
        passwordAuthClient = tempClient;
        const auth = await tempClient.login(
          resolvedUsername,
          secret,
          true,
          options?.totpPasscode
        );
        activeToken = auth.token;
        activeRefreshToken = tempClient.getRefreshToken();
        // Best-effort resolve canonical user profile so email <-> username / tk_ re-auth matches accurately
        authUser = await tempClient.getCurrentUser().catch(() => null);
        if (authUser?.username) {
          resolvedUsername = authUser.username;
        }
      }

      if (wasLocalMode) {
        const migMode = options?.migrationMode ?? 'merge';

        if (migMode === 'replace') {
          pendingNotifActionsRef.current = [];
          setPendingNotifActionCount(0);
          await clearMigrationCheckpoint();
          await useTaskStore.getState().clearSession();
          if (isTokenAuth) {
            await clearNativeCookies();
          }

          await setStoredAuth(activeToken, normalizedUrl, resolvedUsername || undefined, {
            refreshToken: activeRefreshToken,
          });
          await initialize(normalizedUrl, activeToken, activeRefreshToken);
          if (authUser && authUser.username) {
            useTaskStore.setState({ currentUser: authUser });
          }
        } else {
          const migrationClient = new VikunjaClient({
            baseUrl: normalizedUrl,
            token: activeToken,
            refreshToken: activeRefreshToken,
            onRefreshTokenUpdated: async (nextRt) => {
              activeRefreshToken = nextRt;
              await setStoredRefreshToken(nextRt);
            },
          });

          const userScope = authUser?.id
            ? `id:${authUser.id}`
            : resolvedUsername || normalizedUrl;

          const migResult = await migrateLocalDataToServer({
            client: migrationClient,
            localProjects: initialStoreSnap.projects || [],
            localTasks: initialStoreSnap.tasks || [],
            localLabels: initialStoreSnap.labels || [],
            selectedProjectId: initialStoreSnap.selectedProjectId,
            userScope,
          });

          const finalRefreshToken = migrationClient.getRefreshToken() ?? activeRefreshToken;

          await useTaskStore.getState().clearSession();
          if (isTokenAuth) {
            await clearNativeCookies();
          }

          if (migResult.mappedSelectedProjectId !== null && migResult.mappedSelectedProjectId > 0) {
            await AsyncStorage.setItem(
              '@vikunja_last_project_id',
              String(migResult.mappedSelectedProjectId)
            ).catch(() => {});
          }

          await setStoredAuth(activeToken, normalizedUrl, resolvedUsername || undefined, {
            refreshToken: finalRefreshToken,
          });

          await initialize(normalizedUrl, activeToken, finalRefreshToken);
          if (authUser && authUser.username) {
            useTaskStore.setState({ currentUser: authUser });
          }

          await useTaskStore.getState().seedMigratedServerState({
            projects: migResult.mergedProjects,
            labels: migResult.mergedLabels,
            tasks: migResult.uploadedServerTasks,
            selectedProjectId: migResult.mappedSelectedProjectId,
          });

          if (
            Array.isArray((migResult as any).skippedTasks) &&
            (migResult as any).skippedTasks.length > 0
          ) {
            (useTaskStore.getState() as any).recordSkippedMigrationTasks?.(
              (migResult as any).skippedTasks
            );
          }

          if (
            migResult.deferredTasks.length > 0 ||
            migResult.deferredRelations.length > 0 ||
            migResult.deferredFollowUps.length > 0
          ) {
            useTaskStore
              .getState()
              .enqueueDeferredMigrationItems(
                migResult.deferredTasks,
                migResult.deferredRelations,
                migResult.deferredFollowUps
              );
          }
        }
      } else {
        const prevStored = await getStoredAuth();
        let prevCurrentUser: User | null = initialStoreSnap.currentUser;
        if (!prevCurrentUser) {
          try {
            const rawPrevUser = await AsyncStorage.getItem('@vikunja_current_user');
            if (rawPrevUser) {
              const parsedPrevUser = JSON.parse(rawPrevUser);
              if (parsedPrevUser && typeof parsedPrevUser === 'object') {
                prevCurrentUser = parsedPrevUser as User;
              }
            }
          } catch (_) {}
        }

        let canonicalPrevUrl: string | null = null;
        if (prevStored.serverUrl) {
          try {
            canonicalPrevUrl = parseAndValidateServerUrl(prevStored.serverUrl).serverUrl;
          } catch (_) {
            canonicalPrevUrl = prevStored.serverUrl.trim().replace(/\/+$/, '');
          }
        }

        const isDifferentServer =
          Boolean(canonicalPrevUrl) && canonicalPrevUrl !== normalizedUrl;

        const hadPreviousUser = Boolean(
          prevStored.username || prevCurrentUser?.username || (prevCurrentUser && prevCurrentUser.id > 0)
        );

        let isDifferentUser = false;
        if (authUser && prevCurrentUser && authUser.id > 0 && prevCurrentUser.id > 0) {
          isDifferentUser = authUser.id !== prevCurrentUser.id;
        } else if (hadPreviousUser) {
          const prevIdentifiers = new Set(
            [
              prevStored.username,
              prevCurrentUser?.username,
              prevCurrentUser?.email,
            ]
              .filter((v): v is string => Boolean(v))
              .map((v) => v.toLowerCase())
          );
          const nextIdentifiers = [
            resolvedUsername,
            username.trim(),
            authUser?.username,
            authUser?.email,
          ]
            .filter((v): v is string => Boolean(v))
            .map((v) => v.toLowerCase());

          // Fail-closed: if we had a previous user and cannot confirm overlap with the new identity, isolate!
          isDifferentUser =
            prevIdentifiers.size > 0 &&
            (nextIdentifiers.length === 0 || !nextIdentifiers.some((id) => prevIdentifiers.has(id)));
        }

        const unsyncedCount = await computeUnsyncedChangesCount(
          initialStoreSnap.pendingSyncCount || 0
        );

        let switchDecision: UnsyncedSwitchDecision = 'discard';

        if (unsyncedCount > 0 && (isDifferentServer || isDifferentUser)) {
          const title = t('auth.unsyncedSwitchTitle');
          setIsConnecting(false);
          if (isDifferentUser) {
            const message = t('auth.unsyncedDifferentUserMsg', { count: unsyncedCount });
            if (Platform.OS === 'web') {
              switchDecision = await new Promise<UnsyncedSwitchDecision>((resolve) => {
                setWebUnsyncedSwitchPrompt({
                  title,
                  message,
                  allowKeepAndSync: false,
                  resolve: (decision) => {
                    setWebUnsyncedSwitchPrompt(null);
                    resolve(decision);
                  },
                });
              });
            } else {
              switchDecision = await new Promise<UnsyncedSwitchDecision>((resolve) => {
                Alert.alert(
                  title,
                  message,
                  [
                    {
                      text: t('common.cancel'),
                      style: 'cancel',
                      onPress: () => resolve('cancel'),
                    },
                    {
                      text: t('auth.discardAndConnect'),
                      style: 'destructive',
                      onPress: () => resolve('discard'),
                    },
                  ],
                  { cancelable: true, onDismiss: () => resolve('cancel') }
                );
              });
            }
          } else {
            const message = t('auth.unsyncedDifferentUrlMsg', {
              count: unsyncedCount,
              prevUrl: canonicalPrevUrl || prevStored.serverUrl || '',
              nextUrl: normalizedUrl,
            });
            if (Platform.OS === 'web') {
              switchDecision = await new Promise<UnsyncedSwitchDecision>((resolve) => {
                setWebUnsyncedSwitchPrompt({
                  title,
                  message,
                  allowKeepAndSync: true,
                  resolve: (decision) => {
                    setWebUnsyncedSwitchPrompt(null);
                    resolve(decision);
                  },
                });
              });
            } else {
              switchDecision = await new Promise<UnsyncedSwitchDecision>((resolve) => {
                Alert.alert(
                  title,
                  message,
                  [
                    {
                      text: t('auth.keepAndSyncNewUrl'),
                      onPress: () => resolve('keep_and_sync'),
                    },
                    {
                      text: t('auth.discardAndConnect'),
                      style: 'destructive',
                      onPress: () => resolve('discard'),
                    },
                    {
                      text: t('common.cancel'),
                      style: 'cancel',
                      onPress: () => resolve('cancel'),
                    },
                  ],
                  { cancelable: true, onDismiss: () => resolve('cancel') }
                );
              });
            }
          }

          if (switchDecision === 'cancel') {
            if (passwordAuthClient) {
              await passwordAuthClient.logoutServer().catch(() => {});
            }
            return { cancelled: true };
          }
          setIsConnecting(true);
        }

        if ((isDifferentServer || isDifferentUser) && switchDecision === 'discard') {
          pendingNotifActionsRef.current = [];
          setPendingNotifActionCount(0);
          await useTaskStore.getState().clearSession();
          if (isDifferentUser || unsyncedCount > 0) {
            await setBiometricEnabled(false);
          }
        }
        if (isDifferentServer || isDifferentUser || isTokenAuth) {
          // Only clear native cookies after login if token auth, or if switching users without fresh cookie refresh
          if (isTokenAuth || !activeRefreshToken) {
            await clearNativeCookies();
          }
        }

        // Persist token, rotating refresh token, normalized server URL, and canonical username ONLY (zero plaintext passwords!)
        await setStoredAuth(activeToken, normalizedUrl, resolvedUsername || undefined, {
          refreshToken: activeRefreshToken,
        });

        await initialize(normalizedUrl, activeToken, activeRefreshToken);
        if (authUser && authUser.username) {
          useTaskStore.setState({ currentUser: authUser });
        }
      }

      setPendingStoredSession(null);
      setPendingLocalSession(false);
      setShowReauthLogin(false);
      setShowConnectServerFromLocal(false);
      setLockError(null);
      setPendingLockLogoutCount(null);
      setPendingLockEraseLocal(false);
      isLockedRef.current = false;
      setIsLocked(false);
      setIsAuthenticated(true);

      syncAll().catch(() => {});
    } finally {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  };

  const handleLogout = async () => {
    const myLogoutEpoch = ++logoutEpochRef.current;

    // Capture active client (or locked pending session) to revoke server refresh token best-effort,
    // while IMMEDIATELY clearing local credentials & store state at T=0ms before awaiting network!
    const activeClient = useTaskStore.getState().client;
    let serverLogoutPromise: Promise<void> = Promise.resolve();
    if (activeClient && !isPersonalApiToken(activeClient.getToken())) {
      serverLogoutPromise = activeClient.logoutServer();
    } else if (
      !activeClient &&
      pendingStoredSession?.serverUrl &&
      !isPersonalApiToken(pendingStoredSession.token)
    ) {
      serverLogoutPromise = new VikunjaClient({
        baseUrl: pendingStoredSession.serverUrl,
        token: pendingStoredSession.token,
        refreshToken: pendingStoredSession.refreshToken,
      }).logoutServer();
    }

    const clearCredsPromise = clearStoredCredentialsOnly();
    const clearPromise = useTaskStore.getState().clearSession();
    setWebUnsyncedSwitchPrompt((prev) => {
      if (prev) prev.resolve('cancel');
      return null;
    });
    pendingNotifActionsRef.current = [];
    setPendingNotifActionCount(0);
    setIsDrawerOpen(false);
    setShowReauthLogin(false);
    setShowConnectServerFromLocal(false);
    setLockError(null);
    setPendingLockLogoutCount(null);
    setPendingLockEraseLocal(false);
    isLockedRef.current = false;
    setIsLocked(false);
    setPendingStoredSession(null);
    setPendingLocalSession(false);
    setIsAuthenticated(false);

    await serverLogoutPromise;
    if (logoutEpochRef.current === myLogoutEpoch) {
      await clearNativeCookies();
    }
    await Promise.all([clearCredsPromise, clearPromise]);
  };

  const handleLockRequestLogout = async () => {
    const isLockedLocalMode =
      pendingLocalSession || Boolean(useTaskStore.getState().isLocalMode);

    if (isLockedLocalMode) {
      const title = t('settings.eraseLocalTitle');
      const message = t('settings.eraseLocalConfirmMessage');
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (window.confirm(`${title}\n\n${message}`)) {
            await handleLogout();
          }
        } else {
          setPendingLockEraseLocal(true);
        }
        return;
      }

      Alert.alert(title, message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.eraseBtn'),
          style: 'destructive',
          onPress: () => {
            handleLogout().catch(() => {});
          },
        },
      ]);
      return;
    }

    const unsyncedCount = await computeUnsyncedChangesCount(pendingSyncCount);

    if (unsyncedCount <= 0) {
      await handleLogout();
      return;
    }

    const title = t('lock.unsyncedTitle');
    const message = t('lock.unsyncedSignOutMessage', { count: unsyncedCount });
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`${title}\n\n${message}`)) {
          await handleLogout();
        }
      } else {
        setPendingLockLogoutCount(unsyncedCount);
      }
      return;
    }

    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          handleLogout().catch(() => {});
        },
      },
    ]);
  };

  const handleManualLockUnlock = async () => {
    needsAutoUnlockPromptRef.current = false;
    setLockError(null);
    setPendingLockLogoutCount(null);
    setPendingLockEraseLocal(false);
    const passed = await promptBiometricUnlock({ forceReset: true });
    if (passed) {
      isLockedRef.current = false;
      await unlockOfflineSession();
    } else {
      setLockError(t('lock.authFailedTryAgain'));
    }
  };

  const handleManualPinUnlock = async () => {
    needsAutoUnlockPromptRef.current = false;
    setLockError(null);
    setPendingLockLogoutCount(null);
    setPendingLockEraseLocal(false);
    await cancelBiometricPrompt();
    const passed = await authenticateWithDeviceCredentials(translate('lock.unlockGuanaco'));
    if (passed) {
      isLockedRef.current = false;
      await unlockOfflineSession();
    } else {
      setLockError(t('lock.authFailedTryAgain'));
    }
  };

  const showLoginOverlay = showReauthLogin || showConnectServerFromLocal;
  const showAppShell = isAuthenticated && !isLocked && !showLoginOverlay;
  const isLockedInLocalMode = pendingLocalSession || Boolean(isLocalMode);

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <GestureHandlerRootView
        style={[styles.root, { backgroundColor: theme.colors.background }]}
      >
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />

        {isLocked ? (
          <SafeAreaView
            testID="biometric-lock-screen"
            style={[
              styles.lockScreen,
              { backgroundColor: theme.colors.background },
            ]}
          >
            <View
              style={[
                styles.lockCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <Image
                source={require('../assets/icon.png')}
                style={styles.lockLogo}
                resizeMode="cover"
              />
              <Text style={[styles.lockTitle, { color: theme.colors.text }]}>
                Guanaco
              </Text>

              {lockError && (
                <View
                  testID="lock-error-banner"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.lockErrorBanner,
                    {
                      backgroundColor: hexToRgba(
                        theme.colors.danger,
                        theme.isDark ? 0.16 : 0.08
                      ),
                      borderColor: theme.colors.danger,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.lockErrorText,
                      { color: theme.colors.danger },
                    ]}
                  >
                    {lockError}
                  </Text>
                </View>
              )}

              {(pendingLockLogoutCount !== null || pendingLockEraseLocal) && (
                <View
                  testID="lock-logout-confirm-banner"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.lockErrorBanner,
                    {
                      backgroundColor: hexToRgba(
                        theme.colors.warning,
                        theme.isDark ? 0.16 : 0.08
                      ),
                      borderColor: theme.colors.warning,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.lockErrorText,
                      { color: theme.colors.text, marginBottom: 10 },
                    ]}
                  >
                    {pendingLockEraseLocal
                      ? t('settings.eraseLocalBannerConfirm')
                      : t('lock.discardUnsyncedBanner', { count: pendingLockLogoutCount || 0 })}
                  </Text>
                  <View style={styles.lockConfirmActions}>
                    <TouchableOpacity
                      testID="lock-logout-cancel-btn"
                      accessibilityRole="button"
                      style={[
                        styles.lockConfirmCancelBtn,
                        {
                          backgroundColor: theme.colors.surfaceSecondary,
                          borderColor: theme.colors.borderStrong,
                        },
                      ]}
                      onPress={() => {
                        setPendingLockLogoutCount(null);
                        setPendingLockEraseLocal(false);
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                        {t('common.cancel')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="lock-logout-confirm-btn"
                      accessibilityRole="button"
                      style={[
                        styles.lockConfirmDangerBtn,
                        { backgroundColor: theme.colors.danger },
                      ]}
                      onPress={() => {
                        handleLogout().catch(() => {});
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                        {pendingLockEraseLocal ? t('settings.eraseBtn') : t('auth.signOut')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity
                testID="login-biometric-btn"
                accessibilityRole="button"
                style={[styles.unlockButton, { backgroundColor: theme.colors.accent }]}
                onPress={handleManualLockUnlock}
                activeOpacity={0.8}
              >
                <Text style={styles.unlockButtonText}>{t('auth.unlock')}</Text>
              </TouchableOpacity>

              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  testID="lock-pin-fallback-btn"
                  accessibilityRole="button"
                  style={styles.lockPinFallbackBtn}
                  onPress={handleManualPinUnlock}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.lockPinFallbackText,
                      { color: theme.colors.accent },
                    ]}
                  >
                    {t('lock.enterPinOrPassword')}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                testID="lock-logout-btn"
                accessibilityRole="button"
                style={styles.lockSignOutBtn}
                onPress={handleLockRequestLogout}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.lockSignOutText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {isLockedInLocalMode ? t('settings.eraseLocalDataBtn') : t('auth.signOut')}
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        ) : !isAuthenticated || showLoginOverlay ? (
          <View style={styles.content}>
            {showLoginOverlay && (
              <SafeAreaView edges={['top']}>
                <View
                  style={[
                    styles.reauthTopBar,
                    {
                      backgroundColor: theme.colors.cardBackground,
                      borderBottomColor: theme.colors.cardBorder,
                    },
                  ]}
                >
                  <TouchableOpacity
                    testID="reauth-back-btn"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isConnecting }}
                    disabled={isConnecting}
                    style={isConnecting ? { opacity: 0.5 } : undefined}
                    onPress={() => {
                      if (isConnectingRef.current) return;
                      setShowReauthLogin(false);
                      setShowConnectServerFromLocal(false);
                    }}
                  >
                    <Text style={[styles.reauthBackText, { color: theme.colors.accent }]}>
                      {t('common.back')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            )}
            <LoginScreen
              onConnect={handleConnect}
              onUseOffline={!showLoginOverlay ? handleStartLocalMode : undefined}
              isConnectingFromLocal={showConnectServerFromLocal}
              localStats={localMigrationStats}
              onBiometricUnlock={
                pendingStoredSession
                  ? () => unlockOfflineSession(pendingStoredSession)
                  : pendingLocalSession
                  ? () => unlockOfflineSession()
                  : undefined
              }
            />
          </View>
        ) : (
          <View style={styles.content}>
            {authRequired && (
              <SafeAreaView edges={['top']}>
                <View
                  testID="auth-required-banner"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.authRequiredBanner,
                    {
                      backgroundColor: hexToRgba(
                        theme.colors.warning,
                        theme.isDark ? 0.16 : 0.1
                      ),
                      borderBottomColor: hexToRgba(theme.colors.warning, 0.4),
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.authRequiredText,
                      { color: theme.colors.warning },
                    ]}
                  >
                    {t('auth.sessionExpired')}
                  </Text>
                  <TouchableOpacity
                    testID="auth-required-signin-btn"
                    accessibilityRole="button"
                    style={[
                      styles.authRequiredBtn,
                      { backgroundColor: theme.colors.accent },
                    ]}
                    onPress={() => setShowReauthLogin(true)}
                  >
                    <Text style={styles.authRequiredBtnText}>{t('auth.signIn')}</Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            )}

            {isTablet ? (
              <View style={styles.tabletRoot}>
                <View
                  style={[
                    styles.tabletSidebar,
                    { borderRightColor: theme.colors.cardBorder },
                  ]}
                >
                  <ProjectDrawer
                    visible={true}
                    inline={true}
                    onClose={() => {}}
                    onLogout={handleLogout}
                    onConnectServer={() => setShowConnectServerFromLocal(true)}
                  />
                </View>
                <View style={styles.tabletContent}>
                  <ProjectTasksScreen
                    hideDrawerButton={true}
                    onOpenDrawer={() => {}}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.content}>
                <ProjectTasksScreen onOpenDrawer={() => setIsDrawerOpen(true)} />
                <ProjectDrawer
                  visible={isDrawerOpen}
                  onClose={() => setIsDrawerOpen(false)}
                  onLogout={handleLogout}
                  onConnectServer={() => setShowConnectServerFromLocal(true)}
                />
              </View>
            )}
          </View>
        )}

        {showAppShell && <AppUpdatePromptModal />}

        {webUnsyncedSwitchPrompt && (
          <View
            testID="web-unsynced-switch-modal"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.webConfirmOverlay}
          >
            <View
              style={[
                styles.lockCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.lockTitle,
                  { color: theme.colors.text, fontSize: 18, marginBottom: 10 },
                ]}
              >
                {webUnsyncedSwitchPrompt.title}
              </Text>
              <Text
                style={[
                  styles.lockErrorText,
                  { color: theme.colors.textSecondary, marginBottom: 18 },
                ]}
              >
                {webUnsyncedSwitchPrompt.message}
              </Text>
              <View style={styles.webConfirmActionsCol}>
                {webUnsyncedSwitchPrompt.allowKeepAndSync && (
                  <TouchableOpacity
                    testID="web-unsynced-keep-sync-btn"
                    accessibilityRole="button"
                    style={[
                      styles.unlockButton,
                      { backgroundColor: theme.colors.accent, marginBottom: 8 },
                    ]}
                    onPress={() => webUnsyncedSwitchPrompt.resolve('keep_and_sync')}
                  >
                    <Text style={styles.unlockButtonText}>
                      {t('auth.keepAndSyncNewUrl')}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  testID="web-unsynced-discard-btn"
                  accessibilityRole="button"
                  style={[
                    styles.unlockButton,
                    { backgroundColor: theme.colors.danger, marginBottom: 8 },
                  ]}
                  onPress={() => webUnsyncedSwitchPrompt.resolve('discard')}
                >
                  <Text style={styles.unlockButtonText}>
                    {t('auth.discardAndConnect')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="web-unsynced-cancel-btn"
                  accessibilityRole="button"
                  style={[
                    styles.lockConfirmCancelBtn,
                    {
                      width: '100%',
                      alignItems: 'center',
                      paddingVertical: 12,
                      backgroundColor: theme.colors.surfaceSecondary,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                  onPress={() => webUnsyncedSwitchPrompt.resolve('cancel')}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {Platform.OS === 'ios' && isIosInactive && Boolean(getCachedBiometricEnabled()) && (
          <View
            testID="ios-privacy-curtain"
            pointerEvents="none"
            style={[
              styles.privacyCurtain,
              { backgroundColor: theme.colors.background },
            ]}
          >
            <Image
              source={require('../assets/icon.png')}
              style={styles.lockLogo}
              resizeMode="cover"
            />
            <Text style={[styles.lockTitle, { color: theme.colors.text }]}>
              Guanaco
            </Text>
          </View>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  webConfirmOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 99998,
    elevation: 99998,
  },
  webConfirmActionsCol: {
    width: '100%',
  },
  privacyCurtain: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    elevation: 99999,
  },
  content: {
    flex: 1,
  },
  tabletRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  tabletSidebar: {
    width: 320,
    maxWidth: '35%',
    borderRightWidth: 1,
  },
  tabletContent: {
    flex: 1,
  },
  lockScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  lockLogo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    marginBottom: 16,
  },
  lockTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 20,
  },
  lockErrorBanner: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  lockErrorText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  lockConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  lockConfirmCancelBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  lockConfirmDangerBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  unlockButton: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  unlockButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  lockPinFallbackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  lockPinFallbackText: {
    fontSize: 14,
    fontWeight: '600',
  },
  lockSignOutBtn: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  lockSignOutText: {
    fontSize: 14,
    fontWeight: '600',
  },
  authRequiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  authRequiredText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  authRequiredBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  authRequiredBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  reauthTopBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  reauthBackText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
