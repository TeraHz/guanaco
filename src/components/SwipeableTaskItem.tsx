import React, { useEffect } from 'react';
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
import { getLabelBadgeStyles, hexToRgba, normalizeHexColor } from '../utils/colors';
import {
  normalizeVikunjaDate,
  isOverdue as checkIsOverdue,
  formatDateDisplay,
} from '../utils/dates';
import { useAppTheme, ThemeTokens } from '../utils/theme';
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
  textScale?: number;
}

function getPriorityStripColor(priority: number, theme: ThemeTokens): string {
  switch (priority) {
    case 1:
      return theme.colors.accent;
    case 2:
      return theme.colors.warning;
    case 3:
      return theme.colors.danger;
    case 4:
      return theme.isDark ? '#BF5AF2' : '#7E22CE';
    case 5:
      return theme.isDark ? '#FF375F' : '#BE123C';
    case 0:
    default:
      return theme.colors.textTertiary;
  }
}

function normalizePercentDoneDisplay(raw?: number | null): number {
  if (raw === undefined || raw === null || !Number.isFinite(raw) || raw <= 0) return 0;
  if (raw <= 1) {
    return Math.round(raw * 100);
  }
  return Math.min(100, Math.round(raw));
}

const SwipeableTaskItemComponent: React.FC<SwipeableTaskItemProps> = ({
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
  textScale: textScaleProp,
}) => {
  const theme = useAppTheme();
  const storeBoxScale = useTaskStore((state) => state.taskItemScale);
  const storeTextScale = useTaskStore((state) => state.taskItemTextScale);
  const storeLarge = useTaskStore((state) => state.largeTaskItems);

  // Compute effective scale multipliers (1.0 = 100%, 1.25 = 125%, 1.5 = 150%, etc.)
  const boxScalePercent =
    scaleProp !== undefined
      ? scaleProp
      : isLargeProp !== undefined
      ? isLargeProp
        ? 150
        : 100
      : storeBoxScale ?? (storeLarge ? 150 : 100);
  const boxScale = (boxScalePercent || 100) / 100;
  const isLarge = boxScale > 1.0;

  const textScalePercent =
    textScaleProp !== undefined
      ? textScaleProp
      : isLargeProp !== undefined
      ? isLargeProp
        ? 150
        : 100
      : storeTextScale ?? 100;
  const textScale = (textScalePercent || 100) / 100;

  const dynamicStyles = React.useMemo(() => {
    if (boxScale === 1 && textScale === 1) return null;
    return {
      card: {
        borderRadius: boxScale === 1.5 ? 10 : Math.round(7 * (1 + (boxScale - 1) * 0.7)),
        marginVertical: boxScale === 1.5 ? 3 : Math.round(1.5 * boxScale),
        paddingVertical: boxScale === 1.5 ? 9 : Math.round(5.5 * boxScale),
        paddingHorizontal: boxScale === 1.5 ? 12 : Math.round(8 * (1 + (boxScale - 1) * 0.7)),
        minHeight: boxScale === 1.5 ? 52 : Math.round(35 * boxScale),
      },
      priorityStrip: {
        width: boxScale === 1.5 ? 5 : Math.round(3.5 * boxScale),
      },
      checkbox: {
        width: boxScale === 1.5 ? 28 : Math.round(19 * boxScale),
        height: boxScale === 1.5 ? 28 : Math.round(19 * boxScale),
        borderRadius: boxScale === 1.5 ? 14 : Math.round(9.5 * boxScale),
        borderWidth: boxScale >= 1.4 ? 2 : 1.75,
        marginRight: boxScale === 1.5 ? 12 : Math.round(8 * boxScale),
      },
      checkmark: {
        fontSize: textScale === 1 ? 10.5 : textScale === 1.5 ? 16 : Math.round(10.5 * textScale),
      },
      title: {
        fontSize: textScale === 1 ? 13.5 : textScale === 1.5 ? 20 : Math.round(13.5 * textScale),
        marginRight: boxScale === 1.5 ? 9 : Math.round(6 * boxScale),
        lineHeight: textScale === 1 ? 18 : textScale === 1.5 ? 26 : Math.round(18 * textScale),
      },
      metaRow: {
        gap: Math.round(4 * boxScale),
      },
      progressBadge: {
        paddingHorizontal: Math.round(4 * boxScale),
        paddingVertical: Math.round(1 * boxScale),
        borderRadius: Math.round(4 * boxScale),
      },
      progressText: {
        fontSize: Math.round(10 * textScale),
      },
      dateBadge: {
        paddingHorizontal: Math.round(5 * boxScale),
        paddingVertical: Math.round(1 * boxScale),
        borderRadius: Math.round(4 * boxScale),
      },
      dueDateText: {
        fontSize: textScale === 1 ? 10.5 : Math.round(10.5 * textScale),
      },
      labelPill: {
        borderRadius: Math.round(5 * (1 + (boxScale - 1) * 0.5)),
        paddingHorizontal: Math.round(5 * boxScale),
        paddingVertical: Math.round(1.5 * boxScale),
      },
      labelText: {
        fontSize: textScale === 1 ? 10.5 : Math.round(10.5 * textScale),
      },
      assigneeBadge: {
        paddingHorizontal: Math.round(5 * boxScale),
        paddingVertical: Math.round(1 * boxScale),
        borderRadius: Math.round(5 * boxScale),
      },
      assigneeText: {
        fontSize: textScale === 1 ? 10.5 : Math.round(10.5 * textScale),
      },
      addLabelLink: {
        marginLeft: Math.round(6 * boxScale),
        paddingHorizontal: Math.round(5 * boxScale),
        paddingVertical: Math.round(1.5 * boxScale),
        borderRadius: Math.round(4 * boxScale),
      },
      addLabelLinkText: {
        fontSize: Math.round(10.5 * textScale),
      },
      leftSwipeTray: {
        marginVertical: Math.round(1.5 * boxScale),
      },
      leftSwipeBtn: {
        borderRadius: Math.round(7 * (1 + (boxScale - 1) * 0.7)),
        paddingHorizontal: Math.round(14 * boxScale),
      },
      rightSwipeAction: {
        borderRadius: Math.round(7 * (1 + (boxScale - 1) * 0.7)),
        marginVertical: Math.round(1.5 * boxScale),
        paddingRight: Math.round(18 * boxScale),
      },
      swipeActionText: {
        fontSize: Math.round(12.5 * textScale),
      },
      reorderBtn: {
        paddingHorizontal: Math.round(8 * boxScale),
        paddingVertical: Math.round(5 * boxScale),
        borderRadius: Math.round(8 * boxScale),
      },
      reorderBtnText: {
        fontSize: Math.round(13 * textScale),
      },
      dragHandle: {
        paddingHorizontal: Math.round(8 * boxScale),
        paddingVertical: Math.round(6 * boxScale),
      },
      dragHandleText: {
        fontSize: Math.round(18 * textScale),
      },
    };
  }, [boxScale, textScale]);

  const swipeableRef = React.useRef<Swipeable>(null);
  const isSwipingActionRef = React.useRef(false);
  const swipeResetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (swipeResetTimerRef.current) {
        clearTimeout(swipeResetTimerRef.current);
      }
    };
  }, []);

  // Read inbound Vikunja `hex_color` (as well as `color`) while ignoring unset "000000" black defaults
  const customTaskColor = normalizeHexColor(task.hex_color || task.color, true) ?? null;
  const priorityColor = customTaskColor || getPriorityStripColor(task.priority, theme);
  const showPriorityStrip = task.priority > 0 || Boolean(customTaskColor);

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

  const handleSwipeableOpen = (direction: 'left' | 'right') => {
    if (direction === 'left') {
      // Swiped right -> reveals Move & Delete buttons safely without instant accidental deletion!
      safeHaptics.selection();
      return;
    }

    // direction === 'right': Swiped left -> Toggle Done & close cleanly
    if (isSwipingActionRef.current) return;
    isSwipingActionRef.current = true;
    handleToggle();

    if (swipeResetTimerRef.current) {
      clearTimeout(swipeResetTimerRef.current);
    }
    swipeResetTimerRef.current = setTimeout(() => {
      isSwipingActionRef.current = false;
      swipeResetTimerRef.current = null;
    }, 350);
  };

  // Consistent Vikunja zero-date normalization & overdue calculation
  const normalizedDueDate = normalizeVikunjaDate(task.due_date);
  const formattedDueDate = normalizedDueDate
    ? formatDateDisplay(normalizedDueDate, { includeTime: false })
    : null;
  const isOverdue = Boolean(normalizedDueDate && !task.done && checkIsOverdue(normalizedDueDate));

  const pctDisplay = normalizePercentDoneDisplay(task.percent_done);

  // Slide RIGHT reveals LEFT actions: Move (accent blue) + Delete (danger red) with clean labels
  const renderLeftActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const actionScale = dragX.interpolate({
      inputRange: [0, 60],
      outputRange: [0.8, 1],
      extrapolate: 'clamp',
    });

    return (
      <View
        style={[
          styles.leftSwipeTray,
          isLarge && styles.leftSwipeTrayLarge,
          dynamicStyles?.leftSwipeTray,
        ]}
      >
        <TouchableOpacity
          testID={`swipe-move-btn-${task.id}`}
          style={[
            styles.leftSwipeBtn,
            { backgroundColor: theme.colors.accent },
            isLarge && styles.leftSwipeBtnLarge,
            dynamicStyles?.leftSwipeBtn,
          ]}
          onPress={handleMove}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Move ${task.title} to another list`}
        >
          <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale: actionScale }] }]}>
            <Text
              style={[
                styles.swipeActionText,
                isLarge && styles.swipeActionTextLarge,
                dynamicStyles?.swipeActionText,
              ]}
            >
              Move
            </Text>
          </Animated.View>
        </TouchableOpacity>

        <TouchableOpacity
          testID={`swipe-delete-btn-${task.id}`}
          style={[
            styles.leftSwipeBtn,
            { backgroundColor: theme.colors.danger },
            isLarge && styles.leftSwipeBtnLarge,
            dynamicStyles?.leftSwipeBtn,
          ]}
          onPress={handleDelete}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${task.title}`}
        >
          <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale: actionScale }] }]}>
            <Text
              style={[
                styles.swipeActionText,
                isLarge && styles.swipeActionTextLarge,
                dynamicStyles?.swipeActionText,
              ]}
            >
              Delete
            </Text>
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  // Slide LEFT reveals RIGHT action: Done / Undo (success green)
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
      <View
        style={[
          styles.rightSwipeAction,
          { backgroundColor: theme.colors.success },
          isLarge && styles.rightSwipeActionLarge,
          dynamicStyles?.rightSwipeAction,
        ]}
      >
        <Animated.View style={[styles.swipeInnerContent, { transform: [{ scale: actionScale }] }]}>
          <Text
            style={[
              styles.swipeActionText,
              isLarge && styles.swipeActionTextLarge,
              dynamicStyles?.swipeActionText,
            ]}
          >
            {task.done ? 'Undo' : 'Done'}
          </Text>
        </Animated.View>
      </View>
    );
  };

  const isWeb = Platform.OS === 'web';

  const cardContent = (
    <TouchableOpacity
      testID={`task-item-${task.id}`}
      style={[
        styles.card,
        isLarge && styles.cardLarge,
        dynamicStyles?.card,
        {
          backgroundColor: task.done
            ? theme.isOled
              ? '#050507'
              : theme.isDark
              ? '#161618'
              : '#FFFFFF'
            : theme.colors.cardBackground,
          borderColor: isDragging
            ? theme.colors.accent
            : task.done
            ? theme.colors.border
            : theme.colors.cardBorder,
          borderWidth: isDragging ? 1.5 : 1,
        },
        isDragging && styles.cardDragging,
      ]}
      onPress={() => {
        swipeableRef.current?.close?.();
        onPress(task);
      }}
      onLongPress={() => {
        if (onLongPress) {
          onLongPress(task);
        } else if (drag) {
          safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
          drag();
        }
      }}
      delayLongPress={240}
      activeOpacity={0.7}
    >
      {/* Priority / Task Accent Color indicator bar */}
      {showPriorityStrip && (
        <View
          testID={`task-priority-strip-${task.id}`}
          style={[
            styles.priorityStrip,
            isLarge && styles.priorityStripLarge,
            dynamicStyles?.priorityStrip,
            { backgroundColor: priorityColor },
          ]}
        />
      )}

      {/* Tactile Accessible Night-Legible Checkbox */}
      <TouchableOpacity
        testID={`task-checkbox-${task.id}`}
        style={[
          styles.checkbox,
          isLarge && styles.checkboxLarge,
          dynamicStyles?.checkbox,
          {
            backgroundColor: task.done
              ? theme.colors.success
              : theme.isDark
              ? 'rgba(255, 255, 255, 0.03)'
              : 'transparent',
            borderColor: task.done ? theme.colors.success : theme.colors.checkboxBorder,
          },
        ]}
        onPress={handleToggle}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: Boolean(task.done) }}
        accessibilityLabel={
          task.done ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`
        }
      >
        {task.done && (
          <Text style={[styles.checkmark, isLarge && styles.checkmarkLarge, dynamicStyles?.checkmark]}>
            ✓
          </Text>
        )}
      </TouchableOpacity>

      {/* Title & Metadata */}
      {(() => {
        const isRepeating = Boolean(
          (task.repeat_after && task.repeat_after > 0) || task.repeat_mode === 1
        );
        const subtasks = task.related_tasks?.subtask || [];
        const subtaskTotal = subtasks.length;
        const subtaskDone = subtasks.filter((s) => Boolean(s?.done)).length;
        const parentTask = task.related_tasks?.parenttask?.[0] || null;
        const hasMetadata = Boolean(
          pctDisplay > 0 ||
            subtaskTotal > 0 ||
            parentTask ||
            formattedDueDate ||
            isRepeating ||
            (task.reminders && task.reminders.length > 0) ||
            (task.assignees && task.assignees.length > 0) ||
            (task.labels && task.labels.length > 0)
        );
        const isLongTitle = (task.title || '').length > 26;

        const metadataBadges = (
          <>
            {/* Parent Task Indicator */}
            {parentTask && parentTask.title ? (
              <View
                testID={`task-parent-badge-${task.id}`}
                style={[
                  styles.dateBadge,
                  isLarge && styles.dateBadgeLarge,
                  dynamicStyles?.dateBadge,
                  { backgroundColor: theme.colors.surfaceSecondary },
                ]}
              >
                <Text
                  style={[
                    styles.dueDateText,
                    isLarge && styles.dueDateTextLarge,
                    dynamicStyles?.dueDateText,
                    { color: theme.colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {`↳ ${parentTask.title}`}
                </Text>
              </View>
            ) : null}

            {/* Subtask Progress Badge */}
            {subtaskTotal > 0 && (
              <View
                testID={`task-subtask-badge-${task.id}`}
                style={[
                  styles.progressBadge,
                  isLarge && styles.progressBadgeLarge,
                  dynamicStyles?.progressBadge,
                  {
                    backgroundColor:
                      subtaskDone >= subtaskTotal
                        ? hexToRgba(theme.colors.success, 0.14)
                        : theme.colors.surfaceSecondary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.progressText,
                    isLarge && styles.progressTextLarge,
                    dynamicStyles?.progressText,
                    {
                      color:
                        subtaskDone >= subtaskTotal
                          ? theme.colors.success
                          : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {`☑ ${subtaskDone}/${subtaskTotal}`}
                </Text>
              </View>
            )}
            {/* Progress % */}
            {pctDisplay > 0 && (
              <View
                testID={`task-progress-${task.id}`}
                style={[
                  styles.progressBadge,
                  isLarge && styles.progressBadgeLarge,
                  dynamicStyles?.progressBadge,
                  {
                    backgroundColor: hexToRgba(
                      pctDisplay >= 100 ? theme.colors.success : theme.colors.accent,
                      0.14
                    ),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.progressText,
                    isLarge && styles.progressTextLarge,
                    dynamicStyles?.progressText,
                    {
                      color:
                        pctDisplay >= 100 ? theme.colors.success : theme.colors.accent,
                    },
                  ]}
                >
                  {pctDisplay}%
                </Text>
              </View>
            )}

            {/* Due Date */}
            {formattedDueDate && (
              <View
                testID={`task-due-badge-${task.id}`}
                style={[
                  styles.dateBadge,
                  isLarge && styles.dateBadgeLarge,
                  dynamicStyles?.dateBadge,
                  {
                    backgroundColor: isOverdue
                      ? hexToRgba(theme.colors.danger, 0.15)
                      : theme.colors.surfaceSecondary,
                    borderWidth: isOverdue ? 1 : 0,
                    borderColor: isOverdue ? hexToRgba(theme.colors.danger, 0.4) : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dueDateText,
                    isLarge && styles.dueDateTextLarge,
                    dynamicStyles?.dueDateText,
                    isOverdue && styles.dueDateTextOverdue,
                    {
                      color: isOverdue ? theme.colors.danger : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {formattedDueDate}
                </Text>
              </View>
            )}

            {/* Repeat Glyph */}
            {isRepeating && (
              <View testID={`task-repeat-icon-${task.id}`} style={styles.iconBadge}>
                <Text
                  style={[
                    styles.metaGlyphText,
                    {
                      fontSize: Math.round(11 * textScale),
                      color: theme.colors.textSecondary,
                    },
                  ]}
                >
                  ↻
                </Text>
              </View>
            )}

            {/* Reminder Glyph */}
            {Boolean(task.reminders && task.reminders.length > 0) && (
              <View testID={`task-reminder-icon-${task.id}`} style={styles.iconBadge}>
                <Text
                  style={[
                    styles.metaGlyphText,
                    {
                      fontSize: Math.round(11 * textScale),
                      color: theme.colors.textSecondary,
                    },
                  ]}
                >
                  ◷
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
                      backgroundColor: theme.colors.surfaceSecondary,
                      borderColor: theme.colors.borderStrong,
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

            {/* Label Pills */}
            {task.labels &&
              task.labels.map((label) => {
                const badgeStyle = getLabelBadgeStyles(label, labelDefinitions, theme.isDark);
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
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by label ${label.title}`}
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
          </>
        );

        if (hasMetadata && isLongTitle) {
          return (
            <View style={styles.contentColumn}>
              <Text
                testID={`task-title-${task.id}`}
                style={[
                  styles.title,
                  isLarge && styles.titleLarge,
                  dynamicStyles?.title,
                  { color: task.done ? theme.colors.textSecondary : theme.colors.text },
                  task.done && styles.titleDone,
                ]}
                numberOfLines={3}
                ellipsizeMode="tail"
              >
                {task.title}
              </Text>
              <View
                style={[
                  styles.metaRowStacked,
                  isLarge && styles.metaRowLarge,
                  dynamicStyles?.metaRow,
                ]}
              >
                {metadataBadges}
              </View>
            </View>
          );
        }

        if (hasMetadata) {
          return (
            <View style={styles.singleRow}>
              <Text
                testID={`task-title-${task.id}`}
                style={[
                  styles.title,
                  isLarge && styles.titleLarge,
                  dynamicStyles?.title,
                  { color: task.done ? theme.colors.textSecondary : theme.colors.text },
                  task.done && styles.titleDone,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {task.title}
              </Text>
              <View
                style={[
                  styles.metaRow,
                  isLarge && styles.metaRowLarge,
                  dynamicStyles?.metaRow,
                ]}
              >
                {metadataBadges}
              </View>
            </View>
          );
        }

        return (
          <View style={styles.singleRow}>
            <Text
              testID={`task-title-${task.id}`}
              style={[
                styles.title,
                isLarge && styles.titleLarge,
                dynamicStyles?.title,
                { color: task.done ? theme.colors.textSecondary : theme.colors.text },
                task.done && styles.titleDone,
              ]}
              numberOfLines={3}
              ellipsizeMode="tail"
            >
              {task.title}
            </Text>
          </View>
        );
      })()}

      {/* "+#" Quick Label Button or Drag Handle / Reorder Controls */}
      {isReordering ? (
        <View style={styles.reorderControls}>
          {drag ? (
            <TouchableOpacity
              testID={`drag-handle-${task.id}`}
              style={[
                styles.dragHandle,
                isLarge && styles.dragHandleLarge,
                dynamicStyles?.dragHandle,
              ]}
              onPressIn={drag}
              onLongPress={drag}
              activeOpacity={0.6}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={`Drag to reorder ${task.title}`}
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
                  {
                    backgroundColor: canMoveUp
                      ? hexToRgba(theme.colors.accent, 0.14)
                      : 'transparent',
                    borderColor: canMoveUp
                      ? hexToRgba(theme.colors.accent, 0.35)
                      : theme.colors.border,
                  },
                  !canMoveUp && styles.reorderBtnDisabled,
                ]}
                onPress={onMoveUp}
                disabled={!canMoveUp}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Move ${task.title} up`}
              >
                <Text
                  style={[
                    styles.reorderBtnText,
                    isLarge && styles.reorderBtnTextLarge,
                    dynamicStyles?.reorderBtnText,
                    {
                      color: canMoveUp ? theme.colors.accent : theme.colors.textTertiary,
                    },
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
                  {
                    backgroundColor: canMoveDown
                      ? hexToRgba(theme.colors.accent, 0.14)
                      : 'transparent',
                    borderColor: canMoveDown
                      ? hexToRgba(theme.colors.accent, 0.35)
                      : theme.colors.border,
                  },
                  !canMoveDown && styles.reorderBtnDisabled,
                ]}
                onPress={onMoveDown}
                disabled={!canMoveDown}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Move ${task.title} down`}
              >
                <Text
                  style={[
                    styles.reorderBtnText,
                    isLarge && styles.reorderBtnTextLarge,
                    dynamicStyles?.reorderBtnText,
                    {
                      color: canMoveDown ? theme.colors.accent : theme.colors.textTertiary,
                    },
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
            style={[
              styles.addLabelLink,
              isLarge && styles.addLabelLinkLarge,
              dynamicStyles?.addLabelLink,
              {
                backgroundColor: theme.colors.surfaceSecondary,
                borderColor: theme.colors.borderStrong,
              },
            ]}
            onPress={() => onEditLabels(task)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Edit labels for ${task.title}`}
          >
            <Text
              style={[
                styles.addLabelLinkText,
                isLarge && styles.addLabelLinkTextLarge,
                dynamicStyles?.addLabelLinkText,
                { color: theme.colors.textSecondary },
              ]}
            >
              +#
            </Text>
          </TouchableOpacity>
        )
      )}

      {/* Web visible actions / Native hidden test hooks (strictly hidden from screen readers on native) */}
      <View
        style={isWeb ? styles.webActions : styles.embeddedActions}
        accessible={false}
        importantForAccessibility={isWeb ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={!isWeb}
      >
        <TouchableOpacity
          testID={`task-move-action-${task.id}`}
          accessible={isWeb}
          importantForAccessibility={isWeb ? 'yes' : 'no'}
          accessibilityRole={isWeb ? 'button' : undefined}
          accessibilityLabel={isWeb ? `Move ${task.title}` : undefined}
          style={
            isWeb
              ? [styles.webActionBtn, { backgroundColor: theme.colors.surfaceSecondary }]
              : styles.hiddenAction
          }
          onPress={handleMove}
        >
          {isWeb ? (
            <Text style={[styles.webActionText, { color: theme.colors.textSecondary }]}>
              Move
            </Text>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          testID={`task-delete-action-${task.id}`}
          accessible={isWeb}
          importantForAccessibility={isWeb ? 'yes' : 'no'}
          accessibilityRole={isWeb ? 'button' : undefined}
          accessibilityLabel={isWeb ? `Delete ${task.title}` : undefined}
          style={
            isWeb
              ? [
                  styles.webActionBtn,
                  { backgroundColor: hexToRgba(theme.colors.danger, 0.15) },
                ]
              : styles.hiddenAction
          }
          onPress={handleDelete}
        >
          {isWeb ? (
            <Text style={[styles.webActionText, { color: theme.colors.danger }]}>✕</Text>
          ) : null}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  // On Web only: avoid react-native-gesture-handler's Swipeable.
  // On Native: keep Swipeable mounted (toggling `enabled`) so entering reorder/drag NEVER unmounts mid-gesture!
  if (isWeb) {
    return cardContent;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      enabled={!isReordering && !isDragging}
      friction={2.5}
      leftThreshold={Math.round(115 * boxScale)}
      rightThreshold={Math.round(65 * boxScale)}
      overshootLeft={false}
      overshootRight={false}
      animationOptions={{
        speed: 40,
        bounciness: 0,
      }}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeableOpen}
    >
      {cardContent}
    </Swipeable>
  );
};

export const SwipeableTaskItem = React.memo(SwipeableTaskItemComponent);
SwipeableTaskItem.displayName = 'SwipeableTaskItem';

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
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
    borderWidth: 1.75,
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
  contentColumn: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingVertical: 1,
  },
  metaRowStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 3,
  },
  title: {
    flexShrink: 1,
    fontSize: 13.5,
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
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  dateBadgeLarge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dueDateText: {
    fontSize: 10.5,
    fontWeight: '500',
  },
  dueDateTextLarge: {
    fontSize: 15,
  },
  dueDateTextOverdue: {
    fontWeight: '700',
  },
  iconBadge: {
    paddingHorizontal: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metaGlyphText: {
    fontWeight: '700',
  },
  labelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
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
    fontWeight: '700',
  },
  labelTextLarge: {
    fontSize: 15,
  },
  addLabelLink: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
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
    fontSize: 10.5,
    fontWeight: '700',
  },
  addLabelLinkTextLarge: {
    fontSize: 14,
  },
  leftSwipeTray: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginLeft: 8,
    marginVertical: 1.5,
    gap: 4,
  },
  leftSwipeTrayLarge: {
    marginVertical: 3,
    gap: 6,
  },
  leftSwipeBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 7,
    paddingHorizontal: 14,
  },
  leftSwipeBtnLarge: {
    borderRadius: 10,
    paddingHorizontal: 18,
  },
  rightSwipeAction: {
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
    gap: 5,
  },
  swipeActionText: {
    fontSize: 12.5,
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
    overflow: 'hidden',
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
  },
  webActionText: {
    fontSize: 11,
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
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reorderBtnLarge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  reorderBtnDisabled: {
    opacity: 0.4,
  },
  reorderBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  reorderBtnTextLarge: {
    fontSize: 17,
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
