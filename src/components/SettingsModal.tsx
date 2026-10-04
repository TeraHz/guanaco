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
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
} from '../utils/biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAICoreSupported, clearAICoreCache } from '../utils/aiCore';
import { APP_VERSION, APP_BUILD_NUMBER, APP_NAME } from '../constants/version';

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
    client,
    currentUser: storeCurrentUser,
    cachedUsers,
    reenableStaples,
    setReenableStaples,
    largeTaskItems,
    setLargeTaskItems,
    taskItemScale = 100,
    setTaskItemScale,
    resetAndSyncFromServer,
    syncStatus,
    pendingSyncCount,
  } = useTaskStore();

  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const resetTimerRef = React.useRef<any>(null);

  const serverUrl = client ? client.getBaseApiUrl().replace(/\/api\/v1$/, '') : '';
  const displayUsername =
    storeCurrentUser?.username ||
    savedUsername ||
    (cachedUsers && cachedUsers.length > 0 ? cachedUsers[0].username : null);

  const hasAICore = isAICoreSupported();
  const [clearedAiCache, setClearedAiCache] = useState(false);
  const aiCacheTimerRef = React.useRef<any>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      if (aiCacheTimerRef.current) {
        clearTimeout(aiCacheTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadBiometrics() {
      const avail = await checkBiometricAvailable();
      if (!mounted) return;
      setBiometricAvailable(avail);
      if (avail) {
        const enabled = await isBiometricEnabled();
        if (mounted) setBiometricActive(enabled);
      }
    }
    if (visible) {
      loadBiometrics();
      AsyncStorage.getItem('@vikunja_saved_username')
        .then((saved) => {
          if (mounted && saved) setSavedUsername(saved);
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [visible]);

  const handleToggleBiometric = async (value: boolean) => {
    setBiometricActive(value);
    await setBiometricEnabled(value);
    safeHaptics.selection();
  };

  const handleResetAndSync = async () => {
    if (isResetting) return;
    setIsResetting(true);
    setResetSuccess(false);
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await resetAndSyncFromServer();
      setResetSuccess(true);
      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      resetTimerRef.current = setTimeout(() => setResetSuccess(false), 2500);
    } catch (_) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsResetting(false);
    }
  };

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
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Settings</Text>
          <TouchableOpacity
            testID="close-settings-btn"
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Account & Server Section */}
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
              VIKUNJA SERVER & ACCOUNT
            </Text>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Server</Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]} numberOfLines={1}>
                {serverUrl}
              </Text>
            </View>
            <View style={[styles.infoRow, { borderTopColor: theme.colors.cardBorder, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>User</Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                {displayUsername ? `@${displayUsername}` : 'Connected'}
              </Text>
            </View>
            <View style={[styles.infoRow, { borderTopColor: theme.colors.cardBorder, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Version</Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                v{APP_VERSION} (Build {APP_BUILD_NUMBER})
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
              TASK PREFERENCES
            </Text>
            <View style={styles.settingBlock}>
              <View style={styles.settingRow}>
                <View style={styles.settingTextCol}>
                  <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                    Task Item Size ({taskItemScale}%)
                  </Text>
                  <Text style={[styles.settingSub, { color: theme.colors.textSecondary }]}>
                    Scale list items, text, and tap targets ({taskItemScale > 100 ? `+${taskItemScale - 100}%` : 'Standard'})
                  </Text>
                </View>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity
                    testID="settings-scale-decrement"
                    style={[styles.stepperBtn, taskItemScale <= 100 && styles.stepperBtnDisabled]}
                    disabled={taskItemScale <= 100}
                    onPress={() => {
                      const newScale = Math.max(100, taskItemScale - 25);
                      setTaskItemScale(newScale);
                      safeHaptics.selection();
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text
                      style={[
                        styles.stepperBtnText,
                        { color: taskItemScale <= 100 ? '#8E8E93' : '#007AFF' },
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
                    style={[styles.stepperBtn, taskItemScale >= 200 && styles.stepperBtnDisabled]}
                    disabled={taskItemScale >= 200}
                    onPress={() => {
                      const newScale = Math.min(200, taskItemScale + 25);
                      setTaskItemScale(newScale);
                      safeHaptics.selection();
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text
                      style={[
                        styles.stepperBtnText,
                        { color: taskItemScale >= 200 ? '#8E8E93' : '#007AFF' },
                      ]}
                    >
                      +
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Preset chips */}
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
                          ? { backgroundColor: '#007AFF', borderColor: '#007AFF' }
                          : {
                              backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                              borderColor: theme.isDark ? '#3A3A3C' : '#D1D1D6',
                            },
                      ]}
                      onPress={() => {
                        setTaskItemScale(preset);
                        safeHaptics.selection();
                      }}
                      activeOpacity={0.7}
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
                        {preset === 100 ? '100%' : `${preset}%`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Test automation and accessibility fallback switch */}
            <View style={styles.hiddenAutomation}>
              <Switch
                testID="settings-large-items-switch"
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
                { borderTopColor: theme.colors.cardBorder, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={styles.settingTextCol}>
                <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                  Re-enable Staple Tasks
                </Text>
                <Text style={[styles.settingSub, { color: theme.colors.textSecondary }]}>
                  Suggest previously completed grocery items when typing
                </Text>
              </View>
              <Switch
                testID="settings-staples-switch"
                value={reenableStaples}
                onValueChange={(val) => {
                  setReenableStaples(val);
                  safeHaptics.selection();
                }}
                trackColor={{ false: '#3A3A3C', true: '#30D158' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {biometricAvailable && (
              <View
                style={[
                  styles.settingRow,
                  { borderTopColor: theme.colors.cardBorder, borderTopWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={styles.settingTextCol}>
                  <Text style={[styles.settingTitle, { color: theme.colors.text }]}>
                    🔒 Biometric Unlock
                  </Text>
                  <Text style={[styles.settingSub, { color: theme.colors.textSecondary }]}>
                    Require fingerprint or face ID to open app
                  </Text>
                </View>
                <Switch
                  testID="settings-biometric-switch"
                  value={biometricActive}
                  onValueChange={handleToggleBiometric}
                  trackColor={{ false: '#3A3A3C', true: '#30D158' }}
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
                ORGANIZATION
              </Text>
              <TouchableOpacity
                testID="settings-manage-labels-btn"
                style={styles.menuRowBtn}
                onPress={() => {
                  safeHaptics.selection();
                  onOpenLabelManagement();
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.menuRowTitle, { color: theme.colors.text }]}>🏷️ Manage Labels</Text>
                <Text style={[styles.menuRowArrow, { color: theme.colors.textSecondary }]}>›</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* On-Device Intelligence (Pixel AICore) - only shown when supported */}
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
                ON-DEVICE INTELLIGENCE
              </Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Engine</Text>
                <Text style={[styles.infoValue, { color: '#30D158' }]}>
                  ● Android AICore (Gemini Nano)
                </Text>
              </View>
              <Text style={[styles.aicoreDesc, { color: theme.colors.textSecondary }]}>
                On-device contextual task grouping runs locally on your Pixel device. Zero data is shared with external cloud servers.
              </Text>
              <TouchableOpacity
                testID="settings-clear-ai-cache-btn"
                style={styles.clearAiCacheBtn}
                onPress={async () => {
                  safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                  await clearAICoreCache();
                  setClearedAiCache(true);
                  aiCacheTimerRef.current = setTimeout(() => setClearedAiCache(false), 2000);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.clearAiCacheText}>
                  {clearedAiCache ? '✓ AI Cache Cleared' : 'Clear AI Category Cache'}
                </Text>
              </TouchableOpacity>
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
              DATA & SYNC
            </Text>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>Status</Text>
              <Text style={[styles.infoValue, { color: syncStatus === 'synced' ? '#30D158' : '#FF9F0A' }]}>
                {syncStatus === 'synced' ? '● Fully Synced' : `⚡ Offline (${pendingSyncCount} pending)`}
              </Text>
            </View>

            <TouchableOpacity
              testID="settings-reset-sync-btn"
              style={[
                styles.resetSyncBtn,
                isResetting && styles.resetSyncBtnDisabled,
                resetSuccess && styles.resetSyncBtnSuccess,
              ]}
              onPress={handleResetAndSync}
              disabled={isResetting}
              activeOpacity={0.7}
            >
              {isResetting ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator size="small" color="#0A84FF" />
                  <Text style={styles.resetSyncText}>Resetting & syncing...</Text>
                </View>
              ) : resetSuccess ? (
                <View style={styles.centerRow}>
                  <Text style={styles.resetSuccessText}>✓ Overwrite Complete!</Text>
                </View>
              ) : (
                <View style={styles.centerRow}>
                  <Text style={styles.resetSyncText}>↻ Overwrite & Sync from Server</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Logout Action */}
          {onLogout && (
            <TouchableOpacity
              testID="settings-logout-btn"
              style={styles.logoutBtn}
              onPress={() => {
                safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
                onClose();
                onLogout();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.logoutBtnText}>Log Out</Text>
            </TouchableOpacity>
          )}

          {/* App Version Footer */}
          <View style={styles.footerVersionRow}>
            <Text style={[styles.footerVersionText, { color: theme.colors.textSecondary }]}>
              {APP_NAME} v{APP_VERSION} • Build {APP_BUILD_NUMBER}
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
    paddingHorizontal: 16,
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
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
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
    fontSize: 11,
    marginTop: 2,
  },
  menuRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
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
  resetSyncBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(10, 132, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(10, 132, 255, 0.3)',
    alignItems: 'center',
  },
  resetSyncBtnDisabled: {
    opacity: 0.6,
  },
  resetSyncBtnSuccess: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderColor: 'rgba(48, 209, 88, 0.4)',
  },
  resetSyncText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '600',
  },
  resetSuccessText: {
    color: '#30D158',
    fontSize: 13,
    fontWeight: '700',
  },
  logoutBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#FF453A',
    fontSize: 15,
    fontWeight: '700',
  },
  aicoreDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 10,
  },
  clearAiCacheBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(48, 209, 88, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
    alignItems: 'center',
  },
  clearAiCacheText: {
    color: '#30D158',
    fontSize: 13,
    fontWeight: '600',
  },
  settingBlock: {
    paddingVertical: 4,
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
    backgroundColor: 'rgba(0, 122, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.35,
    backgroundColor: 'rgba(142, 142, 147, 0.12)',
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
    paddingTop: 8,
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
    paddingVertical: 18,
  },
  footerVersionText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
