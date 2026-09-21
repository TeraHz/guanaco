import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { useAppTheme } from '../utils/theme';
import { getLabelBadgeStyles } from '../utils/colors';
import { getUserSuggestions } from '../utils/userSuggestions';
import { Label, Project, Task, User } from '../types/vikunja';

interface TaskDetailModalProps {
  visible: boolean;
  task: Task | null;
  availableLabels?: string[];
  labelDefinitions?: Label[];
  availableUsers?: User[];
  availableProjects?: Project[];
  defaultProjectId?: number;
  onClose: () => void;
  onSave: (taskId: number, updates: Partial<Task>) => void;
  onDelete: (taskId: number) => void;
  onCreateTask?: (taskData: Partial<Task>) => void;
  onMoveTask?: (taskId: number, newProjectId: number) => void;
}

const PRIORITY_LEVELS = [
  { value: 0, label: 'None', color: '#8E8E93' },
  { value: 1, label: 'Low', color: '#007AFF' },
  { value: 2, label: 'Medium', color: '#FF9500' },
  { value: 3, label: 'High', color: '#FF3B30' },
  { value: 4, label: 'Urgent', color: '#AF52DE' },
  { value: 5, label: 'Critical', color: '#FF2D55' },
];

const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

const COLOR_PRESETS = [
  '#0A84FF', // Blue
  '#30D158', // Green
  '#FF9F0A', // Orange
  '#FF453A', // Red
  '#BF5AF2', // Purple
  '#64D2FF', // Cyan
  '#FF375F', // Pink
];

const REPEAT_PRESETS = [
  { value: 0, label: 'Never' },
  { value: 86400, label: 'Daily' },
  { value: 604800, label: 'Weekly' },
  { value: 2592000, label: 'Monthly' },
];

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  visible,
  task,
  availableLabels = [],
  labelDefinitions = [],
  availableUsers = [],
  availableProjects = [],
  defaultProjectId,
  onClose,
  onSave,
  onDelete,
  onCreateTask,
  onMoveTask,
}) => {
  const theme = useAppTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [done, setDone] = useState(false);
  const [priority, setPriority] = useState(0);
  const [percentDone, setPercentDone] = useState(0);
  const [color, setColor] = useState('');
  const [repeatAfter, setRepeatAfter] = useState<number | undefined>(undefined);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [projectId, setProjectId] = useState<number>(
    task?.project_id || defaultProjectId || availableProjects[0]?.id || 1
  );
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const [newAssigneeText, setNewAssigneeText] = useState('');
  const [newLabelText, setNewLabelText] = useState('');

  useEffect(() => {
    if (visible) {
      if (task) {
        setTitle(task.title || '');
        setDescription(task.description || '');
        setDone(Boolean(task.done));
        setPriority(task.priority || 0);

        // Handle percent_done normalized to 0-100
        let normalizedPct = 0;
        if (task.percent_done !== undefined && task.percent_done !== null) {
          normalizedPct =
            task.percent_done <= 1 && task.percent_done > 0
              ? Math.round(task.percent_done * 100)
              : Math.round(task.percent_done);
        }
        setPercentDone(normalizedPct);

        setColor(task.color || '');
        setRepeatAfter(task.repeat_after || 0);
        setDueDate(task.due_date || null);
        setLabels(task.labels ? [...task.labels] : []);
        setAssignees(task.assignees ? [...task.assignees] : []);
        setProjectId(task.project_id);
      } else {
        // Create Mode
        setTitle('');
        setDescription('');
        setDone(false);
        setPriority(0);
        setPercentDone(0);
        setColor('');
        setRepeatAfter(undefined);
        setDueDate(null);
        setLabels([]);
        setAssignees([]);
        setProjectId(defaultProjectId || availableProjects[0]?.id || 1);
      }
      setNewAssigneeText('');
      setNewLabelText('');
      setShowProjectPicker(false);
    }
  }, [task?.id, visible, defaultProjectId]);

  const handleSave = () => {
    if (!title.trim()) return;
    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);

    if (!task) {
      onCreateTask?.({
        title: title.trim(),
        description: description.trim() || undefined,
        done,
        priority,
        percent_done: percentDone,
        color: color || undefined,
        repeat_after: repeatAfter,
        due_date: dueDate,
        project_id: projectId,
        labels,
        assignees,
      });
      onClose();
      return;
    }

    if (onMoveTask && task.project_id !== projectId) {
      onMoveTask(task.id, projectId);
    }

    onSave(task.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      done,
      priority,
      percent_done: percentDone,
      color: color || undefined,
      repeat_after: repeatAfter,
      due_date: dueDate,
      project_id: projectId,
      labels,
      assignees,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!task) return;
    safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
    onDelete(task.id);
    onClose();
  };

  const handleRemoveAssignee = (username: string) => {
    safeHaptics.selection();
    setAssignees((prev) => prev.filter((u) => u.username !== username));
  };

  const handleAddAssignee = () => {
    const trimmed = newAssigneeText.trim().replace(/^@/, '');
    if (!trimmed) return;
    if (assignees.some((u) => u.username.toLowerCase() === trimmed.toLowerCase())) {
      setNewAssigneeText('');
      return;
    }

    const matched = availableUsers.find(
      (u) => u.username.toLowerCase() === trimmed.toLowerCase()
    );
    const newUser: User = matched || {
      id: -Math.floor(Date.now() + Math.random() * 1000),
      username: trimmed,
    };

    safeHaptics.selection();
    setAssignees((prev) => [...prev, newUser]);
    setNewAssigneeText('');
  };

  const handleRemoveLabel = (labelTitle: string) => {
    safeHaptics.selection();
    setLabels((prev) => prev.filter((l) => l.title !== labelTitle));
  };

  const handleAddLabel = (labelTitle?: string) => {
    const textToAdd = (labelTitle || newLabelText).trim().replace(/^#/, '');
    if (!textToAdd) return;
    if (labels.some((l) => l.title.toLowerCase() === textToAdd.toLowerCase())) {
      setNewLabelText('');
      return;
    }

    const matchedDef = labelDefinitions.find(
      (l) => l.title.toLowerCase() === textToAdd.toLowerCase()
    );
    const newLabel: Label = matchedDef || {
      id: -Math.floor(Date.now() + Math.random() * 1000),
      title: textToAdd,
    };

    safeHaptics.selection();
    setLabels((prev) => [...prev, newLabel]);
    setNewLabelText('');
  };

  const assigneeSuggestions = newAssigneeText.trim()
    ? getUserSuggestions(newAssigneeText.trim().replace(/^@/, ''), availableUsers).filter(
        (u) => !assignees.some((a) => a.username.toLowerCase() === u.username.toLowerCase())
      )
    : [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        testID="task-detail-modal-root"
        style={[
          styles.modalRoot,
          {
            backgroundColor: theme.colors.background,
            paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
          },
        ]}
      >
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View
            style={[
              styles.header,
              {
                borderBottomColor: theme.colors.cardBorder,
                backgroundColor: theme.colors.cardBackground,
              },
            ]}
          >
            <TouchableOpacity
              testID="task-detail-close-btn"
              onPress={onClose}
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.cancelText, { color: theme.colors.textSecondary }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
              {task ? 'Task Details' : 'New Task'}
            </Text>
            <TouchableOpacity
              testID="task-detail-save-btn"
              onPress={handleSave}
              style={[styles.headerBtn, styles.saveBtn]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* List / Project Picker */}
            {availableProjects && availableProjects.length > 0 && (
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
                  LIST / PROJECT
                </Text>
                <TouchableOpacity
                  testID="task-project-picker-btn"
                  style={[
                    styles.projectPickerBtn,
                    {
                      backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                      borderColor: theme.colors.cardBorder,
                    },
                  ]}
                  onPress={() => setShowProjectPicker(!showProjectPicker)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.projectColorDot,
                      {
                        backgroundColor:
                          availableProjects.find((p) => p.id === projectId)?.hex_color ||
                          '#007AFF',
                      },
                    ]}
                  />
                  <Text style={[styles.projectPickerText, { color: theme.colors.text }]}>
                    {availableProjects.find((p) => p.id === projectId)?.title || 'Select List'}
                  </Text>
                  <Text style={[styles.projectPickerArrow, { color: theme.colors.textSecondary }]}>
                    {showProjectPicker ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>

                {showProjectPicker && (
                  <View
                    style={[
                      styles.projectDropdown,
                      {
                        backgroundColor: theme.isDark ? '#252528' : '#F2F2F7',
                        borderColor: theme.colors.cardBorder,
                      },
                    ]}
                  >
                    {availableProjects.map((proj) => {
                      const isSelected = proj.id === projectId;
                      return (
                        <TouchableOpacity
                          key={proj.id}
                          testID={`project-option-${proj.id}`}
                          style={[
                            styles.projectOption,
                            isSelected && {
                              backgroundColor: theme.isDark ? '#3A3A3C' : '#E5E5EA',
                            },
                          ]}
                          onPress={() => {
                            safeHaptics.selection();
                            setProjectId(proj.id);
                            setShowProjectPicker(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.projectColorDot,
                              { backgroundColor: proj.hex_color || '#007AFF' },
                            ]}
                          />
                          <Text
                            style={[
                              styles.projectOptionText,
                              { color: theme.colors.text },
                              isSelected && { fontWeight: '700' },
                            ]}
                          >
                            {proj.title}
                          </Text>
                          {isSelected && <Text style={styles.projectCheckmark}>✓</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* Title & Done Checkbox */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <View style={styles.titleRow}>
                <TouchableOpacity
                  testID="task-detail-done-toggle"
                  style={[
                    styles.checkbox,
                    done && styles.checkboxDone,
                    { borderColor: done ? '#30D158' : theme.colors.cardBorder },
                  ]}
                  onPress={() => {
                    safeHaptics.selection();
                    setDone(!done);
                  }}
                >
                  {done && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
                <TextInput
                  testID="task-detail-title-input"
                  style={[
                    styles.titleInput,
                    { color: theme.colors.text },
                    done && styles.titleInputDone,
                  ]}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Task title"
                  placeholderTextColor={theme.colors.textSecondary}
                  multiline
                />
              </View>
            </View>

            {/* Description */}
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
                DESCRIPTION & NOTES
              </Text>
              <TextInput
                testID="task-detail-description-input"
                style={[
                  styles.descriptionInput,
                  {
                    color: theme.colors.text,
                    backgroundColor: theme.isDark ? '#161618' : '#F9F9FB',
                    borderColor: theme.colors.cardBorder,
                  },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder="Add details, markdown, or instructions..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Priority Selector */}
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
                PRIORITY
              </Text>
              <View style={styles.chipRow}>
                {PRIORITY_LEVELS.map((item) => {
                  const isSelected = priority === item.value;
                  return (
                    <TouchableOpacity
                      key={item.value}
                      testID={`priority-option-${item.value}`}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: isSelected
                            ? item.color
                            : theme.isDark
                            ? '#2C2C2E'
                            : '#E5E5EA',
                          borderColor: isSelected ? item.color : 'transparent',
                        },
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        setPriority(item.value);
                      }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: isSelected
                              ? '#FFFFFF'
                              : theme.isDark
                              ? '#D1D1D6'
                              : '#3A3A3C',
                          },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Progress / Percent Done */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.colors.cardBackground,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                  PROGRESS
                </Text>
                <Text style={[styles.progressDisplay, { color: theme.colors.text }]}>
                  {percentDone}% Complete
                </Text>
              </View>
              <View style={styles.chipRow}>
                {PROGRESS_PRESETS.map((pct) => {
                  const isSelected = percentDone === pct;
                  return (
                    <TouchableOpacity
                      key={pct}
                      testID={`progress-option-${pct}`}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: isSelected
                            ? '#0A84FF'
                            : theme.isDark
                            ? '#2C2C2E'
                            : '#E5E5EA',
                        },
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        setPercentDone(pct);
                      }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: isSelected
                              ? '#FFFFFF'
                              : theme.isDark
                              ? '#D1D1D6'
                              : '#3A3A3C',
                          },
                        ]}
                      >
                        {pct}%
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Assignees */}
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
                ASSIGNEES
              </Text>
              <View style={styles.chipRow}>
                {assignees.map((user) => (
                  <View
                    key={user.id || user.username}
                    style={[
                      styles.itemBadge,
                      {
                        backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                        borderColor: theme.colors.cardBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.itemBadgeText, { color: theme.colors.text }]}>
                      @{user.username}
                    </Text>
                    <TouchableOpacity
                      testID={`remove-assignee-${user.username}`}
                      onPress={() => handleRemoveAssignee(user.username)}
                      style={styles.removeBadgeBtn}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={styles.removeBadgeIcon}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              {/* Add Assignee Input */}
              <View style={styles.addInputRow}>
                <TextInput
                  style={[
                    styles.addInput,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.isDark ? '#161618' : '#F9F9FB',
                      borderColor: theme.colors.cardBorder,
                    },
                  ]}
                  placeholder="Add @user..."
                  placeholderTextColor={theme.colors.textSecondary}
                  value={newAssigneeText}
                  onChangeText={setNewAssigneeText}
                  onSubmitEditing={handleAddAssignee}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  testID="add-assignee-btn"
                  style={[styles.addBtn, { backgroundColor: '#0A84FF' }]}
                  onPress={handleAddAssignee}
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>

              {/* Assignee Suggestions */}
              {assigneeSuggestions.length > 0 && (
                <View style={styles.suggestionsList}>
                  {assigneeSuggestions.slice(0, 3).map((user) => (
                    <TouchableOpacity
                      key={user.id}
                      style={[
                        styles.suggestionItem,
                        { borderBottomColor: theme.colors.cardBorder },
                      ]}
                      onPress={() => {
                        setNewAssigneeText(user.username);
                        handleAddAssignee();
                      }}
                    >
                      <Text style={[styles.suggestionText, { color: theme.colors.text }]}>
                        👤 @{user.username} {user.name ? `(${user.name})` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Labels */}
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
                LABELS
              </Text>
              <View style={styles.chipRow}>
                {labels.map((lbl) => {
                  const badgeStyle = getLabelBadgeStyles(lbl, labelDefinitions);
                  return (
                    <View
                      key={lbl.id || lbl.title}
                      style={[
                        styles.itemBadge,
                        {
                          backgroundColor: badgeStyle.backgroundColor,
                          borderColor: badgeStyle.borderColor,
                        },
                      ]}
                    >
                      <Text style={[styles.itemBadgeText, { color: badgeStyle.textColor }]}>
                        #{lbl.title}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleRemoveLabel(lbl.title)}
                        style={styles.removeBadgeBtn}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={[styles.removeBadgeIcon, { color: badgeStyle.textColor }]}>
                          ✕
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>

              {/* Add Label Input */}
              <View style={styles.addInputRow}>
                <TextInput
                  style={[
                    styles.addInput,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.isDark ? '#161618' : '#F9F9FB',
                      borderColor: theme.colors.cardBorder,
                    },
                  ]}
                  placeholder="Add #label..."
                  placeholderTextColor={theme.colors.textSecondary}
                  value={newLabelText}
                  onChangeText={setNewLabelText}
                  onSubmitEditing={() => handleAddLabel()}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: '#30D158' }]}
                  onPress={() => handleAddLabel()}
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>

              {/* Available Labels shortcuts */}
              {availableLabels.length > 0 && (
                <View style={styles.availableLabelsRow}>
                  {availableLabels
                    .filter((al) => !labels.some((l) => l.title.toLowerCase() === al.toLowerCase()))
                    .slice(0, 6)
                    .map((al) => (
                      <TouchableOpacity
                        key={al}
                        style={[
                          styles.quickLabelChip,
                          { backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA' },
                        ]}
                        onPress={() => handleAddLabel(al)}
                      >
                        <Text style={[styles.quickLabelText, { color: theme.colors.textSecondary }]}>
                          +{al}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              )}
            </View>

            {/* Accent Color Picker */}
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
                TASK COLOR ACCENT
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[
                    styles.colorCircle,
                    { backgroundColor: 'transparent', borderColor: theme.colors.cardBorder },
                    !color && styles.colorCircleSelected,
                  ]}
                  onPress={() => {
                    safeHaptics.selection();
                    setColor('');
                  }}
                >
                  <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>None</Text>
                </TouchableOpacity>
                {COLOR_PRESETS.map((preset) => {
                  const isSelected =
                    color.toLowerCase().replace(/^#/, '') ===
                    preset.toLowerCase().replace(/^#/, '');
                  return (
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.colorCircle,
                        { backgroundColor: preset },
                        isSelected && styles.colorCircleSelected,
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        setColor(preset);
                      }}
                    />
                  );
                })}
              </View>
            </View>

            {/* Recurrence / Repeat */}
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
                RECURRENCE
              </Text>
              <View style={styles.chipRow}>
                {REPEAT_PRESETS.map((preset) => {
                  const isSelected = (repeatAfter || 0) === preset.value;
                  return (
                    <TouchableOpacity
                      key={preset.value}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: isSelected
                            ? '#0A84FF'
                            : theme.isDark
                            ? '#2C2C2E'
                            : '#E5E5EA',
                        },
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        setRepeatAfter(preset.value);
                      }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: isSelected
                              ? '#FFFFFF'
                              : theme.isDark
                              ? '#D1D1D6'
                              : '#3A3A3C',
                          },
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Delete Button (Only for existing tasks) */}
            {task && (
              <TouchableOpacity
                testID="task-detail-delete-btn"
                style={styles.deleteBtn}
                onPress={handleDelete}
                activeOpacity={0.8}
              >
                <Text style={styles.deleteBtnText}>Delete Task</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  keyboardView: {
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
  headerBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  cancelText: {
    fontSize: 16,
  },
  saveBtn: {
    backgroundColor: '#0A84FF',
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  checkboxDone: {
    backgroundColor: '#30D158',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  titleInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    padding: 0,
    minHeight: 28,
  },
  titleInputDone: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  progressDisplay: {
    fontSize: 13,
    fontWeight: '700',
  },
  descriptionInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    minHeight: 80,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  itemBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  itemBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  removeBadgeBtn: {
    padding: 2,
  },
  removeBadgeIcon: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8E8E93',
  },
  addInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  addInput: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  addBtn: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  suggestionsList: {
    marginTop: 6,
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  availableLabelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  quickLabelChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  quickLabelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleSelected: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.15 }],
  },
  deleteBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
  },
  deleteBtnText: {
    color: '#FF453A',
    fontWeight: '700',
    fontSize: 16,
  },
  projectPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  projectColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  projectPickerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  projectPickerArrow: {
    fontSize: 12,
  },
  projectDropdown: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  projectOptionText: {
    flex: 1,
    fontSize: 13,
  },
  projectCheckmark: {
    fontSize: 14,
    color: '#30D158',
    fontWeight: '700',
  },
});
