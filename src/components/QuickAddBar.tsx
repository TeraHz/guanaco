import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { getHistoricalStoreSuggestion } from '../utils/storeSuggestions';
import { formatRepeatDescription } from '../utils/repeat';
import { CreateTaskInput, Label, RepeatMode, Task, User } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';

interface QuickAddBarProps {
  activeProjectId: number;
  availableProjects?: { id: number; title: string; hex_color?: string }[];
  doneTasks?: Task[];
  historyTasks?: Task[];
  availableLabels?: string[];
  availableUsers?: User[];
  reenableStaples?: boolean;
  onAddTask: (input: CreateTaskInput) => void;
  onReenableTask?: (taskId: number) => void;
  placeholder?: string;
  onDetailedAdd?: () => void;
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
  historyTasks = [],
  availableLabels = [],
  availableUsers = [],
  reenableStaples = true,
  onAddTask,
  onReenableTask,
  placeholder = 'Add a task...',
  onDetailedAdd,
}) => {
  const theme = useAppTheme();
  const [rawText, setRawText] = useState('');
  const [manualPriority, setManualPriority] = useState<number>(0);
  const [lastUsedLabel, setLastUsedLabel] = useState<string>('');
  const inputRef = useRef<TextInput>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  const focusInputSoon = () => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }
    focusTimerRef.current = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  // Memoized Live Quick Add Magic Parsing
  const parsed: ParsedTaskInput & { repeatMode?: RepeatMode } = useMemo(() => {
    return rawText.trim()
      ? (parseQuickAdd(rawText) as ParsedTaskInput & { repeatMode?: RepeatMode })
      : { title: '', labels: [], assignees: [], dueDate: null };
  }, [rawText]);

  const effectivePriority =
    parsed.priority !== undefined ? parsed.priority : manualPriority;

  // Resolve target project if specified with +Project
  const { targetProjectId, targetProjectTitle } = useMemo(() => {
    if (parsed.projectName && availableProjects.length > 0) {
      const matched = availableProjects.find(
        (p) => p.title.toLowerCase() === parsed.projectName!.toLowerCase()
      );
      if (matched) {
        return { targetProjectId: matched.id, targetProjectTitle: matched.title };
      }
    }
    return { targetProjectId: activeProjectId, targetProjectTitle: undefined };
  }, [parsed.projectName, availableProjects, activeProjectId]);

  // Assignee Suggestions (when typing @user)
  const userSuggestions = useMemo(() => {
    const mentionQuery = extractMentionQuery(rawText);
    return mentionQuery !== null ? getUserSuggestions(mentionQuery, availableUsers) : [];
  }, [rawText, availableUsers]);

  // Label Suggestions (when typing *label or #label) - prioritized with last used label first
  const labelSuggestions = useMemo(() => {
    if (userSuggestions.length > 0) return [];
    return getLabelSuggestions(rawText, availableLabels, lastUsedLabel);
  }, [rawText, availableLabels, lastUsedLabel, userSuggestions.length]);

  // Task Suggestions (from completed / done tasks)
  const taskSuggestions = useMemo(() => {
    if (userSuggestions.length > 0 || labelSuggestions.length > 0) return [];
    return getTaskSuggestions(rawText, doneTasks);
  }, [rawText, doneTasks, userSuggestions.length, labelSuggestions.length]);

  // High-Confidence Historical Store Suggestion (>=75% consistency across past tasks)
  const historicalStoreSuggestion = useMemo(() => {
    if (userSuggestions.length > 0 || labelSuggestions.length > 0) return null;
    const labelObjs = (availableLabels || []).map((l, idx) => ({ id: idx + 1, title: l }));
    return getHistoricalStoreSuggestion(
      rawText,
      historyTasks && historyTasks.length > 0 ? historyTasks : doneTasks,
      labelObjs
    );
  }, [rawText, historyTasks, doneTasks, availableLabels, userSuggestions.length, labelSuggestions.length]);

  const handleSelectUserSuggestion = (user: User) => {
    const updated = replaceMentionQuery(rawText, user.username);
    setRawText(updated);
    safeHaptics.selection();
    focusInputSoon();
  };

  const handleSelectLabelSuggestion = (label: string) => {
    const updated = applyLabelSuggestion(rawText, label);
    setRawText(updated);
    setLastUsedLabel(label);
    safeHaptics.selection();
    focusInputSoon();
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

  // Cycle through ALL priority levels 0 -> 1 -> 2 -> 3 -> 4 -> 5 (Critical) -> 0
  const handleCyclePriority = () => {
    setManualPriority((prev) => (prev >= 5 ? 0 : prev + 1));
    safeHaptics.selection();
  };

  const handleSubmit = () => {
    if (!rawText.trim() || !parsed.title.trim()) return;

    const seenLabels = new Set<string>();
    const formattedLabels: Label[] = [];
    for (let idx = 0; idx < parsed.labels.length; idx++) {
      const name = parsed.labels[idx].trim();
      if (name && !seenLabels.has(name.toLowerCase())) {
        seenLabels.add(name.toLowerCase());
        formattedLabels.push({
          id: -Math.floor(Date.now() + idx + 1),
          title: name,
        });
      }
    }

    const seenUsers = new Set<string>();
    const formattedAssignees: User[] = [];
    for (let idx = 0; idx < (parsed.assignees || []).length; idx++) {
      const username = parsed.assignees[idx].trim();
      if (username && !seenUsers.has(username.toLowerCase())) {
        seenUsers.add(username.toLowerCase());
        const matched = availableUsers.find(
          (u) => u.username.toLowerCase() === username.toLowerCase()
        );
        formattedAssignees.push(
          matched || { id: -Math.floor(Date.now() + idx + 1), username }
        );
      }
    }

    onAddTask({
      title: parsed.title,
      priority: effectivePriority,
      project_id: targetProjectId,
      labels: formattedLabels,
      assignees: formattedAssignees,
      due_date: parsed.dueDate || null,
      repeat_after: parsed.repeatAfter,
      ...(parsed.repeatMode !== undefined ? { repeat_mode: parsed.repeatMode } : {}),
    });

    if (parsed.labels && parsed.labels.length > 0) {
      setLastUsedLabel(parsed.labels[parsed.labels.length - 1]);
    }

    setRawText('');
    setManualPriority(0);
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const curPriority = Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, effectivePriority)
    ? PRIORITY_LABELS[effectivePriority]
    : PRIORITY_LABELS[0];
  const canSubmit = Boolean(parsed.title.trim());
  const hasRepeat = Boolean(parsed.repeatAfter && parsed.repeatAfter > 0);
  const hasMagicAttributes =
    parsed.labels.length > 0 ||
    parsed.assignees.length > 0 ||
    Boolean(parsed.dueDate) ||
    Boolean(targetProjectTitle) ||
    parsed.priority !== undefined ||
    hasRepeat;

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
              style={[
                styles.taskSuggestionChip,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(191, 90, 242, 0.15)'
                    : 'rgba(123, 31, 162, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(191, 90, 242, 0.45)'
                    : 'rgba(123, 31, 162, 0.35)',
                },
              ]}
              onPress={() => handleSelectUserSuggestion(user)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.userSuggestionText,
                  { color: theme.isDark ? '#BF5AF2' : '#7B1FA2' },
                ]}
              >
                👤 @{user.username}
              </Text>
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
              style={[
                styles.labelSuggestionChip,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(48, 209, 88, 0.14)'
                    : 'rgba(21, 128, 61, 0.1)',
                  borderColor: theme.isDark ? '#30D158' : 'rgba(21, 128, 61, 0.4)',
                },
              ]}
              onPress={() => handleSelectLabelSuggestion(label)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.labelSuggestionText,
                  { color: theme.isDark ? '#30D158' : '#15803D' },
                ]}
              >
                #{label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {(taskSuggestions.length > 0 || historicalStoreSuggestion) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionRow}
        >
          {historicalStoreSuggestion && (
            <TouchableOpacity
              testID="store-suggestion-chip"
              style={[
                styles.taskSuggestionChip,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(255, 159, 10, 0.15)'
                    : 'rgba(180, 83, 9, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(255, 159, 10, 0.45)'
                    : 'rgba(180, 83, 9, 0.35)',
                },
              ]}
              onPress={() => {
                const safeTitle = (historicalStoreSuggestion.label.title || '')
                  .replace(/"/g, '')
                  .trim();
                if (!safeTitle) return;
                const formatted = /[\s*#+@!]/.test(safeTitle)
                  ? `*"${safeTitle}"`
                  : `*${safeTitle}`;
                setRawText((prev) => `${prev.trim()} ${formatted} `);
                safeHaptics.selection();
                focusInputSoon();
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.storeSuggestionText,
                  { color: theme.isDark ? '#FF9F0A' : '#B45309' },
                ]}
              >
                🛒 Usually at #{historicalStoreSuggestion.label.title}
              </Text>
            </TouchableOpacity>
          )}
          {taskSuggestions.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={[
                styles.taskSuggestionChip,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(10, 132, 255, 0.14)'
                    : 'rgba(0, 85, 212, 0.09)',
                  borderColor: theme.isDark
                    ? 'rgba(10, 132, 255, 0.5)'
                    : 'rgba(0, 85, 212, 0.35)',
                },
              ]}
              onPress={() => handleSelectTaskSuggestion(task)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.taskSuggestionText,
                  { color: theme.isDark ? '#0A84FF' : '#0055D4' },
                ]}
              >
                ↩ {task.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Live Magic Attribute Preview — Themed for both Dark and Light Mode */}
      {hasMagicAttributes && (
        <View style={styles.magicPreviewRow}>
          {targetProjectTitle && (
            <View
              testID="magic-project-badge"
              style={[
                styles.magicBadge,
                {
                  backgroundColor: theme.isDark ? '#2C2C2E' : 'rgba(0, 85, 212, 0.1)',
                  borderColor: theme.isDark ? '#3A3A3C' : 'rgba(0, 85, 212, 0.35)',
                },
              ]}
            >
              <Text
                style={[
                  styles.magicBadgeText,
                  { color: theme.isDark ? '#0A84FF' : '#0055D4' },
                ]}
              >
                📁 {targetProjectTitle}
              </Text>
            </View>
          )}
          {parsed.assignees.map((u) => (
            <View
              key={u}
              style={[
                styles.magicBadge,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(191, 90, 242, 0.15)'
                    : 'rgba(123, 31, 162, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(191, 90, 242, 0.4)'
                    : 'rgba(123, 31, 162, 0.35)',
                },
              ]}
            >
              <Text
                style={[
                  styles.magicAssigneeBadgeText,
                  { color: theme.isDark ? '#BF5AF2' : '#7B1FA2' },
                ]}
              >
                @{u}
              </Text>
            </View>
          ))}
          {parsed.labels.map((lbl) => (
            <View
              key={lbl}
              style={[
                styles.magicBadge,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(48, 209, 88, 0.12)'
                    : 'rgba(21, 128, 61, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(48, 209, 88, 0.35)'
                    : 'rgba(21, 128, 61, 0.35)',
                },
              ]}
            >
              <Text
                style={[
                  styles.magicLabelBadgeText,
                  { color: theme.isDark ? '#30D158' : '#15803D' },
                ]}
              >
                #{lbl}
              </Text>
            </View>
          ))}
          {parsed.dueDate && (
            <View
              testID="magic-date-badge"
              style={[
                styles.magicBadge,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(255, 149, 0, 0.12)'
                    : 'rgba(180, 83, 9, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(255, 149, 0, 0.35)'
                    : 'rgba(180, 83, 9, 0.35)',
                },
              ]}
            >
              <Text
                style={[
                  styles.magicDateBadgeText,
                  { color: theme.isDark ? '#FF9500' : '#B45309' },
                ]}
              >
                📅 {new Date(parsed.dueDate).toLocaleDateString()}
              </Text>
            </View>
          )}
          {hasRepeat && (
            <View
              testID="magic-repeat-badge"
              style={[
                styles.magicBadge,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(100, 210, 255, 0.12)'
                    : 'rgba(15, 118, 110, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(100, 210, 255, 0.35)'
                    : 'rgba(15, 118, 110, 0.35)',
                },
              ]}
            >
              <Text
                style={[
                  styles.magicRepeatBadgeText,
                  { color: theme.isDark ? '#64D2FF' : '#0F766E' },
                ]}
              >
                🔁 {formatRepeatDescription(parsed.repeatAfter, parsed.repeatMode ?? RepeatMode.FromDueDate)}
              </Text>
            </View>
          )}
          {parsed.priority !== undefined && (
            <View
              testID="magic-priority-badge"
              style={[
                styles.magicBadge,
                {
                  backgroundColor: theme.isDark
                    ? 'rgba(255, 59, 48, 0.12)'
                    : 'rgba(220, 38, 38, 0.1)',
                  borderColor: theme.isDark
                    ? 'rgba(255, 59, 48, 0.35)'
                    : 'rgba(220, 38, 38, 0.35)',
                },
              ]}
            >
              <Text
                style={[
                  styles.magicPriorityBadgeText,
                  { color: theme.isDark ? '#FF3B30' : '#DC2626' },
                ]}
              >
                ⚡ P{parsed.priority}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.dockRow}>
        {onDetailedAdd && (
          <TouchableOpacity
            testID="green-add-task-fab"
            style={styles.detailedAddBtn}
            onPress={onDetailedAdd}
            accessibilityRole="button"
            accessibilityLabel="Create task with details"
            activeOpacity={0.8}
          >
            <Text style={styles.detailedAddIcon}>＋</Text>
          </TouchableOpacity>
        )}

        <View
          style={[
            styles.inputCard,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
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
              accessibilityRole="button"
              accessibilityLabel={`Priority: ${curPriority.label}. Tap to cycle priority`}
            >
              <Text style={[styles.priorityText, { color: curPriority.color }]}>
                {curPriority.text}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="quick-add-submit"
              style={[
                styles.submitButton,
                !canSubmit &&
                  (theme.isDark
                    ? styles.submitButtonDisabled
                    : { backgroundColor: '#D1D1D6' }),
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Add task"
            >
              <Text style={styles.submitButtonText}>↑</Text>
            </TouchableOpacity>
          </View>
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
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  labelSuggestionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  taskSuggestionChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  taskSuggestionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  userSuggestionText: {
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
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  magicBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  magicAssigneeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  magicLabelBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  magicDateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  magicRepeatBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  magicPriorityBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailedAddBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#30D158',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  detailedAddIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '300',
    lineHeight: 26,
  },
  inputCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 6 : 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
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
  storeSuggestionText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
});
