import React, { useState } from 'react';
import {
  View,
  Text,
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
    field: 'dueDate' | 'startDate' | 'endDate';
    mode: 'date' | 'time';
  } | null>(null);

  const [showReminderMenu, setShowReminderMenu] = useState(false);

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
    onChangeStartDate(null);
  };

  const handleClearEndDate = () => {
    safeHaptics.selection();
    onChangeEndDate(null);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed' || !selectedDate || !activePicker) {
      setActivePicker(null);
      return;
    }

    const { field, mode } = activePicker;
    let baseDate: Date;

    if (field === 'dueDate') {
      baseDate = safeDueDate ? new Date(safeDueDate) : new Date();
    } else if (field === 'startDate') {
      baseDate = safeStartDate ? new Date(safeStartDate) : new Date();
    } else {
      baseDate = safeEndDate ? new Date(safeEndDate) : new Date();
    }

    if (mode === 'date') {
      baseDate.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    } else {
      baseDate.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
    }

    const isoString = formatIsoForVikunja(baseDate);

    if (field === 'dueDate') onChangeDueDate(isoString);
    else if (field === 'startDate') onChangeStartDate(isoString);
    else onChangeEndDate(isoString);

    setActivePicker(null);
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
          onPress={() => setActivePicker({ field: 'dueDate', mode: 'date' })}
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
            onPress={() => setActivePicker({ field: 'dueDate', mode: 'time' })}
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
          style={[styles.presetChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary }]}
          onPress={() => handleApplyPreset('today')}
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Today</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-tomorrow"
          style={[styles.presetChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary }]}
          onPress={() => handleApplyPreset('tomorrow')}
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Tomorrow</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-weekend"
          style={[styles.presetChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary }]}
          onPress={() => handleApplyPreset('this_weekend')}
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>Weekend</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-next-week"
          style={[styles.presetChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary }]}
          onPress={() => handleApplyPreset('next_week')}
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
            style={[styles.dateBadge, { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border }]}
            onPress={() => setActivePicker({ field: 'startDate', mode: 'date' })}
          >
            <Text style={[styles.dateBadgeText, { color: theme.colors.text }]}>
              {safeStartDate ? formatDateDisplay(safeStartDate) : 'Not set'}
            </Text>
          </TouchableOpacity>
          {safeStartDate && (
            <TouchableOpacity onPress={handleClearStartDate} style={styles.smallClearBtn}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* End Date */}
        <View style={styles.startEndCol}>
          <Text style={[styles.subLabel, { color: theme.colors.textTertiary }]}>Ends</Text>
          <TouchableOpacity
            testID="picker-end-date-trigger"
            style={[styles.dateBadge, { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border }]}
            onPress={() => setActivePicker({ field: 'endDate', mode: 'date' })}
          >
            <Text style={[styles.dateBadgeText, { color: theme.colors.text }]}>
              {safeEndDate ? formatDateDisplay(safeEndDate) : 'Not set'}
            </Text>
          </TouchableOpacity>
          {safeEndDate && (
            <TouchableOpacity onPress={handleClearEndDate} style={styles.smallClearBtn}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

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
            repeatAfter === 0 && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(0, repeatMode);
          }}
        >
          <Text style={[styles.presetText, { color: repeatAfter === 0 ? '#FFFFFF' : theme.colors.text }]}>
            Never
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-daily"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            repeatAfter === 86400 && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(86400, repeatMode);
          }}
        >
          <Text style={[styles.presetText, { color: repeatAfter === 86400 ? '#FFFFFF' : theme.colors.text }]}>
            Daily
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-weekly"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            repeatAfter === 604800 && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(604800, repeatMode);
          }}
        >
          <Text style={[styles.presetText, { color: repeatAfter === 604800 ? '#FFFFFF' : theme.colors.text }]}>
            Weekly
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-monthly"
          style={[
            styles.presetChip,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.cardSecondary },
            repeatAfter === 2592000 && styles.activeChip,
          ]}
          onPress={() => {
            safeHaptics.selection();
            onChangeRepeat(2592000, repeatMode);
          }}
        >
          <Text style={[styles.presetText, { color: repeatAfter === 2592000 ? '#FFFFFF' : theme.colors.text }]}>
            Monthly
          </Text>
        </TouchableOpacity>
      </View>

      {/* Repeat Mode Selector */}
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
        >
          <Text
            style={[
              styles.modeButtonText,
              { color: repeatMode === RepeatMode.FromDueDate ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            From Due Date
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
        >
          <Text
            style={[
              styles.modeButtonText,
              { color: repeatMode === RepeatMode.FromCompletion ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            After Completion
          </Text>
        </TouchableOpacity>
      </View>

      {repeatAfter > 0 && (
        <Text style={[styles.repeatSummaryText, { color: theme.colors.textTertiary }]}>
          {formatRepeatDescription(repeatAfter, repeatMode)}
        </Text>
      )}

      {/* REMINDERS SECTION */}
      <View style={[styles.sectionHeader, { marginTop: 18 }]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>REMINDERS</Text>
        <TouchableOpacity
          testID="quick-add-reminder-btn"
          style={styles.addReminderBtn}
          onPress={() => setShowReminderMenu(!showReminderMenu)}
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
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>At time of event</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-15m"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(-900)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>15 minutes before</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-1h"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(-3600)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>1 hour before</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-1d"
            style={styles.reminderMenuItem}
            onPress={() => handleAddReminderPreset(-86400)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>1 day before</Text>
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
            >
              <Text style={styles.removeReminderBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* DateTimePicker if active */}
      {activePicker && (
        <DateTimePicker
          value={
            activePicker.field === 'dueDate' && safeDueDate
              ? new Date(safeDueDate)
              : activePicker.field === 'startDate' && safeStartDate
              ? new Date(safeStartDate)
              : activePicker.field === 'endDate' && safeEndDate
              ? new Date(safeEndDate)
              : new Date()
          }
          mode={activePicker.mode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handlePickerChange}
        />
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
  repeatModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  activeModeButton: {
    backgroundColor: '#007AFF',
  },
  modeButtonText: {
    fontSize: 12,
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
