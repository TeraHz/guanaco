import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { RepeatMode, ReminderRelativeTo, TaskReminder, WeekStartDay } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import {
  normalizeVikunjaDate,
  formatDateDisplay,
  getDatePreset,
  postponeDateByDays,
  formatIsoForVikunja,
} from '../utils/dates';
import {
  formatRepeatDescription,
  intervalToSeconds,
  secondsToInterval,
  TimeUnit,
} from '../utils/repeat';
import { formatReminderDescription } from '../utils/reminders';
import { getFormattingLocale, TranslationKey, useTranslation } from '../i18n';

export interface TaskScheduleSectionProps {
  dueDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  repeatAfter?: number;
  repeatMode?: RepeatMode;
  reminders?: TaskReminder[];
  weekStartDay?: WeekStartDay;
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

const FIELD_LABEL_KEYS: Record<ScheduleField, TranslationKey> = {
  dueDate: 'schedule.fieldDue',
  startDate: 'schedule.fieldStart',
  endDate: 'schedule.fieldEnd',
};

export const TaskScheduleSection: React.FC<TaskScheduleSectionProps> = ({
  dueDate,
  startDate,
  endDate,
  repeatAfter = 0,
  repeatMode = RepeatMode.FromDueDate,
  reminders = [],
  weekStartDay = 1,
  onChangeDueDate,
  onChangeStartDate,
  onChangeEndDate,
  onChangeRepeat,
  onChangeReminders,
}) => {
  const theme = useAppTheme();
  const { t, locale } = useTranslation();
  const fmtLocale = getFormattingLocale(locale);

  const getFieldLabel = (field: ScheduleField): string =>
    Object.prototype.hasOwnProperty.call(FIELD_LABEL_KEYS, field)
      ? t(FIELD_LABEL_KEYS[field])
      : t('schedule.fieldDateFallback');

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
  const [customRepeatExpanded, setCustomRepeatExpanded] = useState(false);

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

    if (safeStartDate && candidateDate.getTime() < new Date(safeStartDate).getTime()) {
      setDateValidationError(t('taskDetail.endBeforeStartError'));
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
    const d = getDatePreset(preset, new Date(), weekStartDay);
    if (d) {
      onChangeDueDate(formatIsoForVikunja(d));
    }
  };

  const handlePostponeByDays = (days: number) => {
    safeHaptics.selection();
    const shifted = postponeDateByDays(safeDueDate, days, new Date());
    onChangeDueDate(formatIsoForVikunja(shifted));
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
      setPendingIosDate(combined);
      commitIsoToField(field, combined);
      return;
    }

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
        setWebInputError(t('schedule.webInvalidDateFormat'));
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
        setWebInputError(t('schedule.webInvalidCalendarDate'));
        return;
      }
      setWebInputError(null);
      if (commitIsoToField(field, candidate)) {
        setActivePicker(null);
      }
      return;
    }

    const tm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm) {
      setWebInputError(t('schedule.webInvalidTimeFormat'));
      return;
    }
    const hours = parseInt(tm[1], 10);
    const minutes = parseInt(tm[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      setWebInputError(t('schedule.webInvalidHoursMinutes'));
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

  const isMonthlySelected =
    !customRepeatExpanded &&
    (repeatMode === RepeatMode.Monthly || repeatAfter === 2592000) &&
    (repeatAfter <= 0 || repeatAfter === 2592000);
  const isNeverSelected = !customRepeatExpanded && repeatAfter === 0 && repeatMode !== RepeatMode.Monthly;
  const isDailySelected =
    !customRepeatExpanded && repeatAfter === 86400 && repeatMode !== RepeatMode.Monthly;
  const isWeeklySelected =
    !customRepeatExpanded && repeatAfter === 604800 && repeatMode !== RepeatMode.Monthly;
  const isNonStandardInterval =
    (repeatAfter > 0 && !isDailySelected && !isWeeklySelected && !isMonthlySelected) ||
    (repeatMode === RepeatMode.Monthly && repeatAfter > 2592000);
  const isCustomSelected = customRepeatExpanded || isNonStandardInterval;

  const parsedCustomInterval = secondsToInterval(
    repeatAfter > 0 ? repeatAfter : 172800,
    repeatMode
  ) || { amount: 2, unit: 'days' as TimeUnit };
  const customUnits: { key: TimeUnit; label: string }[] = [
    { key: 'hours', label: t('schedule.unitHours') },
    { key: 'days', label: t('schedule.unitDays') },
    { key: 'weeks', label: t('schedule.unitWeeks') },
    { key: 'months', label: t('schedule.unitMonths') },
    { key: 'years', label: t('schedule.unitYears') },
  ];
  const derivedUnit: TimeUnit = customUnits.some((u) => u.key === parsedCustomInterval.unit)
    ? parsedCustomInterval.unit
    : 'days';
  const derivedAmount = Math.max(1, parsedCustomInterval.amount);

  const [activeCustomUnit, setActiveCustomUnit] = useState<TimeUnit>(derivedUnit);
  const [activeCustomAmount, setActiveCustomAmount] = useState<number>(derivedAmount);

  useEffect(() => {
    setActiveCustomUnit(derivedUnit);
    setActiveCustomAmount(derivedAmount);
  }, [repeatAfter, repeatMode, derivedUnit, derivedAmount]);

  const applyCustomRepeat = (nextAmount: number, nextUnit: TimeUnit) => {
    const clampedAmount = Math.max(1, Math.min(365, Math.round(nextAmount)));
    setActiveCustomAmount(clampedAmount);
    setActiveCustomUnit(nextUnit);
    const secs = intervalToSeconds(clampedAmount, nextUnit);
    const nextMode =
      nextUnit === 'months'
        ? RepeatMode.Monthly
        : repeatMode === RepeatMode.Monthly
        ? RepeatMode.FromDueDate
        : repeatMode;
    onChangeRepeat(secs, nextMode);
  };

  const currentPickerValue = activePicker
    ? pendingIosDate || getBaseDateForField(activePicker.field)
    : new Date();

  const secondarySurface = {
    backgroundColor: theme.colors.surfaceSecondary,
    borderColor: theme.colors.borderStrong,
  };

  const activeAccentStyle = {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  };

  return (
    <View style={styles.container}>
      {/* DUE DATE SECTION */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
          {t('schedule.dueDateSection')}
        </Text>
        {safeDueDate && (
          <TouchableOpacity
            testID="clear-due-date-btn"
            onPress={handleClearDueDate}
            style={[styles.clearBtn, secondarySurface]}
            accessibilityRole="button"
            accessibilityLabel={t('schedule.clearDueDateA11y')}
          >
            <Text style={[styles.clearBtnText, { color: theme.colors.textSecondary }]}>
              {t('common.clear')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Due Date Display / Picker Trigger */}
      <View style={styles.dateRow}>
        <TouchableOpacity
          testID="picker-due-date-trigger"
          style={[
            styles.dateBadge,
            { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.borderStrong },
          ]}
          onPress={() => openPicker('dueDate', 'date')}
          accessibilityRole="button"
          accessibilityLabel={t('schedule.selectDueDateA11y')}
        >
          <Text
            style={[
              styles.dateBadgeText,
              { color: safeDueDate ? theme.colors.text : theme.colors.textSecondary },
            ]}
          >
            {safeDueDate ? formatDateDisplay(safeDueDate) : t('schedule.notSet')}
          </Text>
        </TouchableOpacity>

        {safeDueDate && (
          <TouchableOpacity
            testID="picker-due-time-trigger"
            style={[
              styles.timeBadge,
              { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.borderStrong },
            ]}
            onPress={() => openPicker('dueDate', 'time')}
            accessibilityRole="button"
            accessibilityLabel={t('schedule.selectDueTimeA11y')}
          >
            <Text style={[styles.dateBadgeText, { color: theme.colors.accent }]}>
              {new Date(safeDueDate).toLocaleTimeString(fmtLocale, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Date Presets */}
      <View style={styles.presetsRow}>
        <TouchableOpacity
          testID="preset-today"
          style={[styles.presetChip, secondarySurface]}
          onPress={() => handleApplyPreset('today')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>
            {t('schedule.today')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-tomorrow"
          style={[styles.presetChip, secondarySurface]}
          onPress={() => handleApplyPreset('tomorrow')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>
            {t('schedule.tomorrow')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-weekend"
          style={[styles.presetChip, secondarySurface]}
          onPress={() => handleApplyPreset('this_weekend')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>
            {t('schedule.weekend')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="preset-next-week"
          style={[styles.presetChip, secondarySurface]}
          onPress={() => handleApplyPreset('next_week')}
          accessibilityRole="button"
        >
          <Text style={[styles.presetText, { color: theme.colors.text }]}>
            {t('schedule.nextWeek')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Postpone / Defer Shortcuts */}
      <View style={[styles.presetsRow, { marginTop: 8 }]}>
        {[
          { days: 1, label: t('schedule.postpone1d'), testID: 'postpone-1d' },
          { days: 3, label: t('schedule.postpone3d'), testID: 'postpone-3d' },
          { days: 7, label: t('schedule.postpone1w'), testID: 'postpone-1w' },
        ].map((item) => (
          <TouchableOpacity
            key={item.testID}
            testID={item.testID}
            style={[styles.presetChip, secondarySurface]}
            onPress={() => handlePostponeByDays(item.days)}
            accessibilityRole="button"
            accessibilityLabel={
              item.days === 1
                ? t('schedule.postponeOneDayA11y')
                : t('schedule.postponeDaysA11y', { days: item.days })
            }
          >
            <Text style={[styles.presetText, { color: theme.colors.textSecondary }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* START & END DATES SECTION */}
      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, marginTop: 18 }]}>
        {t('schedule.startEndSection')}
      </Text>
      <View style={styles.startEndRow}>
        {/* Start Date */}
        <View style={styles.startEndCol}>
          <Text style={[styles.subLabel, { color: theme.colors.textSecondary }]}>
            {t('schedule.starts')}
          </Text>
          <TouchableOpacity
            testID="picker-start-date-trigger"
            style={[
              styles.dateBadge,
              { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.borderStrong },
            ]}
            onPress={() => openPicker('startDate', 'date')}
            accessibilityRole="button"
            accessibilityLabel={t('schedule.selectStartDateA11y')}
          >
            <Text
              style={[
                styles.dateBadgeText,
                { color: safeStartDate ? theme.colors.text : theme.colors.textSecondary },
              ]}
            >
              {safeStartDate ? formatDateDisplay(safeStartDate) : t('schedule.notSet')}
            </Text>
          </TouchableOpacity>
          {safeStartDate && (
            <View style={styles.inlineTimeActionsRow}>
              <TouchableOpacity
                testID="picker-start-time-trigger"
                style={[
                  styles.smallTimeBadge,
                  { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.borderStrong },
                ]}
                onPress={() => openPicker('startDate', 'time')}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.selectStartTimeA11y')}
              >
                <Text style={[styles.dateBadgeText, { color: theme.colors.accent, fontSize: 12 }]}>
                  {new Date(safeStartDate).toLocaleTimeString(fmtLocale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="clear-start-date-btn"
                onPress={handleClearStartDate}
                style={[styles.clearBtn, secondarySurface]}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.clearStartDateA11y')}
              >
                <Text style={[styles.clearBtnText, { color: theme.colors.textSecondary }]}>
                  {t('common.clear')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* End Date */}
        <View style={styles.startEndCol}>
          <Text style={[styles.subLabel, { color: theme.colors.textSecondary }]}>
            {t('schedule.ends')}
          </Text>
          <TouchableOpacity
            testID="picker-end-date-trigger"
            style={[
              styles.dateBadge,
              { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.borderStrong },
            ]}
            onPress={() => openPicker('endDate', 'date')}
            accessibilityRole="button"
            accessibilityLabel={t('schedule.selectEndDateA11y')}
          >
            <Text
              style={[
                styles.dateBadgeText,
                { color: safeEndDate ? theme.colors.text : theme.colors.textSecondary },
              ]}
            >
              {safeEndDate ? formatDateDisplay(safeEndDate) : t('schedule.notSet')}
            </Text>
          </TouchableOpacity>
          {safeEndDate && (
            <View style={styles.inlineTimeActionsRow}>
              <TouchableOpacity
                testID="picker-end-time-trigger"
                style={[
                  styles.smallTimeBadge,
                  { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.borderStrong },
                ]}
                onPress={() => openPicker('endDate', 'time')}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.selectEndTimeA11y')}
              >
                <Text style={[styles.dateBadgeText, { color: theme.colors.accent, fontSize: 12 }]}>
                  {new Date(safeEndDate).toLocaleTimeString(fmtLocale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="clear-end-date-btn"
                onPress={handleClearEndDate}
                style={[styles.clearBtn, secondarySurface]}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.clearEndDateA11y')}
              >
                <Text style={[styles.clearBtnText, { color: theme.colors.textSecondary }]}>
                  {t('common.clear')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {dateValidationError ? (
        <Text
          testID="schedule-date-error"
          style={[styles.validationErrorText, { color: theme.colors.danger }]}
        >
          {dateValidationError}
        </Text>
      ) : null}

      {/* Active Date/Time Picker UI */}
      {activePicker && Platform.OS === 'web' && (
        <View
          testID="web-picker-container"
          style={[
            styles.pickerCard,
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.borderStrong },
          ]}
        >
          <Text style={[styles.pickerCardTitle, { color: theme.colors.text }]}>
            {t(activePicker.mode === 'date' ? 'schedule.setFieldDate' : 'schedule.setFieldTime', {
              field: getFieldLabel(activePicker.field),
            })}
          </Text>
          <View style={styles.webInputRow}>
            <TextInput
              testID="web-datetime-input"
              style={[
                styles.webInput,
                {
                  backgroundColor: theme.colors.inputBg,
                  color: theme.colors.text,
                  borderColor: theme.colors.borderStrong,
                },
              ]}
              value={webInputText}
              onChangeText={(txt) => {
                setWebInputText(txt);
                if (webInputError) setWebInputError(null);
              }}
              placeholder={activePicker.mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM'}
              placeholderTextColor={theme.colors.placeholder}
              onSubmitEditing={handleWebApply}
              autoFocus
            />
            <TouchableOpacity
              testID="web-picker-apply-btn"
              style={[styles.pickerActionBtn, { backgroundColor: theme.colors.accent }]}
              onPress={handleWebApply}
              accessibilityRole="button"
            >
              <Text style={styles.pickerActionBtnText}>{t('common.apply')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="web-picker-cancel-btn"
              style={[styles.pickerCancelBtn, secondarySurface]}
              onPress={() => {
                setWebInputError(null);
                setActivePicker(null);
              }}
              accessibilityRole="button"
            >
              <Text style={[styles.pickerCancelBtnText, { color: theme.colors.text }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
          {webInputError ? (
            <Text
              testID="web-picker-error"
              style={[styles.validationErrorText, { color: theme.colors.danger }]}
            >
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
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.borderStrong },
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
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.pickerCardTitle, { color: theme.colors.text }]}>
              {t(activePicker.mode === 'date' ? 'schedule.iosFieldDate' : 'schedule.iosFieldTime', {
                field: getFieldLabel(activePicker.field),
              })}
            </Text>
            <TouchableOpacity
              testID="ios-picker-done-btn"
              onPress={handleIosDone}
              style={styles.iosToolbarBtn}
              accessibilityRole="button"
            >
              <Text style={[styles.iosDoneText, { color: theme.colors.accent }]}>
                {t('common.done')}
              </Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={currentPickerValue}
            mode={activePicker.mode}
            display="spinner"
            locale={fmtLocale}
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
        {t('schedule.repeatSection')}
      </Text>
      <View style={styles.presetsRow}>
        <TouchableOpacity
          testID="repeat-preset-never"
          style={[styles.presetChip, isNeverSelected ? activeAccentStyle : secondarySurface]}
          onPress={() => {
            safeHaptics.selection();
            setCustomRepeatExpanded(false);
            onChangeRepeat(0, RepeatMode.FromDueDate);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isNeverSelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isNeverSelected ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            {t('schedule.never')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-daily"
          style={[styles.presetChip, isDailySelected ? activeAccentStyle : secondarySurface]}
          onPress={() => {
            safeHaptics.selection();
            setCustomRepeatExpanded(false);
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
              { color: isDailySelected ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            {t('schedule.daily')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-weekly"
          style={[styles.presetChip, isWeeklySelected ? activeAccentStyle : secondarySurface]}
          onPress={() => {
            safeHaptics.selection();
            setCustomRepeatExpanded(false);
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
              { color: isWeeklySelected ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            {t('schedule.weekly')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-monthly"
          style={[styles.presetChip, isMonthlySelected ? activeAccentStyle : secondarySurface]}
          onPress={() => {
            safeHaptics.selection();
            setCustomRepeatExpanded(false);
            onChangeRepeat(2592000, RepeatMode.Monthly);
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isMonthlySelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isMonthlySelected ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            {t('schedule.monthly')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-preset-custom"
          style={[styles.presetChip, isCustomSelected ? activeAccentStyle : secondarySurface]}
          onPress={() => {
            safeHaptics.selection();
            setCustomRepeatExpanded(true);
            if (!repeatAfter || repeatAfter <= 0) {
              applyCustomRepeat(2, 'days');
            }
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isCustomSelected }}
        >
          <Text
            style={[
              styles.presetText,
              { color: isCustomSelected ? '#FFFFFF' : theme.colors.textSecondary },
            ]}
          >
            {t('schedule.custom')}
          </Text>
        </TouchableOpacity>
      </View>

      {isCustomSelected && (
        <View
          testID="custom-repeat-editor"
          style={[
            styles.pickerCard,
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.borderStrong },
          ]}
        >
          <View style={styles.customRepeatTopRow}>
            <Text style={[styles.pickerCardTitle, { color: theme.colors.text }]}>
              {t('schedule.every')}
            </Text>
            <View style={styles.customStepperRow}>
              <TouchableOpacity
                testID="custom-repeat-decrement"
                style={[styles.customStepperBtn, secondarySurface]}
                disabled={activeCustomAmount <= 1}
                onPress={() => {
                  safeHaptics.selection();
                  applyCustomRepeat(activeCustomAmount - 1, activeCustomUnit);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.decreaseRepeatA11y')}
              >
                <Text
                  style={[
                    styles.customStepperText,
                    {
                      color:
                        activeCustomAmount <= 1
                          ? theme.colors.textTertiary
                          : theme.colors.accent,
                    },
                  ]}
                >
                  −
                </Text>
              </TouchableOpacity>
              <Text
                testID="custom-repeat-amount"
                style={[styles.customAmountText, { color: theme.colors.text }]}
              >
                {activeCustomAmount}
              </Text>
              <TouchableOpacity
                testID="custom-repeat-increment"
                style={[styles.customStepperBtn, secondarySurface]}
                onPress={() => {
                  safeHaptics.selection();
                  applyCustomRepeat(activeCustomAmount + 1, activeCustomUnit);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('schedule.increaseRepeatA11y')}
              >
                <Text style={[styles.customStepperText, { color: theme.colors.accent }]}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={[styles.presetsRow, { marginTop: 10 }]}>
            {customUnits.map((u) => {
              const selected = activeCustomUnit === u.key;
              return (
                <TouchableOpacity
                  key={u.key}
                  testID={`custom-repeat-unit-${u.key}`}
                  style={[styles.presetChip, selected ? activeAccentStyle : secondarySurface]}
                  onPress={() => {
                    safeHaptics.selection();
                    applyCustomRepeat(activeCustomAmount, u.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.presetText,
                      { color: selected ? '#FFFFFF' : theme.colors.textSecondary },
                    ]}
                  >
                    {u.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Repeat Mode Selector */}
      <View style={styles.repeatModeRow}>
        <TouchableOpacity
          testID="repeat-mode-from-due-date"
          style={[
            styles.modeButton,
            repeatMode === RepeatMode.FromDueDate ? activeAccentStyle : secondarySurface,
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
            {t('schedule.fromDueDate')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-mode-monthly"
          style={[
            styles.modeButton,
            repeatMode === RepeatMode.Monthly ? activeAccentStyle : secondarySurface,
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
            {t('schedule.monthly')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="repeat-mode-from-completion"
          style={[
            styles.modeButton,
            repeatMode === RepeatMode.FromCompletion ? activeAccentStyle : secondarySurface,
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
            {t('schedule.afterCompletion')}
          </Text>
        </TouchableOpacity>
      </View>

      {(repeatAfter > 0 || repeatMode === RepeatMode.Monthly) && (
        <Text style={[styles.repeatSummaryText, { color: theme.colors.textSecondary }]}>
          {formatRepeatDescription(
            repeatMode === RepeatMode.Monthly && repeatAfter <= 0 ? 2592000 : repeatAfter,
            repeatMode
          )}
        </Text>
      )}

      {/* REMINDERS SECTION */}
      <View style={[styles.sectionHeader, { marginTop: 18 }]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
          {t('schedule.remindersSection')}
        </Text>
        <TouchableOpacity
          testID="quick-add-reminder-btn"
          style={styles.addReminderBtn}
          onPress={() => setShowReminderMenu(!showReminderMenu)}
          accessibilityRole="button"
        >
          <Text style={[styles.addReminderBtnText, { color: theme.colors.accent }]}>
            {t('schedule.addReminderBtn')}
          </Text>
        </TouchableOpacity>
      </View>

      {showReminderMenu && (
        <View
          style={[
            styles.reminderMenuCard,
            { backgroundColor: theme.colors.cardSecondary, borderColor: theme.colors.borderStrong },
          ]}
        >
          <TouchableOpacity
            testID="reminder-preset-0"
            style={[styles.reminderMenuItem, { borderBottomColor: theme.colors.border }]}
            onPress={() => handleAddReminderPreset(0)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              {t('schedule.atTimeOfEvent')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-15m"
            style={[styles.reminderMenuItem, { borderBottomColor: theme.colors.border }]}
            onPress={() => handleAddReminderPreset(-900)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              {t('schedule.15mBefore')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-1h"
            style={[styles.reminderMenuItem, { borderBottomColor: theme.colors.border }]}
            onPress={() => handleAddReminderPreset(-3600)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              {t('schedule.1hBefore')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="reminder-preset-1d"
            style={[styles.reminderMenuItem, { borderBottomWidth: 0 }]}
            onPress={() => handleAddReminderPreset(-86400)}
          >
            <Text style={[styles.reminderMenuItemText, { color: theme.colors.text }]}>
              {t('schedule.1dBefore')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Reminders List */}
      {reminders.length === 0 ? (
        <Text style={[styles.emptyRemindersText, { color: theme.colors.textSecondary }]}>
          {t('schedule.noReminders')}
        </Text>
      ) : (
        reminders.map((reminder, idx) => (
          <View
            key={idx}
            style={[styles.reminderItem, secondarySurface]}
          >
            <Text style={[styles.reminderItemText, { color: theme.colors.text }]}>
              {formatReminderDescription(reminder)}
            </Text>
            <TouchableOpacity
              testID={`remove-reminder-${idx}`}
              style={styles.removeReminderBtn}
              onPress={() => handleRemoveReminder(idx)}
              accessibilityRole="button"
              accessibilityLabel={t('schedule.removeReminderA11y', { index: idx + 1 })}
            >
              <Text style={[styles.removeReminderBtnText, { color: theme.colors.danger }]}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
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
    letterSpacing: 0.6,
  },
  clearBtn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inlineTimeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
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
  smallTimeBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  pickerCancelBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
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
    borderWidth: 1,
    alignItems: 'center',
  },
  modeButtonText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  repeatSummaryText: {
    fontSize: 12,
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
  },
  reminderMenuItemText: {
    fontSize: 13,
  },
  emptyRemindersText: {
    fontSize: 13,
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
    fontSize: 14,
    fontWeight: '700',
  },
  customRepeatTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customStepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customStepperText: {
    fontSize: 16,
    fontWeight: '700',
  },
  customAmountText: {
    fontSize: 15,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center',
  },
});
