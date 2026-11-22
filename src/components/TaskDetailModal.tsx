import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { useAppTheme } from '../utils/theme';
import { getLabelBadgeStyles, normalizeHexColor } from '../utils/colors';
import { normalizeVikunjaDate } from '../utils/dates';
import { getUserSuggestions } from '../utils/userSuggestions';
import { Label, Project, Task, User, RepeatMode, TaskReminder } from '../types/vikunja';
import { TaskScheduleSection } from './TaskScheduleSection';

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

/**
 * Converts Vikunja's `[0..1]` float (or legacy `>1` percentage) into a UI `[0..100]` integer
 * without misreading `0.01` (1%) vs `1.0` (100%).
 */
export function percentDoneToUiScale(raw?: number | null): number {
  if (raw === undefined || raw === null || !Number.isFinite(raw) || raw <= 0) return 0;
  if (raw <= 1) {
    return Math.round(raw * 100);
  }
  return Math.min(100, Math.round(raw));
}

/**
 * Converts UI `[0..100]` percentage back to Vikunja's `[0..1]` float scale.
 */
export function uiScaleToPercentDone(uiPct: number): number {
  if (!Number.isFinite(uiPct) || uiPct <= 0) return 0;
  return Math.max(0, Math.min(1, Number((uiPct / 100).toFixed(4))));
}

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
}) => {
  const theme = useAppTheme();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [done, setDone] = useState(false);
  const [priority, setPriority] = useState(0);
  const [percentDone, setPercentDone] = useState(0);
  const [color, setColor] = useState('');
  const [repeatAfter, setRepeatAfter] = useState<number | undefined>(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.FromDueDate);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [projectId, setProjectId] = useState<number>(
    task?.project_id || defaultProjectId || availableProjects[0]?.id || 0
  );
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showWebDeleteConfirm, setShowWebDeleteConfirm] = useState(false);

  const [newAssigneeText, setNewAssigneeText] = useState('');
  const [newLabelText, setNewLabelText] = useState('');
  const titleInputRef = useRef<TextInput>(null);
  const initializedRef = useRef<number | 'create' | null>(null);

  useEffect(() => {
    if (visible && !task) {
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [visible, task]);

  useEffect(() => {
    if (!visible) {
      initializedRef.current = null;
      return;
    }

    if (task) {
      // If same optimistic task resolved from negative tempId -> positive server ID while modal is open,
      // update our tracked ID WITHOUT wiping user's in-progress edits!
      if (
        typeof initializedRef.current === 'number' &&
        initializedRef.current < 0 &&
        task.id > 0
      ) {
        initializedRef.current = task.id;
        return;
      }

      if (initializedRef.current !== task.id) {
        initializedRef.current = task.id;
        setTitle(task.title || '');
        setDescription(task.description || '');
        setDone(Boolean(task.done));
        setPriority(task.priority || 0);
        setPercentDone(percentDoneToUiScale(task.percent_done));

        const effectiveColor = normalizeHexColor(task.hex_color || task.color, true) || '';
        setColor(effectiveColor);

        setRepeatAfter(task.repeat_after || 0);
        setRepeatMode((task.repeat_mode ?? RepeatMode.FromDueDate) as RepeatMode);
        setDueDate(normalizeVikunjaDate(task.due_date));
        setStartDate(normalizeVikunjaDate(task.start_date));
        setEndDate(normalizeVikunjaDate(task.end_date));
        setReminders(task.reminders ? [...task.reminders] : []);
        setLabels(task.labels ? [...task.labels] : []);
        setAssignees(task.assignees ? [...task.assignees] : []);
        setProjectId(task.project_id);
        setNewAssigneeText('');
        setNewLabelText('');
        setShowProjectPicker(false);
        setValidationError(null);
        setShowWebDeleteConfirm(false);
      }
    } else if (initializedRef.current !== 'create') {
      initializedRef.current = 'create';
      setTitle('');
      setDescription('');
      setDone(false);
      setPriority(0);
      setPercentDone(0);
      setColor('');
      setRepeatAfter(0);
      setRepeatMode(RepeatMode.FromDueDate);
      setDueDate(null);
      setStartDate(null);
      setEndDate(null);
      setReminders([]);
      setLabels([]);
      setAssignees([]);
      const fallbackPid =
        (defaultProjectId && defaultProjectId > 0 ? defaultProjectId : undefined) ||
        availableProjects[0]?.id ||
        0;
      setProjectId(fallbackPid);
      setNewAssigneeText('');
      setNewLabelText('');
      setShowProjectPicker(false);
      setValidationError(null);
      setShowWebDeleteConfirm(false);
    }
  }, [task?.id, visible, defaultProjectId, availableProjects]);

  const resolveAssigneeUser = (userOrText: User | string): User | null => {
    if (
      typeof userOrText === 'object' &&
      userOrText !== null &&
      'username' in userOrText &&
      typeof userOrText.username === 'string'
    ) {
      return userOrText;
    }
    if (typeof userOrText !== 'string') return null;
    const trimmed = userOrText.trim().replace(/^@+/, '').trim();
    if (!trimmed) return null;
    const matched = availableUsers.find(
      (u) => u.username.toLowerCase() === trimmed.toLowerCase()
    );
    return (
      matched || {
        id: -Math.floor(Date.now() + Math.random() * 1000 + 1),
        username: trimmed,
      }
    );
  };

  const resolveLabelObj = (labelTitle: string): Label | null => {
    const cleaned = labelTitle.trim().replace(/^#+/, '').trim();
    if (!cleaned) return null;
    const matchedDef = labelDefinitions.find(
      (l) => l.title.toLowerCase() === cleaned.toLowerCase()
    );
    return (
      matchedDef || {
        id: -Math.floor(Date.now() + Math.random() * 1000 + 1),
        title: cleaned,
      }
    );
  };

  const handleSave = () => {
    if (!title.trim()) {
      setValidationError('Task title cannot be empty.');
      return;
    }

    const normStart = normalizeVikunjaDate(startDate);
    const normEnd = normalizeVikunjaDate(endDate);
    if (normStart && normEnd && new Date(normEnd).getTime() < new Date(normStart).getTime()) {
      setValidationError('End date cannot be earlier than start date.');
      return;
    }

    if (!task && projectId <= 0 && availableProjects.length === 0) {
      // Allow fallback if defaultProjectId was provided in tests, otherwise guard invalid projectId <= 0
      if (!defaultProjectId || defaultProjectId <= 0) {
        setValidationError('Please create a list before adding tasks.');
        return;
      }
    }

    setValidationError(null);
    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);

    // Auto-commit any pending typed assignee or label text when tapping Save!
    let finalAssignees = [...assignees];
    if (newAssigneeText.trim()) {
      const pendingUser = resolveAssigneeUser(newAssigneeText);
      if (
        pendingUser &&
        !finalAssignees.some(
          (u) => u.username.toLowerCase() === pendingUser.username.toLowerCase()
        )
      ) {
        finalAssignees = [...finalAssignees, pendingUser];
      }
    }

    let finalLabels = [...labels];
    if (newLabelText.trim()) {
      const pendingLabel = resolveLabelObj(newLabelText);
      if (
        pendingLabel &&
        !finalLabels.some(
          (l) => l.title.toLowerCase() === pendingLabel.title.toLowerCase()
        )
      ) {
        finalLabels = [...finalLabels, pendingLabel];
      }
    }

    const resolvedPid =
      projectId > 0
        ? projectId
        : defaultProjectId && defaultProjectId > 0
        ? defaultProjectId
        : availableProjects[0]?.id || 1;

    const trimmedDescription = description.trim();
    const normalizedChosenColor = normalizeHexColor(color, true) || '';

    if (!task) {
      const createPayload: Partial<Task> = {
        title: title.trim(),
        description: trimmedDescription || undefined,
        done,
        ...(done ? { done_at: new Date().toISOString() } : {}),
        priority,
        percent_done: uiScaleToPercentDone(percentDone),
        color: normalizedChosenColor || undefined,
        hex_color: normalizedChosenColor || undefined,
        repeat_after: repeatAfter,
        repeat_mode: repeatMode,
        due_date: normalizeVikunjaDate(dueDate),
        start_date: normStart,
        end_date: normEnd,
        reminders,
        project_id: resolvedPid,
        labels: finalLabels,
        assignees: finalAssignees,
      };
      onCreateTask?.(createPayload);
      onClose();
      return;
    }

    const updatePayload: Partial<Task> = {
      title: title.trim(),
      description: trimmedDescription,
      done,
      ...(done !== Boolean(task.done)
        ? { done_at: done ? new Date().toISOString() : null }
        : {}),
      priority,
      percent_done: uiScaleToPercentDone(percentDone),
      color: normalizedChosenColor,
      hex_color: normalizedChosenColor,
      repeat_after: repeatAfter,
      repeat_mode: repeatMode,
      due_date: normalizeVikunjaDate(dueDate),
      start_date: normStart,
      end_date: normEnd,
      reminders,
      project_id: resolvedPid,
      labels: finalLabels,
      assignees: finalAssignees,
    };

    // `onSave` -> `taskStore.updateTaskDetails` already updates `project_id` and schedules/cancels reminders!
    onSave(task.id, updatePayload);
    onClose();
  };

  const performDeleteTask = () => {
    if (!task) return;
    setShowWebDeleteConfirm(false);
    safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
    onDelete(task.id);
    onClose();
  };

  const handleDelete = () => {
    if (!task) return;
    const message = `Are you sure you want to delete "${task.title}"?`;

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (window.confirm(`Delete Task\n\n${message}`)) {
          performDeleteTask();
        }
      } else {
        setShowWebDeleteConfirm(true);
      }
      return;
    }

    Alert.alert('Delete Task', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: performDeleteTask,
      },
    ]);
  };

  const handleRemoveAssignee = (username: string) => {
    safeHaptics.selection();
    setAssignees((prev) => prev.filter((u) => u.username !== username));
  };

  const handleAddAssignee = (userOrText?: User | string) => {
    const resolved = resolveAssigneeUser(userOrText !== undefined ? userOrText : newAssigneeText);
    if (!resolved) return;

    if (assignees.some((u) => u.username.toLowerCase() === resolved.username.toLowerCase())) {
      setNewAssigneeText('');
      return;
    }

    safeHaptics.selection();
    setAssignees((prev) => [...prev, resolved]);
    setNewAssigneeText('');
  };

  const handleRemoveLabel = (labelTitle: string) => {
    safeHaptics.selection();
    setLabels((prev) => prev.filter((l) => l.title !== labelTitle));
  };

  const handleAddLabel = (labelTitle?: string) => {
    const resolved = resolveLabelObj(labelTitle !== undefined ? labelTitle : newLabelText);
    if (!resolved) return;

    if (labels.some((l) => l.title.toLowerCase() === resolved.title.toLowerCase())) {
      setNewLabelText('');
      return;
    }

    safeHaptics.selection();
    setLabels((prev) => [...prev, resolved]);
    setNewLabelText('');
  };

  const assigneeSuggestions = newAssigneeText.trim()
    ? getUserSuggestions(newAssigneeText.trim().replace(/^@/, ''), availableUsers).filter(
        (u) => !assignees.some((a) => a.username.toLowerCase() === u.username.toLowerCase())
      )
    : [];

  const selectedProjectObj = availableProjects.find((p) => p.id === projectId);
  const selectedProjectDotColor =
    normalizeHexColor(selectedProjectObj?.hex_color ?? undefined, true) || '#007AFF';
  const selectedRingColor = theme.isDark ? '#FFFFFF' : '#1C1C1E';

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
          testID="task-detail-modal-root"
          style={[
            styles.modalRoot,
            {
              backgroundColor: theme.colors.background,
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
                accessibilityRole="button"
                accessibilityLabel="Cancel"
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
                accessibilityRole="button"
                accessibilityLabel="Save task"
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            {validationError ? (
              <View
                testID="task-detail-error-banner"
                style={styles.errorBanner}
                accessibilityRole="alert"
              >
                <Text style={styles.errorText}>{validationError}</Text>
              </View>
            ) : null}

            {showWebDeleteConfirm && task ? (
              <View
                testID="task-web-delete-confirm"
                style={[
                  styles.confirmBanner,
                  { backgroundColor: theme.colors.cardBackground, borderColor: '#FF453A' },
                ]}
              >
                <Text style={[styles.confirmBannerText, { color: theme.colors.text }]}>
                  Delete "{task.title}"?
                </Text>
                <View style={styles.confirmBannerActions}>
                  <TouchableOpacity
                    testID="task-confirm-cancel-btn"
                    style={[styles.confirmBtn, { backgroundColor: '#8E8E93' }]}
                    onPress={() => setShowWebDeleteConfirm(false)}
                  >
                    <Text style={styles.confirmBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="task-confirm-delete-btn"
                    style={[styles.confirmBtn, { backgroundColor: '#FF453A' }]}
                    onPress={performDeleteTask}
                  >
                    <Text style={styles.confirmBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Title & Done Checkbox (Top-most in dialog) */}
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
                      {
                        borderColor: done
                          ? '#30D158'
                          : theme.isDark
                          ? '#636366'
                          : '#8E8E93',
                      },
                    ]}
                    onPress={() => {
                      safeHaptics.selection();
                      setDone(!done);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={done ? 'Mark task incomplete' : 'Mark task complete'}
                  >
                    {done && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                  <TextInput
                    ref={titleInputRef}
                    testID="task-detail-title-input"
                    style={[
                      styles.titleInput,
                      { color: theme.colors.text },
                      done && styles.titleInputDone,
                    ]}
                    value={title}
                    onChangeText={(txt) => {
                      setTitle(txt);
                      if (validationError) setValidationError(null);
                    }}
                    placeholder="Task title"
                    placeholderTextColor={theme.colors.textSecondary}
                    multiline
                    autoFocus={task === null}
                  />
                </View>
              </View>

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
                    accessibilityRole="button"
                  >
                    <View
                      style={[
                        styles.projectColorDot,
                        { backgroundColor: selectedProjectDotColor },
                      ]}
                    />
                    <Text style={[styles.projectPickerText, { color: theme.colors.text }]}>
                      {selectedProjectObj?.title || 'Select List'}
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
                        const optDotColor =
                          normalizeHexColor(proj.hex_color ?? undefined, true) || '#007AFF';
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
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                          >
                            <View
                              style={[
                                styles.projectColorDot,
                                { backgroundColor: optDotColor },
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
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
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
                  <Text
                    testID="task-detail-progress-display"
                    style={[styles.progressDisplay, { color: theme.colors.text }]}
                  >
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
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
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
                        accessibilityRole="button"
                        accessibilityLabel={`Remove assignee ${user.username}`}
                      >
                        <Text style={styles.removeBadgeIcon}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                {/* Add Assignee Input */}
                <View style={styles.addInputRow}>
                  <TextInput
                    testID="task-detail-assignee-input"
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
                    onSubmitEditing={() => handleAddAssignee()}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    testID="add-assignee-btn"
                    style={[styles.addBtn, { backgroundColor: '#0A84FF' }]}
                    onPress={() => handleAddAssignee()}
                    accessibilityRole="button"
                  >
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {/* Assignee Suggestions */}
                {assigneeSuggestions.length > 0 && (
                  <View style={styles.suggestionsList}>
                    {assigneeSuggestions.slice(0, 3).map((user) => (
                      <TouchableOpacity
                        key={user.id || user.username}
                        testID={`assignee-suggestion-${user.username}`}
                        style={[
                          styles.suggestionItem,
                          { borderBottomColor: theme.colors.cardBorder },
                        ]}
                        onPress={() => handleAddAssignee(user)}
                        accessibilityRole="button"
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
                    const badgeStyle = getLabelBadgeStyles(lbl, labelDefinitions, theme.isDark);
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
                          testID={`remove-label-${lbl.title}`}
                          onPress={() => handleRemoveLabel(lbl.title)}
                          style={styles.removeBadgeBtn}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove label ${lbl.title}`}
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
                    testID="task-detail-label-input"
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
                    testID="add-label-btn"
                    style={[styles.addBtn, { backgroundColor: '#30D158' }]}
                    onPress={() => handleAddLabel()}
                    accessibilityRole="button"
                  >
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {/* Available Labels shortcuts */}
                {availableLabels.length > 0 && (
                  <View style={styles.availableLabelsRow}>
                    {availableLabels
                      .filter(
                        (al) => !labels.some((l) => l.title.toLowerCase() === al.toLowerCase())
                      )
                      .slice(0, 6)
                      .map((al) => (
                        <TouchableOpacity
                          key={al}
                          style={[
                            styles.quickLabelChip,
                            { backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA' },
                          ]}
                          onPress={() => handleAddLabel(al)}
                          accessibilityRole="button"
                        >
                          <Text
                            style={[styles.quickLabelText, { color: theme.colors.textSecondary }]}
                          >
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
                    testID="task-color-none"
                    style={[
                      styles.colorCircle,
                      { backgroundColor: 'transparent', borderColor: theme.colors.cardBorder },
                      !color && [
                        styles.colorCircleSelected,
                        { borderColor: selectedRingColor },
                      ],
                    ]}
                    onPress={() => {
                      safeHaptics.selection();
                      setColor('');
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !color }}
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
                        testID={`task-color-${preset}`}
                        style={[
                          styles.colorCircle,
                          { backgroundColor: preset },
                          isSelected && [
                            styles.colorCircleSelected,
                            { borderColor: selectedRingColor },
                          ],
                        ]}
                        onPress={() => {
                          safeHaptics.selection();
                          setColor(preset);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      />
                    );
                  })}
                </View>
              </View>

              {/* Schedule, Repeat & Reminders */}
              <View
                style={[
                  styles.sectionCard,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderColor: theme.colors.cardBorder,
                  },
                ]}
              >
                <TaskScheduleSection
                  dueDate={dueDate}
                  startDate={startDate}
                  endDate={endDate}
                  repeatAfter={repeatAfter}
                  repeatMode={repeatMode}
                  reminders={reminders}
                  onChangeDueDate={setDueDate}
                  onChangeStartDate={setStartDate}
                  onChangeEndDate={setEndDate}
                  onChangeRepeat={(after, mode) => {
                    setRepeatAfter(after);
                    setRepeatMode(mode);
                  }}
                  onChangeReminders={setReminders}
                />
              </View>

              {/* Delete Button (Only for existing tasks) */}
              {task && (
                <TouchableOpacity
                  testID="task-detail-delete-btn"
                  style={styles.deleteBtn}
                  onPress={handleDelete}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteBtnText}>Delete Task</Text>
                </TouchableOpacity>
              )}
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
  errorBanner: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderLeftWidth: 4,
    borderLeftColor: '#FF453A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 6,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBanner: {
    marginHorizontal: 16,
    marginTop: 10,
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
    gap: 8,
  },
  confirmBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
    borderWidth: 2.5,
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
