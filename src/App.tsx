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
import { useTaskStore } from './store/taskStore';
import { SYNC_QUEUE_STORAGE_KEY } from './store/syncQueue';
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
  clearStoredAuth,
  clearNativeCookies,
  checkBiometricAvailable,
  isBiometricEnabled,
  authenticateWithBiometrics,
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
} from './services/localNotifications';
import { useUpdateStore } from './store/updateStore';
import { AppUpdatePromptModal } from './components/AppUpdatePromptModal';
import { loadStoredLanguagePreference, t as translate, useTranslation } from './i18n';

/** Grace period in milliseconds in background before requiring biometric re-unlock on resume. */
export const BIOMETRIC_LOCK_GRACE_MS = 15_000;

export default function App() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [pendingLockLogoutCount, setPendingLockLogoutCount] = useState<number | null>(null);
  const [showReauthLogin, setShowReauthLogin] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingStoredSession, setPendingStoredSession] = useState<{
    serverUrl: string;
    token: string;
    refreshToken: string | null;
    username: string | null;
  } | null>(null);

  const backgroundedAtRef = useRef<number | null>(null);
  const biometricPromptInFlightRef = useRef(false);
  const biometricAttemptSeqRef = useRef(0);
  const needsAutoUnlockPromptRef = useRef(false);
  const isConnectingRef = useRef(false);
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;

  const { initialize, syncAll, authRequired, pendingSyncCount } = useTaskStore();

  useEffect(() => {
    const unsub = useTaskStore.subscribe((state, prev) => {
      if (prev.client && !state.client && !isConnectingRef.current) {
        setIsDrawerOpen(false);
        setShowReauthLogin(false);
        setLockError(null);
        setPendingLockLogoutCount(null);
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

  // Handle interactive local reminder actions (Mark Complete, Snooze 15m) & tap-to-open safely
  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      typeof Notifications.addNotificationResponseReceivedListener !== 'function'
    ) {
      return;
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const actionId = response?.actionIdentifier;
      const notifId = response?.notification?.request?.identifier;
      const data = (response?.notification?.request?.content?.data || {}) as {
        taskId?: number;
        taskDueDate?: string | null;
      };
      const taskId = typeof data.taskId === 'number' ? data.taskId : null;
      if (taskId === null) return;

      if (actionId === NOTIF_ACTION_MARK_DONE) {
        if (notifId && typeof Notifications.dismissNotificationAsync === 'function') {
          Notifications.dismissNotificationAsync(notifId).catch(() => {});
        }
        if (isLockedRef.current || !useTaskStore.getState().client) return;
        const store = useTaskStore.getState();
        const target = (store.tasks || []).find((t) => t.id === taskId);
        if (shouldCompleteTaskFromNotification(target, data)) {
          store.toggleTask(taskId);
        }
        return;
      }

      if (actionId === NOTIF_ACTION_SNOOZE_15M) {
        if (notifId && typeof Notifications.dismissNotificationAsync === 'function') {
          Notifications.dismissNotificationAsync(notifId).catch(() => {});
        }
        if (isLockedRef.current || !useTaskStore.getState().client) return;
        const target = (useTaskStore.getState().tasks || []).find((t) => t.id === taskId);
        if (target && !target.done) {
          scheduleSnoozedReminder(target, 15).catch(() => {});
        }
        return;
      }

      // Default notification tap: stage taskId so ProjectTasksScreen opens it once unlocked
      useTaskStore.getState().setPendingOpenTaskId(taskId);
    });

    return () => {
      sub?.remove?.();
    };
  }, []);

  const promptBiometricUnlock = useCallback(
    async (options?: { forceReset?: boolean }): Promise<boolean> => {
      if (biometricPromptInFlightRef.current && !options?.forceReset) {
        return false;
      }
      const hadInFlight = biometricPromptInFlightRef.current;
      const seq = ++biometricAttemptSeqRef.current;
      biometricPromptInFlightRef.current = true;
      try {
        return await authenticateWithBiometrics(translate('lock.unlockGuanaco'), {
          forceReset: Boolean(options?.forceReset || hadInFlight),
        });
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
      }
      setLockError(null);
      setPendingLockLogoutCount(null);
      setIsLocked(false);
      syncAll().catch(() => {});
    },
    [initialize, isAuthenticated, pendingStoredSession, syncAll]
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
      if (!mounted) return;
      if (!stored.serverUrl || !stored.token) return;

      const biometricActive =
        (await isBiometricEnabled()) && (await checkBiometricAvailable());
      if (!mounted) return;

      if (biometricActive) {
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
        if (!mounted) return;
        if (!readyForPrompt) {
          // Device Keyguard is still locked — defer auto-prompt until Android window focus arrives
          needsAutoUnlockPromptRef.current = true;
          return;
        }

        const passed = await promptBiometricUnlock();
        if (!mounted) return;
        if (!passed) {
          // Stay on the biometric lock gate without exposing cached tasks or requiring network login
          return;
        }

        await initialize(stored.serverUrl, stored.token, stored.refreshToken);
        if (!mounted) return;
        setPendingStoredSession(null);
        setIsAuthenticated(true);
        isLockedRef.current = false;
        setIsLocked(false);
        syncAll().catch(() => {});
        return;
      }

      // Biometrics disabled or unavailable on device: restore offline cached data in 0ms
      await initialize(stored.serverUrl, stored.token, stored.refreshToken);
      if (!mounted) return;
      setIsAuthenticated(true);
      setIsLocked(false);
      syncAll().catch(() => {});
    }
    restoreSession();
    return () => {
      mounted = false;
    };
  }, [initialize, promptBiometricUnlock, syncAll]);

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

  // Resume-aware biometric lock (grace period) + bi-directional foreground sync
  useEffect(() => {
    if (!isAuthenticated) return;

    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        if (AppState.currentState === 'active' && !isLockedRef.current) {
          syncAll().catch(() => {});
        }
      }, 60000);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    if (AppState.currentState === 'active' && !isLockedRef.current) {
      startPolling();
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
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

        (async () => {
          if (bgAt !== null && elapsedMs >= BIOMETRIC_LOCK_GRACE_MS) {
            const bioActive =
              (await isBiometricEnabled()) && (await checkBiometricAvailable());
            if (bioActive) {
              isLockedRef.current = true;
              setLockError(null);
              setPendingLockLogoutCount(null);
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
            }
          }

          if (!isLockedRef.current) {
            syncAll().catch(() => {});
            useUpdateStore.getState().checkForUpdate().catch(() => {});
            startPolling();
          }
        })().catch(() => {});
      }
    });

    let handleFocus: (() => void) | null = null;
    let handleBlur: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      handleFocus = () => {
        if (!isLockedRef.current) {
          syncAll().catch(() => {});
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
      if (handleFocus && typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
      if (handleBlur && typeof window !== 'undefined') {
        window.removeEventListener('blur', handleBlur);
      }
    };
  }, [isAuthenticated, promptBiometricUnlock, syncAll]);

  const handleConnect = async (
    rawServerUrl: string,
    username: string,
    secret: string,
    options?: LoginConnectOptions
  ) => {
    const parsedUrl = parseAndValidateServerUrl(rawServerUrl);
    if (parsedUrl.isInsecureHttp && !options?.allowInsecureHttp) {
      throw new Error(t('auth.insecureHttpError'));
    }

    const normalizedUrl = parsedUrl.serverUrl;
    const isTokenAuth =
      options?.authMethod === 'api_token' || isPersonalApiToken(secret);

    let activeToken: string;
    let activeRefreshToken: string | null = null;
    let resolvedUsername = username.trim();
    let authUser: User | null = null;

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

    // Isolate sessions if switching to a different server or genuinely different user account
    isConnectingRef.current = true;
    try {
      const prevStored = await getStoredAuth();
      const prevCurrentUser = useTaskStore.getState().currentUser;
      const isDifferentServer =
        Boolean(prevStored.serverUrl) && prevStored.serverUrl !== normalizedUrl;

      let isDifferentUser = false;
      if (authUser && prevCurrentUser && authUser.id > 0 && prevCurrentUser.id > 0) {
        isDifferentUser = authUser.id !== prevCurrentUser.id;
      } else if (prevStored.username && resolvedUsername) {
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

        isDifferentUser =
          prevIdentifiers.size > 0 &&
          nextIdentifiers.length > 0 &&
          !nextIdentifiers.some((id) => prevIdentifiers.has(id));
      }

      if (isDifferentServer || isDifferentUser) {
        await useTaskStore.getState().clearSession();
      }
      if (isDifferentServer || isDifferentUser || isTokenAuth) {
        await clearNativeCookies();
      }

      // Persist token, rotating refresh token, normalized server URL, and canonical username ONLY (zero plaintext passwords!)
      await setStoredAuth(activeToken, normalizedUrl, resolvedUsername || undefined, {
        refreshToken: activeRefreshToken,
      });

      await initialize(normalizedUrl, activeToken, activeRefreshToken);
      if (authUser && authUser.username) {
        useTaskStore.setState({ currentUser: authUser });
      }

      setPendingStoredSession(null);
      setShowReauthLogin(false);
      setLockError(null);
      setPendingLockLogoutCount(null);
      setIsLocked(false);
      setIsAuthenticated(true);

      syncAll().catch(() => {});
    } finally {
      isConnectingRef.current = false;
    }
  };

  const handleLogout = async () => {
    // Capture active client (or locked pending session) to revoke server refresh token best-effort,
    // while STILL calling `clearSession()` synchronously on tick 0 so `store.client` is immediately `null`
    // before unmounting authenticated screens!
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

    const clearPromise = useTaskStore.getState().clearSession();
    setIsDrawerOpen(false);
    setShowReauthLogin(false);
    setLockError(null);
    setPendingLockLogoutCount(null);
    setIsLocked(false);
    setPendingStoredSession(null);
    setIsAuthenticated(false);
    await serverLogoutPromise;
    await Promise.all([clearStoredAuth(), clearPromise]);
  };

  const handleLockRequestLogout = async () => {
    let unsyncedCount = pendingSyncCount;
    if (unsyncedCount <= 0) {
      try {
        const rawQueue = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
        if (rawQueue) {
          const parsed = JSON.parse(rawQueue);
          if (Array.isArray(parsed)) {
            unsyncedCount = parsed.length;
          }
        }
      } catch (_) {}
    }

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
    const passed = await promptBiometricUnlock({ forceReset: true });
    if (passed) {
      isLockedRef.current = false;
      await unlockOfflineSession();
    } else {
      setLockError(t('lock.authFailedTryAgain'));
    }
  };

  const showAppShell = isAuthenticated && !isLocked && !showReauthLogin;

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

              {pendingLockLogoutCount !== null && (
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
                    {t('lock.discardUnsyncedBanner', { count: pendingLockLogoutCount })}
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
                      onPress={() => setPendingLockLogoutCount(null)}
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
                        {t('auth.signOut')}
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
                  {t('auth.signOut')}
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        ) : !isAuthenticated || showReauthLogin ? (
          <View style={styles.content}>
            {showReauthLogin && (
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
                    onPress={() => setShowReauthLogin(false)}
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
              onBiometricUnlock={
                pendingStoredSession
                  ? () => unlockOfflineSession(pendingStoredSession)
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
                />
              </View>
            )}
          </View>
        )}

        {showAppShell && <AppUpdatePromptModal />}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
