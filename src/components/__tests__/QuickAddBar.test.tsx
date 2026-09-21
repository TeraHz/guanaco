import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QuickAddBar } from '../QuickAddBar';

describe('QuickAddBar', () => {
  const mockOnAddTask = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders input field with placeholder', () => {
    const { getByPlaceholderText } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );
    expect(getByPlaceholderText('Add a task...')).toBeTruthy();
  });

  it('allows typing and submits new task when submit button is pressed', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, 'Review Vikunja pull request');

    const submitBtn = getByTestId('quick-add-submit');
    fireEvent.press(submitBtn);

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Review Vikunja pull request',
        priority: 0,
        project_id: 1,
      })
    );
  });

  it('clears input field after successful submission for rapid consecutive entry', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, 'Task 1');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(input.props.value).toBe('');
  });

  it('does not submit if task title is empty or only whitespace', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, '   ');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).not.toHaveBeenCalled();
  });

  it('allows cycling priority (None -> Low -> Medium -> High -> Urgent)', () => {
    const { getByPlaceholderText, getByTestId, getByText } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const priorityBtn = getByTestId('quick-add-priority');
    // Cycle priority
    fireEvent.press(priorityBtn); // Priority 1 (Low)
    fireEvent.press(priorityBtn); // Priority 2 (Medium)
    fireEvent.press(priorityBtn); // Priority 3 (High)

    const input = getByPlaceholderText('Add a task...');
    fireEvent.changeText(input, 'High priority bug');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'High priority bug',
        priority: 3,
        project_id: 1,
        labels: [],
        due_date: null,
      })
    );
  });

  // --- Quick Add Magic Tests ---
  it('parses Quick Add Magic labels, priority, and due dates from input text', () => {
    const { getByTestId } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Order packing supplies *logistics !3 tomorrow');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Order packing supplies',
        priority: 3,
        labels: [expect.objectContaining({ title: 'logistics' })],
        due_date: expect.any(String),
      })
    );
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

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Buy oat milk +Shopping *groceries');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Buy oat milk',
        project_id: 2,
        labels: [expect.objectContaining({ title: 'groceries' })],
      })
    );
  });

  // --- Task Suggestions & Staple Re-enabling ---
  it('suggests previously done tasks and re-enables them when tapped with reenableStaples=true', () => {
    const mockOnReenable = jest.fn();
    const doneTasks = [
      { id: 101, title: 'Organic Whole Milk', done: true, priority: 0, project_id: 1 },
      { id: 102, title: 'Paper Towels', done: true, priority: 0, project_id: 1 },
    ];

    const { getByTestId, getByText, queryByText } = render(
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

    // Should display suggested done task chip
    const suggestionChip = getByText('↩ Organic Whole Milk');
    expect(suggestionChip).toBeTruthy();

    // Tapping suggestion should call onReenableTask(101) instead of adding duplicate
    fireEvent.press(suggestionChip);
    expect(mockOnReenable).toHaveBeenCalledWith(101);
    expect(mockOnAddTask).not.toHaveBeenCalled();
    expect(input.props.value).toBe('');
  });

  // --- Label Suggestions ---
  it('suggests available labels when typing * and applies selected label to input', () => {
    const availableLabels = ['Groceries', 'Costco', 'Pharmacy'];

    const { getByTestId, getByText } = render(
      <QuickAddBar
        activeProjectId={1}
        onAddTask={mockOnAddTask}
        availableLabels={availableLabels}
      />
    );

    const input = getByTestId('quick-add-input');
    // Start typing label indicator
    fireEvent.changeText(input, 'Buy vitamins *pha');

    const labelChip = getByText('#Pharmacy');
    expect(labelChip).toBeTruthy();

    fireEvent.press(labelChip);

    // Input should now have *Pharmacy applied
    expect(input.props.value).toBe('Buy vitamins *Pharmacy ');
  });

  // --- Assignee (@user) Suggestions & Preview (CUJ 1) ---
  it('suggests users when typing @ and applies selected user to input', () => {
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

    const userChip = getByText('👤 @alex');
    expect(userChip).toBeTruthy();

    fireEvent.press(userChip);
    expect(input.props.value).toBe('Task for @alex ');
  });

  it('renders @user preview chip and passes assignees to onAddTask on submission', () => {
    const { getByTestId, getByText } = render(
      <QuickAddBar activeProjectId={1} onAddTask={mockOnAddTask} />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Design review @terahz !2');

    // Shows preview chip
    expect(getByText('@terahz')).toBeTruthy();

    const submitBtn = getByTestId('quick-add-submit');
    fireEvent.press(submitBtn);

    expect(mockOnAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Design review',
        priority: 2,
        assignees: [expect.objectContaining({ username: 'terahz' })],
      })
    );
  });
});

