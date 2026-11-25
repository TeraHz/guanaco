import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Project } from '../types/vikunja';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { normalizeHexColor } from '../utils/colors';
import { getDescendantProjectIds, wouldCreateProjectCycle } from '../utils/projectTree';
import { canAdminProject, canWriteProject } from '../utils/permissions';
import { useTranslation } from '../i18n';

const PALETTE = [
  '#0A84FF', // Blue
  '#30D158', // Green
  '#FF9F0A', // Orange
  '#FF453A', // Red
  '#BF5AF2', // Purple
  '#64D2FF', // Cyan
  '#FF375F', // Pink
  '#FFD60A', // Yellow
  '#8E8E93', // Gray
  '#5E5CE6', // Indigo
];

export interface ProjectEditorModalProps {
  visible: boolean;
  onClose: () => void;
  project?: Project | null;
  allProjects?: Project[];
  onSaved?: (project: Project) => void;
  onDeleted?: (projectId: number) => void;
}

const EMPTY_PROJECTS: Project[] = [];

export const ProjectEditorModal: React.FC<ProjectEditorModalProps> = ({
  visible,
  onClose,
  project,
  allProjects = [],
  onSaved,
  onDeleted,
}) => {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const {
    isLocalMode = false,
    projects: storeProjects,
    createProject,
    updateProject,
    deleteProject,
    archiveProject,
    duplicateProject,
  } = useTaskStore(
    useShallow((s) => ({
      isLocalMode: s.isLocalMode ?? false,
      projects: visible ? s.projects : EMPTY_PROJECTS,
      createProject: s.createProject,
      updateProject: s.updateProject,
      deleteProject: s.deleteProject,
      archiveProject: s.archiveProject,
      duplicateProject: s.duplicateProject,
    }))
  );

  const isEditMode = Boolean(project && project.id);
  const canDeleteProject = isLocalMode || !project || canAdminProject(project);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hexColor, setHexColor] = useState(PALETTE[0]);
  const [parentProjectId, setParentProjectId] = useState<number | undefined>(undefined);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showParentDropdown, setShowParentDropdown] = useState(false);
  const [showWebDeleteConfirm, setShowWebDeleteConfirm] = useState(false);

  const safeAllProjects = React.useMemo(
    () => (Array.isArray(allProjects) ? allProjects.filter((p) => p.id > 0) : []),
    [allProjects]
  );

  useEffect(() => {
    if (visible) {
      if (project) {
        setTitle(project.title || '');
        setDescription(project.description || '');
        setHexColor(normalizeHexColor(project.hex_color ?? undefined, true) || PALETTE[0]);
        setParentProjectId(project.parent_project_id || undefined);
        setIsFavorite(Boolean(project.is_favorite));
      } else {
        setTitle('');
        setDescription('');
        setHexColor(PALETTE[0]);
        setParentProjectId(undefined);
        setIsFavorite(false);
      }
      setErrorMessage(null);
      setShowParentDropdown(false);
      setShowWebDeleteConfirm(false);
    }
  }, [visible, project?.id]);

  const validParentProjects = React.useMemo(() => {
    return safeAllProjects
      .filter((p) => {
        if (!isLocalMode && !canWriteProject(p)) return false;
        if (p.is_archived && p.id !== project?.parent_project_id) return false;
        if (!isEditMode || !project) return true;
        if (p.id === project.id) return false;
        return !wouldCreateProjectCycle(safeAllProjects, project.id, p.id);
      })
      .sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
      );
  }, [safeAllProjects, isLocalMode, isEditMode, project]);

  const descendantSourceProjects =
    safeAllProjects.length > 0
      ? safeAllProjects
      : Array.isArray(storeProjects)
      ? storeProjects
      : [];
  const childCount = project ? getDescendantProjectIds(descendantSourceProjects, project.id).size : 0;

  const parentProjectName =
    safeAllProjects.find((p) => p.id === parentProjectId)?.title || t('common.none');

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage(t('listEditor.emptyTitleError'));
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const normalizedColor = normalizeHexColor(hexColor, true) || PALETTE[0];
      if (isEditMode && project) {
        const updated = await updateProject(project.id, {
          title: trimmedTitle,
          description: description.trim(),
          hex_color: normalizedColor,
          parent_project_id: parentProjectId || 0,
          is_favorite: isFavorite,
        });
        safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
        onSaved?.(updated);
      } else {
        const created = await createProject({
          title: trimmedTitle,
          description: description.trim(),
          hex_color: normalizedColor,
          parent_project_id: parentProjectId,
          is_favorite: isFavorite,
        });
        safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
        onSaved?.(created);
      }
      onClose();
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('listEditor.saveError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!project) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextArchiveStatus = !project.is_archived;
      await archiveProject(project.id, nextArchiveStatus);
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);
      onClose();
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('listEditor.archiveError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicate = async () => {
    if (!project) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await duplicateProject(project.id);
      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('listEditor.duplicateError'));
    } finally {
      setIsLoading(false);
    }
  };

  const performDeleteProject = async () => {
    if (!project || !canDeleteProject) return;
    setShowWebDeleteConfirm(false);
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await deleteProject(project.id);
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      onDeleted?.(project.id);
      onClose();
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('listEditor.deleteError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = () => {
    if (!project || !canDeleteProject) return;
    const message =
      childCount > 0
        ? t('listEditor.deleteConfirmWithSublists', {
            title: project.title,
            count: childCount,
          })
        : t('listEditor.deleteConfirmMessage', { title: project.title });

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`${t('drawer.deleteList')}\n\n${message}`)) {
          performDeleteProject();
        }
      } else {
        setShowWebDeleteConfirm(true);
      }
      return;
    }

    Alert.alert(t('drawer.deleteList'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: performDeleteProject,
      },
    ]);
  };

  if (!visible) return null;

  const selectedRingColor = theme.colors.text;
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
                <Text style={[styles.heading, { color: theme.colors.text }]}>
                  {isEditMode ? t('drawer.editList') : t('drawer.newList')}
                </Text>
                <TouchableOpacity
                  testID="project-modal-close-btn"
                  onPress={onClose}
                  style={styles.closeBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('listEditor.closeA11y')}
                >
                  <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Error Banner */}
              {errorMessage ? (
                <View
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

              {/* Inline Web Delete Confirmation Fallback */}
              {showWebDeleteConfirm && project ? (
                <View
                  testID="project-web-delete-confirm"
                  style={[
                    styles.confirmBanner,
                    {
                      backgroundColor: theme.colors.cardSecondary,
                      borderColor: theme.colors.danger,
                    },
                  ]}
                >
                  <Text style={[styles.confirmBannerText, { color: theme.colors.text }]}>
                    {childCount > 0
                      ? t('listEditor.deleteWebConfirmWithSublists', {
                          title: project.title,
                          count: childCount,
                        })
                      : t('listEditor.deleteWebConfirm', { title: project.title })}
                  </Text>
                  <View style={styles.confirmBannerActions}>
                    <TouchableOpacity
                      testID="project-confirm-cancel-btn"
                      style={[styles.confirmCancelBtn, secondarySurface]}
                      onPress={() => setShowWebDeleteConfirm(false)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.confirmCancelBtnText, { color: theme.colors.text }]}>
                        {t('common.cancel')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="project-confirm-delete-btn"
                      style={[styles.confirmDeleteBtn, { backgroundColor: theme.colors.danger }]}
                      onPress={performDeleteProject}
                      accessibilityRole="button"
                    >
                      <Text style={styles.confirmDeleteBtnText}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
                keyboardShouldPersistTaps="handled"
              >
                {/* Name Input */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                  {t('listEditor.nameLabel')}
                </Text>
                <TextInput
                  testID="project-modal-title-input"
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.colors.inputBg,
                      color: theme.colors.text,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                  placeholder={t('listEditor.namePlaceholder')}
                  placeholderTextColor={theme.colors.placeholder}
                  value={title}
                  onChangeText={setTitle}
                  autoCapitalize="sentences"
                  autoFocus={!isEditMode}
                />

                {/* Description Input */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                  {t('listEditor.descriptionLabel')}
                </Text>
                <TextInput
                  testID="project-modal-desc-input"
                  style={[
                    styles.textInput,
                    styles.textArea,
                    {
                      backgroundColor: theme.colors.inputBg,
                      color: theme.colors.text,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                  placeholder={t('listEditor.descriptionPlaceholder')}
                  placeholderTextColor={theme.colors.placeholder}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                />

                {/* Color Swatches */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                  {t('listEditor.colorLabel')}
                </Text>
                <View style={styles.paletteRow}>
                  {PALETTE.map((color) => {
                    const isSelected =
                      (normalizeHexColor(hexColor, true) || '').toLowerCase() ===
                      color.toLowerCase();
                    const isLightSwatch = color.toUpperCase() === '#FFD60A';
                    return (
                      <TouchableOpacity
                        key={color}
                        testID={`project-color-dot-${color}`}
                        style={[
                          styles.colorDot,
                          { backgroundColor: color },
                          isSelected && [
                            styles.colorDotSelected,
                            { borderColor: selectedRingColor },
                          ],
                        ]}
                        onPress={() => {
                          safeHaptics.selection();
                          setHexColor(color);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={t('listEditor.selectColorA11y', { color })}
                      >
                        {isSelected && (
                          <Text
                            style={[
                              styles.colorCheckmark,
                              isLightSwatch && { color: '#1C1C1E' },
                            ]}
                          >
                            ✓
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Parent Project Picker */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                  {t('listEditor.parentListLabel')}
                </Text>
                <TouchableOpacity
                  testID="project-modal-parent-selector"
                  style={[
                    styles.selectorBtn,
                    {
                      backgroundColor: theme.colors.inputBg,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                  onPress={() => setShowParentDropdown(!showParentDropdown)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.selectorBtnText, { color: theme.colors.text }]}>
                    {parentProjectName}
                  </Text>
                  <Text style={[styles.selectorArrow, { color: theme.colors.textSecondary }]}>
                    {showParentDropdown ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>

                {showParentDropdown && (
                  <View
                    style={[
                      styles.dropdownCard,
                      {
                        backgroundColor: theme.colors.cardSecondary,
                        borderColor: theme.colors.borderStrong,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={[styles.dropdownOption, { borderBottomColor: theme.colors.border }]}
                      onPress={() => {
                        setParentProjectId(undefined);
                        setShowParentDropdown(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownOptionText,
                          { color: theme.colors.text },
                          !parentProjectId && styles.dropdownOptionSelected,
                        ]}
                      >
                        {t('common.none')}
                      </Text>
                    </TouchableOpacity>
                    {validParentProjects.map((p) => {
                      const isSelected = p.id === parentProjectId;
                      const dotColor =
                        normalizeHexColor(p.hex_color ?? undefined, true) || theme.colors.accent;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={[
                            styles.dropdownOption,
                            { borderBottomColor: theme.colors.border },
                          ]}
                          onPress={() => {
                            setParentProjectId(p.id);
                            setShowParentDropdown(false);
                          }}
                        >
                          <View
                            style={[
                              styles.smallColorDot,
                              { backgroundColor: dotColor },
                            ]}
                          />
                          <Text
                            style={[
                              styles.dropdownOptionText,
                              { color: theme.colors.text },
                              isSelected && styles.dropdownOptionSelected,
                            ]}
                          >
                            {p.title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Favorite Toggle */}
                <View style={styles.switchRow}>
                  <Text style={[styles.switchLabel, { color: theme.colors.text }]}>
                    {t('listEditor.favoriteList')}
                  </Text>
                  <Switch
                    testID="project-modal-favorite-switch"
                    value={isFavorite}
                    onValueChange={setIsFavorite}
                    trackColor={{
                      false: theme.colors.borderStrong,
                      true: theme.colors.success,
                    }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                {/* Edit Mode Extra Actions */}
                {isEditMode && (
                  <View style={styles.extraActionsContainer}>
                    <TouchableOpacity
                      testID="project-modal-duplicate-btn"
                      style={[styles.secondaryBtn, secondarySurface]}
                      onPress={handleDuplicate}
                      disabled={isLoading}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.secondaryBtnText, { color: theme.colors.text }]}>
                        {t('listEditor.duplicateList')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID="project-modal-archive-btn"
                      style={[styles.secondaryBtn, secondarySurface]}
                      onPress={handleArchiveToggle}
                      disabled={isLoading}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.secondaryBtnText, { color: theme.colors.text }]}>
                        {project?.is_archived ? t('drawer.unarchiveList') : t('drawer.archiveList')}
                      </Text>
                    </TouchableOpacity>

                    {canDeleteProject && (
                      <TouchableOpacity
                        testID="project-modal-delete-btn"
                        style={[
                          styles.destructiveBtn,
                          {
                            borderColor: theme.isDark
                              ? 'rgba(255, 69, 58, 0.35)'
                              : 'rgba(215, 0, 21, 0.3)',
                            backgroundColor: theme.isDark
                              ? 'rgba(255, 69, 58, 0.12)'
                              : 'rgba(215, 0, 21, 0.08)',
                          },
                        ]}
                        onPress={handleDelete}
                        disabled={isLoading}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.destructiveBtnText, { color: theme.colors.danger }]}>
                          {t('drawer.deleteList')}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </ScrollView>

              {/* Footer Save Button */}
              <View style={[styles.footer, { borderTopColor: theme.colors.cardBorder }]}>
                <TouchableOpacity
                  testID="project-modal-save-btn"
                  style={[
                    styles.saveBtn,
                    { backgroundColor: theme.colors.accent },
                    isLoading && styles.btnDisabled,
                  ]}
                  onPress={handleSave}
                  disabled={isLoading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {isEditMode ? t('listEditor.saveChanges') : t('listEditor.createList')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  heading: {
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
  confirmBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
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
  confirmDeleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  confirmDeleteBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  content: {
    flexGrow: 1,
  },
  contentContainer: {
    padding: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  textArea: {
    height: 80,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 4,
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDotSelected: {
    transform: [{ scale: 1.15 }],
    borderWidth: 2.5,
  },
  colorCheckmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  selectorBtn: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorBtnText: {
    fontSize: 15,
    fontWeight: '500',
  },
  selectorArrow: {
    fontSize: 12,
  },
  dropdownCard: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  smallColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  dropdownOptionText: {
    fontSize: 14,
  },
  dropdownOptionSelected: {
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 6,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  extraActionsContainer: {
    marginTop: 20,
    gap: 10,
  },
  secondaryBtn: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  destructiveBtn: {
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  destructiveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  saveBtn: {
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.55,
  },
});
