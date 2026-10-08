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
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { wouldCreateProjectCycle, flattenProjectTree, buildProjectTree } from '../utils/projectTree';

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

export const ProjectEditorModal: React.FC<ProjectEditorModalProps> = ({
  visible,
  onClose,
  project,
  allProjects = [],
  onSaved,
  onDeleted,
}) => {
  const theme = useAppTheme();
  const {
    createProject,
    updateProject,
    deleteProject,
    archiveProject,
    duplicateProject,
  } = useTaskStore();

  const isEditMode = Boolean(project && project.id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hexColor, setHexColor] = useState(PALETTE[0]);
  const [parentProjectId, setParentProjectId] = useState<number | undefined>(undefined);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showParentDropdown, setShowParentDropdown] = useState(false);

  useEffect(() => {
    if (visible) {
      if (project) {
        setTitle(project.title || '');
        setDescription(project.description || '');
        setHexColor(project.hex_color || PALETTE[0]);
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
    }
  }, [visible, project]);

  // Filter valid parent projects (prevent self and descendants cycle) and sort alphabetically
  const validParentProjects = React.useMemo(() => {
    return allProjects
      .filter((p) => {
        if (!isEditMode || !project) return true;
        if (p.id === project.id) return false;
        return !wouldCreateProjectCycle(allProjects, project.id, p.id);
      })
      .sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  }, [allProjects, isEditMode, project]);

  const parentProjectName = allProjects.find((p) => p.id === parentProjectId)?.title || 'None (Top Level)';

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('List title cannot be empty.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (isEditMode && project) {
        const updated = await updateProject(project.id, {
          title: trimmedTitle,
          description: description.trim(),
          hex_color: hexColor,
          parent_project_id: parentProjectId || 0,
          is_favorite: isFavorite,
        });
        safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
        onSaved?.(updated);
      } else {
        const created = await createProject({
          title: trimmedTitle,
          description: description.trim(),
          hex_color: hexColor,
          parent_project_id: parentProjectId,
          is_favorite: isFavorite,
        });
        safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
        onSaved?.(created);
      }
      onClose();
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err.message || 'Failed to save list.');
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
      setErrorMessage(err.message || 'Failed to update archive status.');
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
      setErrorMessage(err.message || 'Failed to duplicate list.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = () => {
    if (!project) return;
    Alert.alert(
      'Delete List',
      `Are you sure you want to delete "${project.title}"? All tasks inside will be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
              await deleteProject(project.id);
              safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
              onDeleted?.(project.id);
              onClose();
            } catch (err: any) {
              safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
              setErrorMessage(err.message || 'Failed to delete list.');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
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
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
                <Text style={[styles.heading, { color: theme.colors.text }]}>
                  {isEditMode ? 'Edit List' : 'New List'}
                </Text>
                <TouchableOpacity
                  testID="project-modal-close-btn"
                  onPress={onClose}
                  style={styles.closeBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Error Banner */}
              {errorMessage ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
                keyboardShouldPersistTaps="handled"
              >
                {/* Title Input */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>TITLE *</Text>
                <TextInput
                  testID="project-modal-title-input"
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.colors.inputBg,
                      color: theme.colors.text,
                      borderColor: theme.colors.border,
                    },
                  ]}
                  placeholder="e.g. Groceries, Vacation Prep"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={title}
                  onChangeText={setTitle}
                  autoCapitalize="sentences"
                  autoFocus={!isEditMode}
                />

                {/* Description Input */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>DESCRIPTION</Text>
                <TextInput
                  testID="project-modal-desc-input"
                  style={[
                    styles.textInput,
                    styles.textArea,
                    {
                      backgroundColor: theme.colors.inputBg,
                      color: theme.colors.text,
                      borderColor: theme.colors.border,
                    },
                  ]}
                  placeholder="Optional details or instructions..."
                  placeholderTextColor={theme.colors.textTertiary}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                />

                {/* Color Swatches */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>COLOR</Text>
                <View style={styles.paletteRow}>
                  {PALETTE.map((color) => {
                    const isSelected = hexColor.toLowerCase() === color.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={color}
                        testID={`project-color-dot-${color}`}
                        style={[
                          styles.colorDot,
                          { backgroundColor: color },
                          isSelected && styles.colorDotSelected,
                        ]}
                        onPress={() => {
                          safeHaptics.selection();
                          setHexColor(color);
                        }}
                      >
                        {isSelected && <Text style={styles.colorCheckmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Parent Project Picker */}
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>PARENT LIST</Text>
                <TouchableOpacity
                  testID="project-modal-parent-selector"
                  style={[
                    styles.selectorBtn,
                    {
                      backgroundColor: theme.colors.inputBg,
                      borderColor: theme.colors.border,
                    },
                  ]}
                  onPress={() => setShowParentDropdown(!showParentDropdown)}
                >
                  <Text style={[styles.selectorBtnText, { color: theme.colors.text }]}>
                    {parentProjectName}
                  </Text>
                  <Text style={[styles.selectorArrow, { color: theme.colors.textTertiary }]}>
                    {showParentDropdown ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>

                {showParentDropdown && (
                  <View
                    style={[
                      styles.dropdownCard,
                      {
                        backgroundColor: theme.colors.cardSecondary,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.dropdownOption}
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
                        None (Top Level)
                      </Text>
                    </TouchableOpacity>
                    {validParentProjects.map((p) => {
                      const isSelected = p.id === parentProjectId;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.dropdownOption}
                          onPress={() => {
                            setParentProjectId(p.id);
                            setShowParentDropdown(false);
                          }}
                        >
                          <View
                            style={[
                              styles.smallColorDot,
                              { backgroundColor: p.hex_color || theme.colors.accent },
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
                  <Text style={[styles.switchLabel, { color: theme.colors.text }]}>Favorite List</Text>
                  <Switch
                    testID="project-modal-favorite-switch"
                    value={isFavorite}
                    onValueChange={setIsFavorite}
                    trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                  />
                </View>

                {/* Edit Mode Extra Actions */}
                {isEditMode && (
                  <View style={styles.extraActionsContainer}>
                    <TouchableOpacity
                      testID="project-modal-duplicate-btn"
                      style={[
                        styles.secondaryBtn,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
                      ]}
                      onPress={handleDuplicate}
                      disabled={isLoading}
                    >
                      <Text style={[styles.secondaryBtnText, { color: theme.colors.text }]}>
                        Duplicate List
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID="project-modal-archive-btn"
                      style={[
                        styles.secondaryBtn,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
                      ]}
                      onPress={handleArchiveToggle}
                      disabled={isLoading}
                    >
                      <Text style={[styles.secondaryBtnText, { color: theme.colors.text }]}>
                        {project?.is_archived ? 'Unarchive List' : 'Archive List'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID="project-modal-delete-btn"
                      style={[styles.destructiveBtn]}
                      onPress={handleDelete}
                      disabled={isLoading}
                    >
                      <Text style={styles.destructiveBtnText}>Delete List</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>

              {/* Footer Save Button */}
              <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
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
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {isEditMode ? 'Save Changes' : 'Create List'}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 20,
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
  content: {
    flexGrow: 1,
  },
  contentContainer: {
    padding: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
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
    borderWidth: 2,
    borderColor: '#FFFFFF',
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
    borderBottomColor: 'rgba(128,128,128,0.2)',
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
    marginTop: 18,
    paddingVertical: 6,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  extraActionsContainer: {
    marginTop: 24,
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
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
  },
  destructiveBtnText: {
    color: '#FF453A',
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
    fontSize: 16,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
