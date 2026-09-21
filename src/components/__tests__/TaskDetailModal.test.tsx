import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TaskDetailModal } from '../TaskDetailModal';
import { Task } from '../../types/vikunja';

describe('TaskDetailModal (CUJ 2)', () => {
  const mockTask: Task = {
    id: 10,
    title: 'Grocery Run',
    description: 'Buy organic eggs and almond milk',
    done: false,
    priority: 3, // High
    project_id: 1,
    percent_done: 25,
    color: '#0A84FF',
    repeat_after: 604800, // Weekly
    due_date: '2026-09-25T17:00:00Z',
    labels: [{ id: 1, title: 'Costco', color: 'ef4444' }],
    assignees: [{ id: 2, username: 'alex', name: 'Alex Johnson' }],
  };

  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();
  const mockOnDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all existing task details correctly', () => {
    const { getByDisplayValue, getByText } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // Title & Description
    expect(getByDisplayValue('Grocery Run')).toBeTruthy();
    expect(getByDisplayValue('Buy organic eggs and almond milk')).toBeTruthy();

    // Assignees & Labels
    expect(getByText('@alex')).toBeTruthy();
    expect(getByText('#Costco')).toBeTruthy();

    // Percent Done
    expect(getByText('25%')).toBeTruthy();
  });

  it('allows updating description and saving changes', () => {
    const { getByDisplayValue, getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    const descInput = getByDisplayValue('Buy organic eggs and almond milk');
    fireEvent.changeText(descInput, 'Updated notes: buy 2 cartons of milk');

    const saveBtn = getByTestId('task-detail-save-btn');
    fireEvent.press(saveBtn);

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        description: 'Updated notes: buy 2 cartons of milk',
      })
    );
  });

  it('allows updating priority and progress', () => {
    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // Change priority to Urgent (4)
    const priority4Btn = getByTestId('priority-option-4');
    fireEvent.press(priority4Btn);

    // Change percent done to 75%
    const progress75Btn = getByTestId('progress-option-75');
    fireEvent.press(progress75Btn);

    const saveBtn = getByTestId('task-detail-save-btn');
    fireEvent.press(saveBtn);

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        priority: 4,
        percent_done: 75,
      })
    );
  });

  it('allows removing an assignee and adding a new assignee', () => {
    const { getByTestId, getByPlaceholderText, queryByText } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // Remove existing assignee 'alex'
    const removeAlexBtn = getByTestId('remove-assignee-alex');
    fireEvent.press(removeAlexBtn);
    expect(queryByText('@alex')).toBeNull();

    // Add new assignee 'terahz'
    const assigneeInput = getByPlaceholderText('Add @user...');
    fireEvent.changeText(assigneeInput, 'terahz');
    const addAssigneeBtn = getByTestId('add-assignee-btn');
    fireEvent.press(addAssigneeBtn);

    const saveBtn = getByTestId('task-detail-save-btn');
    fireEvent.press(saveBtn);

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        assignees: [expect.objectContaining({ username: 'terahz' })],
      })
    );
  });

  it('triggers onDelete when Delete Task button is pressed', () => {
    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    const deleteBtn = getByTestId('task-detail-delete-btn');
    fireEvent.press(deleteBtn);

    expect(mockOnDelete).toHaveBeenCalledWith(10);
  });
});
