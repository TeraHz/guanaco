import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SwipeableTaskItem } from '../SwipeableTaskItem';
import { useTaskStore } from '../../store/taskStore';
import { Task, RepeatMode } from '../../types/vikunja';

describe('SwipeableTaskItem', () => {
  const initialStoreState = useTaskStore.getState();
  const originalOS = ReactNative.Platform.OS;

  const mockTask: Task = {
    id: 10,
    title: 'Ship Vikunja Mobile UX',
    done: false,
    priority: 3, // High (#FF3B30)
    project_id: 1,
    due_date: '2026-09-20T12:00:00Z',
    labels: [
      { id: 1, title: 'Costco', hex_color: '#E02424' },
      { id: 2, title: 'Produce', hex_color: '#057A55' },
    ],
  };

  const mockOnToggle = jest.fn();
  const mockOnMove = jest.fn();
  const mockOnDelete = jest.fn();
  const mockOnPress = jest.fn();
  const mockOnSelectLabel = jest.fn();

  beforeEach(() => {
    ReactNative.Platform.OS = originalOS;
    useTaskStore.setState(initialStoreState, true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    ReactNative.Platform.OS = originalOS;
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  it('renders task title, labels, accessible checkbox, and priority indicator ignoring default "000000" task.color', () => {
    const taskWithBlackDefault: Task = {
      ...mockTask,
      color: '000000',
    };

    const { getByText, getByTestId } = render(
      <SwipeableTaskItem
        task={taskWithBlackDefault}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        onSelectLabel={mockOnSelectLabel}
      />
    );

    const title = getByText('Ship Vikunja Mobile UX');
    expect(title).toBeTruthy();
    expect(title.props.numberOfLines).toBe(1);
    expect(getByTestId('task-label-10-Costco')).toBeTruthy();
    expect(getByTestId('task-label-10-Produce')).toBeTruthy();

    const strip = getByTestId('task-priority-strip-10');
    const flatStrip = ReactNative.StyleSheet.flatten(strip.props.style);
    expect(flatStrip.backgroundColor).toBe('#D70015');

    const checkbox = getByTestId('task-checkbox-10');
    expect(checkbox.props.accessibilityRole).toBe('checkbox');
    expect(checkbox.props.accessibilityState).toEqual({ checked: false });
    const flatCheckbox = ReactNative.StyleSheet.flatten(checkbox.props.style);
    expect(flatCheckbox.borderColor).toBe('#71717A');
    expect(flatCheckbox.borderWidth).toBe(1.75);
  });

  it('uses night-legible checkboxBorder (#A1A1AA) with 1.75px width and subtle inner contrast on unchecked checkbox in Dark Mode', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );
    const darkCheckbox = ReactNative.StyleSheet.flatten(
      getByTestId('task-checkbox-10').props.style
    );
    expect(darkCheckbox.borderColor).toBe('#A1A1AA');
    expect(darkCheckbox.borderWidth).toBe(1.75);
    expect(darkCheckbox.backgroundColor).toBe('rgba(255, 255, 255, 0.03)');
  });

  it('reads inbound Vikunja task.hex_color when task.color is undefined and ignores unset "000000" hex_color', () => {
    const inboundHexTask: Task = {
      ...mockTask,
      priority: 0,
      color: undefined,
      hex_color: '0A84FF',
      percent_done: Number.NaN,
    };

    const { getByTestId, queryByTestId, rerender } = render(
      <SwipeableTaskItem
        task={inboundHexTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const strip = getByTestId('task-priority-strip-10');
    expect(ReactNative.StyleSheet.flatten(strip.props.style).backgroundColor).toBe('#0A84FF');
    expect(queryByTestId('task-progress-10')).toBeNull();

    // Unset "000000" hex_color with priority 0 hides the strip cleanly
    rerender(
      <SwipeableTaskItem
        task={{ ...inboundHexTask, hex_color: '000000' }}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );
    expect(queryByTestId('task-priority-strip-10')).toBeNull();
  });

  it('renders custom non-black task color strip even when priority is 0 and shows repeat icon for RepeatMode.Monthly with repeat_after=0', () => {
    const coloredMonthlyTask: Task = {
      ...mockTask,
      priority: 0,
      color: '30D158',
      repeat_after: 0,
      repeat_mode: RepeatMode.Monthly,
    };

    const { getByTestId } = render(
      <SwipeableTaskItem
        task={coloredMonthlyTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const strip = getByTestId('task-priority-strip-10');
    const flatStrip = Object.assign({}, ...strip.props.style.filter(Boolean));
    expect(flatStrip.backgroundColor).toBe('#30D158');
    expect(getByTestId('task-repeat-icon-10')).toBeTruthy();
  });

  it('ignores non-UTC 0001-01-01 zero-dates so unscheduled tasks never display Jan 1 overdue', () => {
    const zeroDateTask: Task = {
      ...mockTask,
      due_date: '0001-01-01T01:00:00+01:00',
    };

    const { queryByTestId, queryByText } = render(
      <SwipeableTaskItem
        task={zeroDateTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    expect(queryByTestId('task-due-badge-10')).toBeNull();
    expect(queryByText(/Jan 1/)).toBeNull();
  });

  it('renders label with Vikunja un-prefixed hex color and canonical definitions', () => {
    const taskWithVikunjaHex: Task = {
      ...mockTask,
      labels: [
        { id: 1, title: 'Costco', hex_color: 'ff5722' },
        { id: 2, title: 'BlackTag', hex_color: '000000' },
        { id: 3, title: 'Caraluzzi', color: '3b82f6' },
      ],
    };

    const definitions = [{ id: 3, title: 'Caraluzzi', color: '22c55e' }];

    const { getByText } = render(
      <SwipeableTaskItem
        task={taskWithVikunjaHex}
        labelDefinitions={definitions}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    expect(getByText('#Costco').props.style).toContainEqual({ color: '#ff5722' });
    expect(getByText('#BlackTag').props.style).not.toContainEqual({ color: '#000000' });
    expect(getByText('#Caraluzzi').props.style).toContainEqual({ color: '#22c55e' });
  });

  it('renders completed tasks with strike-through and legible Light Mode card (without leaking spy)', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    const completedTask: Task = { ...mockTask, done: true };

    const { getByTestId } = render(
      <SwipeableTaskItem
        task={completedTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const card = getByTestId(`task-item-${completedTask.id}`);
    const flatCard = Array.isArray(card.props.style)
      ? Object.assign({}, ...card.props.style.filter(Boolean))
      : card.props.style;
    expect(flatCard.backgroundColor).toBe('#FFFFFF');

    const checkbox = getByTestId(`task-checkbox-${completedTask.id}`);
    expect(checkbox.props.accessibilityState).toEqual({ checked: true });
  });

  it('hides native 0x0 test hooks from screen readers while supporting includeHiddenElements automation', () => {
    const { queryByTestId, getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    // Invisible to accessible tree (VoiceOver / TalkBack)
    expect(queryByTestId('task-move-action-10')).toBeNull();
    expect(queryByTestId('task-delete-action-10')).toBeNull();

    // Functional when explicitly targeting hidden automation hooks
    fireEvent.press(getByTestId('task-move-action-10', { includeHiddenElements: true }));
    expect(mockOnMove).toHaveBeenCalledWith(10);

    fireEvent.press(getByTestId('task-delete-action-10', { includeHiddenElements: true }));
    expect(mockOnDelete).toHaveBeenCalledWith(10);
  });

  it('renders visible accessible Move and Delete buttons on Web platform', () => {
    ReactNative.Platform.OS = 'web';
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    fireEvent.press(getByTestId('task-move-action-10'));
    expect(mockOnMove).toHaveBeenCalledWith(10);

    fireEvent.press(getByTestId('task-delete-action-10'));
    expect(mockOnDelete).toHaveBeenCalledWith(10);
  });

  it('configures Swipeable with onSwipeableOpen only, keeps it mounted during reorder, and exposes Move + Delete in renderLeftActions', () => {
    const { UNSAFE_getByType, rerender } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const swipeableInstance = UNSAFE_getByType(Swipeable);
    expect(swipeableInstance.props.friction).toBeGreaterThanOrEqual(2);
    expect(swipeableInstance.props.leftThreshold).toBeGreaterThanOrEqual(100);
    expect(swipeableInstance.props.rightThreshold).toBeGreaterThanOrEqual(50);
    expect(swipeableInstance.props.onSwipeableWillOpen).toBeUndefined();
    expect(typeof swipeableInstance.props.onSwipeableOpen).toBe('function');
    expect(swipeableInstance.props.enabled).toBe(true);

    // Entering reorder mode disables Swipeable WITHOUT unmounting it mid-gesture!
    rerender(
      <SwipeableTaskItem
        task={mockTask}
        isReordering={true}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );
    expect(UNSAFE_getByType(Swipeable).props.enabled).toBe(false);
  });

  it('renders tappable Move and Delete buttons inside renderLeftActions tray', () => {
    const { UNSAFE_getByType } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const swipeableInstance = UNSAFE_getByType(Swipeable);
    const fakeAnim = { interpolate: () => 1 } as any;
    const leftTrayElement = swipeableInstance.props.renderLeftActions(fakeAnim, fakeAnim);
    const children = React.Children.toArray(leftTrayElement.props.children) as React.ReactElement[];

    const moveBtnEl = children.find((el: any) => el.props?.testID === 'swipe-move-btn-10') as any;
    const deleteBtnEl = children.find(
      (el: any) => el.props?.testID === 'swipe-delete-btn-10'
    ) as any;

    expect(moveBtnEl).toBeTruthy();
    expect(deleteBtnEl).toBeTruthy();

    moveBtnEl.props.onPress();
    expect(mockOnMove).toHaveBeenCalledWith(10);

    deleteBtnEl.props.onPress();
    expect(mockOnDelete).toHaveBeenCalledWith(10);
  });

  it('does NOT call drag() twice when onLongPress is provided', () => {
    const mockDrag = jest.fn();
    const mockOnLongPress = jest.fn();

    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        drag={mockDrag}
        onLongPress={mockOnLongPress}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    fireEvent(getByTestId('task-item-10'), 'longPress');
    expect(mockOnLongPress).toHaveBeenCalledTimes(1);
    expect(mockDrag).not.toHaveBeenCalled();
  });

  it('supports independent box scale (150%) and text scale (100%) and [0..1] percent_done display', () => {
    const taskWithFloatPct: Task = {
      ...mockTask,
      percent_done: 0.6,
    };

    const { getByTestId, getByText } = render(
      <SwipeableTaskItem
        task={taskWithFloatPct}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        scale={150}
        textScale={100}
      />
    );

    expect(getByText('60%')).toBeTruthy();

    const card = getByTestId('task-item-10');
    const checkbox = getByTestId('task-checkbox-10');
    const title = getByTestId('task-title-10');

    const flatCard = ReactNative.StyleSheet.flatten(card.props.style);
    const flatCheckbox = ReactNative.StyleSheet.flatten(checkbox.props.style);
    const flatTitle = ReactNative.StyleSheet.flatten(title.props.style);

    expect(flatCard.minHeight).toBe(52);
    expect(flatCheckbox.width).toBe(28);
    expect(flatTitle.fontSize).toBe(13.5);
  });

  it('calls onSelectLabel when a label chip is tapped', () => {
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        onSelectLabel={mockOnSelectLabel}
      />
    );

    fireEvent.press(getByTestId('task-label-10-Costco'));
    expect(mockOnSelectLabel).toHaveBeenCalledWith('Costco');
  });

  it('calls onToggle when checkbox is pressed', () => {
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    fireEvent.press(getByTestId(`task-checkbox-${mockTask.id}`));
    expect(mockOnToggle).toHaveBeenCalledWith(mockTask.id);
  });

  it('calls onPress when task body is tapped', () => {
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    fireEvent.press(getByTestId(`task-item-${mockTask.id}`));
    expect(mockOnPress).toHaveBeenCalledWith(mockTask);
  });

  it('calls onEditLabels when +# link is pressed and does not render tag icon', () => {
    const mockOnEditLabels = jest.fn();
    const { getByTestId, getByText, queryByText } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        onEditLabels={mockOnEditLabels}
      />
    );

    expect(getByText('+#')).toBeTruthy();
    expect(queryByText(/🏷️/)).toBeNull();

    fireEvent.press(getByTestId(`task-edit-labels-${mockTask.id}`));
    expect(mockOnEditLabels).toHaveBeenCalledWith(mockTask);
  });

  it('renders @username assignee badge when task has assignees', () => {
    const taskWithAssignee: Task = {
      ...mockTask,
      assignees: [{ id: 5, username: 'terahz', name: 'Georgi' }],
    };

    const { getByTestId, getByText } = render(
      <SwipeableTaskItem
        task={taskWithAssignee}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    expect(getByTestId(`task-assignee-${mockTask.id}-terahz`)).toBeTruthy();
    expect(getByText('@terahz')).toBeTruthy();
  });

  it('renders reorder controls (▲ and ▼) when isReordering is true and handles up/down actions', () => {
    const mockOnMoveUp = jest.fn();
    const mockOnMoveDown = jest.fn();

    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        isReordering={true}
        onMoveUp={mockOnMoveUp}
        onMoveDown={mockOnMoveDown}
        canMoveUp={true}
        canMoveDown={true}
      />
    );

    fireEvent.press(getByTestId(`move-up-task-${mockTask.id}`));
    expect(mockOnMoveUp).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId(`move-down-task-${mockTask.id}`));
    expect(mockOnMoveDown).toHaveBeenCalledTimes(1);
  });

  it('renders with 50% larger dimensions and font sizes when isLarge is true', () => {
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        isLarge={true}
      />
    );

    expect(ReactNative.StyleSheet.flatten(getByTestId('task-item-10').props.style).minHeight).toBe(52);
    expect(ReactNative.StyleSheet.flatten(getByTestId('task-checkbox-10').props.style).width).toBe(28);
    expect(ReactNative.StyleSheet.flatten(getByTestId('task-title-10').props.style).fontSize).toBe(20);
  });

  it('renders long task titles (>26 chars) with numberOfLines={3} to prevent aggressive truncation', () => {
    const longTask: Task = {
      ...mockTask,
      id: 99,
      title: 'Schedule quarterly dental checkup and purchase supplies for the office',
    };

    const { getByTestId } = render(
      <SwipeableTaskItem
        task={longTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    expect(getByTestId('task-title-99').props.numberOfLines).toBe(3);
  });

  it('renders completed tasks with strike-through, lifted night-mode secondary text (#A1A1AA), zero opacity stacking, and #30D158 green checkbox', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
    const completedTask: Task = { ...mockTask, done: true };
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={completedTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const cardStyle = ReactNative.StyleSheet.flatten(
      getByTestId(`task-item-${completedTask.id}`).props.style
    );
    expect(cardStyle.opacity).toBe(1);

    const titleText = getByTestId(`task-title-${completedTask.id}`);
    const flatTitle = ReactNative.StyleSheet.flatten(titleText.props.style);
    expect(flatTitle.textDecorationLine).toBe('line-through');
    expect(flatTitle.color).toBe('#A1A1AA');

    const doneCheckbox = ReactNative.StyleSheet.flatten(
      getByTestId(`task-checkbox-${completedTask.id}`).props.style
    );
    expect(doneCheckbox.backgroundColor).toBe('#30D158');
  });

  it('renders progress indicator badge when task has legacy >1 integer percent_done', () => {
    const legacyProgressTask: Task = { ...mockTask, percent_done: 60 };
    const { getByTestId, getByText } = render(
      <SwipeableTaskItem
        task={legacyProgressTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    expect(getByTestId(`task-progress-${mockTask.id}`)).toBeTruthy();
    expect(getByText('60%')).toBeTruthy();
  });

  it('renders subtask completion badge (1/2) and parent context indicator when related_tasks exist', () => {
    const parentTask: Task = {
      ...mockTask,
      id: 50,
      related_tasks: {
        subtask: [
          { id: 51, title: 'Step 1', done: true, priority: 0, project_id: 1 },
          { id: 52, title: 'Step 2', done: false, priority: 0, project_id: 1 },
        ],
      },
    };
    const { getByTestId, getByText, rerender } = render(
      <SwipeableTaskItem
        task={parentTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );
    expect(getByTestId('task-subtask-badge-50')).toBeTruthy();
    expect(getByText('☑ 1/2')).toBeTruthy();

    const childTask: Task = {
      ...mockTask,
      id: 52,
      title: 'Step 2',
      related_tasks: {
        parenttask: [{ id: 50, title: 'Launch Prep', done: false, priority: 1, project_id: 1 }],
      },
    };
    rerender(
      <SwipeableTaskItem
        task={childTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );
    expect(getByTestId('task-parent-badge-52')).toBeTruthy();
    expect(getByText('↳ Launch Prep')).toBeTruthy();
  });

  it('stacks metadata beneath short titles when 4+ badges are present so the title is never squashed', () => {
    const badgeRichTask: Task = {
      ...mockTask,
      id: 60,
      title: 'Fix leaky kitchen faucet',
      percent_done: 0.75,
      assignees: [{ id: 1, username: 'alex' }],
    };
    const { getByText } = render(
      <SwipeableTaskItem
        task={badgeRichTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );
    expect(getByText('Fix leaky kitchen faucet').props.numberOfLines).toBe(3);
  });
});
