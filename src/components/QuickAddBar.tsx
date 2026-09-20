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
import { CreateTaskInput, Label, Project, Task } from '../types/vikunja';

interface QuickAddBarProps {
  activeProjectId: number;
  availableProjects?: { id: number; title: string; hex_color?: string }[];
  doneTasks?: Task[];
  availableLabels?: string[];
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
  reenableStaples = true,
  onAddTask,
  onReenableTask,
  placeholder = 'Add a task...',
}) => {
  const [rawText, setRawText] = useState('');
  const [manualPriority, setManualPriority] = useState<number>(0);

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

  // Label Suggestions (when typing *label)
  const labelSuggestions = getLabelSuggestions(rawText, availableLabels);

  // Task Suggestions (from completed / done tasks)
  const taskSuggestions =
    labelSuggestions.length === 0 ? getTaskSuggestions(rawText, doneTasks) : [];

  const handleSelectLabelSuggestion = (label: string) => {
    const updated = applyLabelSuggestion(rawText, label);
    setRawText(updated);
    safeHaptics.selection();
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

    onAddTask({
      title: parsed.title,
      priority: effectivePriority,
      project_id: targetProjectId,
      labels: formattedLabels,
      due_date: parsed.dueDate || null,
    });

    setRawText('');
    setManualPriority(0);
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const curPriority = PRIORITY_LABELS[effectivePriority] || PRIORITY_LABELS[0];
  const hasMagicAttributes =
    parsed.labels.length > 0 ||
    parsed.dueDate ||
    parsed.projectName ||
    parsed.priority !== undefined;

  return (
    <View style={styles.container}>
      {/* Suggestions Row: Label Suggestions or Done Task Suggestions */}
      {labelSuggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionRow}
        >
          {labelSuggestions.map((label) => (
            <TouchableOpacity
              key={label}
              testID={`suggest-label-${label}`}
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
          style={styles.suggestionScroll}
          contentContainerStyle={styles.suggestionRow}
        >
          {taskSuggestions.map((task) => (
            <TouchableOpacity
              key={task.id}
              testID={`suggest-task-${task.id}`}
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

      <View style={styles.inputCard}>
        <TextInput
          testID="quick-add-input"
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#8E8E93"
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  suggestionScroll: {
    marginBottom: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 2,
  },
  labelSuggestionChip: {
    backgroundColor: '#30D15820',
    borderColor: '#30D158',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  labelSuggestionText: {
    color: '#30D158',
    fontSize: 13,
    fontWeight: '700',
  },
  taskSuggestionChip: {
    backgroundColor: '#0A84FF20',
    borderColor: '#0A84FF80',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  taskSuggestionText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '600',
  },
  magicPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  magicBadge: {
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  magicBadgeText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '600',
  },
  magicLabelBadge: {
    borderColor: '#30D15840',
    backgroundColor: '#30D15815',
  },
  magicLabelBadgeText: {
    color: '#30D158',
    fontSize: 12,
    fontWeight: '600',
  },
  magicDateBadge: {
    borderColor: '#FF950040',
    backgroundColor: '#FF950015',
  },
  magicDateBadgeText: {
    color: '#FF9500',
    fontSize: 12,
    fontWeight: '600',
  },
  magicPriorityBadge: {
    borderColor: '#FF3B3040',
    backgroundColor: '#FF3B3015',
  },
  magicPriorityBadgeText: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: '700',
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    paddingVertical: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  priorityBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  priorityText: {
    fontSize: 13,
    fontWeight: '700',
  },
  submitButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#30D158',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#3A3A3C',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
  },
});
