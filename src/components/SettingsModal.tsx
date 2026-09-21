import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Switch,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
} from '../utils/biometrics';

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
    cachedUsers,
    reenableStaples,
    setReenableStaples,
    resetAndSyncFromServer,
    syncStatus,
    pendingSyncCount,
  } = useTaskStore();

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const resetTimerRef = React.useRef<any>(null);

  const serverUrl = client ? client.getBaseApiUrl().replace(/\/api\/v1$/, '') : 'https://vikunja.example.com';
  const currentUser = cachedUsers?.[0]?.username || 'Connected';

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
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
      <SafeAreaView
        style={[
          styles.modalRoot,
          {
            backgroundColor: theme.colors.background,
            paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
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
                @{currentUser}
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
            <View style={styles.settingRow}>
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
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
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
});
