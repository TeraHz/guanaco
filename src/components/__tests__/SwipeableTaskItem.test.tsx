import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SwipeableTaskItem } from '../SwipeableTaskItem';
import { Task } from '../../types/vikunja';

describe('SwipeableTaskItem', () => {
  const mockTask: Task = {
    id: 10,
    title: 'Ship Vikunja Mobile UX',
    done: false,
    priority: 3, // High
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
    jest.clearAllMocks();
  });

  it('renders task title, labels, and priority indicator correctly', () => {
    const { getByText, getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
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
  });

  it('renders label with Vikunja un-prefixed hex color and accessible text color', () => {
    const taskWithVikunjaHex: Task = {
      ...mockTask,
      labels: [
        { id: 1, title: 'Costco', hex_color: 'ff5722' }, // Without #
        { id: 2, title: 'BlackTag', hex_color: '000000' }, // Dark / black color
      ],
    };

    const { getByTestId, getByText } = render(
      <SwipeableTaskItem
        task={taskWithVikunjaHex}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const costcoPill = getByTestId('task-label-10-Costco');
    expect(costcoPill).toBeTruthy();

    const costcoText = getByText('#Costco');
    // Text color must be normalized #ff5722
    expect(costcoText.props.style).toContainEqual({ color: '#ff5722' });

    const blackTagText = getByText('#BlackTag');
    // Text color for pure black must NOT be invisible black #000000
    expect(blackTagText.props.style).not.toContainEqual({ color: '#000000' });
  });

  it('uses canonical label color from labelDefinitions when task has stale color', () => {
    const taskWithStaleColor: Task = {
      ...mockTask,
      labels: [{ id: 2, title: 'Caraluzzi', color: '3b82f6' }], // Task has stale blue
    };

    const definitions = [
      { id: 2, title: 'Caraluzzi', color: '22c55e' }, // Canonical is green
    ];

    const { getByText } = render(
      <SwipeableTaskItem
        task={taskWithStaleColor}
        labelDefinitions={definitions}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const caraluzziText = getByText('#Caraluzzi');
    // Must be canonical green (#22c55e), NOT stale blue (#3b82f6)
    expect(caraluzziText.props.style).toContainEqual({ color: '#22c55e' });
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

    const labelChip = getByTestId('task-label-10-Costco');
    fireEvent.press(labelChip);

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

    const checkbox = getByTestId(`task-checkbox-${mockTask.id}`);
    fireEvent.press(checkbox);

    expect(mockOnToggle).toHaveBeenCalledWith(mockTask.id);
  });

  it('renders completed tasks with strike-through styling indicator', () => {
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

    const titleText = getByTestId(`task-title-${completedTask.id}`);
    expect(titleText.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ textDecorationLine: 'line-through' })])
    );
  });

  it('renders completed tasks with distinct card and legible text in light theme', () => {
    jest.spyOn(require('react-native'), 'useColorScheme').mockReturnValue('light');
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
    expect(card.props.style).toEqual(
      expect.objectContaining({
        backgroundColor: '#FFFFFF',
      })
    );
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

    const body = getByTestId(`task-item-${mockTask.id}`);
    fireEvent.press(body);

    expect(mockOnPress).toHaveBeenCalledWith(mockTask);
  });

  it('calls onMove when Move action button is pressed', () => {
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const moveBtn = getByTestId(`task-move-action-${mockTask.id}`);
    fireEvent.press(moveBtn);

    expect(mockOnMove).toHaveBeenCalledWith(mockTask.id);
  });

  it('calls onDelete when Delete action button is pressed', () => {
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    const deleteBtn = getByTestId(`task-delete-action-${mockTask.id}`);
    fireEvent.press(deleteBtn);

    expect(mockOnDelete).toHaveBeenCalledWith(mockTask.id);
  });

  it('calls onEditLabels when + link is pressed and does not render tag icon', () => {
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

    const editLabelsBtn = getByTestId(`task-edit-labels-${mockTask.id}`);
    expect(getByText('+#')).toBeTruthy();
    expect(queryByText(/🏷️/)).toBeNull();

    fireEvent.press(editLabelsBtn);
    expect(mockOnEditLabels).toHaveBeenCalledWith(mockTask);
  });

  // --- Regression Test: Issue 4 (Web platform safety) ---
  it('renders safely without crashing when Platform.OS is web (Regression #4)', () => {
    const originalOS = require('react-native').Platform.OS;
    try {
      require('react-native').Platform.OS = 'web';
      const { getByText } = render(
        <SwipeableTaskItem
          task={mockTask}
          onToggle={mockOnToggle}
          onMove={mockOnMove}
          onDelete={mockOnDelete}
          onPress={mockOnPress}
        />
      );
      expect(getByText('Ship Vikunja Mobile UX')).toBeTruthy();
    } finally {
      require('react-native').Platform.OS = originalOS;
    }
  });

  // --- Assignee and Progress Display (CUJ 1 & 2) ---
  it('renders assignee badge when task has assignees', () => {
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

  it('renders progress bar indicator when task has percent_done > 0', () => {
    const taskWithProgress: Task = {
      ...mockTask,
      percent_done: 60,
    };

    const { getByTestId, getByText } = render(
      <SwipeableTaskItem
        task={taskWithProgress}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
      />
    );

    expect(getByTestId(`task-progress-${mockTask.id}`)).toBeTruthy();
    expect(getByText('60%')).toBeTruthy();
  });

  // --- Swipe Gesture Sensitivity & Safety (Wife's Feedback) ---
  it('configures Swipeable with high friction and safe thresholds to avoid accidental triggers during vertical scroll', () => {
    const { Swipeable } = require('react-native-gesture-handler');
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
    expect(swipeableInstance.props.friction).toBeGreaterThanOrEqual(2);
    expect(swipeableInstance.props.leftThreshold).toBeGreaterThanOrEqual(60);
    expect(swipeableInstance.props.rightThreshold).toBeGreaterThanOrEqual(100);
    expect(swipeableInstance.props.rightThreshold).toBeGreaterThan(swipeableInstance.props.leftThreshold);
  });

  // --- Reordering & Long Press ---
  it('calls onLongPress when user presses and holds task', () => {
    const mockOnLongPress = jest.fn();
    const { getByTestId } = render(
      <SwipeableTaskItem
        task={mockTask}
        onToggle={mockOnToggle}
        onMove={mockOnMove}
        onDelete={mockOnDelete}
        onPress={mockOnPress}
        onLongPress={mockOnLongPress}
      />
    );

    fireEvent(getByTestId(`task-item-${mockTask.id}`), 'longPress');
    expect(mockOnLongPress).toHaveBeenCalledWith(mockTask);
  });

  it('renders reorder controls when isReordering is true and handles up/down actions', () => {
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

    const upBtn = getByTestId(`move-up-task-${mockTask.id}`);
    const downBtn = getByTestId(`move-down-task-${mockTask.id}`);

    expect(upBtn).toBeTruthy();
    expect(downBtn).toBeTruthy();

    fireEvent.press(upBtn);
    expect(mockOnMoveUp).toHaveBeenCalledTimes(1);

    fireEvent.press(downBtn);
    expect(mockOnMoveDown).toHaveBeenCalledTimes(1);
  });
});

