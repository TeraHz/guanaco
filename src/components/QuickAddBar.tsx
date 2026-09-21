import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { parseQuickAdd, ParsedTaskInput } from '../utils/quickAddParser';
import {
  getTaskSuggestions,
  getLabelSuggestions,
  applyLabelSuggestion,
} from '../utils/suggestions';
import {
  extractMentionQuery,
  getUserSuggestions,
  replaceMentionQuery,
} from '../utils/userSuggestions';
import { CreateTaskInput, Label, Project, Task, User } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';

interface QuickAddBarProps {
  activeProjectId: number;
  availableProjects?: { id: number; title: string; hex_color?: string }[];
  doneTasks?: Task[];
  availableLabels?: string[];
  availableUsers?: User[];
  reenableStaples?: boolean;
  onAddTask: (input: CreateTaskInput) => void;
  onReenableTask?: (taskId: number) => void;
  placeholder?: string;
}

const PRIORITY_LABELS: Record<number, { text: string; color: string; label: string }> = {
  0: { text: '!', color: '#8E8E93', label: 'None' },
  1: { text: '!', color: '#007AFF', label: 'Low' },
  2: { text: '!!', color: '#FF9500', label: 'Medium' },
  3: { text: '!!!', color: '#FF3B30', label: 'High' },
  4: { text: '!!!!', color: '#AF52DE', label: 'Urgent' },
  5: { text: '!!!!!', color: '#FF2D55', label: 'Critical' },
};

export const QuickAddBar: React.FC<QuickAddBarProps> = ({
  activeProjectId,
  availableProjects = [],
  doneTasks = [],
  availableLabels = [],
  availableUsers = [],
  reenableStaples = true,
  onAddTask,
  onReenableTask,
  placeholder = 'Add a task...',
}) => {
  const theme = useAppTheme();
  const [rawText, setRawText] = useState('');
  const [manualPriority, setManualPriority] = useState<number>(0);
  const [lastUsedLabel, setLastUsedLabel] = useState<string>('');
  const inputRef = React.useRef<TextInput>(null);

  // Live Quick Add Magic Parsing
  const parsed: ParsedTaskInput = rawText.trim()
    ? parseQuickAdd(rawText)
    : { title: '', labels: [], assignees: [], dueDate: null };

  const effectivePriority =
    parsed.priority !== undefined ? parsed.priority : manualPriority;

  // Resolve target project if specified with +Project
  let targetProjectId = activeProjectId;
  let targetProjectTitle: string | undefined;

  if (parsed.projectName && availableProjects.length > 0) {
    const matched = availableProjects.find(
      (p) => p.title.toLowerCase() === parsed.projectName!.toLowerCase()
    );
    if (matched) {
      targetProjectId = matched.id;
      targetProjectTitle = matched.title;
    }
  }

  // Assignee Suggestions (when typing @user)
  const mentionQuery = extractMentionQuery(rawText);
  const userSuggestions =
    mentionQuery !== null ? getUserSuggestions(mentionQuery, availableUsers) : [];

  // Label Suggestions (when typing *label) - prioritized with last used label first
  const labelSuggestions =
    userSuggestions.length === 0
      ? getLabelSuggestions(rawText, availableLabels, lastUsedLabel)
      : [];

  // Task Suggestions (from completed / done tasks)
  const taskSuggestions =
    userSuggestions.length === 0 && labelSuggestions.length === 0
      ? getTaskSuggestions(rawText, doneTasks)
      : [];

  const handleSelectUserSuggestion = (user: User) => {
    const updated = replaceMentionQuery(rawText, user.username);
    setRawText(updated);
    safeHaptics.selection();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  const handleSelectLabelSuggestion = (label: string) => {
    const updated = applyLabelSuggestion(rawText, label);
    setRawText(updated);
    setLastUsedLabel(label);
    safeHaptics.selection();
    // Do not close out keyboard when label is selected
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  const handleSelectTaskSuggestion = (task: Task) => {
    if (reenableStaples && onReenableTask) {
      onReenableTask(task.id);
      setRawText('');
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      setRawText(task.title);
      safeHaptics.selection();
    }
  };

  const handleCyclePriority = () => {
    setManualPriority((prev) => (prev >= 4 ? 0 : prev + 1));
    safeHaptics.selection();
  };

  const handleSubmit = () => {
    if (!rawText.trim()) return;

    const formattedLabels: Label[] = parsed.labels.map((name, idx) => ({
      id: -Math.floor(Date.now() + idx),
      title: name,
    }));

    const formattedAssignees: User[] = (parsed.assignees || []).map((username, idx) => {
      const matched = availableUsers.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );
      return matched || { id: -Math.floor(Date.now() + idx), username };
    });

    onAddTask({
      title: parsed.title,
      priority: effectivePriority,
      project_id: targetProjectId,
      labels: formattedLabels,
      assignees: formattedAssignees,
      due_date: parsed.dueDate || null,
      repeat_after: parsed.repeatAfter,
    });

    if (parsed.labels && parsed.labels.length > 0) {
      setLastUsedLabel(parsed.labels[parsed.labels.length - 1]);
    }

    setRawText('');
    setManualPriority(0);
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const curPriority = PRIORITY_LABELS[effectivePriority] || PRIORITY_LABELS[0];
  const hasMagicAttributes =
    parsed.labels.length > 0 ||
    parsed.assignees.length > 0 ||
    parsed.dueDate ||
    parsed.projectName ||
    parsed.priority !== undefined;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Suggestions Row: User Suggestions, Label Suggestions, or Done Task Suggestions */}
      {userSuggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionRow}
        >
          {userSuggestions.map((user) => (
            <TouchableOpacity
              key={user.id || user.username}
              testID={`user-suggestion-${user.username}`}
              style={[styles.taskSuggestionChip, styles.userSuggestionChip]}
              onPress={() => handleSelectUserSuggestion(user)}
              activeOpacity={0.7}
            >
              <Text style={styles.userSuggestionText}>👤 @{user.username}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {labelSuggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionRow}
        >
          {labelSuggestions.map((label) => (
            <TouchableOpacity
              key={label}
              style={styles.labelSuggestionChip}
              onPress={() => handleSelectLabelSuggestion(label)}
              activeOpacity={0.7}
            >
              <Text style={styles.labelSuggestionText}>#{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {taskSuggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionRow}
        >
          {taskSuggestions.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.taskSuggestionChip}
              onPress={() => handleSelectTaskSuggestion(task)}
              activeOpacity={0.7}
            >
              <Text style={styles.taskSuggestionText}>↩ {task.title}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Live Magic Attribute Preview */}
      {hasMagicAttributes && (
        <View style={styles.magicPreviewRow}>
          {targetProjectTitle && (
            <View style={styles.magicBadge}>
              <Text style={styles.magicBadgeText}>📁 {targetProjectTitle}</Text>
            </View>
          )}
          {parsed.assignees.map((u) => (
            <View key={u} style={[styles.magicBadge, styles.magicAssigneeBadge]}>
              <Text style={styles.magicAssigneeBadgeText}>@{u}</Text>
            </View>
          ))}
          {parsed.labels.map((lbl) => (
            <View key={lbl} style={[styles.magicBadge, styles.magicLabelBadge]}>
              <Text style={styles.magicLabelBadgeText}>#{lbl}</Text>
            </View>
          ))}
          {parsed.dueDate && (
            <View style={[styles.magicBadge, styles.magicDateBadge]}>
              <Text style={styles.magicDateBadgeText}>
                📅 {new Date(parsed.dueDate).toLocaleDateString()}
              </Text>
            </View>
          )}
          {parsed.priority !== undefined && (
            <View style={[styles.magicBadge, styles.magicPriorityBadge]}>
              <Text style={styles.magicPriorityBadgeText}>
                ⚡ P{parsed.priority}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.inputCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
        <TextInput
          ref={inputRef}
          testID="quick-add-input"
          style={[styles.input, { color: theme.colors.text }]}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textSecondary || '#8E8E93'}
          value={rawText}
          onChangeText={setRawText}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          blurOnSubmit={false}
        />

        <View style={styles.actionsRow}>
          <TouchableOpacity
            testID="quick-add-priority"
            style={[styles.priorityBadge, { borderColor: curPriority.color }]}
            onPress={handleCyclePriority}
            activeOpacity={0.7}
          >
            <Text style={[styles.priorityText, { color: curPriority.color }]}>
              {curPriority.text}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="quick-add-submit"
            style={[styles.submitButton, !rawText.trim() && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!rawText.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.submitButtonText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'transparent',
  },
  suggestionScroll: {
    marginBottom: 6,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 2,
  },
  labelSuggestionChip: {
    backgroundColor: '#30D15820',
    borderColor: '#30D158',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  labelSuggestionText: {
    color: '#30D158',
    fontSize: 12,
    fontWeight: '700',
  },
  taskSuggestionChip: {
    backgroundColor: '#0A84FF20',
    borderColor: '#0A84FF80',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  taskSuggestionText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '600',
  },
  userSuggestionChip: {
    borderColor: 'rgba(191, 90, 242, 0.4)',
    backgroundColor: 'rgba(191, 90, 242, 0.15)',
  },
  userSuggestionText: {
    color: '#BF5AF2',
    fontSize: 12,
    fontWeight: '600',
  },
  magicPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  magicBadge: {
    backgroundColor: '#2C2C2E',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  magicBadgeText: {
    color: '#0A84FF',
    fontSize: 11,
    fontWeight: '600',
  },
  magicAssigneeBadge: {
    borderColor: 'rgba(191, 90, 242, 0.4)',
    backgroundColor: 'rgba(191, 90, 242, 0.15)',
  },
  magicAssigneeBadgeText: {
    color: '#BF5AF2',
    fontSize: 11,
    fontWeight: '600',
  },
  magicLabelBadge: {
    borderColor: '#30D15840',
    backgroundColor: '#30D15815',
  },
  magicLabelBadgeText: {
    color: '#30D158',
    fontSize: 11,
    fontWeight: '600',
  },
  magicDateBadge: {
    borderColor: '#FF950040',
    backgroundColor: '#FF950015',
  },
  magicDateBadgeText: {
    color: '#FF9500',
    fontSize: 11,
    fontWeight: '600',
  },
  magicPriorityBadge: {
    borderColor: '#FF3B3040',
    backgroundColor: '#FF3B3015',
  },
  magicPriorityBadgeText: {
    color: '#FF3B30',
    fontSize: 11,
    fontWeight: '700',
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 6 : 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    color: '#FFFFFF',
    paddingVertical: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 6,
  },
  priorityBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  priorityText: {
    fontSize: 12,
    fontWeight: '700',
  },
  submitButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#30D158',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#3A3A3C',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
});
