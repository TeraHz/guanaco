import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import {
  TaskDetailModal,
  percentDoneToUiScale,
  uiScaleToPercentDone,
} from '../TaskDetailModal';
import { Task } from '../../types/vikunja';

describe('TaskDetailModal (CUJ 2)', () => {
  const originalOS = Platform.OS;

  const mockTask: Task = {
    id: 10,
    title: 'Grocery Run',
    description: 'Buy organic eggs and almond milk',
    done: false,
    priority: 3, // High
    project_id: 1,
    percent_done: 0.25, // Vikunja [0..1] float scale
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
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  afterEach(() => {
    Platform.OS = originalOS;
    cleanup();
    jest.restoreAllMocks();
  });

  it('converts percent_done accurately between Vikunja [0..1] floats, legacy >1 integers, and UI [0..100]', () => {
    expect(percentDoneToUiScale(0)).toBe(0);
    expect(percentDoneToUiScale(0.01)).toBe(1);
    expect(percentDoneToUiScale(0.25)).toBe(25);
    expect(percentDoneToUiScale(1)).toBe(100);
    expect(percentDoneToUiScale(1.0)).toBe(100);
    expect(percentDoneToUiScale(25)).toBe(25);
    expect(percentDoneToUiScale(100)).toBe(100);
    expect(percentDoneToUiScale(Number.NaN)).toBe(0);

    expect(uiScaleToPercentDone(0)).toBe(0);
    expect(uiScaleToPercentDone(25)).toBe(0.25);
    expect(uiScaleToPercentDone(75)).toBe(0.75);
    expect(uiScaleToPercentDone(100)).toBe(1);
    expect(uiScaleToPercentDone(Number.NaN)).toBe(0);
  });

  it('reads inbound task.hex_color, updates hex_color + color on change, and clears color/description on save', () => {
    const inboundTask: Task = {
      ...mockTask,
      color: undefined,
      hex_color: '0A84FF',
    };

    const { getByTestId, rerender } = render(
      <TaskDetailModal
        visible={true}
        task={inboundTask}
        availableProjects={[{ id: 1, title: 'Uncolored List', hex_color: '000000' }]}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // Inbound hex_color '0A84FF' pre-selects #0A84FF swatch
    expect(getByTestId('task-color-#0A84FF').props.accessibilityState).toEqual({ selected: true });

    // Switch color to #30D158 and toggle done -> saves both color & hex_color + done_at
    fireEvent.press(getByTestId('task-color-#30D158'));
    fireEvent.press(getByTestId('task-detail-done-toggle'));
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        color: '#30D158',
        hex_color: '#30D158',
        done: true,
        done_at: expect.any(String),
      })
    );

    // Reopen, select "None" color and clear description -> sends empty string "" to clear both on Vikunja
    mockOnSave.mockClear();
    rerender(
      <TaskDetailModal
        visible={false}
        task={inboundTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );
    rerender(
      <TaskDetailModal
        visible={true}
        task={inboundTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('task-color-none'));
    fireEvent.changeText(getByTestId('task-detail-description-input'), '   ');
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        color: '',
        hex_color: '',
        description: '',
      })
    );
  });

  it('renders all existing task details, night-legible checkbox border, and accent blue Add buttons', () => {
    const { getByDisplayValue, getByText, getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    expect(getByDisplayValue('Grocery Run')).toBeTruthy();
    expect(getByDisplayValue('Buy organic eggs and almond milk')).toBeTruthy();
    expect(getByText('@alex')).toBeTruthy();
    expect(getByText('#Costco')).toBeTruthy();
    expect(getByTestId('task-detail-progress-display').props.children).toBe('25%');

    const { StyleSheet } = require('react-native');
    const checkbox = getByTestId('task-detail-done-toggle');
    expect(checkbox.props.accessibilityRole).toBe('checkbox');
    expect(checkbox.props.accessibilityState).toEqual({ checked: false });
    const checkboxStyle = StyleSheet.flatten(checkbox.props.style);
    expect(checkboxStyle.borderWidth).toBe(1.75);
    expect(['#A1A1AA', '#71717A']).toContain(checkboxStyle.borderColor);

    // Both Add Assignee and Add Label buttons use accent blue (never #30D158 green)
    const addAssigneeStyle = StyleSheet.flatten(getByTestId('add-assignee-btn').props.style);
    const addLabelStyle = StyleSheet.flatten(getByTestId('add-label-btn').props.style);
    expect(addLabelStyle.backgroundColor).toBe(addAssigneeStyle.backgroundColor);
  });

  it('updates priority and converts UI percentDone (75%) back to Vikunja [0..1] float (0.75) on save', () => {
    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('priority-option-4'));
    fireEvent.press(getByTestId('progress-option-75'));
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        priority: 4,
        percent_done: 0.75,
      })
    );
  });

  it('adds suggested assignee cleanly on chip tap (no stale input closure) and auto-commits typed label/assignee on Save', () => {
    const availableUsers = [
      { id: 2, username: 'alex', name: 'Alex Johnson' },
      { id: 7, username: 'terahz', name: 'Georgi Todorov' },
      { id: 8, username: 'taylor', name: 'Taylor Swift' },
    ];

    const { getByTestId, getByPlaceholderText, getByText } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        availableUsers={availableUsers}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // Type partial "@te" -> tap suggestion chip for "terahz" -> must add real user "terahz" (id: 7), NOT "@te"!
    const assigneeInput = getByPlaceholderText('Add @user...');
    fireEvent.changeText(assigneeInput, 'te');
    fireEvent.press(getByTestId('assignee-suggestion-terahz'));
    expect(getByText('@terahz')).toBeTruthy();

    // Now type "@taylor" and "#Organic" WITHOUT pressing inline Add buttons, then tap Save directly!
    fireEvent.changeText(assigneeInput, '@taylor');
    fireEvent.changeText(getByPlaceholderText('Add #label...'), '#Organic');
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        assignees: expect.arrayContaining([
          expect.objectContaining({ id: 2, username: 'alex' }),
          expect.objectContaining({ id: 7, username: 'terahz' }),
          expect.objectContaining({ id: 8, username: 'taylor' }),
        ]),
        labels: expect.arrayContaining([
          expect.objectContaining({ title: 'Costco' }),
          expect.objectContaining({ title: 'Organic' }),
        ]),
      })
    );
  });

  it('prompts confirmation before deleting a task on native and Web', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('task-detail-delete-btn'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Task',
      expect.stringContaining('Grocery Run'),
      expect.any(Array)
    );
    expect(mockOnDelete).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as any[];
    const { act } = require('@testing-library/react-native');
    act(() => {
      buttons.find((b: any) => b.text === 'Delete').onPress();
    });
    expect(mockOnDelete).toHaveBeenCalledWith(10);
  });

  it('updates project_id via onSave without firing redundant onMoveTask double-mutation', () => {
    const mockOnMoveTask = jest.fn();
    const availableProjects = [
      { id: 1, title: 'Inbox', hex_color: '3498db' },
      { id: 2, title: 'Work', hex_color: 'e74c3c' },
    ];

    const { getByTestId, getByText } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        availableProjects={availableProjects}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onMoveTask={mockOnMoveTask}
      />
    );

    expect(getByText('Inbox')).toBeTruthy();

    fireEvent.press(getByTestId('task-project-picker-btn'));
    fireEvent.press(getByTestId('project-option-2'));
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        project_id: 2,
      })
    );
    expect(mockOnMoveTask).not.toHaveBeenCalled();
  });

  it('preserves unsaved edits when optimistic negative task ID resolves to positive server ID while open', () => {
    const optimisticTask: Task = { ...mockTask, id: -444, description: '' };
    const { getByTestId, rerender } = render(
      <TaskDetailModal
        visible={true}
        task={optimisticTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // User types notes while task still has negative tempId
    fireEvent.changeText(getByTestId('task-detail-description-input'), 'Drafting notes live');

    // Sync resolves -444 -> 888 in background
    rerender(
      <TaskDetailModal
        visible={true}
        task={{ ...optimisticTask, id: 888 }}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(mockOnSave).toHaveBeenCalledWith(
      888,
      expect.objectContaining({
        description: 'Drafting notes live',
      })
    );
  });

  it('renders in Create Mode when task is null and forwards all fields to onCreateTask', () => {
    const mockOnCreateTask = jest.fn();
    const availableProjects = [
      { id: 1, title: 'Inbox', hex_color: '#3498db' },
      { id: 2, title: 'Groceries', hex_color: '#2ecc71' },
    ];

    const { getByText, getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={null}
        availableProjects={availableProjects}
        defaultProjectId={2}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onCreateTask={mockOnCreateTask}
      />
    );

    expect(getByText('New Task')).toBeTruthy();

    const titleInput = getByTestId('task-detail-title-input');
    expect(titleInput.props.autoFocus).toBe(true);
    fireEvent.changeText(titleInput, 'Buy organic honey');
    fireEvent.press(getByTestId('repeat-preset-monthly'));
    fireEvent.press(getByTestId('progress-option-50'));
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Buy organic honey',
        project_id: 2,
        percent_done: 0.5,
        repeat_after: 2592000,
        repeat_mode: 1,
      })
    );
  });

  it('allows removing an existing assignee and removing an existing label on save', () => {
    const { getByTestId, queryByText } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('remove-assignee-alex'));
    expect(queryByText('@alex')).toBeNull();

    fireEvent.press(getByTestId('remove-label-Costco'));
    expect(queryByText('#Costco')).toBeNull();

    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        assignees: [],
        labels: [],
      })
    );
  });

  it('saves task with due date, repeat mode, and reminders', () => {
    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('preset-today'));
    fireEvent.press(getByTestId('repeat-preset-weekly'));
    fireEvent.press(getByTestId('quick-add-reminder-btn'));
    fireEvent.press(getByTestId('reminder-preset-15m'));
    fireEvent.press(getByTestId('task-detail-save-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        due_date: expect.any(String),
        repeat_after: 604800,
        repeat_mode: 0,
        reminders: [expect.objectContaining({ relative_period: -900 })],
      })
    );
  });

  it('renders SafeAreaView root with flex: 1 to manage safe status bar insets', () => {
    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={mockTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    const modalRoot = getByTestId('task-detail-modal-root');
    expect(modalRoot.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ flex: 1 })])
    );
  });

  it('normalizes HTML descriptions for readable editing while preserving untouched HTML on save', () => {
    const htmlTask: Task = {
      ...mockTask,
      description: '<p>First line</p><ul><li><p>Item A</p></li></ul>',
    };

    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={htmlTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    const descInput = getByTestId('task-detail-description-input');
    expect(descInput.props.value).toBe('First line\n\n• Item A');

    // Change priority ONLY without editing Notes -> original server HTML is preserved verbatim!
    fireEvent.press(getByTestId('priority-option-4'));
    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        priority: 4,
        description: '<p>First line</p><ul><li><p>Item A</p></li></ul>',
      })
    );
  });

  it('serializes edited notes back into clean HTML when the original description was HTML', () => {
    const htmlTask: Task = {
      ...mockTask,
      description: '<p>First line</p><ul><li><p>Item A</p></li></ul>',
    };

    const { getByTestId } = render(
      <TaskDetailModal
        visible={true}
        task={htmlTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.changeText(
      getByTestId('task-detail-description-input'),
      'Updated heading\n\n- [x] Done step'
    );
    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        description:
          '<p>Updated heading</p><ul data-type="taskList"><li data-checked="true"><p>Done step</p></li></ul>',
      })
    );
  });

  it('renders subtasks, toggles/adds/deletes subtasks, and triggers Duplicate Task', () => {
    const mockOnAddSubtask = jest.fn();
    const mockOnToggleSubtask = jest.fn();
    const mockOnDeleteSubtask = jest.fn();
    const mockOnDuplicateTask = jest.fn();

    const taskWithSubs: Task = {
      ...mockTask,
      related_tasks: {
        subtask: [
          { id: 201, title: 'Pack charger', done: true, priority: 0, project_id: 1 },
          { id: 202, title: 'Lock doors', done: false, priority: 0, project_id: 1 },
        ],
      },
    };

    const { getByTestId, getByText } = render(
      <TaskDetailModal
        visible={true}
        task={taskWithSubs}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onAddSubtask={mockOnAddSubtask}
        onToggleSubtask={mockOnToggleSubtask}
        onDeleteSubtask={mockOnDeleteSubtask}
        onDuplicateTask={mockOnDuplicateTask}
      />
    );

    expect(getByText('1/2')).toBeTruthy();
    expect(getByText('Pack charger')).toBeTruthy();
    expect(getByText('Lock doors')).toBeTruthy();

    fireEvent.press(getByTestId('subtask-checkbox-202'));
    expect(mockOnToggleSubtask).toHaveBeenCalledWith(202);

    fireEvent.changeText(getByTestId('task-detail-subtask-input'), 'Water plants');
    fireEvent.press(getByTestId('add-subtask-btn'));
    expect(mockOnAddSubtask).toHaveBeenCalledWith(10, 'Water plants');

    fireEvent.press(getByTestId('delete-subtask-201'));
    expect(mockOnDeleteSubtask).toHaveBeenCalledWith(10, 201);

    fireEvent.press(getByTestId('task-detail-duplicate-btn'));
    expect(mockOnDuplicateTask).toHaveBeenCalledWith(10);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes immediately when clean, prompts confirmation before discarding unsaved edits on native & web, and preserves snapshot across -tempId -> positiveId remap', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { act } = require('@testing-library/react-native');

    const optimisticTask: Task = { ...mockTask, id: -501 };
    const { getByTestId, queryByTestId, rerender } = render(
      <TaskDetailModal
        visible={true}
        task={optimisticTask}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    // 1. Clean close calls onClose immediately without Alert
    fireEvent.press(getByTestId('task-detail-close-btn'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    mockOnClose.mockClear();

    // 2. Edit title while optimistic, then remap -501 -> 901 -> still dirty on Cancel!
    fireEvent.changeText(getByTestId('task-detail-title-input'), 'Grocery Run Edited');
    rerender(
      <TaskDetailModal
        visible={true}
        task={{ ...optimisticTask, id: 901 }}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.press(getByTestId('task-detail-close-btn'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Discard Changes?',
      'You have unsaved changes to this task.',
      expect.any(Array)
    );
    expect(mockOnClose).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as any[];
    expect(buttons.find((b) => b.text === 'Keep Editing')).toBeTruthy();
    act(() => {
      buttons.find((b) => b.text === 'Discard').onPress();
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // 3. Web inline fallback when window.confirm is absent
    mockOnClose.mockClear();
    Platform.OS = 'web';
    const origWindow = (global as any).window;
    (global as any).window = undefined;
    try {
      rerender(
        <TaskDetailModal
          visible={false}
          task={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
          onDelete={mockOnDelete}
        />
      );
      rerender(
        <TaskDetailModal
          visible={true}
          task={null}
          onClose={mockOnClose}
          onSave={mockOnSave}
          onDelete={mockOnDelete}
        />
      );

      fireEvent.changeText(getByTestId('task-detail-title-input'), 'Unsaved web draft');
      fireEvent.press(getByTestId('task-detail-close-btn'));
      expect(getByTestId('task-web-discard-confirm')).toBeTruthy();
      expect(mockOnClose).not.toHaveBeenCalled();

      fireEvent.press(getByTestId('task-discard-cancel-btn'));
      expect(queryByTestId('task-web-discard-confirm')).toBeNull();

      fireEvent.press(getByTestId('task-detail-close-btn'));
      fireEvent.press(getByTestId('task-discard-confirm-btn'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    } finally {
      (global as any).window = origWindow;
    }
  });

  it('renders read-only pill, hides Save/Delete/Duplicate, sets inputs editable=false, and disables mutation controls when readOnly=true', () => {
    const mockOnDuplicate = jest.fn();
    const mockOnToggleSubtask = jest.fn();
    const mockOnDeleteSubtask = jest.fn();

    const taskWithSub: Task = {
      ...mockTask,
      related_tasks: {
        subtask: [{ id: 301, title: 'Read-only step', done: false, priority: 0, project_id: 1 }],
      },
    };

    const { getByTestId, queryByTestId, getByText } = render(
      <TaskDetailModal
        visible={true}
        task={taskWithSub}
        readOnly={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onDuplicateTask={mockOnDuplicate}
        onToggleSubtask={mockOnToggleSubtask}
        onDeleteSubtask={mockOnDeleteSubtask}
      />
    );

    expect(getByTestId('task-detail-readonly-badge')).toBeTruthy();
    expect(getByText('Read-only')).toBeTruthy();
    expect(queryByTestId('task-detail-save-btn')).toBeNull();
    expect(queryByTestId('task-detail-delete-btn')).toBeNull();
    expect(queryByTestId('task-detail-duplicate-btn')).toBeNull();

    expect(getByTestId('task-detail-title-input').props.editable).toBe(false);
    expect(getByTestId('task-detail-description-input').props.editable).toBe(false);

    fireEvent.press(getByTestId('task-detail-done-toggle'));
    fireEvent.press(getByTestId('subtask-checkbox-301'));
    expect(mockOnToggleSubtask).not.toHaveBeenCalled();
    expect(queryByTestId('delete-subtask-301')).toBeNull();
    expect(queryByTestId('add-subtask-btn')).toBeNull();
    expect(queryByTestId('remove-assignee-alex')).toBeNull();
    expect(queryByTestId('remove-label-Costco')).toBeNull();

    // Header Close button closes cleanly without prompt
    fireEvent.press(getByTestId('task-detail-close-btn'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('avoids false-positive Discard prompt when toggling repeat to Daily and back to Never on legacy repeat_mode=2 task, saves Monthly -> Never via onSaveDirty, and locks cross-project read-only subtasks', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const mockOnSaveDirty = jest.fn();
    const mockOnToggleSubtask = jest.fn();
    const mockOnDeleteSubtask = jest.fn();

    const legacyRepeatTask: Task = {
      ...mockTask,
      repeat_after: 0,
      repeat_mode: 2,
      related_tasks: {
        subtask: [
          { id: 401, title: 'Writable Sub', done: false, priority: 0, project_id: 1 },
          { id: 402, title: 'ReadOnly Cross-List Sub', done: false, priority: 0, project_id: 9 },
        ],
      },
    };

    const { getByTestId, queryByTestId, rerender } = render(
      <TaskDetailModal
        visible={true}
        task={legacyRepeatTask}
        allProjects={[
          { id: 1, title: 'Writable', max_permission: 2 },
          { id: 9, title: 'Shared RO', max_permission: 0 },
        ]}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onSaveDirty={mockOnSaveDirty}
        onDelete={mockOnDelete}
        onToggleSubtask={mockOnToggleSubtask}
        onDeleteSubtask={mockOnDeleteSubtask}
      />
    );

    // Cross-project read-only subtask 402 cannot be toggled or deleted, while 401 remains writable
    expect(getByTestId('delete-subtask-401')).toBeTruthy();
    expect(queryByTestId('delete-subtask-402')).toBeNull();
    fireEvent.press(getByTestId('subtask-checkbox-402'));
    expect(mockOnToggleSubtask).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('subtask-checkbox-401'));
    expect(mockOnToggleSubtask).toHaveBeenCalledWith(401);

    // Toggle repeat Daily -> back to Never: repeatAfter is 0 again, so closing does NOT prompt Discard!
    fireEvent.press(getByTestId('repeat-preset-daily'));
    fireEvent.press(getByTestId('repeat-preset-never'));
    fireEvent.press(getByTestId('task-detail-close-btn'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // Edit ONLY priority and tap Save -> onSaveDirty receives ONLY { priority: 5 }
    fireEvent.press(getByTestId('priority-option-5'));
    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(mockOnSaveDirty).toHaveBeenCalledWith(10, { priority: 5 });
    expect(mockOnSave).not.toHaveBeenCalled();

    // Turning OFF an active Vikunja Monthly repeat (`repeat_mode: 1, repeat_after: 0` -> Never) MUST emit repeat_mode: 0!
    mockOnSaveDirty.mockClear();
    rerender(
      <TaskDetailModal
        visible={true}
        task={{ ...mockTask, id: 77, repeat_after: 0, repeat_mode: 1 }}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onSaveDirty={mockOnSaveDirty}
        onDelete={mockOnDelete}
      />
    );
    fireEvent.press(getByTestId('repeat-preset-never'));
    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(mockOnSaveDirty).toHaveBeenCalledWith(77, { repeat_after: 0, repeat_mode: 0 });
  });
});
