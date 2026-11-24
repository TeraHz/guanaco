import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/taskStore';
import { AppBadgeMode, LanguagePreference, ThemeMode, WeekStartDay } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { useTranslation } from '../i18n';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
  authenticateWithBiometrics,
  getStoredAuth,
} from '../utils/biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aiCoreModule from '../utils/aiCore';
import { APP_VERSION, APP_NAME, versionFromCode } from '../constants/version';
import { useUpdateStore } from '../store/updateStore';
import { isNativeUpdateSupported } from '../services/appUpdateChecker';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onLogout?: () => void;
  onOpenLabelManagement?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  onLogout,
  onOpenLabelManagement,
}) => {
  const theme = useAppTheme();
  const {
    t,
    languagePreference: activeLangPref,
    setLanguagePreference: setI18nLanguagePreference,
  } = useTranslation();
  const {
    client,
    currentUser: storeCurrentUser,
    cachedUsers,
    reenableStaples,
    setReenableStaples,
    largeTaskItems,
    setLargeTaskItems,
    taskItemScale = 100,
    setTaskItemScale,
    taskItemTextScale = 100,
    setTaskItemTextScale,
    themeMode = 'system',
    setThemeMode,
    languagePreference: storeLanguagePreference,
    setLanguagePreference: setStoreLanguagePreference,
    weekStartDay = 1,
    setWeekStartDay,
    appBadgeMode = 'off',
    setAppBadgeMode,
    resetAndSyncFromServer,
    syncStatus,
    pendingSyncCount,
  } = useTaskStore();
  const effectiveLanguagePref: LanguagePreference =
    storeLanguagePreference ?? activeLangPref ?? 'system';

  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<'reset' | 'logout' | null>(null);
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const serverUrl = client ? client.getBaseApiUrl().replace(/\/api\/v1$/, '') : '';
  const displayUsername =
    storeCurrentUser?.username ||
    savedUsername ||
    (cachedUsers && cachedUsers.length > 0 ? cachedUsers[0].username : null);

  const hasAICore = aiCoreModule.isAICoreSupported();
  const hasLivePromptApi =
    typeof (aiCoreModule as any).isPromptAPIAvailable === 'function'
      ? Boolean((aiCoreModule as any).isPromptAPIAvailable())
      : Boolean(
          (globalThis as any).ai?.languageModel ||
            (typeof window !== 'undefined' && (window as any).ai?.languageModel)
        );

  const nativeUpdatesSupported = isNativeUpdateSupported();

  const [clearedAiCache, setClearedAiCache] = useState(false);
  const aiCacheTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isUpToDateNotice, setIsUpToDateNotice] = useState(false);
  const updateStatusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    updateInfo,
    isChecking: isCheckingUpdate,
    checkForUpdate,
    startUpdate,
  } = useUpdateStore();

  const handleCheckForUpdates = async () => {
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    const info = await checkForUpdate(true);
    if (info?.isAvailable) {
      setIsUpToDateNotice(false);
    } else {
      setIsUpToDateNotice(true);
      if (updateStatusTimerRef.current) clearTimeout(updateStatusTimerRef.current);
      updateStatusTimerRef.current = setTimeout(() => {
        setIsUpToDateNotice(false);
      }, 4000);
    }
  };

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (aiCacheTimerRef.current) clearTimeout(aiCacheTimerRef.current);
      if (updateStatusTimerRef.current) clearTimeout(updateStatusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadSettingsMetadata() {
      const [avail, enabled, storedAuth, legacyValues] = await Promise.all([
        checkBiometricAvailable().catch(() => false),
        isBiometricEnabled().catch(() => false),
        getStoredAuth().catch(() => null),
        AsyncStorage.multiGet(['@vikunja_saved_username', '@vikunja_username']).catch(
          () => [] as [string, string | null][]
        ),
      ]);

      if (!mounted) return;

      setBiometricAvailable((prev) => (prev === avail ? prev : avail));
      const nextBioActive = avail ? enabled : false;
      setBiometricActive((prev) => (prev === nextBioActive ? prev : nextBioActive));

      const legacySaved = legacyValues.find(([k]) => k === '@vikunja_saved_username')?.[1] || null;
      const legacyUser = legacyValues.find(([k]) => k === '@vikunja_username')?.[1] || null;
      const resolvedUser = storedAuth?.username || legacyUser || legacySaved || null;
      setSavedUsername((prev) => (prev === resolvedUser ? prev : resolvedUser));
    }

    if (visible) {
      setPendingConfirmAction(null);
      setResetError(null);
      loadSettingsMetadata();
    }
    return () => {
      mounted = false;
    };
  }, [visible]);

  const handleToggleBiometric = async (value: boolean) => {
    const promptReason = value
      ? t('lock.enableBiometricReason')
      : t('lock.disableBiometricReason');
    try {
      const passed = await authenticateWithBiometrics(promptReason);
      if (!passed) {
        safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
        return;
      }
      await setBiometricEnabled(value);
      setBiometricActive(value);
      safeHaptics.selection();
    } catch {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
    }
  };

  const executeResetAndSync = async () => {
    if (isResetting) return;
    setPendingConfirmAction(null);
    setIsResetting(true);
    setResetSuccess(false);
    setResetError(null);
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await resetAndSyncFromServer();
      setResetSuccess(true);
      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      resetTimerRef.current = setTimeout(() => setResetSuccess(false), 2500);
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setResetError(err?.message || t('settings.failedSyncFromServer'));
    } finally {
      setIsResetting(false);
    }
  };

  const handleRequestResetAndSync = () => {
    if (isResetting) return;
    const message =
      pendingSyncCount > 0
        ? t('settings.overwriteConfirmPending', { count: pendingSyncCount })
        : t('settings.overwriteConfirmClean');

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`${t('settings.overwriteTitle')}\n\n${message}`)) {
          executeResetAndSync();
        }
      } else {
        setPendingConfirmAction('reset');
      }
      return;
    }

    Alert.alert(t('settings.overwriteTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.overwriteBtn'),
        style: 'destructive',
        onPress: () => executeResetAndSync(),
      },
    ]);
  };

  const executeLogout = () => {
    setPendingConfirmAction(null);
    safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
    onClose();
    onLogout?.();
  };

  const handleRequestLogout = () => {
    if (pendingSyncCount > 0) {
      const message = t('settings.logoutConfirmPending', { count: pendingSyncCount });
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (window.confirm(`${t('lock.unsyncedTitle')}\n\n${message}`)) {
            executeLogout();
          }
        } else {
          setPendingConfirmAction('logout');
        }
        return;
      }

      Alert.alert(t('lock.unsyncedTitle'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.logOut'),
          style: 'destructive',
          onPress: executeLogout,
        },
      ]);
      return;
    }

    executeLogout();
  };

  const syncStatusColor =
    syncStatus === 'synced'
      ? theme.colors.success
      : syncStatus === 'syncing'
      ? theme.colors.accent
      : (syncStatus as string) === 'auth_required'
      ? theme.colors.danger
      : theme.colors.warning;

  const syncStatusLabel =
    syncStatus === 'synced'
      ? t('settings.statusSynced')
      : syncStatus === 'syncing'
      ? t('settings.statusSyncing')
      : (syncStatus as string) === 'auth_required'
      ? pendingSyncCount > 0
        ? t('settings.statusSignInPending', { count: pendingSyncCount })
        : t('settings.statusSignIn')
      : pendingSyncCount > 0
      ? t('settings.statusOfflinePending', { count: pendingSyncCount })
      : t('settings.statusOffline');

  const secondaryBtnSurface = {
    backgroundColor: theme.colors.surfaceSecondary,
    borderColor: theme.colors.borderStrong,
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modalBackdrop, { backgroundColor: theme.colors.background }]}>
        <SafeAreaView
          style={[
            styles.modalRoot,
            {
              backgroundColor: theme.colors.background,
            },
          ]}
        >
          {/* Header */}
          <View
            style={[
              styles.header,
              {
                backgroundColor: theme.colors.cardBackground,
                borderBottomColor: theme.colors.cardBorder,
              },
            ]}
          >
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
              {t('settings.title')}
            </Text>
            <TouchableOpacity
              testID="close-settings-btn"
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('settings.closeA11y')}
            >
              <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {pendingConfirmAction ? (
            <View
              testID="settings-confirm-banner"
              style={[
                styles.confirmBanner,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.danger,
                },
              ]}
            >
              <Text style={[styles.confirmBannerText, { color: theme.colors.text }]}>
                {pendingConfirmAction === 'reset'
                  ? t('settings.overwriteBannerConfirm')
                  : t('settings.logoutBannerConfirm', { count: pendingSyncCount })}
              </Text>
              <View style={styles.confirmBannerActions}>
                <TouchableOpacity
                  testID="settings-confirm-cancel-btn"
                  style={[styles.confirmCancelBtn, secondaryBtnSurface]}
                  onPress={() => setPendingConfirmAction(null)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.confirmCancelBtnText, { color: theme.colors.text }]}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="settings-confirm-proceed-btn"
                  style={[styles.confirmProceedBtn, { backgroundColor: theme.colors.danger }]}
                  onPress={pendingConfirmAction === 'reset' ? executeResetAndSync : executeLogout}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmProceedBtnText}>
                    {pendingConfirmAction === 'reset'
                      ? t('settings.overwriteBtn')
                      : t('settings.logOut')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Account Section */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                {t('settings.accountSection')}
              </Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                  {t('settings.server')}
                </Text>
                <Text style={[styles.infoValue, { color: theme.colors.text }]} numberOfLines={1}>
                  {serverUrl}
                </Text>
              </View>
              <View
                style={[
                  styles.infoRow,
                  {
                    borderTopColor: theme.colors.cardBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                  {t('settings.user')}
                </Text>
                <Text
                  testID="settings-display-username"
                  style={[styles.infoValue, { color: theme.colors.text }]}
                >
                  {displayUsername ? `@${displayUsername}` : t('settings.connected')}
                </Text>
              </View>
            </View>

            {/* Preferences Section */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                {t('settings.preferencesSection')}
              </Text>

              {/* Language Selector */}
              <View style={styles.settingBlock}>
                <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                  {t('settings.language')}
                </Text>
                <View style={styles.presetChipsRow}>
                  {(
                    [
                      { key: 'system', label: t('settings.langSystem') },
                      { key: 'en', label: 'English' },
                      { key: 'bg', label: 'Български' },
                      { key: 'es', label: 'Español' },
                    ] as { key: LanguagePreference; label: string }[]
                  ).map((opt) => {
                    const isSelected = effectiveLanguagePref === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        testID={`settings-lang-${opt.key}`}
                        style={[
                          styles.presetChip,
                          isSelected
                            ? {
                                backgroundColor: theme.colors.accent,
                                borderColor: theme.colors.accent,
                              }
                            : secondaryBtnSurface,
                        ]}
                        onPress={() => {
                          if (setStoreLanguagePreference) {
                            setStoreLanguagePreference(opt.key);
                          } else {
                            setI18nLanguagePreference(opt.key);
                          }
                          safeHaptics.selection();
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View
                style={[
                  styles.settingBlock,
                  {
                    borderTopColor: theme.colors.cardBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.settingRow}>
                  <View style={styles.settingTextCol}>
                    <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                      {t('settings.taskBoxSize')}
                    </Text>
                  </View>
                  <View style={styles.stepperContainer}>
                    <TouchableOpacity
                      testID="settings-scale-decrement"
                      style={[
                        styles.stepperBtn,
                        secondaryBtnSurface,
                        taskItemScale <= 100 && styles.stepperBtnDisabled,
                      ]}
                      disabled={taskItemScale <= 100}
                      onPress={() => {
                        const newScale = Math.max(100, taskItemScale - 25);
                        setTaskItemScale(newScale);
                        safeHaptics.selection();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.decreaseBoxSizeA11y')}
                    >
                      <Text
                        style={[
                          styles.stepperBtnText,
                          {
                            color:
                              taskItemScale <= 100
                                ? theme.colors.textTertiary
                                : theme.colors.accent,
                          },
                        ]}
                      >
                        −
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.stepperValueBadge}>
                      <Text
                        testID="settings-scale-value"
                        style={[styles.stepperValueText, { color: theme.colors.text }]}
                      >
                        {taskItemScale}%
                      </Text>
                    </View>
                    <TouchableOpacity
                      testID="settings-scale-increment"
                      style={[
                        styles.stepperBtn,
                        secondaryBtnSurface,
                        taskItemScale >= 200 && styles.stepperBtnDisabled,
                      ]}
                      disabled={taskItemScale >= 200}
                      onPress={() => {
                        const newScale = Math.min(200, taskItemScale + 25);
                        setTaskItemScale(newScale);
                        safeHaptics.selection();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.increaseBoxSizeA11y')}
                    >
                      <Text
                        style={[
                          styles.stepperBtnText,
                          {
                            color:
                              taskItemScale >= 200
                                ? theme.colors.textTertiary
                                : theme.colors.accent,
                          },
                        ]}
                      >
                        +
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Preset chips for Box Size */}
                <View style={styles.presetChipsRow}>
                  {[100, 125, 150, 175, 200].map((preset) => {
                    const isSelected = taskItemScale === preset;
                    return (
                      <TouchableOpacity
                        key={preset}
                        testID={`settings-scale-preset-${preset}`}
                        style={[
                          styles.presetChip,
                          isSelected
                            ? {
                                backgroundColor: theme.colors.accent,
                                borderColor: theme.colors.accent,
                              }
                            : secondaryBtnSurface,
                        ]}
                        onPress={() => {
                          setTaskItemScale(preset);
                          safeHaptics.selection();
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {preset}%
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Task Text Size */}
                <View style={[styles.settingRow, { marginTop: 14 }]}>
                  <View style={styles.settingTextCol}>
                    <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                      {t('settings.taskTextSize')}
                    </Text>
                  </View>
                  <View style={styles.stepperContainer}>
                    <TouchableOpacity
                      testID="settings-text-scale-decrement"
                      style={[
                        styles.stepperBtn,
                        secondaryBtnSurface,
                        taskItemTextScale <= 100 && styles.stepperBtnDisabled,
                      ]}
                      disabled={taskItemTextScale <= 100}
                      onPress={() => {
                        const newScale = Math.max(100, taskItemTextScale - 25);
                        setTaskItemTextScale(newScale);
                        safeHaptics.selection();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.decreaseTextSizeA11y')}
                    >
                      <Text
                        style={[
                          styles.stepperBtnText,
                          {
                            color:
                              taskItemTextScale <= 100
                                ? theme.colors.textTertiary
                                : theme.colors.accent,
                          },
                        ]}
                      >
                        −
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.stepperValueBadge}>
                      <Text
                        testID="settings-text-scale-value"
                        style={[styles.stepperValueText, { color: theme.colors.text }]}
                      >
                        {taskItemTextScale}%
                      </Text>
                    </View>
                    <TouchableOpacity
                      testID="settings-text-scale-increment"
                      style={[
                        styles.stepperBtn,
                        secondaryBtnSurface,
                        taskItemTextScale >= 200 && styles.stepperBtnDisabled,
                      ]}
                      disabled={taskItemTextScale >= 200}
                      onPress={() => {
                        const newScale = Math.min(200, taskItemTextScale + 25);
                        setTaskItemTextScale(newScale);
                        safeHaptics.selection();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.increaseTextSizeA11y')}
                    >
                      <Text
                        style={[
                          styles.stepperBtnText,
                          {
                            color:
                              taskItemTextScale >= 200
                                ? theme.colors.textTertiary
                                : theme.colors.accent,
                          },
                        ]}
                      >
                        +
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Preset chips for Text Size */}
                <View style={styles.presetChipsRow}>
                  {[100, 125, 150, 175, 200].map((preset) => {
                    const isSelected = taskItemTextScale === preset;
                    return (
                      <TouchableOpacity
                        key={preset}
                        testID={`settings-text-scale-preset-${preset}`}
                        style={[
                          styles.presetChip,
                          isSelected
                            ? {
                                backgroundColor: theme.colors.accent,
                                borderColor: theme.colors.accent,
                              }
                            : secondaryBtnSurface,
                        ]}
                        onPress={() => {
                          setTaskItemTextScale(preset);
                          safeHaptics.selection();
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {preset}%
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Test automation fallback switch — hidden from VoiceOver & TalkBack */}
              <View
                style={styles.hiddenAutomation}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden={true}
              >
                <Switch
                  testID="settings-large-items-switch"
                  accessible={false}
                  importantForAccessibility="no"
                  value={largeTaskItems}
                  onValueChange={(val) => {
                    setLargeTaskItems(val);
                    safeHaptics.selection();
                  }}
                />
              </View>

              <View
                style={[
                  styles.settingRow,
                  {
                    borderTopColor: theme.colors.cardBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.settingTextCol}>
                  <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                    {t('settings.reenableStaples')}
                  </Text>
                  <Text style={[styles.settingSub, { color: theme.colors.textSecondary }]}>
                    {t('settings.reenableStaplesSub')}
                  </Text>
                </View>
                <Switch
                  testID="settings-staples-switch"
                  value={reenableStaples}
                  onValueChange={(val) => {
                    setReenableStaples(val);
                    safeHaptics.selection();
                  }}
                  trackColor={{
                    false: theme.colors.borderStrong,
                    true: theme.colors.success,
                  }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Appearance Selector */}
              <View
                style={[
                  styles.settingBlock,
                  {
                    borderTopColor: theme.colors.cardBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                  {t('settings.appearance')}
                </Text>
                <View style={styles.presetChipsRow}>
                  {(
                    [
                      { key: 'system', label: t('settings.themeSystem') },
                      { key: 'light', label: t('settings.themeLight') },
                      { key: 'dark', label: t('settings.themeDark') },
                      { key: 'oled', label: t('settings.themeOled') },
                    ] as { key: ThemeMode; label: string }[]
                  ).map((opt) => {
                    const isSelected = themeMode === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        testID={`settings-theme-${opt.key}`}
                        style={[
                          styles.presetChip,
                          isSelected
                            ? {
                                backgroundColor: theme.colors.accent,
                                borderColor: theme.colors.accent,
                              }
                            : secondaryBtnSurface,
                        ]}
                        onPress={() => {
                          setThemeMode?.(opt.key);
                          safeHaptics.selection();
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Start Week On Selector */}
              <View
                style={[
                  styles.settingBlock,
                  {
                    borderTopColor: theme.colors.cardBorder,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                  {t('settings.startWeekOn')}
                </Text>
                <View style={styles.presetChipsRow}>
                  {(
                    [
                      { day: 1, label: t('settings.monday') },
                      { day: 0, label: t('settings.sunday') },
                    ] as { day: WeekStartDay; label: string }[]
                  ).map((opt) => {
                    const isSelected = weekStartDay === opt.day;
                    return (
                      <TouchableOpacity
                        key={opt.day}
                        testID={`settings-week-start-${opt.day}`}
                        style={[
                          styles.presetChip,
                          isSelected
                            ? {
                                backgroundColor: theme.colors.accent,
                                borderColor: theme.colors.accent,
                              }
                            : secondaryBtnSurface,
                        ]}
                        onPress={() => {
                          setWeekStartDay?.(opt.day);
                          safeHaptics.selection();
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            {
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* App Icon Badge Selector */}
              {Platform.OS !== 'web' && (
                <View
                  style={[
                    styles.settingBlock,
                    {
                      borderTopColor: theme.colors.cardBorder,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                    {t('settings.appIconBadge')}
                  </Text>
                  <View style={styles.presetChipsRow}>
                    {(
                      [
                        { key: 'off', label: t('settings.badgeOff') },
                        { key: 'overdue', label: t('settings.badgeOverdue') },
                        { key: 'due_today', label: t('settings.badgeDueToday') },
                      ] as { key: AppBadgeMode; label: string }[]
                    ).map((opt) => {
                      const isSelected = appBadgeMode === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          testID={`settings-badge-${opt.key}`}
                          style={[
                            styles.presetChip,
                            isSelected
                              ? {
                                  backgroundColor: theme.colors.accent,
                                  borderColor: theme.colors.accent,
                                }
                              : secondaryBtnSurface,
                          ]}
                          onPress={() => {
                            setAppBadgeMode?.(opt.key);
                            safeHaptics.selection();
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              {
                                color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
                                fontWeight: isSelected ? '700' : '500',
                              },
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {biometricAvailable && (
                <View
                  style={[
                    styles.settingRow,
                    {
                      borderTopColor: theme.colors.cardBorder,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={styles.settingTextCol}>
                    <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                      {t('settings.biometricLock')}
                    </Text>
                  </View>
                  <Switch
                    testID="settings-biometric-switch"
                    value={biometricActive}
                    onValueChange={handleToggleBiometric}
                    trackColor={{
                      false: theme.colors.borderStrong,
                      true: theme.colors.success,
                    }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              )}
            </View>

            {/* Labels Management */}
            {onOpenLabelManagement && (
              <View
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderColor: theme.colors.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                  {t('settings.organizationSection')}
                </Text>
                <TouchableOpacity
                  testID="settings-manage-labels-btn"
                  style={styles.menuRowBtn}
                  onPress={() => {
                    safeHaptics.selection();
                    onClose();
                    onOpenLabelManagement();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={[styles.menuRowTitle, { color: theme.colors.text }]}>
                    {t('labels.manageLabels')}
                  </Text>
                  <Text style={[styles.menuRowArrow, { color: theme.colors.textSecondary }]}>›</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Smart Grouping - only shown when supported */}
            {hasAICore && (
              <View
                testID="settings-aicore-section"
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderColor: theme.colors.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                  {t('settings.smartGroupingSection')}
                </Text>
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                    {t('settings.mode')}
                  </Text>
                  <Text
                    testID="settings-aicore-engine-label"
                    style={[styles.infoValue, { color: theme.colors.textSecondary }]}
                  >
                    {hasLivePromptApi
                      ? t('settings.geminiNano')
                      : t('settings.onDeviceHeuristics')}
                  </Text>
                </View>
                <TouchableOpacity
                  testID="settings-clear-ai-cache-btn"
                  style={[styles.secondaryActionBtn, secondaryBtnSurface]}
                  onPress={async () => {
                    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                    await aiCoreModule.clearAICoreCache();
                    setClearedAiCache(true);
                    aiCacheTimerRef.current = setTimeout(() => setClearedAiCache(false), 2000);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.secondaryActionText,
                      { color: clearedAiCache ? theme.colors.success : theme.colors.text },
                    ]}
                  >
                    {clearedAiCache
                      ? t('settings.cacheCleared')
                      : t('settings.clearCategoryCache')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* App Updates Section - ONLY rendered on native Android with Play Core support */}
            {nativeUpdatesSupported && (
              <View
                testID="settings-updates-section"
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderColor: theme.colors.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                  {t('settings.appUpdatesSection')}
                </Text>

                {updateInfo?.isAvailable ? (
                  (() => {
                    const nextVer = versionFromCode(updateInfo.availableVersionCode);
                    return (
                      <>
                        <View style={styles.infoRow}>
                          <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                            {t('settings.available')}
                          </Text>
                          <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                            {nextVer ? `v${nextVer}` : t('settings.newVersion')}
                          </Text>
                        </View>
                        <TouchableOpacity
                          testID="settings-install-update-btn"
                          style={[styles.primaryActionBtn, { backgroundColor: theme.colors.accent }]}
                          onPress={() => {
                            safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                            startUpdate('flexible');
                          }}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                        >
                          <Text style={styles.primaryActionBtnText}>
                            {nextVer
                              ? t('settings.updateToVersion', { version: nextVer })
                              : t('settings.updateNow')}
                          </Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()
                ) : (
                  <TouchableOpacity
                    testID="settings-check-updates-btn"
                    style={[
                      styles.secondaryActionBtn,
                      { marginTop: 0 },
                      secondaryBtnSurface,
                      isCheckingUpdate && styles.btnDisabled,
                    ]}
                    onPress={handleCheckForUpdates}
                    disabled={isCheckingUpdate}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    {isCheckingUpdate ? (
                      <View style={styles.centerRow}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text
                          style={[
                            styles.secondaryActionText,
                            { color: theme.colors.textSecondary },
                          ]}
                        >
                          {t('settings.checking')}
                        </Text>
                      </View>
                    ) : (
                      <Text
                        style={[
                          styles.secondaryActionText,
                          {
                            color: isUpToDateNotice
                              ? theme.colors.success
                              : theme.colors.text,
                          },
                        ]}
                      >
                        {isUpToDateNotice ? t('settings.upToDate') : t('settings.checkForUpdates')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Sync & Server Actions */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                {t('settings.syncSection')}
              </Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                  {t('settings.status')}
                </Text>
                <Text
                  testID="settings-sync-status-text"
                  style={[styles.infoValue, { color: syncStatusColor }]}
                >
                  {syncStatusLabel}
                </Text>
              </View>

              {resetError ? (
                <Text
                  testID="settings-reset-error"
                  style={[styles.inlineErrorText, { color: theme.colors.danger }]}
                >
                  {resetError}
                </Text>
              ) : null}

              <TouchableOpacity
                testID="settings-reset-sync-btn"
                style={[
                  styles.secondaryActionBtn,
                  secondaryBtnSurface,
                  isResetting && styles.btnDisabled,
                ]}
                onPress={handleRequestResetAndSync}
                disabled={isResetting}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                {isResetting ? (
                  <View style={styles.centerRow}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text
                      style={[styles.secondaryActionText, { color: theme.colors.textSecondary }]}
                    >
                      {t('settings.syncingFromServer')}
                    </Text>
                  </View>
                ) : resetSuccess ? (
                  <Text style={[styles.secondaryActionText, { color: theme.colors.success }]}>
                    {t('settings.syncedDone')}
                  </Text>
                ) : (
                  <Text style={[styles.secondaryActionText, { color: theme.colors.text }]}>
                    {t('settings.overwriteAndSync')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Logout Action */}
            {onLogout && (
              <TouchableOpacity
                testID="settings-logout-btn"
                style={[
                  styles.logoutBtn,
                  {
                    borderColor: theme.isDark
                      ? 'rgba(255, 69, 58, 0.35)'
                      : 'rgba(215, 0, 21, 0.3)',
                    backgroundColor: theme.isDark
                      ? 'rgba(255, 69, 58, 0.12)'
                      : 'rgba(215, 0, 21, 0.08)',
                  },
                ]}
                onPress={handleRequestLogout}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Text style={[styles.logoutBtnText, { color: theme.colors.danger }]}>
                  {t('settings.logOut')}
                </Text>
              </TouchableOpacity>
            )}

            {/* Single Subtle App Version Footer */}
            <View style={styles.footerVersionRow}>
              <Text
                testID="settings-version-footer"
                style={[styles.footerVersionText, { color: theme.colors.textSecondary }]}
              >
                {APP_NAME} v{APP_VERSION}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 17,
    fontWeight: '600',
  },
  confirmBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  confirmBannerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBannerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  confirmCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  confirmCancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  confirmProceedBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  confirmProceedBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '70%',
  },
  inlineErrorText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  settingTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  settingSub: {
    fontSize: 12,
    marginTop: 2,
  },
  menuRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  menuRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuRowArrow: {
    fontSize: 18,
    fontWeight: '600',
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryActionBtn: {
    marginTop: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryActionBtn: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  logoutBtn: {
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  logoutBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  settingBlock: {
    paddingVertical: 2,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  stepperValueBadge: {
    paddingHorizontal: 8,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueText: {
    fontSize: 14,
    fontWeight: '700',
  },
  presetChipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 6,
    paddingBottom: 4,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipText: {
    fontSize: 11,
  },
  hiddenAutomation: {
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  footerVersionRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  footerVersionText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
