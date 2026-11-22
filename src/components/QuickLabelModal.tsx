import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles } from '../utils/colors';
import { Label, Task } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';

interface QuickLabelModalProps {
  visible: boolean;
  task: Task | null;
  availableLabels?: string[];
  labelDefinitions?: Label[];
  onSave: (taskId: number, labels: Label[]) => void;
  onClose: () => void;
  onOpenManageLabels?: () => void;
}

export const QuickLabelModal: React.FC<QuickLabelModalProps> = ({
  visible,
  task,
  availableLabels = [],
  labelDefinitions = [],
  onSave,
  onClose,
  onOpenManageLabels,
}) => {
  const theme = useAppTheme();
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [newLabelText, setNewLabelText] = useState('');
  const initializedTaskIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible || !task) {
      initializedTaskIdRef.current = null;
      return;
    }

    const prevId = initializedTaskIdRef.current;
    if (prevId !== null && prevId < 0 && task.id > 0) {
      initializedTaskIdRef.current = task.id;
      return;
    }

    if (prevId !== task.id) {
      initializedTaskIdRef.current = task.id;
      const taskLabelTitles = (task.labels || []).map((l) => l.title);
      setSelectedLabels(taskLabelTitles);

      const defTitles = (labelDefinitions || []).map((l) => l.title);
      const seen = new Set<string>();
      const combined: string[] = [];
      for (const item of [...(availableLabels || []), ...defTitles, ...taskLabelTitles]) {
        const clean = (item || '').trim();
        if (clean && !seen.has(clean.toLowerCase())) {
          seen.add(clean.toLowerCase());
          combined.push(clean);
        }
      }
      setAllLabels(combined);
      setNewLabelText('');
    }
  }, [task?.id, visible, availableLabels, labelDefinitions]);

  if (!task || !visible) return null;

  const getHexColor = (title: string): string | undefined => {
    const def = labelDefinitions.find(
      (l) => l.title.toLowerCase() === title.toLowerCase()
    );
    const fromDef = def?.hex_color || def?.color;
    if (fromDef) return fromDef;
    const taskLbl = task.labels?.find((l) => l.title.toLowerCase() === title.toLowerCase());
    return taskLbl?.hex_color || taskLbl?.color;
  };

  const toggleLabel = (label: string) => {
    safeHaptics.selection();
    const exists = selectedLabels.some((l) => l.toLowerCase() === label.toLowerCase());
    if (exists) {
      setSelectedLabels(selectedLabels.filter((l) => l.toLowerCase() !== label.toLowerCase()));
    } else {
      setSelectedLabels([...selectedLabels, label]);
    }
  };

  const handleAddNewLabel = () => {
    const trimmed = newLabelText.trim().replace(/^#+/, '').trim();
    if (!trimmed) return;

    const existingCanonical =
      allLabels.find((l) => l.toLowerCase() === trimmed.toLowerCase()) || trimmed;

    if (!allLabels.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      setAllLabels([existingCanonical, ...allLabels]);
    }
    if (!selectedLabels.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      setSelectedLabels([...selectedLabels, existingCanonical]);
    }

    setNewLabelText('');
    safeHaptics.selection();
  };

  const handleSave = () => {
    let finalSelected = [...selectedLabels];
    const pendingTyped = newLabelText.trim().replace(/^#+/, '').trim();
    if (pendingTyped && !finalSelected.some((l) => l.toLowerCase() === pendingTyped.toLowerCase())) {
      const canonical =
        allLabels.find((l) => l.toLowerCase() === pendingTyped.toLowerCase()) || pendingTyped;
      finalSelected.push(canonical);
    }

    const formattedLabels: Label[] = finalSelected.map((title, idx) => {
      const existing = task.labels?.find((l) => l.title.toLowerCase() === title.toLowerCase());
      const def = labelDefinitions.find((l) => l.title.toLowerCase() === title.toLowerCase());
      return (
        existing || {
          id: def?.id || -Math.floor(Date.now() + idx + 1),
          title: def?.title || title,
          hex_color: def?.hex_color || def?.color,
        }
      );
    });

    onSave(task.id, formattedLabels);
    safeHaptics.selection();
    onClose();
  };

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
      <KeyboardAvoidingView
        testID="quick-label-keyboard-avoiding"
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <SafeAreaView
          style={[
            styles.modalContent,
            {
              backgroundColor: theme.colors.cardBackground,
              borderColor: theme.colors.cardBorder,
            },
          ]}
        >
          {/* Unified Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.cardBorder }]}>
            <View style={styles.headerTextCol}>
              <Text style={[styles.title, { color: theme.colors.text }]}>Edit Labels</Text>
              <Text
                style={[styles.taskTitle, { color: theme.colors.textSecondary }]}
                numberOfLines={1}
              >
                {task.title}
              </Text>
            </View>
            <TouchableOpacity
              testID="label-modal-done-btn"
              style={[styles.doneBtn, { backgroundColor: theme.colors.accent }]}
              onPress={handleSave}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Save labels"
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bodyContent}>
            {/* New Label Input */}
            <View style={styles.inputRow}>
              <TextInput
                testID="new-label-input"
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.colors.inputBg,
                    color: theme.colors.text,
                    borderColor: theme.colors.borderStrong,
                  },
                ]}
                placeholder="New label name..."
                placeholderTextColor={theme.colors.placeholder}
                value={newLabelText}
                onChangeText={setNewLabelText}
                onSubmitEditing={handleAddNewLabel}
                returnKeyType="done"
              />
              <TouchableOpacity
                testID="label-modal-add-btn"
                style={[
                  styles.addBtn,
                  { backgroundColor: theme.colors.accent },
                  !newLabelText.trim() && styles.btnDisabled,
                ]}
                onPress={handleAddNewLabel}
                disabled={!newLabelText.trim()}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Add new label"
              >
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {/* Labels Grid / Chips */}
            <ScrollView
              style={styles.labelsList}
              contentContainerStyle={styles.chipsContainer}
              keyboardShouldPersistTaps="handled"
            >
              {allLabels.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No labels yet
                </Text>
              ) : (
                allLabels.map((label) => {
                  const isSelected = selectedLabels.some(
                    (l) => l.toLowerCase() === label.toLowerCase()
                  );
                  const hex = getHexColor(label);
                  const badgeStyle = getLabelBadgeStyles(label, hex, theme.isDark);

                  return (
                    <TouchableOpacity
                      key={label}
                      testID={`label-chip-${label}`}
                      style={[
                        styles.chip,
                        isSelected
                          ? {
                              backgroundColor: badgeStyle.backgroundColor,
                              borderColor: badgeStyle.textColor,
                            }
                          : secondarySurface,
                      ]}
                      onPress={() => toggleLabel(label)}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`Label ${label}`}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          isSelected
                            ? { color: badgeStyle.textColor, fontWeight: '700' }
                            : { color: theme.colors.textSecondary },
                        ]}
                      >
                        #{label} {isSelected ? '✓' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {onOpenManageLabels && (
              <TouchableOpacity
                testID="quick-label-manage-btn"
                style={[styles.manageLabelsBtn, secondarySurface]}
                onPress={() => {
                  onClose();
                  onOpenManageLabels();
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={[styles.manageLabelsBtnText, { color: theme.colors.text }]}>
                  Manage Labels
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
    maxHeight: '80%',
    borderWidth: 1,
    overflow: 'hidden',
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
  taskTitle: {
    fontSize: 13,
    marginTop: 2,
  },
  doneBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  bodyContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  addBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  labelsList: {
    maxHeight: 220,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 14,
  },
  emptyText: {
    fontSize: 13,
    paddingVertical: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  manageLabelsBtn: {
    marginTop: 8,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageLabelsBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
