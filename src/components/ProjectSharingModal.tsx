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
import { useTranslation, TranslationKey } from '../i18n';

export interface ProjectSharingModalProps {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
}

const PERMISSION_KEYS: Record<Permission, TranslationKey> = {
  0: 'sharing.permRead',
  1: 'sharing.permWrite',
  2: 'sharing.permAdmin',
};

const PERMISSION_OPTIONS: Permission[] = [0, 1, 2];

export const ProjectSharingModal: React.FC<ProjectSharingModalProps> = ({
  visible,
  project,
  onClose,
}) => {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { client } = useTaskStore();

  const getPermissionLabel = (perm: Permission): string =>
    Object.prototype.hasOwnProperty.call(PERMISSION_KEYS, perm)
      ? t(PERMISSION_KEYS[perm])
      : t('sharing.permCustom');

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
  const loadSeqRef = React.useRef(0);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    if (visible && project && client) {
      loadData(project.id, seq);
    } else {
      setIsLoading(false);
      setUsers([]);
      setTeams([]);
      setUsernameInput('');
      setUserPermission(1);
      setSelectedTeamId(null);
      setTeamPermission(0);
      setErrorMessage(null);
    }
    return () => {
      loadSeqRef.current += 1;
    };
  }, [visible, project?.id, client]);

  const loadData = async (projectId: number, seq: number) => {
    if (!client) return;
    setIsLoading(true);
    setErrorMessage(null);
    setUsers([]);
    setTeams([]);
    try {
      const [usersResult, teamsResult, availTeamsResult] = await Promise.allSettled([
        client.getProjectUsers(projectId),
        client.getProjectTeams(projectId),
        client.getTeams(),
      ]);

      if (seq !== loadSeqRef.current) return;

      if (usersResult.status === 'fulfilled') {
        setUsers(Array.isArray(usersResult.value) ? usersResult.value : []);
      } else {
        setUsers([]);
      }

      if (teamsResult.status === 'fulfilled') {
        setTeams(Array.isArray(teamsResult.value) ? teamsResult.value : []);
      } else {
        setTeams([]);
      }

      if (availTeamsResult.status === 'fulfilled') {
        setAvailableTeams(Array.isArray(availTeamsResult.value) ? availTeamsResult.value : []);
      } else {
        setAvailableTeams([]);
      }

      const firstFailure =
        usersResult.status === 'rejected'
          ? usersResult.reason
          : teamsResult.status === 'rejected'
          ? teamsResult.reason
          : null;

      if (firstFailure) {
        setErrorMessage(firstFailure?.message || t('sharing.loadError'));
      }
    } catch (err: any) {
      if (seq !== loadSeqRef.current) return;
      setErrorMessage(err?.message || t('sharing.loadError'));
    } finally {
      if (seq === loadSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleAddUser = async () => {
    const trimmed = usernameInput.trim().replace(/^@/, '');
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
      setErrorMessage(err?.message || t('sharing.addUserError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCycleUserPermission = async (share: ProjectUserShare) => {
    if (!project || !client) return;
    const nextPerm: Permission = share.permission === 0 ? 1 : share.permission === 1 ? 2 : 0;
    const userId = share.user?.id ?? share.id;
    setErrorMessage(null);
    try {
      safeHaptics.selection();
      const updated = await client.updateProjectUser(project.id, userId, nextPerm);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === share.id ? { ...u, permission: updated?.permission ?? nextPerm } : u
        )
      );
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('sharing.updateUserError'));
    }
  };

  const handleRemoveUser = async (share: ProjectUserShare) => {
    if (!project || !client) return;
    const userId = share.user?.id ?? share.id;
    setErrorMessage(null);
    try {
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      await client.removeProjectUser(project.id, userId);
      setUsers((prev) => prev.filter((u) => u.id !== share.id));
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('sharing.removeUserError'));
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
      setErrorMessage(err?.message || t('sharing.addTeamError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCycleTeamPermission = async (share: ProjectTeamShare) => {
    if (!project || !client) return;
    const nextPerm: Permission = share.permission === 0 ? 1 : share.permission === 1 ? 2 : 0;
    const teamId = share.team?.id ?? share.id;
    setErrorMessage(null);
    try {
      safeHaptics.selection();
      const updated = await client.updateProjectTeam(project.id, teamId, nextPerm);
      setTeams((prev) =>
        prev.map((teamItem) =>
          teamItem.id === share.id
            ? { ...teamItem, permission: updated?.permission ?? nextPerm }
            : teamItem
        )
      );
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('sharing.updateTeamError'));
    }
  };

  const handleRemoveTeam = async (share: ProjectTeamShare) => {
    if (!project || !client) return;
    const teamId = share.team?.id ?? share.id;
    setErrorMessage(null);
    try {
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      await client.removeProjectTeam(project.id, teamId);
      setTeams((prev) => prev.filter((teamItem) => teamItem.id !== share.id));
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('sharing.removeTeamError'));
    }
  };

  if (!visible) return null;

  const secondarySurface = {
    backgroundColor: theme.colors.surfaceSecondary,
    borderColor: theme.colors.borderStrong,
  };

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
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              {/* Unified Header */}
              <View
                style={[
                  styles.header,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderBottomColor: theme.colors.cardBorder,
                  },
                ]}
              >
                <View style={styles.headerTextCol}>
                  <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t('sharing.title')}
                  </Text>
                  {project && (
                    <Text
                      style={[styles.subtitle, { color: theme.colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {project.title}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  testID="share-modal-close-btn"
                  onPress={onClose}
                  style={styles.closeBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('sharing.closeA11y')}
                >
                  <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Offline Warning */}
              {!client ? (
                <View style={styles.offlineContainer}>
                  <Text style={[styles.offlineText, { color: theme.colors.textSecondary }]}>
                    {t('sharing.offlineWarning')}
                  </Text>
                </View>
              ) : (
                <>
                  {/* Tabs */}
                  <View style={[styles.tabsRow, { borderBottomColor: theme.colors.cardBorder }]}>
                    <TouchableOpacity
                      testID="share-tab-users"
                      style={[
                        styles.tab,
                        activeTab === 'users' && [
                          styles.tabActive,
                          { borderBottomColor: theme.colors.accent },
                        ],
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        setActiveTab('users');
                      }}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: activeTab === 'users' }}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          {
                            color:
                              activeTab === 'users'
                                ? theme.colors.accent
                                : theme.colors.textSecondary,
                          },
                        ]}
                      >
                        {t('sharing.usersTab', { count: users.length })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="share-tab-teams"
                      style={[
                        styles.tab,
                        activeTab === 'teams' && [
                          styles.tabActive,
                          { borderBottomColor: theme.colors.accent },
                        ],
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        setActiveTab('teams');
                      }}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: activeTab === 'teams' }}
                    >
                      <Text
                        style={[
                          styles.tabText,
                          {
                            color:
                              activeTab === 'teams'
                                ? theme.colors.accent
                                : theme.colors.textSecondary,
                          },
                        ]}
                      >
                        {t('sharing.teamsTab', { count: teams.length })}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Error Message */}
                  {errorMessage ? (
                    <View
                      testID="project-sharing-error"
                      style={[
                        styles.errorBanner,
                        {
                          borderLeftColor: theme.colors.danger,
                          backgroundColor: theme.isDark
                            ? 'rgba(255, 69, 58, 0.15)'
                            : 'rgba(215, 0, 21, 0.1)',
                        },
                      ]}
                      accessibilityRole="alert"
                    >
                      <Text style={[styles.errorText, { color: theme.colors.danger }]}>
                        {errorMessage}
                      </Text>
                    </View>
                  ) : null}

                  {isLoading ? (
                    <View style={styles.centerContainer}>
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    </View>
                  ) : activeTab === 'users' ? (
                    /* USERS TAB */
                    <ScrollView style={styles.contentList} keyboardShouldPersistTaps="handled">
                      <View style={styles.addRow}>
                        <TextInput
                          testID="share-user-input"
                          style={[
                            styles.input,
                            {
                              backgroundColor: theme.colors.inputBg,
                              color: theme.colors.text,
                              borderColor: theme.colors.borderStrong,
                            },
                          ]}
                          placeholder={t('sharing.usernamePlaceholder')}
                          placeholderTextColor={theme.colors.placeholder}
                          value={usernameInput}
                          onChangeText={setUsernameInput}
                          onSubmitEditing={handleAddUser}
                          autoCapitalize="none"
                          autoCorrect={false}
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
                          accessibilityRole="button"
                          accessibilityLabel={t('sharing.shareWithUserA11y')}
                        >
                          <Text style={styles.addBtnText}>{t('common.add')}</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.permPickerRow}>
                        {PERMISSION_OPTIONS.map((perm) => {
                          const selected = userPermission === perm;
                          return (
                            <TouchableOpacity
                              key={perm}
                              testID={`share-new-user-perm-${perm}`}
                              style={[
                                styles.permOptionChip,
                                selected
                                  ? {
                                      backgroundColor: theme.colors.accent,
                                      borderColor: theme.colors.accent,
                                    }
                                  : secondarySurface,
                              ]}
                              onPress={() => {
                                safeHaptics.selection();
                                setUserPermission(perm);
                              }}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text
                                style={[
                                  styles.permOptionText,
                                  { color: selected ? '#FFFFFF' : theme.colors.textSecondary },
                                ]}
                              >
                                {getPermissionLabel(perm)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Current Shared Users */}
                      <Text style={[styles.sectionHeading, { color: theme.colors.textSecondary }]}>
                        {t('sharing.sharedUsersHeading')}
                      </Text>
                      {users.length === 0 ? (
                        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                          {t('sharing.noSharedUsers')}
                        </Text>
                      ) : (
                        users.map((share) => {
                          const shareName = share.user?.username || share.username || '';
                          return (
                            <View
                              key={share.id}
                              style={[
                                styles.memberRow,
                                {
                                  backgroundColor: theme.colors.cardSecondary,
                                  borderColor: theme.colors.borderStrong,
                                },
                              ]}
                            >
                              <View style={styles.memberInfo}>
                                <Text style={[styles.memberName, { color: theme.colors.text }]}>
                                  {shareName}
                                </Text>
                                {(share.user?.name || share.name) && (
                                  <Text style={[styles.memberSub, { color: theme.colors.textSecondary }]}>
                                    {share.user?.name || share.name}
                                  </Text>
                                )}
                              </View>

                              <TouchableOpacity
                                testID={`share-user-perm-${share.id}`}
                                style={[styles.permBadge, secondarySurface]}
                                onPress={() => handleCycleUserPermission(share)}
                                accessibilityRole="button"
                                accessibilityLabel={t('sharing.changePermA11y', { name: shareName })}
                              >
                                <Text style={[styles.permBadgeText, { color: theme.colors.text }]}>
                                  {getPermissionLabel(share.permission)} ▾
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                testID={`share-remove-user-${share.id}`}
                                style={styles.removeBtn}
                                onPress={() => handleRemoveUser(share)}
                                accessibilityRole="button"
                                accessibilityLabel={t('sharing.removeShareA11y', { name: shareName })}
                              >
                                <Text style={[styles.removeBtnText, { color: theme.colors.danger }]}>
                                  ✕
                                </Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })
                      )}
                    </ScrollView>
                  ) : (
                    /* TEAMS TAB */
                    <ScrollView style={styles.contentList} keyboardShouldPersistTaps="handled">
                      <View style={styles.addTeamSection}>
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                          {t('sharing.teamLabel')}
                        </Text>
                        <View style={styles.teamChipsRow}>
                          {availableTeams
                            .filter((tm) => !teams.some((st) => (st.team?.id ?? st.id) === tm.id))
                            .map((team) => {
                              const isSelected = selectedTeamId === team.id;
                              return (
                                <TouchableOpacity
                                  key={team.id}
                                  testID={`share-select-team-${team.id}`}
                                  style={[
                                    styles.teamChip,
                                    isSelected
                                      ? {
                                          backgroundColor: theme.colors.accent,
                                          borderColor: theme.colors.accent,
                                        }
                                      : secondarySurface,
                                  ]}
                                  onPress={() => {
                                    safeHaptics.selection();
                                    setSelectedTeamId(team.id);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
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

                        <View style={styles.permPickerRow}>
                          {PERMISSION_OPTIONS.map((perm) => {
                            const selected = teamPermission === perm;
                            return (
                              <TouchableOpacity
                                key={perm}
                                testID={`share-new-team-perm-${perm}`}
                                style={[
                                  styles.permOptionChip,
                                  selected
                                    ? {
                                        backgroundColor: theme.colors.accent,
                                        borderColor: theme.colors.accent,
                                      }
                                    : secondarySurface,
                                ]}
                                onPress={() => {
                                  safeHaptics.selection();
                                  setTeamPermission(perm);
                                }}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                              >
                                <Text
                                  style={[
                                    styles.permOptionText,
                                    { color: selected ? '#FFFFFF' : theme.colors.textSecondary },
                                  ]}
                                >
                                  {getPermissionLabel(perm)}
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
                          accessibilityRole="button"
                          accessibilityLabel={t('sharing.shareWithTeamA11y')}
                        >
                          <Text style={styles.addBtnText}>{t('sharing.shareWithTeam')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Current Shared Teams */}
                      <Text style={[styles.sectionHeading, { color: theme.colors.textSecondary }]}>
                        {t('sharing.sharedTeamsHeading')}
                      </Text>
                      {teams.length === 0 ? (
                        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                          {t('sharing.noSharedTeams')}
                        </Text>
                      ) : (
                        teams.map((share) => {
                          const shareTeamName = share.team?.name || share.name || '';
                          return (
                            <View
                              key={share.id}
                              style={[
                                styles.memberRow,
                                {
                                  backgroundColor: theme.colors.cardSecondary,
                                  borderColor: theme.colors.borderStrong,
                                },
                              ]}
                            >
                              <View style={styles.memberInfo}>
                                <Text style={[styles.memberName, { color: theme.colors.text }]}>
                                  {shareTeamName}
                                </Text>
                                {(share.team?.description || share.description) ? (
                                  <Text style={[styles.memberSub, { color: theme.colors.textSecondary }]}>
                                    {share.team?.description || share.description}
                                  </Text>
                                ) : null}
                              </View>

                              <TouchableOpacity
                                testID={`share-team-perm-${share.id}`}
                                style={[styles.permBadge, secondarySurface]}
                                onPress={() => handleCycleTeamPermission(share)}
                                accessibilityRole="button"
                                accessibilityLabel={t('sharing.changePermA11y', {
                                  name: shareTeamName,
                                })}
                              >
                                <Text style={[styles.permBadgeText, { color: theme.colors.text }]}>
                                  {getPermissionLabel(share.permission)} ▾
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                testID={`share-remove-team-${share.id}`}
                                style={styles.removeBtn}
                                onPress={() => handleRemoveTeam(share)}
                                accessibilityRole="button"
                                accessibilityLabel={t('sharing.removeShareA11y', {
                                  name: shareTeamName,
                                })}
                              >
                                <Text style={[styles.removeBtnText, { color: theme.colors.danger }]}>
                                  ✕
                                </Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 17,
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
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorBanner: {
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 6,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  centerContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentList: {
    padding: 18,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  permPickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  permOptionChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  permOptionText: {
    fontSize: 12,
    fontWeight: '600',
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
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13,
    paddingVertical: 10,
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
    borderWidth: 1,
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
    fontSize: 15,
    fontWeight: '700',
  },
  addTeamSection: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
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
