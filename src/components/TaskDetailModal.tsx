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
import { htmlToPlainText, serializeDescriptionForServer } from '../utils/htmlDescription';
import { Label, Project, Task, User, RepeatMode, TaskReminder, WeekStartDay } from '../types/vikunja';
import { TaskScheduleSection } from './TaskScheduleSection';

interface TaskDetailModalProps {
  visible: boolean;
  task: Task | null;
  availableLabels?: string[];
  labelDefinitions?: Label[];
  availableUsers?: User[];
  availableProjects?: Project[];
  defaultProjectId?: number;
  weekStartDay?: WeekStartDay;
  onClose: () => void;
  onSave: (taskId: number, updates: Partial<Task>) => void;
  onDelete: (taskId: number) => void;
  onCreateTask?: (taskData: Partial<Task>, initialSubtaskTitles?: string[]) => void;
  onMoveTask?: (taskId: number, newProjectId: number) => void;
  onAddSubtask?: (parentTaskId: number, title: string) => Task | null | void;
  onToggleSubtask?: (subtaskId: number) => void;
  onDeleteSubtask?: (parentTaskId: number, subtaskId: number) => void;
  onSelectSubtask?: (subtask: Task) => void;
  onDuplicateTask?: (taskId: number) => void;
}

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
  weekStartDay = 1,
  onClose,
  onSave,
  onDelete,
  onCreateTask,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onSelectSubtask,
  onDuplicateTask,
}) => {
  const theme = useAppTheme();

  const priorityLevels = [
    { value: 0, label: 'None', color: theme.colors.accent },
    { value: 1, label: 'Low', color: theme.colors.accent },
    { value: 2, label: 'Medium', color: theme.colors.warning },
    { value: 3, label: 'High', color: theme.colors.danger },
    { value: 4, label: 'Urgent', color: theme.isDark ? '#BF5AF2' : '#7E22CE' },
    { value: 5, label: 'Critical', color: theme.isDark ? '#FF375F' : '#BE123C' },
  ];

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
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [draftSubtasks, setDraftSubtasks] = useState<string[]>([]);
  const [isDescriptionDirty, setIsDescriptionDirty] = useState(false);
  const rawOriginalDescriptionRef = useRef<string | undefined>(undefined);
  const initialTaskTitleRef = useRef<string>('');
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
        task.id > 0 &&
        task.title === initialTaskTitleRef.current
      ) {
        initializedRef.current = task.id;
        return;
      }

      if (initializedRef.current !== task.id) {
        initializedRef.current = task.id;
        initialTaskTitleRef.current = task.title || '';
        rawOriginalDescriptionRef.current = task.description;
        setTitle(task.title || '');
        setDescription(htmlToPlainText(task.description || ''));
        setIsDescriptionDirty(false);
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
        setNewSubtaskText('');
        setDraftSubtasks([]);
        setShowProjectPicker(false);
        setValidationError(null);
        setShowWebDeleteConfirm(false);
      }
    } else if (initializedRef.current !== 'create') {
      initializedRef.current = 'create';
      rawOriginalDescriptionRef.current = undefined;
      setTitle('');
      setDescription('');
      setIsDescriptionDirty(false);
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
      setNewSubtaskText('');
      setDraftSubtasks([]);
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

    const pendingSubtaskTrimmed = newSubtaskText.trim();

    if (!task) {
      const initialSubtasks = pendingSubtaskTrimmed
        ? [...draftSubtasks, pendingSubtaskTrimmed]
        : [...draftSubtasks];
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
      if (initialSubtasks.length > 0) {
        onCreateTask?.(createPayload, initialSubtasks);
      } else {
        onCreateTask?.(createPayload);
      }
      onClose();
      return;
    }

    if (pendingSubtaskTrimmed && onAddSubtask) {
      onAddSubtask(task.id, pendingSubtaskTrimmed);
      setNewSubtaskText('');
    }

    const serializedDescription = serializeDescriptionForServer(
      description,
      rawOriginalDescriptionRef.current,
      isDescriptionDirty
    );

    const updatePayload: Partial<Task> = {
      title: title.trim(),
      description: serializedDescription,
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

    onSave(task.id, updatePayload);
    onClose();
  };

  const handleAddSubtaskSubmit = () => {
    const cleaned = newSubtaskText.trim();
    if (!cleaned) return;
    safeHaptics.selection();
    if (task) {
      onAddSubtask?.(task.id, cleaned);
    } else {
      setDraftSubtasks((prev) => [...prev, cleaned]);
    }
    setNewSubtaskText('');
  };

  const handleDuplicate = () => {
    if (!task || !onDuplicateTask) return;
    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
    onDuplicateTask(task.id);
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
    normalizeHexColor(selectedProjectObj?.hex_color ?? undefined, true) || theme.colors.accent;
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
                style={[styles.headerBtn, styles.saveBtn, { backgroundColor: theme.colors.accent }]}
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
                  {validationError}
                </Text>
              </View>
            ) : null}

            {showWebDeleteConfirm && task ? (
              <View
                testID="task-web-delete-confirm"
                style={[
                  styles.confirmBanner,
                  {
                    backgroundColor: theme.colors.cardBackground,
                    borderColor: theme.colors.danger,
                  },
                ]}
              >
                <Text style={[styles.confirmBannerText, { color: theme.colors.text }]}>
                  Delete "{task.title}"?
                </Text>
                <View style={styles.confirmBannerActions}>
                  <TouchableOpacity
                    testID="task-confirm-cancel-btn"
                    style={[styles.confirmCancelBtn, secondarySurface]}
                    onPress={() => setShowWebDeleteConfirm(false)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.confirmCancelBtnText, { color: theme.colors.text }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="task-confirm-delete-btn"
                    style={[styles.confirmDeleteBtn, { backgroundColor: theme.colors.danger }]}
                    onPress={performDeleteTask}
                    accessibilityRole="button"
                  >
                    <Text style={styles.confirmDeleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
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
                      {
                        borderColor: done ? theme.colors.success : theme.colors.checkboxBorder,
                        backgroundColor: done
                          ? theme.colors.success
                          : theme.isDark
                          ? 'rgba(255, 255, 255, 0.03)'
                          : 'transparent',
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
                      { color: done ? theme.colors.textSecondary : theme.colors.text },
                      done && styles.titleInputDone,
                    ]}
                    value={title}
                    onChangeText={(txt) => {
                      setTitle(txt);
                      if (validationError) setValidationError(null);
                    }}
                    placeholder="Task title"
                    placeholderTextColor={theme.colors.placeholder}
                    multiline
                    autoFocus={task === null}
                  />
                </View>
              </View>

              {/* List Picker */}
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
                    LIST
                  </Text>
                  <TouchableOpacity
                    testID="task-project-picker-btn"
                    style={[styles.projectPickerBtn, secondarySurface]}
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
                          backgroundColor: theme.colors.cardSecondary,
                          borderColor: theme.colors.borderStrong,
                        },
                      ]}
                    >
                      {availableProjects.map((proj) => {
                        const isSelected = proj.id === projectId;
                        const optDotColor =
                          normalizeHexColor(proj.hex_color ?? undefined, true) ||
                          theme.colors.accent;
                        return (
                          <TouchableOpacity
                            key={proj.id}
                            testID={`project-option-${proj.id}`}
                            style={[
                              styles.projectOption,
                              isSelected && {
                                backgroundColor: theme.colors.surfaceSecondary,
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
                            {isSelected && (
                              <Text
                                style={[
                                  styles.projectCheckmark,
                                  { color: theme.colors.accent },
                                ]}
                              >
                                ✓
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* Notes */}
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
                  NOTES
                </Text>
                <TextInput
                  testID="task-detail-description-input"
                  style={[
                    styles.descriptionInput,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.inputBg,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                  value={description}
                  onChangeText={(txt) => {
                    setDescription(txt);
                    setIsDescriptionDirty(true);
                  }}
                  placeholder="Add notes..."
                  placeholderTextColor={theme.colors.placeholder}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {/* Subtasks */}
              {(() => {
                const liveSubtasks = task ? task.related_tasks?.subtask || [] : [];
                const doneSubCount = liveSubtasks.filter((s) => s?.done).length;
                const totalSubCount = task ? liveSubtasks.length : draftSubtasks.length;
                return (
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
                      <Text
                        style={[
                          styles.sectionLabel,
                          { color: theme.colors.textSecondary, marginBottom: 0 },
                        ]}
                      >
                        SUBTASKS
                      </Text>
                      {totalSubCount > 0 && (
                        <Text
                          testID="task-detail-subtask-count"
                          style={[styles.progressDisplay, { color: theme.colors.textSecondary }]}
                        >
                          {task ? `${doneSubCount}/${totalSubCount}` : `${totalSubCount}`}
                        </Text>
                      )}
                    </View>

                    {task
                      ? liveSubtasks.map((sub) => (
                          <View
                            key={sub.id}
                            style={[
                              styles.subtaskRow,
                              { borderBottomColor: theme.colors.cardBorder },
                            ]}
                          >
                            <TouchableOpacity
                              testID={`subtask-checkbox-${sub.id}`}
                              style={[
                                styles.subtaskCheckbox,
                                {
                                  borderColor: sub.done
                                    ? theme.colors.success
                                    : theme.colors.checkboxBorder,
                                  backgroundColor: sub.done
                                    ? theme.colors.success
                                    : 'transparent',
                                },
                              ]}
                              onPress={() => {
                                safeHaptics.selection();
                                onToggleSubtask?.(sub.id);
                              }}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: Boolean(sub.done) }}
                            >
                              {sub.done && <Text style={styles.subtaskCheckmark}>✓</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity
                              testID={`subtask-title-btn-${sub.id}`}
                              style={styles.subtaskTitleBtn}
                              disabled={!onSelectSubtask}
                              onPress={() => onSelectSubtask?.(sub)}
                            >
                              <Text
                                style={[
                                  styles.subtaskTitleText,
                                  {
                                    color: sub.done
                                      ? theme.colors.textSecondary
                                      : theme.colors.text,
                                  },
                                  sub.done && styles.titleInputDone,
                                ]}
                              >
                                {sub.title}
                              </Text>
                            </TouchableOpacity>
                            {onDeleteSubtask && (
                              <TouchableOpacity
                                testID={`delete-subtask-${sub.id}`}
                                onPress={() => {
                                  safeHaptics.selection();
                                  onDeleteSubtask(task.id, sub.id);
                                }}
                                style={styles.removeBadgeBtn}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                accessibilityRole="button"
                                accessibilityLabel={`Delete subtask ${sub.title}`}
                              >
                                <Text
                                  style={[
                                    styles.removeBadgeIcon,
                                    { color: theme.colors.textSecondary },
                                  ]}
                                >
                                  ✕
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        ))
                      : draftSubtasks.map((subTitle, idx) => (
                          <View
                            key={`${subTitle}-${idx}`}
                            style={[
                              styles.subtaskRow,
                              { borderBottomColor: theme.colors.cardBorder },
                            ]}
                          >
                            <Text style={[styles.subtaskTitleText, { color: theme.colors.text, flex: 1 }]}>
                              {subTitle}
                            </Text>
                            <TouchableOpacity
                              onPress={() =>
                                setDraftSubtasks((prev) => prev.filter((_, i) => i !== idx))
                              }
                              style={styles.removeBadgeBtn}
                            >
                              <Text
                                style={[
                                  styles.removeBadgeIcon,
                                  { color: theme.colors.textSecondary },
                                ]}
                              >
                                ✕
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ))}

                    <View style={styles.addInputRow}>
                      <TextInput
                        testID="task-detail-subtask-input"
                        style={[
                          styles.addInput,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.inputBg,
                            borderColor: theme.colors.borderStrong,
                          },
                        ]}
                        placeholder="Add subtask..."
                        placeholderTextColor={theme.colors.placeholder}
                        value={newSubtaskText}
                        onChangeText={setNewSubtaskText}
                        onSubmitEditing={handleAddSubtaskSubmit}
                        blurOnSubmit={false}
                        returnKeyType="done"
                      />
                      <TouchableOpacity
                        testID="add-subtask-btn"
                        style={[styles.addBtn, { backgroundColor: theme.colors.accent }]}
                        onPress={handleAddSubtaskSubmit}
                        accessibilityRole="button"
                      >
                        <Text style={styles.addBtnText}>Add</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })()}

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
                  {priorityLevels.map((item) => {
                    const isSelected = priority === item.value;
                    return (
                      <TouchableOpacity
                        key={item.value}
                        testID={`priority-option-${item.value}`}
                        style={[
                          styles.chip,
                          isSelected
                            ? {
                                backgroundColor: item.color,
                                borderColor: item.color,
                              }
                            : secondarySurface,
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
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
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
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: theme.colors.textSecondary, marginBottom: 0 },
                    ]}
                  >
                    PROGRESS
                  </Text>
                  <Text
                    testID="task-detail-progress-display"
                    style={[styles.progressDisplay, { color: theme.colors.textSecondary }]}
                  >
                    {`${percentDone}%`}
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
                          isSelected
                            ? {
                                backgroundColor: theme.colors.accent,
                                borderColor: theme.colors.accent,
                              }
                            : secondarySurface,
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
                              color: isSelected ? '#FFFFFF' : theme.colors.textSecondary,
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
                      style={[styles.itemBadge, secondarySurface]}
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
                        <Text
                          style={[styles.removeBadgeIcon, { color: theme.colors.textSecondary }]}
                        >
                          ✕
                        </Text>
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
                        backgroundColor: theme.colors.inputBg,
                        borderColor: theme.colors.borderStrong,
                      },
                    ]}
                    placeholder="Add @user..."
                    placeholderTextColor={theme.colors.placeholder}
                    value={newAssigneeText}
                    onChangeText={setNewAssigneeText}
                    onSubmitEditing={() => handleAddAssignee()}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    testID="add-assignee-btn"
                    style={[styles.addBtn, { backgroundColor: theme.colors.accent }]}
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
                          @{user.username}
                          {user.name ? ` (${user.name})` : ''}
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
                        backgroundColor: theme.colors.inputBg,
                        borderColor: theme.colors.borderStrong,
                      },
                    ]}
                    placeholder="Add #label..."
                    placeholderTextColor={theme.colors.placeholder}
                    value={newLabelText}
                    onChangeText={setNewLabelText}
                    onSubmitEditing={() => handleAddLabel()}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    testID="add-label-btn"
                    style={[styles.addBtn, { backgroundColor: theme.colors.accent }]}
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
                          style={[styles.quickLabelChip, secondarySurface]}
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
                  COLOR
                </Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    testID="task-color-none"
                    style={[
                      styles.colorCircle,
                      {
                        backgroundColor: theme.colors.surfaceSecondary,
                        borderColor: theme.colors.borderStrong,
                      },
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
                  weekStartDay={weekStartDay}
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

              {/* Duplicate Task Button (Only for existing tasks) */}
              {task && onDuplicateTask && (
                <TouchableOpacity
                  testID="task-detail-duplicate-btn"
                  style={[styles.duplicateBtn, secondarySurface]}
                  onPress={handleDuplicate}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.duplicateBtnText, { color: theme.colors.text }]}>
                    Duplicate Task
                  </Text>
                </TouchableOpacity>
              )}

              {/* Delete Button (Only for existing tasks) */}
              {task && (
                <TouchableOpacity
                  testID="task-detail-delete-btn"
                  style={[
                    styles.deleteBtn,
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
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Text style={[styles.deleteBtnText, { color: theme.colors.danger }]}>
                    Delete Task
                  </Text>
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
    paddingHorizontal: 18,
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
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  errorBanner: {
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 6,
  },
  errorText: {
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
    borderWidth: 1.75,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
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
    borderWidth: 1,
  },
  quickLabelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleSelected: {
    borderWidth: 2.5,
    transform: [{ scale: 1.15 }],
  },
  deleteBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
    borderWidth: 1,
  },
  deleteBtnText: {
    fontWeight: '700',
    fontSize: 15,
  },
  duplicateBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
  },
  duplicateBtnText: {
    fontWeight: '600',
    fontSize: 15,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  subtaskCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtaskCheckmark: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  subtaskTitleBtn: {
    flex: 1,
  },
  subtaskTitleText: {
    fontSize: 14,
    fontWeight: '500',
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
    fontWeight: '700',
  },
});
