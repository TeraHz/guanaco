import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { getLabelBadgeStyles } from '../utils/colors';
import { useAppTheme } from '../utils/theme';
import { Label, Task } from '../types/vikunja';

interface SwipeableTaskItemProps {
  task: Task;
  onToggle: (taskId: number) => void;
  onMove: (taskId: number) => void;
  onDelete: (taskId: number) => void;
  onPress: (task: Task) => void;
  onSelectLabel?: (labelTitle: string) => void;
  onEditLabels?: (task: Task) => void;
  labelDefinitions?: Label[];
}

const PRIORITY_COLORS: Record<number, string> = {
  0: '#8E8E93', // None
  1: '#007AFF', // Low
  2: '#FF9500', // Medium
  3: '#FF3B30', // High
  4: '#AF52DE', // Urgent
  5: '#FF2D55', // Critical
};

export const SwipeableTaskItem: React.FC<SwipeableTaskItemProps> = ({
  task,
  onToggle,
  onMove,
  onDelete,
  onPress,
  onSelectLabel,
  onEditLabels,
  labelDefinitions,
}) => {
  const theme = useAppTheme();
  const priorityColor =
    task.color && task.color !== ''
      ? `#${task.color.replace(/^#/, '')}`
      : PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[0];

  const handleToggle = () => {
    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
    onToggle(task.id);
  };

  const handleMove = () => {
    safeHaptics.selection();
    onMove(task.id);
  };

  const handleDelete = () => {
    safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
    onDelete(task.id);
  };

  // Date formatting & Overdue detection
  const isDueDateValid =
    task.due_date &&
    task.due_date !== '0001-01-01T00:00:00Z' &&
    !isNaN(new Date(task.due_date).getTime());

  let formattedDueDate: string | null = null;
  let isOverdue = false;

  if (isDueDateValid) {
    const d = new Date(task.due_date!);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const diffDays = Math.round(
      (targetDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      formattedDueDate = 'Today';
    } else if (diffDays === 1) {
      formattedDueDate = 'Tomorrow';
    } else if (diffDays === -1) {
      formattedDueDate = 'Yesterday';
    } else {
      formattedDueDate = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    }

    if (targetDay.getTime() < today.getTime() && !task.done) {
      isOverdue = true;
    }
  }

  const renderRightActions = () => (
    <View style={styles.actionsContainer}>
      <TouchableOpacity
        testID={`task-move-action-${task.id}`}
        style={[styles.actionBtn, styles.moveBtn]}
        onPress={handleMove}
        activeOpacity={0.8}
      >
        <Text style={styles.actionText}>Move</Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID={`task-delete-action-${task.id}`}
        style={[styles.actionBtn, styles.deleteBtn]}
        onPress={handleDelete}
        activeOpacity={0.8}
      >
        <Text style={styles.actionText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  const cardContent = (
    <TouchableOpacity
      testID={`task-item-${task.id}`}
      style={[
        styles.card,
        {
          backgroundColor: task.done
            ? (theme.isDark ? '#161618' : '#F2F2F7')
            : theme.colors.cardBackground,
          borderColor: theme.colors.cardBorder,
        },
        task.done && styles.cardDone,
      ]}
      onPress={() => onPress(task)}
      activeOpacity={0.7}
    >
      {/* Priority indicator bar */}
      {task.priority > 0 && (
        <View style={[styles.priorityStrip, { backgroundColor: priorityColor }]} />
      )}

      {/* Tactile Checkbox */}
      <TouchableOpacity
        testID={`task-checkbox-${task.id}`}
        style={[
          styles.checkbox,
          task.done && styles.checkboxDone,
          { borderColor: task.done ? '#30D158' : priorityColor },
        ]}
        onPress={handleToggle}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        {task.done && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>

      {/* Task Title & Details */}
      <View style={styles.content}>
        <Text
          testID={`task-title-${task.id}`}
          style={[
            styles.title,
            { color: theme.colors.text },
            task.done && styles.titleDone,
          ]}
          numberOfLines={2}
        >
          {task.title}
        </Text>

        {/* Progress Bar (if percent_done > 0) */}
        {task.percent_done !== undefined && task.percent_done > 0 && (
          <View testID={`task-progress-${task.id}`} style={styles.progressContainer}>
            <View
              style={[
                styles.progressBarTrack,
                { backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA' },
              ]}
            >
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        task.percent_done <= 1 && task.percent_done > 0
                          ? Math.round(task.percent_done * 100)
                          : Math.round(task.percent_done)
                      )
                    )}%`,
                    backgroundColor: task.color ? `#${task.color.replace(/^#/, '')}` : '#0A84FF',
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
              {task.percent_done <= 1 && task.percent_done > 0
                ? Math.round(task.percent_done * 100)
                : Math.round(task.percent_done)}%
            </Text>
          </View>
        )}

        {/* Labels, Assignees & Dates metadata row */}
        <View style={styles.metaRow}>
          {formattedDueDate && (
            <View
              style={[
                styles.dateBadge,
                isOverdue && styles.dateBadgeOverdue,
              ]}
            >
              <Text
                style={[
                  styles.dueDateText,
                  isOverdue && styles.dueDateTextOverdue,
                ]}
              >
                {isOverdue ? '⚠️ ' : '📅 '}
                {formattedDueDate}
              </Text>
            </View>
          )}

          {/* Assignees */}
          {task.assignees &&
            task.assignees.map((user) => (
              <View
                key={user.id || user.username}
                testID={`task-assignee-${task.id}-${user.username}`}
                style={[
                  styles.assigneeBadge,
                  {
                    backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                    borderColor: theme.isDark ? '#3A3A3C' : '#D1D1D6',
                  },
                ]}
              >
                <Text style={[styles.assigneeIcon, { color: theme.colors.textSecondary }]}>👤 </Text>
                <Text style={[styles.assigneeText, { color: theme.colors.textSecondary }]}>
                  @{user.username}
                </Text>
              </View>
            ))}

          {/* Label Pills (Clickable for easy filtering) */}
          {task.labels &&
            task.labels.map((label) => {
              const badgeStyle = getLabelBadgeStyles(label, labelDefinitions);
              return (
                <TouchableOpacity
                  key={label.id || label.title}
                  testID={`task-label-${task.id}-${label.title}`}
                  style={[
                    styles.labelPill,
                    {
                      backgroundColor: badgeStyle.backgroundColor,
                      borderColor: badgeStyle.borderColor,
                    },
                  ]}
                  onPress={() => onSelectLabel?.(label.title)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.labelText,
                      { color: badgeStyle.textColor },
                    ]}
                  >
                    #{label.title}
                  </Text>
                </TouchableOpacity>
              );
            })}

          {/* Quick Tag Edit button */}
          <TouchableOpacity
            testID={`task-edit-labels-${task.id}`}
            style={styles.editLabelBtn}
            onPress={() => onEditLabels?.(task)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Text style={styles.editLabelBtnText}>🏷️+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Web & accessibility actions */}
      <View style={Platform.OS === 'web' ? styles.webActions : styles.embeddedActions}>
        <TouchableOpacity
          testID={`task-move-action-${task.id}`}
          style={Platform.OS === 'web' ? styles.webActionBtn : styles.hiddenAction}
          onPress={handleMove}
        >
          {Platform.OS === 'web' ? <Text style={styles.webActionText}>Move</Text> : null}
        </TouchableOpacity>
        <TouchableOpacity
          testID={`task-delete-action-${task.id}`}
          style={Platform.OS === 'web' ? [styles.webActionBtn, styles.webDeleteBtn] : styles.hiddenAction}
          onPress={handleDelete}
        >
          {Platform.OS === 'web' ? <Text style={styles.webActionText}>✕</Text> : null}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  // On Web: avoid react-native-gesture-handler's Swipeable which relies on deprecated findNodeHandle
  if (Platform.OS === 'web') {
    return cardContent;
  }

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      onSwipeableOpen={(direction) => {
        if (direction === 'left') {
          handleToggle();
        }
      }}
    >
      {cardContent}
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E22',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  cardDone: {
    opacity: 0.65,
    backgroundColor: '#161618',
  },
  priorityStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxDone: {
    backgroundColor: '#30D158',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    color: '#F2F2F7',
    fontWeight: '500',
  },
  titleDone: {
    textDecorationLine: 'line-through',
    color: '#8E8E93',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 6,
  },
  dateBadge: {
    backgroundColor: '#2C2C2E',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dateBadgeOverdue: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
  },
  dueDateText: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '500',
  },
  dueDateTextOverdue: {
    color: '#FF453A',
    fontWeight: '600',
  },
  labelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  labelText: {
    fontSize: 12,
    color: '#0A84FF',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  editLabelBtn: {
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  editLabelBtnText: {
    fontSize: 11,
    color: '#8E8E93',
    fontWeight: '600',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    marginRight: 16,
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 68,
    height: '100%',
    borderRadius: 10,
    marginLeft: 6,
  },
  moveBtn: {
    backgroundColor: '#0A84FF',
  },
  deleteBtn: {
    backgroundColor: '#FF453A',
  },
  actionText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  embeddedActions: {
    width: 0,
    height: 0,
    opacity: 0,
  },
  hiddenAction: {
    width: 0,
    height: 0,
  },
  webActions: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  webActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#2C2C2E',
  },
  webDeleteBtn: {
    backgroundColor: 'rgba(255,69,58,0.2)',
  },
  webActionText: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '600',
  },
  assigneeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  assigneeIcon: {
    fontSize: 11,
  },
  assigneeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    marginBottom: 2,
  },
  progressBarTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    maxWidth: 120,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
