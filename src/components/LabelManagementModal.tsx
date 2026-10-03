import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/taskStore';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles } from '../utils/colors';
import { Label } from '../types/vikunja';

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
  const { labels, createGlobalLabel, updateGlobalLabel, deleteGlobalLabel } = useTaskStore();

  const [newTitle, setNewTitle] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editColor, setEditColor] = useState('');

  const safeLabels = Array.isArray(labels) ? labels : [];

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      safeHaptics.selection();
      await createGlobalLabel(newTitle.trim(), newColor);
      setNewTitle('');
    } catch (_) {}
  };

  const handleStartEdit = (label: Label) => {
    safeHaptics.selection();
    setEditingLabelId(label.id);
    setEditTitle(label.title);
    setEditColor(label.hex_color || label.color || PRESET_COLORS[0]);
  };

  const handleSaveEdit = async (labelId: number) => {
    if (!editTitle.trim()) return;
    try {
      safeHaptics.selection();
      await updateGlobalLabel(labelId, editTitle.trim(), editColor);
      setEditingLabelId(null);
    } catch (_) {}
  };

  const handleDelete = (labelId: number, title: string) => {
    safeHaptics.notification();
    if (Platform.OS === 'web') {
      deleteGlobalLabel(labelId);
      return;
    }

    Alert.alert(
      'Delete Label',
      `Are you sure you want to delete "#${title}"? It will be removed from all tasks.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteGlobalLabel(labelId),
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[
          styles.modalRoot,
          {
            backgroundColor: theme.colors.background,
            paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
          },
        ]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.colors.cardBackground,
              borderBottomColor: theme.colors.cardBorder,
            },
          ]}
        >
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Manage Labels</Text>
          <TouchableOpacity
            testID="close-label-management-btn"
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        </View>

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
              CREATE NEW LABEL
            </Text>
            <View style={styles.createInputRow}>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    color: theme.colors.text,
                    backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                    borderColor: theme.colors.cardBorder,
                  },
                ]}
                placeholder="New label name..."
                placeholderTextColor={theme.colors.textSecondary}
                value={newTitle}
                onChangeText={setNewTitle}
              />
              <TouchableOpacity
                testID="create-label-btn"
                style={[styles.createBtn, { backgroundColor: '#30D158' }]}
                onPress={handleCreate}
                disabled={!newTitle.trim()}
              >
                <Text style={styles.createBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {/* Color Presets for new label */}
            <View style={styles.colorPresetRow}>
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c },
                    newColor === c && styles.colorDotSelected,
                  ]}
                  onPress={() => setNewColor(c)}
                />
              ))}
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
              LABELS ({safeLabels.length})
            </Text>

            {safeLabels.length === 0 ? (
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                No labels created yet. Add one above!
              </Text>
            ) : (
              safeLabels.map((l) => {
                const badge = getLabelBadgeStyles(l.title, l.hex_color || l.color);
                const isEditing = editingLabelId === l.id;

                if (isEditing) {
                  return (
                    <View
                      key={l.id}
                      style={[
                        styles.editRow,
                        { borderColor: theme.colors.cardBorder },
                      ]}
                    >
                      <TextInput
                        style={[
                          styles.editInput,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                          },
                        ]}
                        value={editTitle}
                        onChangeText={setEditTitle}
                      />
                      <TouchableOpacity
                        testID={`save-label-${l.id}`}
                        style={[styles.smallBtn, { backgroundColor: '#0A84FF' }]}
                        onPress={() => handleSaveEdit(l.id)}
                      >
                        <Text style={styles.smallBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.smallBtn, { backgroundColor: '#8E8E93' }]}
                        onPress={() => setEditingLabelId(null)}
                      >
                        <Text style={styles.smallBtnText}>Cancel</Text>
                      </TouchableOpacity>
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
                        style={styles.actionBtn}
                        onPress={() => handleStartEdit(l)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={[styles.actionBtnText, { color: theme.colors.textSecondary }]}>
                          ✎
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID={`delete-label-${l.id}`}
                        style={[styles.actionBtn, styles.deleteActionBtn]}
                        onPress={() => handleDelete(l.id, l.title)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.deleteActionText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
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
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
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
  createBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  colorPresetRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  colorDotSelected: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.15 }],
  },
  emptyText: {
    fontSize: 13,
    fontStyle: 'italic',
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
  actionBtn: {
    padding: 6,
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: 14,
  },
  deleteActionBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
  },
  deleteActionText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '700',
  },
  editRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  editInput: {
    flex: 1,
    height: 36,
    borderRadius: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  smallBtn: {
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 12,
  },
});
