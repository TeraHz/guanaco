import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableWithoutFeedback,
  Switch,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/taskStore';
import { safeHaptics } from '../utils/haptics';
import { useAppTheme } from '../utils/theme';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled,
} from '../utils/biometrics';

interface ProjectDrawerProps {
  visible: boolean;
  onClose: () => void;
  onAddNewList?: () => void;
  onLogout?: () => void;
}

export const ProjectDrawer: React.FC<ProjectDrawerProps> = ({
  visible,
  onClose,
  onAddNewList,
  onLogout,
}) => {
  const theme = useAppTheme();
  const {
    projects,
    tasks,
    selectedProjectId,
    setSelectedProjectId,
    reenableStaples,
    setReenableStaples,
    resetAndSyncFromServer,
  } = useTaskStore();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const resetTimerRef = React.useRef<any>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    let mounted = true;
    async function loadBiometricState() {
      const available = await checkBiometricAvailable();
      if (!mounted) return;
      setBiometricAvailable(available);
      if (available) {
        const enabled = await isBiometricEnabled();
        if (mounted) setBiometricActive(enabled);
      }
    }
    if (visible) {
      loadBiometricState();
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

  const handleSelect = (id: number | null) => {
    safeHaptics.selection();
    setSelectedProjectId(id);
    onClose();
  };

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <SafeAreaView
          style={[
            styles.drawerContainer,
            {
              backgroundColor: theme.colors.cardBackground,
              borderRightColor: theme.colors.cardBorder,
            },
          ]}
        >
          {/* Drawer Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.cardBorder }]}>
            <View style={styles.brandRow}>
              <View style={styles.logoBadge}>
                <Text style={styles.logoText}>V</Text>
              </View>
              <Text style={[styles.brandTitle, { color: theme.colors.text }]}>Lists</Text>
            </View>
            <TouchableOpacity
              testID="drawer-close-btn"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Project List */}
          <ScrollView style={styles.projectList}>
            {/* All Tasks Master View (TickTick style) */}
            <TouchableOpacity
              testID="drawer-project-all"
              style={[
                styles.projectItem,
                selectedProjectId === null && {
                  backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                },
              ]}
              onPress={() => handleSelect(null)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorDot, { backgroundColor: '#007AFF' }]} />
              <Text
                style={[
                  styles.projectTitle,
                  { color: theme.colors.text },
                  selectedProjectId === null && styles.projectTitleSelected,
                ]}
                numberOfLines={1}
              >
                All Tasks
              </Text>
              <Text
                testID="drawer-count-all"
                style={styles.badgeCount}
              >
                {safeTasks.filter((t) => !t.done).length}
              </Text>
            </TouchableOpacity>

            {/* Individual Lists */}
            {safeProjects.filter((p) => p.id > 0).map((proj) => {
              const isSelected = proj.id === selectedProjectId;
              const activeTasks = safeTasks.filter(
                (t) => t.project_id === proj.id && !t.done
              ).length;

              return (
                <TouchableOpacity
                  key={proj.id}
                  testID={`drawer-project-${proj.id}`}
                  style={[
                    styles.projectItem,
                    isSelected && {
                      backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                    },
                  ]}
                  onPress={() => handleSelect(proj.id)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.colorDot,
                      { backgroundColor: proj.hex_color ? `#${proj.hex_color.replace(/^#/, '')}` : '#007AFF' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.projectTitle,
                      { color: theme.colors.text },
                      isSelected && styles.projectTitleSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {proj.title}
                  </Text>
                  {activeTasks > 0 && (
                    <Text
                      testID={`drawer-count-${proj.id}`}
                      style={styles.badgeCount}
                    >
                      {activeTasks}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Quick Add List button */}
          {onAddNewList && (
            <TouchableOpacity
              testID="drawer-add-list-btn"
              style={[styles.addListBtn, { borderTopColor: theme.colors.cardBorder }]}
              onPress={() => {
                safeHaptics.selection();
                onAddNewList();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.addListIcon}>＋</Text>
              <Text style={styles.addListText}>New List</Text>
            </TouchableOpacity>
          )}

          {/* Settings & Biometrics Section */}
          <View style={[styles.footerSection, { borderTopColor: theme.colors.cardBorder }]}>
            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Re-enable Staple Tasks</Text>
              <Switch
                testID="drawer-staples-switch"
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
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>🔒 Biometric Unlock</Text>
                <Switch
                  testID="drawer-biometric-switch"
                  value={biometricActive}
                  onValueChange={handleToggleBiometric}
                  trackColor={{ false: '#3A3A3C', true: '#30D158' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            )}

            {/* Sync & Overwrite from Server Action */}
            <TouchableOpacity
              testID="drawer-reset-sync-btn"
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
                <View style={styles.resetSyncContent}>
                  <ActivityIndicator size="small" color="#0A84FF" />
                  <Text style={styles.resetSyncText}>Resetting & syncing...</Text>
                </View>
              ) : resetSuccess ? (
                <View style={styles.resetSyncContent}>
                  <Text style={styles.resetSyncSuccessText}>✓ Overwrite Complete!</Text>
                </View>
              ) : (
                <View style={styles.resetSyncContent}>
                  <Text style={styles.resetSyncIcon}>🔄</Text>
                  <View style={styles.resetSyncTextContainer}>
                    <Text style={styles.resetSyncTitle}>Sync & Overwrite from Server</Text>
                    <Text style={styles.resetSyncSubtitle}>Clear cache and download fresh data</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>

            {onLogout && (
              <TouchableOpacity
                testID="drawer-logout-btn"
                style={styles.logoutBtn}
                onPress={() => {
                  onClose();
                  onLogout();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.logoutText}>Log Out</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  drawerContainer: {
    width: '80%',
    backgroundColor: '#161618',
    borderRightWidth: 1,
    borderRightColor: '#2C2C2E',
    display: 'flex',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2E',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#8E8E93',
    fontSize: 18,
    fontWeight: '600',
  },
  projectList: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  projectItemSelected: {
    backgroundColor: '#2C2C2E',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  projectTitle: {
    flex: 1,
    fontSize: 16,
    color: '#E5E5EA',
    fontWeight: '500',
  },
  projectTitleSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  badgeCount: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  addListBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
    gap: 10,
  },
  addListIcon: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: '700',
  },
  addListText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  footerSection: {
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  settingLabel: {
    color: '#E5E5EA',
    fontSize: 14,
    fontWeight: '500',
  },
  resetSyncBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    marginVertical: 4,
  },
  resetSyncBtnDisabled: {
    opacity: 0.6,
  },
  resetSyncBtnSuccess: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderColor: '#30D158',
  },
  resetSyncContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  resetSyncIcon: {
    fontSize: 18,
  },
  resetSyncTextContainer: {
    flex: 1,
  },
  resetSyncTitle: {
    color: '#F2F2F7',
    fontSize: 13,
    fontWeight: '600',
  },
  resetSyncSubtitle: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 1,
  },
  resetSyncText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '600',
  },
  resetSyncSuccessText: {
    color: '#30D158',
    fontSize: 13,
    fontWeight: '700',
  },
  logoutBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
  },
  logoutText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '600',
  },
});
