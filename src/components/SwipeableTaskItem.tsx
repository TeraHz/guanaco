import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
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
  onLongPress?: (task: Task) => void;
  onSelectLabel?: (labelTitle: string) => void;
  onEditLabels?: (task: Task) => void;
  labelDefinitions?: Label[];
  isReordering?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
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
  onLongPress,
  onSelectLabel,
  onEditLabels,
  labelDefinitions,
  isReordering = false,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}) => {
  const theme = useAppTheme();
  const swipeableRef = React.useRef<Swipeable>(null);
  const isSwipingActionRef = React.useRef(false);
  const priorityColor =
    task.color && task.color !== ''
      ? `#${task.color.replace(/^#/, '')}`
      : PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[0];

  const handleToggle = () => {
    safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
    swipeableRef.current?.close?.();
    onToggle(task.id);
  };

  const handleMove = () => {
    safeHaptics.selection();
    swipeableRef.current?.close?.();
    onMove(task.id);
  };

  const handleDelete = () => {
    safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
    swipeableRef.current?.close?.();
    onDelete(task.id);
  };

  const triggerSwipeAction = (direction: 'left' | 'right') => {
    if (isSwipingActionRef.current) return;
    isSwipingActionRef.current = true;
    swipeableRef.current?.close?.();

    if (direction === 'left') {
      // Swiped right -> Delete
      handleDelete();
    } else if (direction === 'right') {
      // Swiped left -> Done
      handleToggle();
    }

    setTimeout(() => {
      isSwipingActionRef.current = false;
      swipeableRef.current?.close?.();
    }, 150);
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

  // Slide RIGHT reveals LEFT action: Delete (Red with Trash) - snappy response
  const renderLeftActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [0, 36],
      outputRange: [0.6, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.leftSwipeAction}>
        <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale }] }]}>
          <Text style={styles.swipeActionIcon}>🗑️</Text>
          <Text style={styles.swipeActionText}>Delete</Text>
        </Animated.View>
      </View>
    );
  };

  // Slide LEFT reveals RIGHT action: Done (Green with Check) - snappy response
  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-36, 0],
      outputRange: [1, 0.6],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.rightSwipeAction}>
        <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale }] }]}>
          <Text style={styles.swipeActionIcon}>✓</Text>
          <Text style={styles.swipeActionText}>{task.done ? 'Undo' : 'Done'}</Text>
        </Animated.View>
      </View>
    );
  };

  const cardContent = (
    <TouchableOpacity
      testID={`task-item-${task.id}`}
      style={[
        styles.card,
        {
          backgroundColor: task.done
            ? (theme.isDark ? '#161618' : '#FFFFFF')
            : theme.colors.cardBackground,
          borderColor: task.done
            ? (theme.isDark ? '#2C2C2E' : '#E5E5EA')
            : theme.colors.cardBorder,
          borderWidth: 1,
          opacity: task.done ? (theme.isDark ? 0.7 : 0.88) : 1,
        },
      ]}
      onPress={() => onPress(task)}
      onLongPress={() => {
        safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress?.(task);
      }}
      delayLongPress={280}
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
          { borderColor: task.done ? '#30D158' : theme.colors.cardBorder },
        ]}
        onPress={handleToggle}
        activeOpacity={0.7}
      >
        {task.done && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>

      {/* Title & Metadata */}
      <View style={styles.singleRow}>
        <Text
          testID={`task-title-${task.id}`}
          style={[
            styles.title,
            { color: theme.colors.text },
            task.done && styles.titleDone,
            task.done && { color: theme.colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {task.title}
        </Text>

        {/* Metadata badges row */}
        <View style={styles.metaRow}>
          {/* Progress % */}
          {task.percent_done !== undefined && task.percent_done > 0 && (
            <View testID={`task-progress-${task.id}`} style={styles.progressBadge}>
              <Text
                style={[
                  styles.progressText,
                  {
                    color:
                      task.percent_done === 1 || task.percent_done === 100
                        ? '#30D158'
                        : '#007AFF',
                  },
                ]}
              >
                {task.percent_done <= 1 && task.percent_done > 0
                  ? Math.round(task.percent_done * 100)
                  : Math.round(task.percent_done)}
                %
              </Text>
            </View>
          )}

          {/* Due Date */}
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
                <Text style={[styles.assigneeText, { color: theme.colors.textSecondary }]}>
                  @{user.username}
                </Text>
              </View>
            ))}

          {/* Label Pills (Clean without tag icon) */}
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
                  onPress={() => onSelectLabel && onSelectLabel(label.title)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.labelText, { color: badgeStyle.textColor }]}>
                    #{label.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
        </View>
      </View>

      {/* Small subtle "+#" link or Reorder Controls on the right of the item */}
      {isReordering ? (
        <View style={styles.reorderControls}>
          <TouchableOpacity
            testID={`move-up-task-${task.id}`}
            style={[styles.reorderBtn, !canMoveUp && styles.reorderBtnDisabled]}
            onPress={onMoveUp}
            disabled={!canMoveUp}
            activeOpacity={0.6}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.reorderBtnText, !canMoveUp && styles.reorderBtnTextDisabled]}>▲</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`move-down-task-${task.id}`}
            style={[styles.reorderBtn, !canMoveDown && styles.reorderBtnDisabled]}
            onPress={onMoveDown}
            disabled={!canMoveDown}
            activeOpacity={0.6}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.reorderBtnText, !canMoveDown && styles.reorderBtnTextDisabled]}>▼</Text>
          </TouchableOpacity>
        </View>
      ) : (
        onEditLabels && (
          <TouchableOpacity
            testID={`task-edit-labels-${task.id}`}
            style={styles.addLabelLink}
            onPress={() => onEditLabels(task)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Text style={styles.addLabelLinkText}>+#</Text>
          </TouchableOpacity>
        )
      )}

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

  // On Web or in Reorder Mode: avoid react-native-gesture-handler's Swipeable
  if (Platform.OS === 'web' || isReordering) {
    return cardContent;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      friction={2.5}
      leftThreshold={65}
      rightThreshold={115}
      overshootLeft={false}
      overshootRight={false}
      animationOptions={{
        speed: 40,
        bounciness: 0,
      }}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={triggerSwipeAction}
      onSwipeableOpen={triggerSwipeAction}
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
    borderRadius: 7,
    marginHorizontal: 8,
    marginVertical: 1.5,
    paddingVertical: 5.5,
    paddingHorizontal: 8,
    overflow: 'hidden',
    minHeight: 35,
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
    width: 3.5,
  },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 9.5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    flexShrink: 0,
  },
  checkboxDone: {
    backgroundColor: '#30D158',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '900',
  },
  singleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  title: {
    flexShrink: 1,
    fontSize: 13.5,
    color: '#F2F2F7',
    fontWeight: '500',
    marginRight: 6,
  },
  titleDone: {
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  progressBadge: {
    backgroundColor: 'rgba(10, 132, 255, 0.12)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 10,
    fontWeight: '700',
  },
  dateBadge: {
    backgroundColor: '#2C2C2E',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  dateBadgeOverdue: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
  },
  dueDateText: {
    fontSize: 10.5,
    color: '#8E8E93',
    fontWeight: '500',
  },
  dueDateTextOverdue: {
    color: '#FF453A',
    fontWeight: '700',
  },
  labelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  labelText: {
    fontSize: 10.5,
    color: '#0A84FF',
    fontWeight: '700',
  },
  addLabelLink: {
    marginLeft: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(142, 142, 147, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabelLinkText: {
    fontSize: 10,
    color: '#8E8E93',
    fontWeight: '700',
  },
  leftSwipeAction: {
    backgroundColor: '#FF453A',
    justifyContent: 'center',
    alignItems: 'flex-start',
    borderRadius: 7,
    marginHorizontal: 8,
    marginVertical: 1.5,
    paddingLeft: 18,
    flex: 1,
  },
  rightSwipeAction: {
    backgroundColor: '#30D158',
    justifyContent: 'center',
    alignItems: 'flex-end',
    borderRadius: 7,
    marginHorizontal: 8,
    marginVertical: 1.5,
    paddingRight: 18,
    flex: 1,
  },
  swipeInnerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swipeActionIcon: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '900',
  },
  swipeActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
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
    gap: 4,
    marginLeft: 6,
  },
  webActionBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#2C2C2E',
  },
  webDeleteBtn: {
    backgroundColor: 'rgba(255,69,58,0.2)',
  },
  webActionText: {
    fontSize: 11,
    color: '#8E8E93',
    fontWeight: '600',
  },
  assigneeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
  },
  assigneeText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  reorderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    gap: 6,
  },
  reorderBtn: {
    backgroundColor: '#007AFF20',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reorderBtnDisabled: {
    backgroundColor: 'transparent',
    borderColor: '#3A3A3C',
    opacity: 0.3,
  },
  reorderBtnText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '700',
  },
  reorderBtnTextDisabled: {
    color: '#8E8E93',
  },
});
