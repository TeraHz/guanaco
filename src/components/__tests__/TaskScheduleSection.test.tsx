import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { TaskScheduleSection } from '../TaskScheduleSection';
import { RepeatMode, ReminderRelativeTo, TaskReminder } from '../../types/vikunja';

describe('TaskScheduleSection', () => {
  const mockOnChangeDueDate = jest.fn();
  const mockOnChangeStartDate = jest.fn();
  const mockOnChangeEndDate = jest.fn();
  const mockOnChangeRepeat = jest.fn();
  const mockOnChangeReminders = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders schedule fields properly with default/empty values', () => {
    const { getByText, getByTestId } = render(
      <TaskScheduleSection
        dueDate={null}
        startDate={null}
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={[]}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    expect(getByText('DUE DATE')).toBeTruthy();
    expect(getByText('START & END DATES')).toBeTruthy();
    expect(getByText('REPEAT')).toBeTruthy();
    expect(getByText('REMINDERS')).toBeTruthy();
    expect(getByTestId('preset-today')).toBeTruthy();
    expect(getByTestId('preset-tomorrow')).toBeTruthy();
  });

  it('sets due date when preset button is pressed', () => {
    const { getByTestId } = render(
      <TaskScheduleSection
        dueDate={null}
        startDate={null}
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={[]}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    fireEvent.press(getByTestId('preset-today'));
    expect(mockOnChangeDueDate).toHaveBeenCalledWith(expect.any(String));

    fireEvent.press(getByTestId('preset-tomorrow'));
    expect(mockOnChangeDueDate).toHaveBeenCalledWith(expect.any(String));
  });

  it('clears due date when clear button is pressed', () => {
    const { getByTestId } = render(
      <TaskScheduleSection
        dueDate="2026-10-15T12:00:00Z"
        startDate={null}
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={[]}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    fireEvent.press(getByTestId('clear-due-date-btn'));
    expect(mockOnChangeDueDate).toHaveBeenCalledWith(null);
  });

  it('changes repeat interval and mode', () => {
    const { getByTestId } = render(
      <TaskScheduleSection
        dueDate="2026-10-15T12:00:00Z"
        startDate={null}
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={[]}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    // Select weekly preset (604800 seconds)
    fireEvent.press(getByTestId('repeat-preset-weekly'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(604800, RepeatMode.FromDueDate);

    // Toggle repeat mode to FromCompletion
    fireEvent.press(getByTestId('repeat-mode-from-completion'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(0, RepeatMode.FromCompletion);
  });

  it('adds and removes reminders', () => {
    const initialReminders: TaskReminder[] = [
      {
        reminder: '2026-10-15T11:00:00Z',
        relative_to: ReminderRelativeTo.DueDate,
        relative_period: -3600,
      },
    ];

    const { getByTestId, getByText } = render(
      <TaskScheduleSection
        dueDate="2026-10-15T12:00:00Z"
        startDate={null}
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={initialReminders}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    // Shows existing reminder
    expect(getByText(/1 hour before/i)).toBeTruthy();

    // Add reminder preset (e.g. 15 minutes before)
    fireEvent.press(getByTestId('quick-add-reminder-btn'));
    fireEvent.press(getByTestId('reminder-preset-15m'));

    expect(mockOnChangeReminders).toHaveBeenCalledWith(
      expect.arrayContaining([
        ...initialReminders,
        expect.objectContaining({
          relative_to: ReminderRelativeTo.DueDate,
          relative_period: -900,
        }),
      ])
    );

    // Remove existing reminder
    fireEvent.press(getByTestId('remove-reminder-0'));
    expect(mockOnChangeReminders).toHaveBeenCalledWith([]);
  });

  it('normalizes Vikunja 0001-01-01 zero dates', () => {
    const { queryByTestId } = render(
      <TaskScheduleSection
        dueDate="0001-01-01T00:00:00Z"
        startDate="0001-01-01T00:00:00Z"
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={[]}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    // Zero date should be normalized as not set, so clear button won't appear
    expect(queryByTestId('clear-due-date-btn')).toBeNull();
  });
});
