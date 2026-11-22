import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { RepeatMode, ReminderRelativeTo, TaskReminder } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import {
  normalizeVikunjaDate,
  formatDateDisplay,
  getDatePreset,
  formatIsoForVikunja,
} from '../utils/dates';
import { formatRepeatDescription } from '../utils/repeat';
import { formatReminderDescription } from '../utils/reminders';

export interface TaskScheduleSectionProps {
  dueDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  repeatAfter?: number;
  repeatMode?: RepeatMode;
  reminders?: TaskReminder[];
  onChangeDueDate: (date: string | null) => void;
  onChangeStartDate: (date: string | null) => void;
  onChangeEndDate: (date: string | null) => void;
  onChangeRepeat: (repeatAfter: number, repeatMode: RepeatMode) => void;
  onChangeReminders: (reminders: TaskReminder[]) => void;
}

type ScheduleField = 'dueDate' | 'startDate' | 'endDate';
type PickerMode = 'date' | 'time';

function formatLocalDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLocalTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

const FIELD_LABELS: Record<ScheduleField, string> = {
  dueDate: 'Due',
  startDate: 'Start',
  endDate: 'End',
};

function getFieldLabel(field: ScheduleField): string {
  return Object.prototype.hasOwnProperty.call(FIELD_LABELS, field) ? FIELD_LABELS[field] : 'Date';
}

export const TaskScheduleSection: React.FC<TaskScheduleSectionProps> = ({
  dueDate,
  startDate,
  endDate,
  repeatAfter = 0,
  repeatMode = RepeatMode.FromDueDate,
  reminders = [],
  onChangeDueDate,
  onChangeStartDate,
  onChangeEndDate,
  onChangeRepeat,
  onChangeReminders,
}) => {
  const theme = useAppTheme();

  const safeDueDate = normalizeVikunjaDate(dueDate);
  const safeStartDate = normalizeVikunjaDate(startDate);
  const safeEndDate = normalizeVikunjaDate(endDate);

  const [activePicker, setActivePicker] = useState<{
    field: ScheduleField;
    mode: PickerMode;
  } | null>(null);

  const [pendingIosDate, setPendingIosDate] = useState<Date | null>(null);
  const initialPickerSnapshotRef = useRef<{
    dueDate: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null>(null);

  const [webInputText, setWebInputText] = useState('');
  const [webInputError, setWebInputError] = useState<string | null>(null);
  const [dateValidationError, setDateValidationError] = useState<string | null>(null);

  const [showReminderMenu, setShowReminderMenu] = useState(false);

  const getFieldIso = (field: ScheduleField): string | null => {
    if (field === 'dueDate') return safeDueDate;
    if (field === 'startDate') return safeStartDate;
    return safeEndDate;
  };

  const getBaseDateForField = (field: ScheduleField): Date => {
    const existing = getFieldIso(field);
    if (existing) {
      const parsed = new Date(existing);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    if (field === 'endDate' && safeStartDate) {
      const parsedStart = new Date(safeStartDate);
      if (!isNaN(parsedStart.getTime())) return parsedStart;
    }
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  };

  const openPicker = (field: ScheduleField, mode: PickerMode) => {
    safeHaptics.selection();
    setDateValidationError(null);
    setWebInputError(null);
    initialPickerSnapshotRef.current = {
      dueDate: safeDueDate,
      startDate: safeStartDate,
      endDate: safeEndDate,
    };
    const base = getBaseDateForField(field);
    setPendingIosDate(base);
    if (Platform.OS === 'web') {
      setWebInputText(mode === 'date' ? formatLocalDateInput(base) : formatLocalTimeInput(base));
    }
    setActivePicker({ field, mode });
  };

  const commitIsoToField = (field: ScheduleField, candidateDate: Date): boolean => {
    const isoString = formatIsoForVikunja(candidateDate);
    if (!isoString) return false;

    if (field === 'dueDate') {
      setDateValidationError(null);
      onChangeDueDate(isoString);
      return true;
    }

    if (field === 'startDate') {
      setDateValidationError(null);
      onChangeStartDate(isoString);
      if (safeEndDate && new Date(safeEndDate).getTime() < candidateDate.getTime()) {
        onChangeEndDate(isoString);
      }
      return true;
    }

    // field === 'endDate': enforce endDate >= startDate
    if (safeStartDate && candidateDate.getTime() < new Date(safeStartDate).getTime()) {
      setDateValidationError('End date cannot be earlier than start date.');
      return false;
    }

    setDateValidationError(null);
    onChangeEndDate(isoString);
    return true;
  };

  const buildCombinedDate = (field: ScheduleField, mode: PickerMode, picked: Date): Date => {
    const baseSource =
      Platform.OS === 'ios' && pendingIosDate ? pendingIosDate : getBaseDateForField(field);
    const baseDate = new Date(baseSource.getTime());
    if (mode === 'date') {
      baseDate.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    } else {
      baseDate.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    }
    return baseDate;
  };

  const handleApplyPreset = (preset: 'today' | 'tomorrow' | 'this_weekend' | 'next_week') => {
    safeHaptics.selection();
    const d = getDatePreset(preset);
    if (d) {
      onChangeDueDate(formatIsoForVikunja(d));
    }
  };

  const handleClearDueDate = () => {
    safeHaptics.selection();
    onChangeDueDate(null);
  };

  const handleClearStartDate = () => {
    safeHaptics.selection();
    setDateValidationError(null);
    onChangeStartDate(null);
  };

  const handleClearEndDate = () => {
    safeHaptics.selection();
    setDateValidationError(null);
    onChangeEndDate(null);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!activePicker) return;

    if (event.type === 'dismissed') {
      setActivePicker(null);
      setPendingIosDate(null);
      return;
    }

    if (!selectedDate) {
      if (Platform.OS !== 'ios') {
        setActivePicker(null);
      }
      return;
    }

    const { field, mode } = activePicker;
    const combined = buildCombinedDate(field, mode, selectedDate);

    if (Platform.OS === 'ios') {
      // On iOS spinner, wheel scroll fires onChange repeatedly — keep picker open until user taps Done!
      setPendingIosDate(combined);
      commitIsoToField(field, combined);
      return;
    }

    // Android dialog: commit and close
    commitIsoToField(field, combined);
    setActivePicker(null);
  };

  const handleIosDone = () => {
    if (!activePicker) return;
    const finalDate = pendingIosDate || getBaseDateForField(activePicker.field);
    if (commitIsoToField(activePicker.field, finalDate)) {
      initialPickerSnapshotRef.current = null;
      setActivePicker(null);
      setPendingIosDate(null);
    }
  };

  const handleIosCancel = () => {
    const snap = initialPickerSnapshotRef.current;
    if (activePicker && snap) {
      if (activePicker.field === 'dueDate') {
        onChangeDueDate(snap.dueDate);
      } else if (activePicker.field === 'startDate') {
        onChangeStartDate(snap.startDate);
        if (snap.endDate !== safeEndDate) {
          onChangeEndDate(snap.endDate);
        }
      } else {
        onChangeEndDate(snap.endDate);
      }
    }
    initialPickerSnapshotRef.current = null;
    setDateValidationError(null);
    setActivePicker(null);
    setPendingIosDate(null);
  };

  const handleWebApply = () => {
    if (!activePicker) return;
    const raw = webInputText.trim();
    const { field, mode } = activePicker;

    if (mode === 'date') {
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) {
        setWebInputError('Enter a valid date as YYYY-MM-DD.');
        return;
      }
      const year = parseInt(m[1], 10);
      const monthIdx = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      const candidate = getBaseDateForField(field);
      candidate.setFullYear(year, monthIdx, day);
      if (
        candidate.getFullYear() !== year ||
        candidate.getMonth() !== monthIdx ||
        candidate.getDate() !== day
      ) {
        setWebInputError('Invalid calendar date.');
        return;
      }
      setWebInputError(null);
      if (commitIsoToField(field, candidate)) {
        setActivePicker(null);
      }
      return;
    }

    // mode === 'time'
    const tm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm) {
      setWebInputError('Enter time in 24-hour format HH:MM.');
      return;
    }
    const hours = parseInt(tm[1], 10);
    const minutes = parseInt(tm[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      setWebInputError('Hours must be 00–23 and minutes 00–59.');
      return;
    }
    const candidate = getBaseDateForField(field);
    candidate.setHours(hours, minutes, 0, 0);
    setWebInputError(null);
    if (commitIsoToField(field, candidate)) {
      setActivePicker(null);
    }
  };

  const handleAddReminderPreset = (relativePeriod: number) => {
    safeHaptics.selection();
    const newReminder: TaskReminder = {
      relative_to: ReminderRelativeTo.DueDate,
      relative_period: relativePeriod,
    };
    onChangeReminders([...reminders, newReminder]);
    setShowReminderMenu(false);
  };

  const handleRemoveReminder = (index: number) => {
    safeHaptics.selection();
    const updated = [...reminders];
    updated.splice(index, 1);
    onChangeReminders(updated);
  };

  const isMonthlySelected = repeatMode === RepeatMode.Monthly || repeatAfter === 2592000;
  const isNeverSelected = repeatAfter === 0 && repeatMode !== RepeatMode.Monthly;
  const isDailySelected = repeatAfter === 86400 && repeatMode !== RepeatMode.Monthly;
  const isWeeklySelected = repeatAfter === 604800 && repeatMode !== RepeatMode.Monthly;

  const currentPickerValue = activePicker
    ? pendingIosDate || getBaseDateForField(activePicker.field)
    : new Date();

  return (
    <View style={styles.container}>
      {/* DUE DATE SECTION */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>DUE DATE</Text>
        {safeDueDate && (
          <TouchableOpacity
            testID="clear-due-date-btn"
            onPress={handleClearDueDate}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear due date"
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Due Date Display / Picker Trigger */}
      <View style={styles.dateRow}>
        <TouchableOpacity
          testID="picker-due-date-trigger"
          style={[
            styles.dateBadge,
            { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border },
          ]}
          onPress={() => openPicker('dueDate', 'date')}
          accessibilityRole="button"
          accessibilityLabel="Select due date"
        >
          <Text style={[styles.dateBadgeText, { color: theme.colors.text }]}>
            {safeDueDate ? formatDateDisplay(safeDueDate) : 'No due date set'}
          </Text>
        </TouchableOpacity>

        {safeDueDate && (
          <TouchableOpacity
            testID="picker-due-time-trigger"
            style={[
              styles.timeBadge,
              { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border },
            ]}
            onPress={() => openPicker('dueDate', 'time')}
            accessibilityRole="button"
            accessibilityLabel="Select due time"
          >
            <Text style={[styles.dateBadgeText, { color: theme.colors.accent }]}>
              {new Date(safeDueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Date Presets */}
      <View style={styles.presetsRow}>
        <TouchableOpacity
          testID="preset-today"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
          ]}
          onPress={() => handleApplyPreset('today')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Today</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-tomorrow"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
          ]}
          onPress={() => handleApplyPreset('tomorrow')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Tomorrow</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-weekend"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
          ]}
          onPress={() => handleApplyPreset('this_weekend')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Weekend</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-next-week"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
          ]}
          onPress={() => handleApplyPreset('next_week')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Next Week</Text>
        </TouchableOpacity>
      </View>

      {/* START & END DATES SECTION */}
      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        START & END DATES
      </Text>
      <View style={styles.startEndRow}>
        {/* Start Date */}
        <View style={styles.startEndCol}>
          <Text style={[styles.subLabel, { color: theme.colors.textTertiary }]}>Starts</Text>
          <TouchableOpacity
            testID="picker-start-date-trigger"
            style={[
              styles.dateBadge,
              { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border },
            ]}
            onPress={() => openPicker('startDate', 'date')}
            accessibilityRole="button"
            accessibilityLabel="Select start date"
          >
            <Text style={[styles.dateBadgeText, { color: theme.colors.text }]}>
              {safeStartDate ? formatDateDisplay(safeStartDate) : 'Not set'}
            </Text>
          </TouchableOpacity>
          {safeStartDate && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <TouchableOpacity
                testID="picker-start-time-trigger"
                style={[
                  styles.timeBadge,
                  { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border, paddingHorizontal: 8, paddingVertical: 4 },
                ]}
                onPress={() => openPicker('startDate', 'time')}
                accessibilityRole="button"
                accessibilityLabel="Select start time"
              >
                <Text style={[styles.dateBadgeText, { color: theme.colors.accent, fontSize: 12 }]}>
                  {new Date(safeStartDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="clear-start-date-btn"
                onPress={handleClearStartDate}
                style={styles.smallClearBtn}
                accessibilityRole="button"
                accessibilityLabel="Clear start date"
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* End Date */}
        <View style={styles.startEndCol}>
          <Text style={[styles.subLabel, { color: theme.colors.textTertiary }]}>Ends</Text>
          <TouchableOpacity
            testID="picker-end-date-trigger"
            style={[
              styles.dateBadge,
              { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border },
            ]}
            onPress={() => openPicker('endDate', 'date')}
            accessibilityRole="button"
            accessibilityLabel="Select end date"
          >
            <Text style={[styles.dateBadgeText, { color: theme.colors.text }]}>
              {safeEndDate ? formatDateDisplay(safeEndDate) : 'Not set'}
            </Text>
          </TouchableOpacity>
          {safeEndDate && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <TouchableOpacity
                testID="picker-end-time-trigger"
                style={[
                  styles.timeBadge,
                  { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border, paddingHorizontal: 8, paddingVertical: 4 },
                ]}
                onPress={() => openPicker('endDate', 'time')}
                accessibilityRole="button"
                accessibilityLabel="Select end time"
              >
                <Text style={[styles.dateBadgeText, { color: theme.colors.accent, fontSize: 12 }]}>
                  {new Date(safeEndDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="clear-end-date-btn"
                onPress={handleClearEndDate}
                style={styles.smallClearBtn}
                accessibilityRole="button"
                accessibilityLabel="Clear end date"
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {dateValidationError ? (
        <Text testID="schedule-date-error" style={styles.validationErrorText}>
          {dateValidationError}
        </Text>
      ) : null}

      {/* Active Date/Time Picker UI (Platform-specific: Web vs iOS Spinner vs Android Dialog) */}
      {activePicker && Platform.OS === 'web' && (
        <View
          testID="web-picker-container"
          style={[
            styles.pickerCard,
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.border },
          ]}
        >
          <Text style={[styles.pickerCardTitle, { color: theme.colors.text }]}>
            Set {getFieldLabel(activePicker.field)} {activePicker.mode === 'date' ? 'Date' : 'Time'}
          </Text>
          <View style={styles.webInputRow}>
            <TextInput
              testID="web-datetime-input"
              style={[
                styles.webInput,
                {
                  backgroundColor: theme.colors.inputBg,
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                },
              ]}
              value={webInputText}
              onChangeText={(txt) => {
                setWebInputText(txt);
                if (webInputError) setWebInputError(null);
              }}
              placeholder={activePicker.mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM'}
              placeholderTextColor={theme.colors.textTertiary}
              onSubmitEditing={handleWebApply}
              autoFocus
            />
            <TouchableOpacity
              testID="web-picker-apply-btn"
              style={[styles.pickerActionBtn, { backgroundColor: theme.colors.accent }]}
              onPress={handleWebApply}
              accessibilityRole="button"
            >
              <Text style={styles.pickerActionBtnText}>Apply</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="web-picker-cancel-btn"
              style={[styles.pickerActionBtn, { backgroundColor: '#8E8E93' }]}
              onPress={() => {
                setWebInputError(null);
                setActivePicker(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.pickerActionBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          {webInputError ? (
            <Text testID="web-picker-error" style={styles.validationErrorText}>
              {webInputError}
            </Text>
          ) : null}
        </View>
      )}

      {activePicker && Platform.OS === 'ios' && (
        <View
          testID="ios-picker-container"
          style={[
            styles.pickerCard,
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.iosPickerToolbar, { borderBottomColor: theme.colors.border }]}>
            <TouchableOpacity
              testID="ios-picker-cancel-btn"
              onPress={handleIosCancel}
              style={styles.iosToolbarBtn}
              accessibilityRole="button"
            >
              <Text style={[styles.iosCancelText, { color: theme.colors.textSecondary }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <Text style={[styles.pickerCardTitle, { color: theme.colors.text }]}>
              {getFieldLabel(activePicker.field)} {activePicker.mode === 'date' ? 'Date' : 'Time'}
            </Text>
            <TouchableOpacity
              testID="ios-picker-done-btn"
              onPress={handleIosDone}
              style={styles.iosToolbarBtn}
              accessibilityRole="button"
            >
              <Text style={[styles.iosDoneText, { color: theme.colors.accent }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={currentPickerValue}
            mode={activePicker.mode}
            display="spinner"
            themeVariant={theme.isDark ? 'dark' : 'light'}
            minimumDate={
              activePicker.field === 'endDate' && safeStartDate
                ? new Date(safeStartDate)
                : undefined
            }
            onChange={handlePickerChange}
          />
        </View>
      )}

      {activePicker && Platform.OS !== 'web' && Platform.OS !== 'ios' && (
        <DateTimePicker
          value={currentPickerValue}
          mode={activePicker.mode}
          display="default"
          minimumDate={
            activePicker.field === 'endDate' && safeStartDate
              ? new Date(safeStartDate)
              : undefined
          }
          onChange={handlePickerChange}
        />
      )}

      {/* REPEAT SECTION */}
      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        REPEAT
      </Text>
      <View style={styles.presetsRow}>
        <TouchableOpacity
          testID="repeat-preset-never"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            isNeverSelected && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(0, RepeatMode.FromDueDate);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isNeverSelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isNeverSelected ? '#FFFFFF' : theme.colors.text },
            ]}
          >
            Never
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-daily"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            isDailySelected && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            const nextMode =
              repeatMode === RepeatMode.Monthly ? RepeatMode.FromDueDate : repeatMode;
            onChangeRepeat(86400, nextMode);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isDailySelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isDailySelected ? '#FFFFFF' : theme.colors.text },
            ]}
          >
            Daily
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-weekly"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            isWeeklySelected && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            const nextMode =
              repeatMode === RepeatMode.Monthly ? RepeatMode.FromDueDate : repeatMode;
            onChangeRepeat(604800, nextMode);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isWeeklySelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isWeeklySelected ? '#FFFFFF' : theme.colors.text },
            ]}
          >
            Weekly
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-monthly"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            isMonthlySelected && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(2592000, RepeatMode.Monthly);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isMonthlySelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isMonthlySelected ? '#FFFFFF' : theme.colors.text },
            ]}
          >
            Monthly
          </Text>
        </TouchableOpacity>
      </View>

      {/* Repeat Mode Selector — All 3 Vikunja Repeat Modes (0 = From Due Date, 1 = Monthly, 2 = After Completion) */}
      <View style={styles.repeatModeRow}>
        <TouchableOpacity
          testID="repeat-mode-from-due-date"
          style={[
            styles.modeButton,
            { backgroundColor: theme.colors.inputBg },
            repeatMode === RepeatMode.FromDueDate && styles.activeModeButton,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(repeatAfter, RepeatMode.FromDueDate);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: repeatMode === RepeatMode.FromDueDate }}
        >
          <Text
            style={[
              styles.modeButtonText,
              {
                color:
                  repeatMode === RepeatMode.FromDueDate
                    ? '#FFFFFF'
                    : theme.colors.textSecondary,
              },
            ]}
            numberOfLines={1}
          >
            From Due Date
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-mode-monthly"
          style={[
            styles.modeButton,
            { backgroundColor: theme.colors.inputBg },
            repeatMode === RepeatMode.Monthly && styles.activeModeButton,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(repeatAfter > 0 ? repeatAfter : 2592000, RepeatMode.Monthly);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: repeatMode === RepeatMode.Monthly }}
        >
          <Text
            style={[
              styles.modeButtonText,
              {
                color:
                  repeatMode === RepeatMode.Monthly
                    ? '#FFFFFF'
                    : theme.colors.textSecondary,
              },
            ]}
            numberOfLines={1}
          >
            Monthly
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-mode-from-completion"
          style={[
            styles.modeButton,
            { backgroundColor: theme.colors.inputBg },
            repeatMode === RepeatMode.FromCompletion && styles.activeModeButton,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(repeatAfter, RepeatMode.FromCompletion);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: repeatMode === RepeatMode.FromCompletion }}
        >
          <Text
            style={[
              styles.modeButtonText,
              {
                color:
                  repeatMode === RepeatMode.FromCompletion
                    ? '#FFFFFF'
                    : theme.colors.textSecondary,
              },
            ]}
            numberOfLines={1}
          >
            After Completion
          </Text>
        </TouchableOpacity>
      </View>

      {(repeatAfter > 0 || repeatMode === RepeatMode.Monthly) && (
        <Text style={[styles.repeatSummaryText, { color: theme.colors.textTertiary }]}>
          {formatRepeatDescription(
            repeatMode === RepeatMode.Monthly && repeatAfter <= 0 ? 2592000 : repeatAfter,
            repeatMode
          )}
        </Text>
      )}

      {/* REMINDERS SECTION */}
      <View style={[styles.sectionHeader, { marginTop: 18 }]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>REMINDERS</Text>
        <TouchableOpacity
          testID="quick-add-reminder-btn"
          style={styles.addReminderBtn}
          onPress={() => setShowReminderMenu(!showReminderMenu)}
          accessibilityRole="button"
        >
          <Text style={[styles.addReminderBtnText, { color: theme.colors.accent }]}>＋ Add</Text>
        </TouchableOpacity>
      </View>

      {showReminderMenu && (
        <View
          style={[
            styles.reminderMenuCard,
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.border },
          ]}
        >
          <TouchableOpacity
            testID="reminder-preset-0"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(0)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              At time of event
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-15m"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(-900)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              15 minutes before
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-1h"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(-3600)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              1 hour before
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-1d"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(-86400)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              1 day before
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Reminders List */}
      {reminders.length === 0 ? (
        <Text style={[styles.emptyRemindersText, { color: theme.colors.textTertiary }]}>
          No reminders scheduled
        </Text>
      ) : (
        reminders.map((reminder, idx) => (
          <View
            key={idx}
            style={[
              styles.reminderItem,
              { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.border },
            ]}
          >
            <Text style={[styles.reminderItemText, { color: theme.colors.text }]}>
              🔔 {formatReminderDescription(reminder)}
            </Text>
            <TouchableOpacity
              testID={`remove-reminder-${idx}`}
              style={styles.removeReminderBtn}
              onPress={() => handleRemoveReminder(idx)}
              accessibilityRole="button"
              accessibilityLabel={`Remove reminder ${idx + 1}`}
            >
              <Text style={styles.removeReminderBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  clearBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  clearBtnText: {
    color: '#FF453A',
    fontSize: 12,
    fontWeight: '600',
  },
  smallClearBtn: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  dateBadge: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  timeBadge: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  dateBadgeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '600',
  },
  activeChip: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  startEndRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  startEndCol: {
    flex: 1,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  validationErrorText: {
    color: '#FF453A',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  pickerCard: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    overflow: 'hidden',
  },
  iosPickerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iosToolbarBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  iosCancelText: {
    fontSize: 14,
    fontWeight: '500',
  },
  iosDoneText: {
    fontSize: 15,
    fontWeight: '700',
  },
  pickerCardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  webInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  webInput: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  pickerActionBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  repeatModeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  activeModeButton: {
    backgroundColor: '#007AFF',
  },
  modeButtonText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  repeatSummaryText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 6,
  },
  addReminderBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  addReminderBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reminderMenuCard: {
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  reminderMenuItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  reminderMenuItemText: {
    fontSize: 13,
  },
  emptyRemindersText: {
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 4,
  },
  reminderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
  },
  reminderItemText: {
    fontSize: 13,
    flex: 1,
  },
  removeReminderBtn: {
    padding: 4,
  },
  removeReminderBtnText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
