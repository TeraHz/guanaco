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
    // If same optimistic task resolved from negative tempId -> positive server ID while open, keep user's in-progress edits
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
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.cardBorder,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerTextCol}>
              <Text style={[styles.title, { color: theme.colors.text }]}>Edit Labels</Text>
              <Text style={[styles.taskTitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {task.title}
              </Text>
            </View>
            <TouchableOpacity
              testID="label-modal-done-btn"
              style={styles.doneBtn}
              onPress={handleSave}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Save labels"
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* New Label Input */}
          <View style={styles.inputRow}>
            <TextInput
              testID="new-label-input"
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.inputBg,
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                },
              ]}
              placeholder="New label name..."
              placeholderTextColor={theme.colors.textTertiary}
              value={newLabelText}
              onChangeText={setNewLabelText}
              onSubmitEditing={handleAddNewLabel}
              returnKeyType="done"
            />
            <TouchableOpacity
              testID="label-modal-add-btn"
              style={[
                styles.addBtn,
                !newLabelText.trim() && {
                  backgroundColor: theme.isDark ? '#3A3A3C' : '#D1D1D6',
                },
              ]}
              onPress={handleAddNewLabel}
              disabled={!newLabelText.trim()}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add new label"
            >
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {/* Labels Grid / Chips */}
          <Text style={[styles.sectionHeading, { color: theme.colors.textSecondary }]}>
            Tap to tag or move stores:
          </Text>
          <ScrollView
            style={styles.labelsList}
            contentContainerStyle={styles.chipsContainer}
            keyboardShouldPersistTaps="handled"
          >
            {allLabels.map((label) => {
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
                      : {
                          backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                          borderColor: theme.isDark ? '#3A3A3C' : '#D1D1D6',
                        },
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
            })}
          </ScrollView>

          {onOpenManageLabels && (
            <TouchableOpacity
              testID="quick-label-manage-btn"
              style={[styles.manageLabelsBtn, { borderTopColor: theme.colors.border }]}
              onPress={() => {
                onClose();
                onOpenManageLabels();
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.manageLabelsBtnText,
                  { color: theme.colors.accent },
                ]}
              >
                ⚙️ Manage & Delete Global Labels
              </Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '80%',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  taskTitle: {
    fontSize: 14,
    marginTop: 2,
  },
  doneBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
  },
  addBtn: {
    backgroundColor: '#30D158',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  labelsList: {
    maxHeight: 220,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  manageLabelsBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
  },
  manageLabelsBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
