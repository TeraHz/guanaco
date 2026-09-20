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
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/taskStore';
import { safeHaptics } from '../utils/haptics';
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
  const {
    projects,
    tasks,
    selectedProjectId,
    setSelectedProjectId,
    reenableStaples,
    setReenableStaples,
  } = useTaskStore();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricActive, setBiometricActive] = useState(false);

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

        <SafeAreaView style={styles.drawerContainer}>
          {/* Drawer Header */}
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.logoBadge}>
                <Text style={styles.logoText}>V</Text>
              </View>
              <Text style={styles.brandTitle}>Lists</Text>
            </View>
            <TouchableOpacity
              testID="drawer-close-btn"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Project List */}
          <ScrollView style={styles.projectList}>
            {/* All Tasks Master View (TickTick style) */}
            <TouchableOpacity
              testID="drawer-project-all"
              style={[
                styles.projectItem,
                selectedProjectId === null && styles.projectItemSelected,
              ]}
              onPress={() => handleSelect(null)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorDot, { backgroundColor: '#007AFF' }]} />
              <Text
                style={[
                  styles.projectTitle,
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
                    isSelected && styles.projectItemSelected,
                  ]}
                  onPress={() => handleSelect(proj.id)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.colorDot,
                      { backgroundColor: proj.hex_color || '#007AFF' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.projectTitle,
                      isSelected && styles.projectTitleSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {proj.title}
                  </Text>
                  <Text
                    testID={`drawer-count-${proj.id}`}
                    style={styles.badgeCount}
                  >
                    {activeTasks}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Add New List Action */}
          {onAddNewList && (
            <TouchableOpacity
              testID="drawer-add-list-btn"
              style={styles.addListBtn}
              onPress={() => {
                onClose();
                onAddNewList();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.addListIcon}>+</Text>
              <Text style={styles.addListText}>New List</Text>
            </TouchableOpacity>
          )}

          {/* Footer Controls: Settings, Biometrics & Logout */}
          <View style={styles.footerSection}>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>♻️ Re-enable staple tasks</Text>
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
