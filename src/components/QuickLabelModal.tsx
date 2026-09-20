import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  SafeAreaView,
} from 'react-native';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles, getLabelColor } from '../utils/colors';
import { Label, Task } from '../types/vikunja';

interface QuickLabelModalProps {
  visible: boolean;
  task: Task | null;
  availableLabels?: string[];
  labelDefinitions?: Label[];
  onSave: (taskId: number, labels: Label[]) => void;
  onClose: () => void;
}

export const QuickLabelModal: React.FC<QuickLabelModalProps> = ({
  visible,
  task,
  availableLabels = [],
  labelDefinitions = [],
  onSave,
  onClose,
}) => {
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [newLabelText, setNewLabelText] = useState('');

  useEffect(() => {
    if (task && visible) {
      const taskLabelTitles = (task.labels || []).map((l) => l.title);
      setSelectedLabels(taskLabelTitles);

      // Combine available labels, labelDefinitions, and task labels, deduplicated
      const defTitles = (labelDefinitions || []).map((l) => l.title);
      const combined = Array.from(
        new Set([...(availableLabels || []), ...defTitles, ...taskLabelTitles])
      ).filter(Boolean);
      setAllLabels(combined);
    }
  }, [task?.id, visible]);

  if (!task) return null;

  const getHexColor = (title: string): string | undefined => {
    const fromDef = labelDefinitions.find(
      (l) => l.title.toLowerCase() === title.toLowerCase()
    )?.hex_color;
    if (fromDef) return fromDef;
    return task.labels?.find((l) => l.title.toLowerCase() === title.toLowerCase())?.hex_color;
  };

  const toggleLabel = (label: string) => {
    safeHaptics.selection();
    if (selectedLabels.includes(label)) {
      setSelectedLabels(selectedLabels.filter((l) => l !== label));
    } else {
      setSelectedLabels([...selectedLabels, label]);
    }
  };

  const handleAddNewLabel = () => {
    const trimmed = newLabelText.trim();
    if (!trimmed) return;

    if (!allLabels.includes(trimmed)) {
      setAllLabels([trimmed, ...allLabels]);
    }
    if (!selectedLabels.includes(trimmed)) {
      setSelectedLabels([...selectedLabels, trimmed]);
    }

    setNewLabelText('');
    safeHaptics.selection();
  };

  const handleSave = () => {
    const formattedLabels: Label[] = selectedLabels.map((title, idx) => {
      const existing = task.labels?.find((l) => l.title.toLowerCase() === title.toLowerCase());
      const def = labelDefinitions.find((l) => l.title.toLowerCase() === title.toLowerCase());
      return (
        existing || {
          id: def?.id || -Math.floor(Date.now() + idx),
          title,
          hex_color: def?.hex_color,
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
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <SafeAreaView style={styles.modalContent}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Edit Labels</Text>
              <Text style={styles.taskTitle} numberOfLines={1}>
                {task.title}
              </Text>
            </View>
            <TouchableOpacity
              testID="label-modal-done-btn"
              style={styles.doneBtn}
              onPress={handleSave}
              activeOpacity={0.7}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* New Label Input */}
          <View style={styles.inputRow}>
            <TextInput
              testID="new-label-input"
              style={styles.input}
              placeholder="New label name..."
              placeholderTextColor="#8E8E93"
              value={newLabelText}
              onChangeText={setNewLabelText}
              onSubmitEditing={handleAddNewLabel}
              returnKeyType="done"
            />
            <TouchableOpacity
              testID="label-modal-add-btn"
              style={[
                styles.addBtn,
                !newLabelText.trim() && styles.addBtnDisabled,
              ]}
              onPress={handleAddNewLabel}
              disabled={!newLabelText.trim()}
              activeOpacity={0.7}
            >
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {/* Labels Grid / Chips */}
          <Text style={styles.sectionHeading}>Tap to tag or move stores:</Text>
          <ScrollView style={styles.labelsList} contentContainerStyle={styles.chipsContainer}>
            {allLabels.map((label) => {
              const isSelected = selectedLabels.includes(label);
              const hex = getHexColor(label);
              const badgeStyle = getLabelBadgeStyles(label, hex);

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
                      : styles.chipUnselected,
                  ]}
                  onPress={() => toggleLabel(label)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected
                        ? { color: badgeStyle.textColor, fontWeight: '700' }
                        : styles.chipTextUnselected,
                    ]}
                  >
                    #{label} {isSelected ? '✓' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
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
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taskTitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
    maxWidth: 240,
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
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  addBtn: {
    backgroundColor: '#30D158',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  addBtnDisabled: {
    backgroundColor: '#3A3A3C',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
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
  chipSelected: {
    backgroundColor: '#0A84FF25',
    borderColor: '#0A84FF',
  },
  chipUnselected: {
    backgroundColor: '#2C2C2E',
    borderColor: '#3A3A3C',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#0A84FF',
  },
  chipTextUnselected: {
    color: '#E5E5EA',
  },
});
