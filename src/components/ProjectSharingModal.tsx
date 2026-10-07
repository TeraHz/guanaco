import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Project, ProjectUserShare, ProjectTeamShare, Team, Permission } from '../types/vikunja';
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';

export interface ProjectSharingModalProps {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
}

const PERMISSION_LABELS: Record<Permission, string> = {
  0: 'Read',
  1: 'Write',
  2: 'Admin',
};

export const ProjectSharingModal: React.FC<ProjectSharingModalProps> = ({
  visible,
  project,
  onClose,
}) => {
  const theme = useAppTheme();
  const { client } = useTaskStore();

  const [activeTab, setActiveTab] = useState<'users' | 'teams'>('users');
  const [users, setUsers] = useState<ProjectUserShare[]>([]);
  const [teams, setTeams] = useState<ProjectTeamShare[]>([]);
  const [availableTeams, setAvailableTeams] = useState<Team[]>([]);

  const [usernameInput, setUsernameInput] = useState('');
  const [userPermission, setUserPermission] = useState<Permission>(1);

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamPermission, setTeamPermission] = useState<Permission>(0);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible && project && client) {
      loadData();
    } else {
      setUsers([]);
      setTeams([]);
      setUsernameInput('');
      setSelectedTeamId(null);
      setErrorMessage(null);
    }
  }, [visible, project, client]);

  const loadData = async () => {
    if (!project || !client) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [fetchedUsers, fetchedTeams, fetchedAvailableTeams] = await Promise.all([
        client.getProjectUsers(project.id).catch(() => []),
        client.getProjectTeams(project.id).catch(() => []),
        client.getTeams().catch(() => []),
      ]);
      setUsers(Array.isArray(fetchedUsers) ? fetchedUsers : []);
      setTeams(Array.isArray(fetchedTeams) ? fetchedTeams : []);
      setAvailableTeams(Array.isArray(fetchedAvailableTeams) ? fetchedAvailableTeams : []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load project sharing settings.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed || !project || !client) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const newShare = await client.addProjectUser(project.id, {
        username: trimmed,
        permission: userPermission,
      });
      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      setUsers((prev) => [...prev, newShare]);
      setUsernameInput('');
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err.message || 'Failed to share list with user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCycleUserPermission = async (share: ProjectUserShare) => {
    if (!project || !client) return;
    const nextPerm: Permission = share.permission === 0 ? 1 : share.permission === 1 ? 2 : 0;
    const userId = share.user?.id ?? share.id;
    try {
      safeHaptics.selection();
      const updated = await client.updateProjectUser(project.id, userId, nextPerm);
      setUsers((prev) =>
        prev.map((u) => (u.id === share.id ? { ...u, permission: updated.permission ?? nextPerm } : u))
      );
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err.message || 'Failed to update user permission.');
    }
  };

  const handleRemoveUser = async (share: ProjectUserShare) => {
    if (!project || !client) return;
    const userId = share.user?.id ?? share.id;
    try {
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      await client.removeProjectUser(project.id, userId);
      setUsers((prev) => prev.filter((u) => u.id !== share.id));
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err.message || 'Failed to remove user share.');
    }
  };

  const handleAddTeam = async () => {
    if (!selectedTeamId || !project || !client) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const newShare = await client.addProjectTeam(project.id, {
        team_id: selectedTeamId,
        permission: teamPermission,
      });
      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      setTeams((prev) => [...prev, newShare]);
      setSelectedTeamId(null);
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err.message || 'Failed to share list with team.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveTeam = async (share: ProjectTeamShare) => {
    if (!project || !client) return;
    const teamId = share.team?.id ?? share.id;
    try {
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      await client.removeProjectTeam(project.id, teamId);
      setTeams((prev) => prev.filter((t) => t.id !== share.id));
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err.message || 'Failed to remove team share.');
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
                <View>
                  <Text style={[styles.title, { color: theme.colors.text }]}>Share List</Text>
                  {project && (
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                      {project.title}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  testID="share-modal-close-btn"
                  onPress={onClose}
                  style={styles.closeBtn}
                >
                  <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Offline Warning */}
              {!client ? (
                <View style={styles.offlineContainer}>
                  <Text style={[styles.offlineText, { color: theme.colors.textSecondary }]}>
                    Network connection required to manage sharing.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Tabs */}
                  <View style={[styles.tabsRow, { borderBottomColor: theme.colors.border }]}>
                    <TouchableOpacity
                      testID="share-tab-users"
                      style={[styles.tab, activeTab === 'users' && styles.tabActive]}
                      onPress={() => {
                        safeHaptics.selection();
                        setActiveTab('users');
                      }}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          { color: activeTab === 'users' ? theme.colors.accent : theme.colors.textSecondary },
                        ]}
                      >
                        Users ({users.length})
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="share-tab-teams"
                      style={[styles.tab, activeTab === 'teams' && styles.tabActive]}
                      onPress={() => {
                        safeHaptics.selection();
                        setActiveTab('teams');
                      }}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          { color: activeTab === 'teams' ? theme.colors.accent : theme.colors.textSecondary },
                        ]}
                      >
                        Teams ({teams.length})
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Error Message */}
                  {errorMessage ? (
                    <View style={styles.errorBanner}>
                      <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                  ) : null}

                  {isLoading ? (
                    <View style={styles.centerContainer}>
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    </View>
                  ) : activeTab === 'users' ? (
                    /* USERS TAB */
                    <ScrollView style={styles.contentList} keyboardShouldPersistTaps="handled">
                      {/* Add User Section */}
                      <View style={styles.addRow}>
                        <TextInput
                          testID="share-user-input"
                          style={[
                            styles.input,
                            {
                              backgroundColor: theme.colors.inputBg,
                              color: theme.colors.text,
                              borderColor: theme.colors.border,
                            },
                          ]}
                          placeholder="Username or email..."
                          placeholderTextColor={theme.colors.textTertiary}
                          value={usernameInput}
                          onChangeText={setUsernameInput}
                          autoCapitalize="none"
                        />
                        <TouchableOpacity
                          testID="share-add-user-btn"
                          style={[
                            styles.addBtn,
                            { backgroundColor: theme.colors.accent },
                            (!usernameInput.trim() || isSubmitting) && styles.btnDisabled,
                          ]}
                          onPress={handleAddUser}
                          disabled={!usernameInput.trim() || isSubmitting}
                        >
                          <Text style={styles.addBtnText}>Add</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Current Shared Users */}
                      <Text style={[styles.sectionHeading, { color: theme.colors.textSecondary }]}>
                        PEOPLE WITH ACCESS
                      </Text>
                      {users.length === 0 ? (
                        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
                          No users shared with this list yet.
                        </Text>
                      ) : (
                        users.map((share) => (
                          <View
                            key={share.id}
                            style={[
                              styles.memberRow,
                              {
                                backgroundColor: theme.colors.cardSecondary,
                                borderColor: theme.colors.border,
                              },
                            ]}
                          >
                            <View style={styles.memberInfo}>
                              <Text style={[styles.memberName, { color: theme.colors.text }]}>
                                {share.user?.username || share.username}
                              </Text>
                              {(share.user?.name || share.name) && (
                                <Text style={[styles.memberSub, { color: theme.colors.textSecondary }]}>
                                  {share.user?.name || share.name}
                                </Text>
                              )}
                            </View>

                            <TouchableOpacity
                              testID={`share-user-perm-${share.id}`}
                              style={[styles.permBadge, { backgroundColor: theme.colors.inputBg }]}
                              onPress={() => handleCycleUserPermission(share)}
                            >
                              <Text style={[styles.permBadgeText, { color: theme.colors.accent }]}>
                                {PERMISSION_LABELS[share.permission] || 'Custom'} ▾
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              testID={`share-remove-user-${share.id}`}
                              style={styles.removeBtn}
                              onPress={() => handleRemoveUser(share)}
                            >
                              <Text style={styles.removeBtnText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ))
                      )}
                    </ScrollView>
                  ) : (
                    /* TEAMS TAB */
                    <ScrollView style={styles.contentList} keyboardShouldPersistTaps="handled">
                      {/* Select & Add Team */}
                      <View style={styles.addTeamSection}>
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                          SELECT A TEAM TO SHARE WITH
                        </Text>
                        <View style={styles.teamChipsRow}>
                          {availableTeams
                            .filter((t) => !teams.some((st) => (st.team?.id ?? st.id) === t.id))
                            .map((team) => {
                            const isSelected = selectedTeamId === team.id;
                            return (
                              <TouchableOpacity
                                key={team.id}
                                testID={`share-select-team-${team.id}`}
                                style={[
                                  styles.teamChip,
                                  {
                                    backgroundColor: isSelected
                                      ? theme.colors.accent
                                      : theme.colors.inputBg,
                                    borderColor: theme.colors.border,
                                  },
                                ]}
                                onPress={() => {
                                  safeHaptics.selection();
                                  setSelectedTeamId(team.id);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.teamChipText,
                                    { color: isSelected ? '#FFFFFF' : theme.colors.text },
                                  ]}
                                >
                                  {team.name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <TouchableOpacity
                          testID="share-add-team-btn"
                          style={[
                            styles.addTeamBtn,
                            { backgroundColor: theme.colors.accent },
                            (!selectedTeamId || isSubmitting) && styles.btnDisabled,
                          ]}
                          onPress={handleAddTeam}
                          disabled={!selectedTeamId || isSubmitting}
                        >
                          <Text style={styles.addBtnText}>Share with Team</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Current Shared Teams */}
                      <Text style={[styles.sectionHeading, { color: theme.colors.textSecondary }]}>
                        TEAMS WITH ACCESS
                      </Text>
                      {teams.length === 0 ? (
                        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
                          No teams shared with this list yet.
                        </Text>
                      ) : (
                        teams.map((share) => (
                          <View
                            key={share.id}
                            style={[
                              styles.memberRow,
                              {
                                backgroundColor: theme.colors.cardSecondary,
                                borderColor: theme.colors.border,
                              },
                            ]}
                          >
                            <View style={styles.memberInfo}>
                              <Text style={[styles.memberName, { color: theme.colors.text }]}>
                                {share.team?.name || share.name}
                              </Text>
                              {(share.team?.description || share.description) ? (
                                <Text style={[styles.memberSub, { color: theme.colors.textSecondary }]}>
                                  {share.team?.description || share.description}
                                </Text>
                              ) : null}
                            </View>

                            <View style={[styles.permBadge, { backgroundColor: theme.colors.inputBg }]}>
                              <Text style={[styles.permBadgeText, { color: theme.colors.accent }]}>
                                {PERMISSION_LABELS[share.permission] || 'Custom'}
                              </Text>
                            </View>

                            <TouchableOpacity
                              testID={`share-remove-team-${share.id}`}
                              style={styles.removeBtn}
                              onPress={() => handleRemoveTeam(share)}
                            >
                              <Text style={styles.removeBtnText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ))
                      )}
                    </ScrollView>
                  )}
                </>
              )}
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 20,
    fontWeight: '600',
  },
  offlineContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    fontSize: 14,
    textAlign: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderLeftWidth: 4,
    borderLeftColor: '#FF453A',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 6,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 13,
    fontWeight: '500',
  },
  centerContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentList: {
    padding: 20,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
  },
  memberSub: {
    fontSize: 12,
    marginTop: 2,
  },
  permBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  permBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  removeBtn: {
    padding: 6,
  },
  removeBtnText: {
    color: '#FF453A',
    fontSize: 16,
    fontWeight: 'bold',
  },
  addTeamSection: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  teamChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  teamChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  teamChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addTeamBtn: {
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
