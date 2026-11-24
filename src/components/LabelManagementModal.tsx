import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles, normalizeHexColor } from '../utils/colors';
import { Label } from '../types/vikunja';
import { useTranslation } from '../i18n';

interface LabelManagementModalProps {
  visible: boolean;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#0A84FF', // Blue
  '#30D158', // Green
  '#FF9F0A', // Orange
  '#FF453A', // Red
  '#BF5AF2', // Purple
  '#64D2FF', // Cyan
  '#FF375F', // Pink
  '#FFD60A', // Yellow
];

export const LabelManagementModal: React.FC<LabelManagementModalProps> = ({
  visible,
  onClose,
}) => {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { labels, createGlobalLabel, updateGlobalLabel, deleteGlobalLabel } = useTaskStore();

  const [newTitle, setNewTitle] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editColor, setEditColor] = useState(PRESET_COLORS[0]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDeleteLabel, setConfirmDeleteLabel] = useState<Label | null>(null);

  const safeLabels = Array.isArray(labels) ? labels : [];

  useEffect(() => {
    if (visible) {
      setErrorMessage(null);
      setEditingLabelId(null);
      setConfirmDeleteLabel(null);
    }
  }, [visible]);

  const handleCreate = async () => {
    const cleaned = newTitle.trim().replace(/^#+/, '').trim();
    if (!cleaned) return;
    if (safeLabels.some((l) => l.title.toLowerCase() === cleaned.toLowerCase())) {
      setErrorMessage(t('labels.alreadyExistsError', { title: cleaned }));
      return;
    }
    setErrorMessage(null);
    try {
      safeHaptics.selection();
      await createGlobalLabel(cleaned, newColor);
      setNewTitle('');
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('labels.createError'));
    }
  };

  const handleStartEdit = (label: Label) => {
    safeHaptics.selection();
    setErrorMessage(null);
    setEditingLabelId(label.id);
    setEditTitle(label.title);
    const normalized = normalizeHexColor(label.hex_color || label.color, true);
    setEditColor(normalized || PRESET_COLORS[0]);
  };

  const handleSaveEdit = async (labelId: number) => {
    const cleaned = editTitle.trim().replace(/^#+/, '').trim();
    if (!cleaned) {
      setErrorMessage(t('labels.emptyNameError'));
      return;
    }
    setErrorMessage(null);
    try {
      safeHaptics.selection();
      await updateGlobalLabel(labelId, cleaned, editColor);
      setEditingLabelId(null);
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('labels.updateError'));
    }
  };

  const performDelete = async (labelId: number) => {
    setErrorMessage(null);
    setConfirmDeleteLabel(null);
    try {
      await deleteGlobalLabel(labelId);
      if (editingLabelId === labelId) {
        setEditingLabelId(null);
      }
    } catch (err: any) {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(err?.message || t('labels.deleteError'));
    }
  };

  const handleDelete = (label: Label) => {
    safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
    const promptMsg = t('labels.deleteConfirmMessage', { title: label.title });

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`${t('labels.deleteTitle')}\n\n${promptMsg}`)) {
          performDelete(label.id);
        }
      } else {
        setConfirmDeleteLabel(label);
      }
      return;
    }

    Alert.alert(t('labels.deleteTitle'), promptMsg, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => performDelete(label.id),
      },
    ]);
  };

  const selectedRingColor = theme.colors.text;
  const secondarySurface = {
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
          <KeyboardAvoidingView
            testID="label-management-keyboard-avoiding"
            style={styles.keyboardView}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
              <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                {t('labels.manageLabels')}
              </Text>
              <TouchableOpacity
                testID="close-label-management-btn"
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('labels.closeManagementA11y')}
              >
                <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {errorMessage ? (
              <View
                testID="label-management-error"
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
                <TouchableOpacity onPress={() => setErrorMessage(null)} accessibilityRole="button">
                  <Text style={[styles.errorDismiss, { color: theme.colors.danger }]}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {confirmDeleteLabel ? (
              <View
                testID="label-delete-confirm-banner"
                style={[
                  styles.confirmBanner,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderColor: theme.colors.danger,
                  },
                ]}
              >
                <Text style={[styles.confirmBannerText, { color: theme.colors.text }]}>
                  {t('labels.deleteWebConfirm', { title: confirmDeleteLabel.title })}
                </Text>
                <View style={styles.confirmBannerActions}>
                  <TouchableOpacity
                    testID="label-confirm-cancel-btn"
                    style={[styles.secondarySmallBtn, secondarySurface]}
                    onPress={() => setConfirmDeleteLabel(null)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.secondarySmallBtnText, { color: theme.colors.text }]}>
                      {t('common.cancel')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="label-confirm-delete-btn"
                    style={[styles.primarySmallBtn, { backgroundColor: theme.colors.danger }]}
                    onPress={() => performDelete(confirmDeleteLabel.id)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primarySmallBtnText}>{t('common.delete')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Create New Label Card */}
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
                  {t('labels.newLabelSection')}
                </Text>
                <View style={styles.createInputRow}>
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.inputBg,
                        borderColor: theme.colors.borderStrong,
                      },
                    ]}
                    placeholder={t('labels.newLabelPlaceholder')}
                    placeholderTextColor={theme.colors.placeholder}
                    value={newTitle}
                    onChangeText={(txt) => {
                      setNewTitle(txt);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    onSubmitEditing={handleCreate}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    testID="create-label-btn"
                    style={[
                      styles.createBtn,
                      { backgroundColor: theme.colors.accent },
                      !newTitle.trim() && styles.btnDisabled,
                    ]}
                    onPress={handleCreate}
                    disabled={!newTitle.trim()}
                    accessibilityRole="button"
                    accessibilityLabel={t('labels.createLabelA11y')}
                  >
                    <Text style={styles.createBtnText}>{t('common.add')}</Text>
                  </TouchableOpacity>
                </View>

                {/* Color Presets for new label */}
                <View style={styles.colorPresetRow}>
                  {PRESET_COLORS.map((c) => {
                    const isSelected = newColor.toLowerCase() === c.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={c}
                        testID={`new-label-color-${c}`}
                        style={[
                          styles.colorDot,
                          { backgroundColor: c },
                          isSelected && [
                            styles.colorDotSelected,
                            { borderColor: selectedRingColor },
                          ],
                        ]}
                        onPress={() => {
                          safeHaptics.selection();
                          setNewColor(c);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={t('listEditor.selectColorA11y', { color: c })}
                      />
                    );
                  })}
                </View>
              </View>

              {/* Existing Labels List */}
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
                  {t('labels.labelsCountSection', { count: safeLabels.length })}
                </Text>

                {safeLabels.length === 0 ? (
                  <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    {t('labels.noLabelsYet')}
                  </Text>
                ) : (
                  safeLabels.map((l) => {
                    const badge = getLabelBadgeStyles(
                      l.title,
                      l.hex_color || l.color,
                      theme.isDark
                    );
                    const isEditing = editingLabelId === l.id;

                    if (isEditing) {
                      return (
                        <View
                          key={l.id}
                          style={[
                            styles.editBlock,
                            { borderColor: theme.colors.cardBorder },
                          ]}
                        >
                          <View style={styles.editRow}>
                            <TextInput
                              testID={`edit-label-input-${l.id}`}
                              style={[
                                styles.editInput,
                                {
                                  color: theme.colors.text,
                                  backgroundColor: theme.colors.inputBg,
                                  borderColor: theme.colors.borderStrong,
                                },
                              ]}
                              value={editTitle}
                              onChangeText={setEditTitle}
                              onSubmitEditing={() => handleSaveEdit(l.id)}
                              returnKeyType="done"
                            />
                            <TouchableOpacity
                              testID={`save-label-${l.id}`}
                              style={[
                                styles.primarySmallBtn,
                                { backgroundColor: theme.colors.accent },
                              ]}
                              onPress={() => handleSaveEdit(l.id)}
                              accessibilityRole="button"
                              accessibilityLabel={t('labels.saveChangesA11y')}
                            >
                              <Text style={styles.primarySmallBtnText}>{t('common.save')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              testID={`cancel-edit-label-${l.id}`}
                              style={[styles.secondarySmallBtn, secondarySurface]}
                              onPress={() => setEditingLabelId(null)}
                              accessibilityRole="button"
                              accessibilityLabel={t('labels.cancelEditA11y')}
                            >
                              <Text
                                style={[
                                  styles.secondarySmallBtnText,
                                  { color: theme.colors.text },
                                ]}
                              >
                                {t('common.cancel')}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {/* Color Presets while editing label */}
                          <View style={styles.editColorRow}>
                            {PRESET_COLORS.map((c) => {
                              const isSelected =
                                (normalizeHexColor(editColor, true) || '').toLowerCase() ===
                                c.toLowerCase();
                              return (
                                <TouchableOpacity
                                  key={c}
                                  testID={`edit-label-color-${l.id}-${c}`}
                                  style={[
                                    styles.colorDotSmall,
                                    { backgroundColor: c },
                                    isSelected && [
                                      styles.colorDotSelected,
                                      { borderColor: selectedRingColor },
                                    ],
                                  ]}
                                  onPress={() => {
                                    safeHaptics.selection();
                                    setEditColor(c);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: isSelected }}
                                  accessibilityLabel={t('labels.setColorA11y', { color: c })}
                                />
                              );
                            })}
                          </View>
                        </View>
                      );
                    }

                    return (
                      <View
                        key={l.id}
                        style={[
                          styles.labelRow,
                          { borderBottomColor: theme.colors.cardBorder },
                        ]}
                      >
                        <View
                          style={[
                            styles.badge,
                            {
                              backgroundColor: badge.backgroundColor,
                              borderColor: badge.textColor,
                            },
                          ]}
                        >
                          <Text style={[styles.badgeText, { color: badge.textColor }]}>
                            #{l.title}
                          </Text>
                        </View>

                        <View style={styles.actionsRow}>
                          <TouchableOpacity
                            testID={`edit-label-${l.id}`}
                            style={[styles.rowActionPill, secondarySurface]}
                            onPress={() => handleStartEdit(l)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('labels.editLabelA11y', { title: l.title })}
                          >
                            <Text style={[styles.rowActionText, { color: theme.colors.text }]}>
                              {t('common.edit')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            testID={`delete-label-${l.id}`}
                            style={[
                              styles.rowActionPill,
                              {
                                borderColor: theme.isDark
                                  ? 'rgba(255, 69, 58, 0.35)'
                                  : 'rgba(215, 0, 21, 0.3)',
                                backgroundColor: theme.isDark
                                  ? 'rgba(255, 69, 58, 0.12)'
                                  : 'rgba(215, 0, 21, 0.08)',
                              },
                            ]}
                            onPress={() => handleDelete(l)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('labels.deleteLabelA11y', { title: l.title })}
                          >
                            <Text style={[styles.rowActionText, { color: theme.colors.danger }]}>
                              {t('common.delete')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
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
  keyboardView: {
    flex: 1,
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  errorDismiss: {
    fontSize: 14,
    fontWeight: '700',
    paddingLeft: 10,
  },
  confirmBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  confirmBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBannerActions: {
    flexDirection: 'row',
    gap: 6,
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
    marginBottom: 10,
  },
  createInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  createBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  colorPresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  colorDotSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  colorDotSelected: {
    borderWidth: 2.5,
    transform: [{ scale: 1.15 }],
  },
  emptyText: {
    fontSize: 13,
    paddingVertical: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  rowActionPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  rowActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editBlock: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  editRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  editColorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  editInput: {
    flex: 1,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  primarySmallBtn: {
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primarySmallBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  secondarySmallBtn: {
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondarySmallBtnText: {
    fontWeight: '600',
    fontSize: 12,
  },
});
