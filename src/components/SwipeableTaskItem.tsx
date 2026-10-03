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
import { useTaskStore } from '../store/taskStore';
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
  drag?: () => void;
  isDragging?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  isLarge?: boolean;
  scale?: number;
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
  drag,
  isDragging = false,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  isLarge: isLargeProp,
  scale: scaleProp,
}) => {
  const theme = useAppTheme();
  const storeScale = useTaskStore((state) => state.taskItemScale);
  const storeLarge = useTaskStore((state) => state.largeTaskItems);

  // Compute effective scale multiplier (1.0 = 100%, 1.25 = 125%, 1.5 = 150%, etc.)
  const scalePercent =
    scaleProp !== undefined
      ? scaleProp
      : isLargeProp !== undefined
      ? isLargeProp
        ? 150
        : 100
      : storeScale ?? (storeLarge ? 150 : 100);
  const scale = (scalePercent || 100) / 100;
  const isLarge = scale > 1.0;

  const dynamicStyles = React.useMemo(() => {
    if (scale === 1) return null;
    return {
      card: {
        borderRadius: scale === 1.5 ? 10 : Math.round(7 * (1 + (scale - 1) * 0.7)),
        marginVertical: scale === 1.5 ? 3 : Math.round(1.5 * scale),
        paddingVertical: scale === 1.5 ? 9 : Math.round(5.5 * scale),
        paddingHorizontal: scale === 1.5 ? 12 : Math.round(8 * (1 + (scale - 1) * 0.7)),
        minHeight: scale === 1.5 ? 52 : Math.round(35 * scale),
      },
      priorityStrip: {
        width: scale === 1.5 ? 5 : Math.round(3.5 * scale),
      },
      checkbox: {
        width: scale === 1.5 ? 28 : Math.round(19 * scale),
        height: scale === 1.5 ? 28 : Math.round(19 * scale),
        borderRadius: scale === 1.5 ? 14 : Math.round(9.5 * scale),
        borderWidth: scale >= 1.4 ? 2 : 1.5,
        marginRight: scale === 1.5 ? 12 : Math.round(8 * scale),
      },
      checkmark: {
        fontSize: scale === 1.5 ? 16 : Math.round(10.5 * scale),
      },
      title: {
        fontSize: scale === 1.5 ? 20 : Math.round(13.5 * scale),
        marginRight: scale === 1.5 ? 9 : Math.round(6 * scale),
        lineHeight: scale === 1.5 ? 26 : Math.round(18 * scale),
      },
      metaRow: {
        gap: Math.round(4 * scale),
      },
      progressBadge: {
        paddingHorizontal: Math.round(4 * scale),
        paddingVertical: Math.round(1 * scale),
        borderRadius: Math.round(4 * scale),
      },
      progressText: {
        fontSize: Math.round(10 * scale),
      },
      dateBadge: {
        paddingHorizontal: Math.round(5 * scale),
        paddingVertical: Math.round(1 * scale),
        borderRadius: Math.round(4 * scale),
      },
      dueDateText: {
        fontSize: Math.round(10.5 * scale),
      },
      labelPill: {
        borderRadius: Math.round(5 * (1 + (scale - 1) * 0.5)),
        paddingHorizontal: Math.round(5 * scale),
        paddingVertical: Math.round(1.5 * scale),
      },
      labelText: {
        fontSize: Math.round(10.5 * scale),
      },
      assigneeBadge: {
        paddingHorizontal: Math.round(5 * scale),
        paddingVertical: Math.round(1 * scale),
        borderRadius: Math.round(5 * scale),
      },
      assigneeText: {
        fontSize: Math.round(10.5 * scale),
      },
      addLabelLink: {
        marginLeft: Math.round(6 * scale),
        paddingHorizontal: Math.round(4 * scale),
        paddingVertical: Math.round(1 * scale),
        borderRadius: Math.round(4 * scale),
      },
      addLabelLinkText: {
        fontSize: Math.round(10 * scale),
      },
      leftSwipeAction: {
        borderRadius: Math.round(7 * (1 + (scale - 1) * 0.7)),
        marginVertical: Math.round(1.5 * scale),
        paddingLeft: Math.round(18 * scale),
      },
      rightSwipeAction: {
        borderRadius: Math.round(7 * (1 + (scale - 1) * 0.7)),
        marginVertical: Math.round(1.5 * scale),
        paddingRight: Math.round(18 * scale),
      },
      swipeActionIcon: {
        fontSize: Math.round(14 * scale),
      },
      swipeActionText: {
        fontSize: Math.round(12 * scale),
      },
      reorderBtn: {
        paddingHorizontal: Math.round(8 * scale),
        paddingVertical: Math.round(5 * scale),
        borderRadius: Math.round(8 * scale),
      },
      reorderBtnText: {
        fontSize: Math.round(13 * scale),
      },
      dragHandle: {
        paddingHorizontal: Math.round(8 * scale),
        paddingVertical: Math.round(6 * scale),
      },
      dragHandleText: {
        fontSize: Math.round(18 * scale),
      },
    };
  }, [scale]);

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
    const actionScale = dragX.interpolate({
      inputRange: [0, 36],
      outputRange: [0.6, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.leftSwipeAction, isLarge && styles.leftSwipeActionLarge, dynamicStyles?.leftSwipeAction]}>
        <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale: actionScale }] }]}>
          <Text style={[styles.swipeActionIcon, isLarge && styles.swipeActionIconLarge, dynamicStyles?.swipeActionIcon]}>🗑️</Text>
          <Text style={[styles.swipeActionText, isLarge && styles.swipeActionTextLarge, dynamicStyles?.swipeActionText]}>Delete</Text>
        </Animated.View>
      </View>
    );
  };

  // Slide LEFT reveals RIGHT action: Done (Green with Check) - snappy response
  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const actionScale = dragX.interpolate({
      inputRange: [-36, 0],
      outputRange: [1, 0.6],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.rightSwipeAction, isLarge && styles.rightSwipeActionLarge, dynamicStyles?.rightSwipeAction]}>
        <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale: actionScale }] }]}>
          <Text style={[styles.swipeActionIcon, isLarge && styles.swipeActionIconLarge, dynamicStyles?.swipeActionIcon]}>✓</Text>
          <Text style={[styles.swipeActionText, isLarge && styles.swipeActionTextLarge, dynamicStyles?.swipeActionText]}>{task.done ? 'Undo' : 'Done'}</Text>
        </Animated.View>
      </View>
    );
  };

  const cardContent = (
    <TouchableOpacity
      testID={`task-item-${task.id}`}
      style={[
        styles.card,
        isLarge && styles.cardLarge,
        dynamicStyles?.card,
        {
          backgroundColor: task.done
            ? (theme.isDark ? '#161618' : '#FFFFFF')
            : theme.colors.cardBackground,
          borderColor: isDragging
            ? '#007AFF'
            : task.done
            ? (theme.isDark ? '#2C2C2E' : '#E5E5EA')
            : theme.colors.cardBorder,
          borderWidth: isDragging ? 1.5 : 1,
          opacity: task.done ? (theme.isDark ? 0.7 : 0.88) : 1,
        },
        isDragging && styles.cardDragging,
      ]}
      onPress={() => onPress(task)}
      onLongPress={() => {
        safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        if (drag) {
          drag();
        }
        onLongPress?.(task);
      }}
      delayLongPress={240}
      activeOpacity={0.7}
    >
      {/* Priority indicator bar */}
      {task.priority > 0 && (
        <View
          style={[
            styles.priorityStrip,
            isLarge && styles.priorityStripLarge,
            dynamicStyles?.priorityStrip,
            { backgroundColor: priorityColor },
          ]}
        />
      )}

      {/* Tactile Checkbox */}
      <TouchableOpacity
        testID={`task-checkbox-${task.id}`}
        style={[
          styles.checkbox,
          isLarge && styles.checkboxLarge,
          dynamicStyles?.checkbox,
          task.done && styles.checkboxDone,
          { borderColor: task.done ? '#30D158' : theme.colors.cardBorder },
        ]}
        onPress={handleToggle}
        activeOpacity={0.7}
      >
        {task.done && (
          <Text style={[styles.checkmark, isLarge && styles.checkmarkLarge, dynamicStyles?.checkmark]}>✓</Text>
        )}
      </TouchableOpacity>

      {/* Title & Metadata */}
      <View style={styles.singleRow}>
        <Text
          testID={`task-title-${task.id}`}
          style={[
            styles.title,
            isLarge && styles.titleLarge,
            dynamicStyles?.title,
            { color: theme.colors.text },
            task.done && styles.titleDone,
            task.done && { color: theme.colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {task.title}
        </Text>

        {/* Metadata badges row */}
        <View style={[styles.metaRow, isLarge && styles.metaRowLarge, dynamicStyles?.metaRow]}>
          {/* Progress % */}
          {task.percent_done !== undefined && task.percent_done > 0 && (
            <View
              testID={`task-progress-${task.id}`}
              style={[styles.progressBadge, isLarge && styles.progressBadgeLarge, dynamicStyles?.progressBadge]}
            >
              <Text
                style={[
                  styles.progressText,
                  isLarge && styles.progressTextLarge,
                  dynamicStyles?.progressText,
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
                isLarge && styles.dateBadgeLarge,
                dynamicStyles?.dateBadge,
                isOverdue && styles.dateBadgeOverdue,
              ]}
            >
              <Text
                style={[
                  styles.dueDateText,
                  isLarge && styles.dueDateTextLarge,
                  dynamicStyles?.dueDateText,
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
                  isLarge && styles.assigneeBadgeLarge,
                  dynamicStyles?.assigneeBadge,
                  {
                    backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                    borderColor: theme.isDark ? '#3A3A3C' : '#D1D1D6',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.assigneeText,
                    isLarge && styles.assigneeTextLarge,
                    dynamicStyles?.assigneeText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
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
                    isLarge && styles.labelPillLarge,
                    dynamicStyles?.labelPill,
                    {
                      backgroundColor: badgeStyle.backgroundColor,
                      borderColor: badgeStyle.borderColor,
                    },
                  ]}
                  onPress={() => onSelectLabel && onSelectLabel(label.title)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.labelText,
                      isLarge && styles.labelTextLarge,
                      dynamicStyles?.labelText,
                      { color: badgeStyle.textColor },
                    ]}
                  >
                    #{label.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
        </View>
      </View>

      {/* Small subtle "+#" link or Drag Handle / Reorder Controls on the right of the item */}
      {isReordering ? (
        <View style={styles.reorderControls}>
          {drag ? (
            <TouchableOpacity
              testID={`drag-handle-${task.id}`}
              style={[styles.dragHandle, isLarge && styles.dragHandleLarge, dynamicStyles?.dragHandle]}
              onPressIn={drag}
              onLongPress={drag}
              activeOpacity={0.6}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text
                style={[
                  styles.dragHandleText,
                  isLarge && styles.dragHandleTextLarge,
                  dynamicStyles?.dragHandleText,
                  { color: theme.colors.textSecondary },
                ]}
              >
                ☰
              </Text>
            </TouchableOpacity>
          ) : null}
          {onMoveUp && onMoveDown ? (
            <>
              <TouchableOpacity
                testID={`move-up-task-${task.id}`}
                style={[
                  styles.reorderBtn,
                  isLarge && styles.reorderBtnLarge,
                  dynamicStyles?.reorderBtn,
                  !canMoveUp && styles.reorderBtnDisabled,
                ]}
                onPress={onMoveUp}
                disabled={!canMoveUp}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    styles.reorderBtnText,
                    isLarge && styles.reorderBtnTextLarge,
                    dynamicStyles?.reorderBtnText,
                    !canMoveUp && styles.reorderBtnTextDisabled,
                  ]}
                >
                  ▲
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`move-down-task-${task.id}`}
                style={[
                  styles.reorderBtn,
                  isLarge && styles.reorderBtnLarge,
                  dynamicStyles?.reorderBtn,
                  !canMoveDown && styles.reorderBtnDisabled,
                ]}
                onPress={onMoveDown}
                disabled={!canMoveDown}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    styles.reorderBtnText,
                    isLarge && styles.reorderBtnTextLarge,
                    dynamicStyles?.reorderBtnText,
                    !canMoveDown && styles.reorderBtnTextDisabled,
                  ]}
                >
                  ▼
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      ) : (
        onEditLabels && (
          <TouchableOpacity
            testID={`task-edit-labels-${task.id}`}
            style={[styles.addLabelLink, isLarge && styles.addLabelLinkLarge, dynamicStyles?.addLabelLink]}
            onPress={() => onEditLabels(task)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.addLabelLinkText,
                isLarge && styles.addLabelLinkTextLarge,
                dynamicStyles?.addLabelLinkText,
              ]}
            >
              +#
            </Text>
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
      leftThreshold={Math.round(115 * scale)}
      rightThreshold={Math.round(65 * scale)}
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
  cardLarge: {
    borderRadius: 10,
    marginVertical: 3,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minHeight: 52,
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
  priorityStripLarge: {
    width: 5,
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
  checkboxLarge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    marginRight: 12,
  },
  checkboxDone: {
    backgroundColor: '#30D158',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '900',
  },
  checkmarkLarge: {
    fontSize: 16,
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
  titleLarge: {
    fontSize: 20,
    marginRight: 9,
    lineHeight: 26,
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
  metaRowLarge: {
    gap: 6,
  },
  progressBadge: {
    backgroundColor: 'rgba(10, 132, 255, 0.12)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  progressBadgeLarge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  progressText: {
    fontSize: 10,
    fontWeight: '700',
  },
  progressTextLarge: {
    fontSize: 14,
  },
  dateBadge: {
    backgroundColor: '#2C2C2E',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  dateBadgeLarge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dateBadgeOverdue: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
  },
  dueDateText: {
    fontSize: 10.5,
    color: '#8E8E93',
    fontWeight: '500',
  },
  dueDateTextLarge: {
    fontSize: 15,
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
  labelPillLarge: {
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  labelText: {
    fontSize: 10.5,
    color: '#0A84FF',
    fontWeight: '700',
  },
  labelTextLarge: {
    fontSize: 15,
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
  addLabelLinkLarge: {
    marginLeft: 9,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  addLabelLinkText: {
    fontSize: 10,
    color: '#8E8E93',
    fontWeight: '700',
  },
  addLabelLinkTextLarge: {
    fontSize: 14,
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
  leftSwipeActionLarge: {
    borderRadius: 10,
    marginVertical: 3,
    paddingLeft: 24,
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
  rightSwipeActionLarge: {
    borderRadius: 10,
    marginVertical: 3,
    paddingRight: 24,
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
  swipeActionIconLarge: {
    fontSize: 20,
  },
  swipeActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  swipeActionTextLarge: {
    fontSize: 17,
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
  assigneeBadgeLarge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  assigneeText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  assigneeTextLarge: {
    fontSize: 15,
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
  reorderBtnLarge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
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
  reorderBtnTextLarge: {
    fontSize: 17,
  },
  reorderBtnTextDisabled: {
    color: '#8E8E93',
  },
  cardDragging: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    transform: [{ scale: 1.02 }],
  },
  dragHandle: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragHandleLarge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dragHandleText: {
    fontSize: 18,
    fontWeight: '600',
  },
  dragHandleTextLarge: {
    fontSize: 26,
  },
});
