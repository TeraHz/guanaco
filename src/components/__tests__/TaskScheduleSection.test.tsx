import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { TaskScheduleSection } from '../TaskScheduleSection';
import { RepeatMode, ReminderRelativeTo, TaskReminder } from '../../types/vikunja';

describe('TaskScheduleSection', () => {
  const originalOS = Platform.OS;
  const mockOnChangeDueDate = jest.fn();
  const mockOnChangeStartDate = jest.fn();
  const mockOnChangeEndDate = jest.fn();
  const mockOnChangeRepeat = jest.fn();
  const mockOnChangeReminders = jest.fn();

  beforeEach(() => {
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  afterEach(() => {
    Platform.OS = originalOS;
    cleanup();
    jest.restoreAllMocks();
  });

  it('renders schedule fields properly with default/empty values and all 3 repeat modes', () => {
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
    expect(getByTestId('repeat-mode-from-due-date')).toBeTruthy();
    expect(getByTestId('repeat-mode-monthly')).toBeTruthy();
    expect(getByTestId('repeat-mode-from-completion')).toBeTruthy();
  });

  it('sets and clears due date via presets and Clear button', () => {
    const { getByTestId, rerender } = render(
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

    rerender(
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

  it('sets RepeatMode.Monthly (1) when Monthly preset is pressed and supports all 3 repeat modes', () => {
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

    // Weekly preset -> (604800, 0)
    fireEvent.press(getByTestId('repeat-preset-weekly'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(604800, RepeatMode.FromDueDate);

    // Monthly preset -> MUST pass RepeatMode.Monthly (1), NOT 0!
    fireEvent.press(getByTestId('repeat-preset-monthly'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(2592000, RepeatMode.Monthly);

    // Monthly mode button -> sets RepeatMode.Monthly (1)
    fireEvent.press(getByTestId('repeat-mode-monthly'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(2592000, RepeatMode.Monthly);

    // After Completion mode button -> RepeatMode.FromCompletion (2)
    fireEvent.press(getByTestId('repeat-mode-from-completion'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(0, RepeatMode.FromCompletion);
  });

  it('keeps iOS spinner DateTimePicker open across wheel scrolls and closes only when Done or Cancel is pressed', () => {
    Platform.OS = 'ios';
    const { getByTestId, queryByTestId } = render(
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

    fireEvent.press(getByTestId('picker-due-date-trigger'));
    expect(getByTestId('ios-picker-container')).toBeTruthy();

    // Simulate scrolling the iOS wheel (fires onChange with type: 'set')
    const picker = getByTestId('datetime-picker');
    fireEvent(picker, 'onChange', { type: 'set' }, new Date('2026-11-20T12:00:00Z'));

    // Picker MUST stay open on iOS!
    expect(getByTestId('ios-picker-container')).toBeTruthy();
    expect(mockOnChangeDueDate).toHaveBeenCalled();

    // Tapping Done commits and closes the iOS spinner
    fireEvent.press(getByTestId('ios-picker-done-btn'));
    expect(queryByTestId('ios-picker-container')).toBeNull();
  });

  it('restores both startDate and endDate on iOS Cancel after startDate auto-advances endDate, keeps iOS picker open on invalid endDate Done, and exposes start/end time triggers', () => {
    Platform.OS = 'ios';
    const { getByTestId, queryByTestId, rerender } = render(
      <TaskScheduleSection
        dueDate={null}
        startDate="2026-10-15T09:00:00Z"
        endDate="2026-10-16T17:00:00Z"
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

    // Start & End time trigger chips must render
    expect(getByTestId('picker-start-time-trigger')).toBeTruthy();
    expect(getByTestId('picker-end-time-trigger')).toBeTruthy();

    // Open startDate picker and scroll past endDate -> auto-advances endDate
    fireEvent.press(getByTestId('picker-start-date-trigger'));
    fireEvent(getByTestId('datetime-picker'), 'onChange', { type: 'set' }, new Date('2026-10-20T09:00:00Z'));
    expect(mockOnChangeStartDate).toHaveBeenCalled();
    expect(mockOnChangeEndDate).toHaveBeenCalled();

    // Simulate controlled parent re-rendering with the auto-advanced dates before user taps Cancel
    rerender(
      <TaskScheduleSection
        dueDate={null}
        startDate="2026-10-20T09:00:00Z"
        endDate="2026-10-20T09:00:00Z"
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

    mockOnChangeStartDate.mockClear();
    mockOnChangeEndDate.mockClear();

    // Pressing Cancel restores BOTH startDate AND endDate!
    fireEvent.press(getByTestId('ios-picker-cancel-btn'));
    expect(mockOnChangeStartDate).toHaveBeenCalledWith('2026-10-15T09:00:00.000Z');
    expect(mockOnChangeEndDate).toHaveBeenCalledWith('2026-10-16T17:00:00.000Z');
    expect(queryByTestId('ios-picker-container')).toBeNull();

    // Open endDate picker and scroll earlier than startDate (Oct 10 < Oct 20) -> tapping Done keeps picker open!
    fireEvent.press(getByTestId('picker-end-date-trigger'));
    fireEvent(getByTestId('datetime-picker'), 'onChange', { type: 'set' }, new Date('2026-10-10T17:00:00Z'));
    fireEvent.press(getByTestId('ios-picker-done-btn'));
    expect(getByTestId('schedule-date-error')).toBeTruthy();
    expect(getByTestId('ios-picker-container')).toBeTruthy();
  });

  it('closes Android DateTimePicker dialog immediately on set', () => {
    Platform.OS = 'android';
    const { getByTestId, queryByTestId } = render(
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

    fireEvent.press(getByTestId('picker-due-date-trigger'));
    const picker = getByTestId('datetime-picker');
    fireEvent(picker, 'onChange', { type: 'set' }, new Date('2026-11-20T12:00:00Z'));

    expect(mockOnChangeDueDate).toHaveBeenCalled();
    expect(queryByTestId('datetime-picker')).toBeNull();
  });

  it('provides a Web date/time TextInput fallback without crashing and prevents endDate < startDate', () => {
    Platform.OS = 'web';
    const { getByTestId, queryByTestId } = render(
      <TaskScheduleSection
        dueDate={null}
        startDate="2026-10-20T12:00:00Z"
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

    // Open End Date on Web
    fireEvent.press(getByTestId('picker-end-date-trigger'));
    expect(getByTestId('web-picker-container')).toBeTruthy();

    // Invalid calendar date (Feb 31) shows validation error
    fireEvent.changeText(getByTestId('web-datetime-input'), '2026-02-31');
    fireEvent.press(getByTestId('web-picker-apply-btn'));
    expect(getByTestId('web-picker-error')).toBeTruthy();
    expect(mockOnChangeEndDate).not.toHaveBeenCalled();

    // Earlier than startDate (Oct 10 < Oct 20) shows schedule-date-error and blocks invalid range
    fireEvent.changeText(getByTestId('web-datetime-input'), '2026-10-10');
    fireEvent.press(getByTestId('web-picker-apply-btn'));
    expect(getByTestId('schedule-date-error')).toBeTruthy();
    expect(mockOnChangeEndDate).not.toHaveBeenCalled();

    // Valid endDate >= startDate (Oct 25) succeeds and closes Web picker
    fireEvent.changeText(getByTestId('web-datetime-input'), '2026-10-25');
    fireEvent.press(getByTestId('web-picker-apply-btn'));
    expect(mockOnChangeEndDate).toHaveBeenCalledWith(expect.any(String));
    expect(queryByTestId('web-picker-container')).toBeNull();
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

    expect(getByText(/1 hour before/i)).toBeTruthy();

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

    fireEvent.press(getByTestId('remove-reminder-0'));
    expect(mockOnChangeReminders).toHaveBeenCalledWith([]);
  });

  it('normalizes both UTC and non-UTC Vikunja 0001-01-01 zero dates', () => {
    const { queryByTestId } = render(
      <TaskScheduleSection
        dueDate="0001-01-01T01:00:00+01:00"
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

    expect(queryByTestId('clear-due-date-btn')).toBeNull();
    expect(queryByTestId('clear-start-date-btn')).toBeNull();
  });

  it('supports custom recurrence intervals (stepper + unit chips), postpone shortcuts, and Sunday weekStartDay', () => {
    const futureIso = new Date(Date.now() + 2 * 86400 * 1000).toISOString();
    const { getByTestId } = render(
      <TaskScheduleSection
        dueDate={futureIso}
        startDate={null}
        endDate={null}
        repeatAfter={259200} // 3 days
        repeatMode={RepeatMode.FromDueDate}
        reminders={[]}
        weekStartDay={0}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );

    // Existing custom interval (3 days) automatically opens custom editor and increments to 4 days (345600s)
    expect(getByTestId('custom-repeat-editor')).toBeTruthy();
    fireEvent.press(getByTestId('custom-repeat-increment'));
    expect(mockOnChangeRepeat).toHaveBeenCalledWith(345600, RepeatMode.FromDueDate);

    // Switch unit to weeks (4 weeks = 2419200s)
    fireEvent.press(getByTestId('custom-repeat-unit-weeks'));
    expect(mockOnChangeRepeat).toHaveBeenLastCalledWith(2419200, RepeatMode.FromDueDate);

    // Postpone +3d shifts due date forward
    fireEvent.press(getByTestId('postpone-3d'));
    expect(mockOnChangeDueDate).toHaveBeenCalledWith(expect.any(String));

    // Next week with weekStartDay = 0 picks Sunday (getDay() === 0)
    mockOnChangeDueDate.mockClear();
    fireEvent.press(getByTestId('preset-next-week'));
    const pickedNextWeekIso = mockOnChangeDueDate.mock.calls[0][0];
    expect(new Date(pickedNextWeekIso).getDay()).toBe(0);
  });

  it('anchors reminder presets to startDate when dueDate is null, auto-populates Today when all dates are unset, and prunes relative reminders on date clear', () => {
    const { getByTestId, rerender } = render(
      <TaskScheduleSection
        dueDate={null}
        startDate="2026-10-15T09:00:00Z"
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

    fireEvent.press(getByTestId('quick-add-reminder-btn'));
    fireEvent.press(getByTestId('reminder-preset-15m'));
    expect(mockOnChangeReminders).toHaveBeenCalledWith([
      { relative_to: ReminderRelativeTo.StartDate, relative_period: -900 },
    ]);

    // Clearing startDate prunes start_date relative reminders automatically
    mockOnChangeReminders.mockClear();
    rerender(
      <TaskScheduleSection
        dueDate={null}
        startDate="2026-10-15T09:00:00Z"
        endDate={null}
        repeatAfter={0}
        repeatMode={RepeatMode.FromDueDate}
        reminders={[{ relative_to: ReminderRelativeTo.StartDate, relative_period: -900 }]}
        onChangeDueDate={mockOnChangeDueDate}
        onChangeStartDate={mockOnChangeStartDate}
        onChangeEndDate={mockOnChangeEndDate}
        onChangeRepeat={mockOnChangeRepeat}
        onChangeReminders={mockOnChangeReminders}
      />
    );
    fireEvent.press(getByTestId('clear-start-date-btn'));
    expect(mockOnChangeReminders).toHaveBeenCalledWith([]);
    expect(mockOnChangeStartDate).toHaveBeenCalledWith(null);

    // When all dates are null, adding a preset reminder auto-sets dueDate to Today so the reminder actually fires
    mockOnChangeDueDate.mockClear();
    mockOnChangeReminders.mockClear();
    rerender(
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
    fireEvent.press(getByTestId('quick-add-reminder-btn'));
    fireEvent.press(getByTestId('reminder-preset-15m'));
    expect(mockOnChangeDueDate).toHaveBeenCalledWith(expect.any(String));
    expect(mockOnChangeReminders).toHaveBeenCalledWith([
      { relative_to: ReminderRelativeTo.DueDate, relative_period: -900 },
    ]);
  });
});
