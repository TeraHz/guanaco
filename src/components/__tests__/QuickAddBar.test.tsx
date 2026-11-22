import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { QuickAddBar } from '../QuickAddBar';
import { RepeatMode } from '../../types/vikunja';

describe('QuickAddBar', () => {
  const mockOnAddTask = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('renders input field with placeholder and submits new task', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, 'Review Vikunja pull request');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Review Vikunja pull request',
        priority: 0,
        project_id: 1,
      })
    );
    expect(input.props.value).toBe('');
  });

  it('does not submit if task title is empty, whitespace, or empty quotes ""', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, '   ');
    fireEvent.press(getByTestId('quick-add-submit'));
    expect(mockOnAddTask).not.toHaveBeenCalled();

    // Quoted empty string '""' or '"   "' or tag-only '#Costco' must disable submit and not create blank task
    fireEvent.changeText(input, '""');
    expect(getByTestId('quick-add-submit').props.accessibilityState?.disabled ?? getByTestId('quick-add-submit').props.disabled).toBeTruthy();
    fireEvent(input, 'submitEditing');
    expect(mockOnAddTask).not.toHaveBeenCalled();

    fireEvent.changeText(input, '"   "');
    fireEvent(input, 'submitEditing');
    expect(mockOnAddTask).not.toHaveBeenCalled();
  });

  it('cycles priority across ALL 6 levels (0 None -> 1 Low -> 2 Medium -> 3 High -> 4 Urgent -> 5 Critical -> 0)', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const priorityBtn = getByTestId('quick-add-priority');
    fireEvent.press(priorityBtn); // 1 Low
    fireEvent.press(priorityBtn); // 2 Medium
    fireEvent.press(priorityBtn); // 3 High
    fireEvent.press(priorityBtn); // 4 Urgent
    fireEvent.press(priorityBtn); // 5 Critical (!!!!!)

    expect(priorityBtn.props.accessibilityLabel).toContain('Critical');

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, 'Production outage');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Production outage',
        priority: 5,
      })
    );

    // Next press after 5 wraps back to 0 (after submit already reset to 0, cycle 6 times -> 0)
    for (let i = 0; i < 6; i++) {
      fireEvent.press(priorityBtn);
    }
    expect(priorityBtn.props.accessibilityLabel).toContain('None');
  });

  it('parses #label, *label, !high, every month (RepeatMode.Monthly), and renders live repeat magic badge', () => {
    const { getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Pay rent #bills !high tomorrow every month');

    // Live repeat magic preview badge must render!
    expect(getByTestId('magic-repeat-badge')).toBeTruthy();
    expect(getByTestId('magic-date-badge')).toBeTruthy();
    expect(getByTestId('magic-priority-badge')).toBeTruthy();

    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Pay rent',
        priority: 3,
        labels: [expect.objectContaining({ title: 'bills' })],
        due_date: expect.any(String),
        repeat_after: 2592000,
        repeat_mode: RepeatMode.Monthly,
      })
    );
  });

  it('themes magic badges for high contrast in Light Mode', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');

    const { getByTestId, getByText } = render(
      <QuickAddBar
        activeProjectId={1}
        availableProjects={[
          { id: 1, title: 'Inbox' },
          { id: 2, title: 'Shopping' },
        ]}
        onAddTask={mockOnAddTask}
      />
    );

    fireEvent.changeText(
      getByTestId('quick-add-input'),
      'Buy apples +Shopping #produce @alex !2 every week'
    );

    const labelText = getByText('#produce');
    const flatLabelStyle = Array.isArray(labelText.props.style)
      ? Object.assign({}, ...labelText.props.style.filter(Boolean))
      : labelText.props.style;
    expect(flatLabelStyle.color).toBe('#15803D');
  });

  it('routes task to target project when +Project magic syntax is used', () => {
    const mockProjects = [
      { id: 1, title: 'Inbox' },
      { id: 2, title: 'Shopping' },
    ];

    const { getByTestId } = render(
      <QuickAddBar
        activeProjectId={1}
        availableProjects={mockProjects}
        onAddTask={mockOnAddTask}
      />
    );

    fireEvent.changeText(getByTestId('quick-add-input'), 'Buy oat milk +Shopping *groceries');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Buy oat milk',
        project_id: 2,
        labels: [expect.objectContaining({ title: 'groceries' })],
      })
    );
  });

  it('suggests previously done tasks and re-enables them when tapped with reenableStaples=true', () => {
    const mockOnReenable = jest.fn();
    const doneTasks = [
      { id: 101, title: 'Organic Whole Milk', done: true, priority: 0, project_id: 1 },
      { id: 102, title: 'Paper Towels', done: true, priority: 0, project_id: 1 },
    ];

    const { getByTestId, getByText } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        doneTasks={doneTasks}
        reenableStaples={true}
        onReenableTask={mockOnReenable}
      />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'milk');

    const suggestionChip = getByText('↩ Organic Whole Milk');
    fireEvent.press(suggestionChip);

    expect(mockOnReenable).toHaveBeenCalledWith(101);
    expect(mockOnAddTask).not.toHaveBeenCalled();
    expect(input.props.value).toBe('');
  });

  it('suggests available labels when typing * or # and applies selected label to input', () => {
    const availableLabels = ['Groceries', 'Costco', 'Pharmacy'];

    const { getByTestId, getByText } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        availableLabels={availableLabels}
      />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Buy vitamins *pha');

    fireEvent.press(getByText('#Pharmacy'));
    expect(input.props.value).toBe('Buy vitamins *Pharmacy ');
  });

  it('suggests users when typing @ and passes assignees on submission', () => {
    const availableUsers = [
      { id: 1, username: 'terahz', name: 'Georgi Todorov' },
      { id: 2, username: 'alex', name: 'Alex Johnson' },
    ];

    const { getByTestId, getByText } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        availableUsers={availableUsers}
      />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Task for @al');

    fireEvent.press(getByText('👤 @alex'));
    expect(input.props.value).toBe('Task for @alex ');

    fireEvent.press(getByTestId('quick-add-submit'));
    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Task for',
        assignees: [expect.objectContaining({ id: 2, username: 'alex' })],
      })
    );
  });

  it('suggests historical store label and invokes onDetailedAdd when green (+) button is pressed', () => {
    const mockOnDetailedAdd = jest.fn();
    const historyTasks = [
      {
        id: 1,
        title: 'Ground beef',
        done: true,
        priority: 0,
        project_id: 1,
        labels: [{ id: 1, title: 'Costco' }],
      },
      {
        id: 2,
        title: 'Beef steaks',
        done: true,
        priority: 0,
        project_id: 1,
        labels: [{ id: 1, title: 'Costco' }],
      },
    ];

    const { getByTestId } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        historyTasks={historyTasks as any}
        availableLabels={['Costco', 'TraderJoes']}
        onDetailedAdd={mockOnDetailedAdd}
      />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Beef for stew');

    const storeChip = getByTestId('store-suggestion-chip');
    fireEvent.press(storeChip);
    expect(input.props.value).toContain('*Costco');

    fireEvent.press(getByTestId('green-add-task-fab'));
    expect(mockOnDetailedAdd).toHaveBeenCalledTimes(1);
  });

  it('quotes historical store label chips containing magic delimiters (+, !, #, *, @)', () => {
    const historyTasks = [
      {
        id: 1,
        title: 'Ground beef',
        done: true,
        priority: 0,
        project_id: 1,
        labels: [{ id: 1, title: 'Stop+Shop!Fresh' }],
      },
      {
        id: 2,
        title: 'Beef steaks',
        done: true,
        priority: 0,
        project_id: 1,
        labels: [{ id: 1, title: 'Stop+Shop!Fresh' }],
      },
    ];

    const { getByTestId } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        historyTasks={historyTasks as any}
        availableLabels={['Stop+Shop!Fresh']}
      />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Beef for stew');

    fireEvent.press(getByTestId('store-suggestion-chip'));
    expect(input.props.value).toBe('Beef for stew *"Stop+Shop!Fresh" ');

    fireEvent.press(getByTestId('quick-add-submit'));
    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Beef for stew',
        labels: [expect.objectContaining({ title: 'Stop+Shop!Fresh' })],
      })
    );
  });

  it('clears input field AND resets manual priority back to None after successful submission', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const priorityBtn = getByTestId('quick-add-priority');
    fireEvent.press(priorityBtn); // Low (1)
    fireEvent.press(priorityBtn); // Medium (2)
    expect(priorityBtn.props.accessibilityLabel).toContain('Medium');

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, 'First rapid task');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(input.props.value).toBe('');
    expect(priorityBtn.props.accessibilityLabel).toContain('None');
  });

  it('renders @user magic preview chip while typing and passes assignees on submission', () => {
    const { getByTestId, getByText } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Design review @terahz !2');

    expect(getByText('@terahz')).toBeTruthy();
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Design review',
        priority: 2,
        assignees: [expect.objectContaining({ username: 'terahz' })],
      })
    );
  });

  it('prioritizes lastUsedLabel first in label suggestions on subsequent tasks', () => {
    const { getByTestId, getAllByText } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        availableLabels={['Alpha', 'Bravo', 'Costco']}
      />
    );

    const input = getByTestId('quick-add-input');
    // Submit a task using *Costco so Costco becomes lastUsedLabel
    fireEvent.changeText(input, 'Milk *Costco');
    fireEvent.press(getByTestId('quick-add-submit'));

    // Next task: typing bare `*` lists #Costco FIRST ahead of #Alpha and #Bravo!
    fireEvent.changeText(input, 'Bread *');
    const chips = getAllByText(/^#/).map((el) => el.props.children);
    expect(chips[0]).toEqual(['#', 'Costco']);
  });

  it('renders label suggestion without emoji tag icon', () => {
    const { getByTestId, getByText, queryByText } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        availableLabels={['Costco', 'Dairy']}
      />
    );

    fireEvent.changeText(getByTestId('quick-add-input'), 'Shopping *');
    expect(getByText('#Costco')).toBeTruthy();
    expect(queryByText(/🏷️/)).toBeNull();
  });
});
