import { RepeatMode } from '../types/vikunja';

export interface ParsedTaskInput {
  title: string;
  labels: string[];
  assignees: string[];
  projectName?: string;
  priority?: number;
  dueDate?: string | null;
  repeatAfter?: number; // In seconds (Vikunja format)
  repeatMode?: RepeatMode;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const NAMED_PRIORITIES: Record<string, number> = {
  low: 1,
  med: 2,
  medium: 2,
  high: 3,
  urgent: 4,
  crit: 5,
  critical: 5,
};

const MAX_REPEAT_COUNT = 10000;
const MAX_IN_DAYS = 36500; // 100 years

export function parseQuickAdd(rawInput: string, now: Date = new Date()): ParsedTaskInput {
  const safeNow = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const trimmed = (typeof rawInput === 'string' ? rawInput : '').trim();

  // 1. Check if entire string is wrapped in a single pair of outer quotes (Skip parsing)
  if (
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    trimmed.length >= 2 &&
    !trimmed.slice(1, -1).includes('"')
  ) {
    return {
      title: trimmed.slice(1, -1),
      labels: [],
      assignees: [],
      dueDate: null,
    };
  }

  let text = trimmed;
  const labels: string[] = [];
  const assignees: string[] = [];
  let projectName: string | undefined;
  let priority: number | undefined;
  let dueDate: string | null = null;
  let repeatAfter: number | undefined;
  let repeatMode: RepeatMode | undefined;

  const pushUniqueCaseInsensitive = (arr: string[], val: string) => {
    if (val && !arr.some((existing) => existing.toLowerCase() === val.toLowerCase())) {
      arr.push(val);
    }
  };

  // 2. Extract Labels: *label, *"multi word", #label, #"multi word" (Unicode/Cyrillic supported)
  text = text.replace(/(?:^|\s)[*#](?:"([^"]+)"|([^\s*#+@!]+))/g, (_, quoted, unquoted) => {
    const val = (quoted || unquoted || '').trim();
    pushUniqueCaseInsensitive(labels, val);
    return ' ';
  });

  // 3a. Normalize @today / @tomorrow / @tonight date shorthands BEFORE @user extraction
  text = text.replace(/(?:^|\s)@(today|tomorrow|tonight)(?=\s|$)/gi, (_, dateKw) => ` ${dateKw}`);

  // 3b. Extract Assignees: @user or @"multi word user"
  text = text.replace(/(?:^|\s)@(?:"([^"]+)"|([^\s*#+@!]+))/g, (_, quoted, unquoted) => {
    const val = (quoted || unquoted || '').trim();
    pushUniqueCaseInsensitive(assignees, val);
    return ' ';
  });

  // 4. Extract Project: +Project or +"Project Name"
  text = text.replace(/(?:^|\s)\+(?:"([^"]+)"|([^\s*#+@!]+))/g, (_, quoted, unquoted) => {
    const val = (quoted || unquoted || '').trim();
    if (val) projectName = val;
    return ' ';
  });

  // 5. Extract Priority: !1 to !5 OR !low / !medium / !high / !urgent / !critical
  text = text.replace(
    /(?:^|\s)!(?:([1-5])|(low|med(?:ium)?|high|urgent|crit(?:ical)?))(?=\s|$)/gi,
    (_, numStr, wordStr) => {
      if (numStr) {
        priority = parseInt(numStr, 10);
      } else if (wordStr) {
        const key = wordStr.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(NAMED_PRIORITIES, key)) {
          priority = NAMED_PRIORITIES[key];
        }
      }
      return ' ';
    }
  );

  // 6. Extract Repeat: every [N] hour(s)/day(s)/week(s)/month(s)/year(s) (bounded to safe integers)
  const repeatRegex =
    /(?:^|\s)every\s+(?:(\d+)\s+)?(hour|hours|day|days|week|weeks|month|months|year|years)(?=\s|$)/i;
  const repeatMatch = text.match(repeatRegex);
  if (repeatMatch) {
    const rawCountStr = repeatMatch[1] || '1';
    const count = rawCountStr.length <= 6 ? parseInt(rawCountStr, 10) : NaN;
    const unit = repeatMatch[2].toLowerCase();

    if (Number.isFinite(count) && count >= 1 && count <= MAX_REPEAT_COUNT) {
      if (unit.startsWith('hour')) {
        repeatAfter = count * 3600;
        repeatMode = RepeatMode.FromDueDate;
      } else if (unit.startsWith('day')) {
        repeatAfter = count * 86400;
        repeatMode = RepeatMode.FromDueDate;
      } else if (unit.startsWith('week')) {
        repeatAfter = count * 604800;
        repeatMode = RepeatMode.FromDueDate;
      } else if (unit.startsWith('month')) {
        repeatAfter = count * 2592000;
        repeatMode = RepeatMode.Monthly;
      } else if (unit.startsWith('year')) {
        repeatAfter = count * 31536000;
        repeatMode = RepeatMode.FromDueDate;
      }
      text = text.replace(repeatMatch[0], ' ');
    }
  }

  // 7. Extract Dates & Times
  let targetDate: Date | null = null;
  let isTodayTarget = false;
  let parsedHour: number | null = null;
  let parsedMinute: number | null = null;

  // Require either :mm OR am/pm so bare store/street numbers ("at 7 Eleven", "at 42 Wallaby") are NEVER eaten!
  const timeRegex = /(?:^|\s)at\s+(\d{1,2})(?::(\d{2})\s*(am|pm)?|\s*(am|pm))(?=\s|$)/i;
  const timeMatch = text.match(timeRegex);
  if (timeMatch) {
    const rawHour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] !== undefined ? parseInt(timeMatch[2], 10) : 0;
    const ampm = (timeMatch[3] || timeMatch[4])?.toLowerCase();

    const isMinuteValid = minute >= 0 && minute <= 59;
    const isHourValid = ampm ? rawHour >= 1 && rawHour <= 12 : rawHour >= 0 && rawHour <= 23;

    if (isMinuteValid && isHourValid) {
      let hour = rawHour;
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      parsedHour = hour;
      parsedMinute = minute;
      text = text.replace(timeMatch[0], ' ');
    }
  }

  // Date relative patterns (bounded to [0..36500] days so large numbers never throw RangeError)
  const inDaysRegex = /(?:^|\s)in\s+(\d+)\s+(day|days)(?=\s|$)/i;
  const inDaysMatch = text.match(inDaysRegex);
  if (inDaysMatch) {
    const rawDaysStr = inDaysMatch[1];
    const days = rawDaysStr.length <= 6 ? parseInt(rawDaysStr, 10) : NaN;
    if (Number.isFinite(days) && days >= 0 && days <= MAX_IN_DAYS) {
      targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate() + days);
      isTodayTarget = days === 0;
      text = text.replace(inDaysMatch[0], ' ');
    }
  }

  if (!targetDate && /(?:^|\s)tomorrow(?=\s|$)/i.test(text)) {
    targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate() + 1);
    text = text.replace(/(?:^|\s)tomorrow(?=\s|$)/i, ' ');
  } else if (!targetDate && /(?:^|\s)today(?=\s|$)/i.test(text)) {
    targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate());
    isTodayTarget = true;
    text = text.replace(/(?:^|\s)today(?=\s|$)/i, ' ');
  } else if (!targetDate && /(?:^|\s)tonight(?=\s|$)/i.test(text)) {
    targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate());
    if (parsedHour === null) {
      parsedHour = 20;
      parsedMinute = 0;
    }
    text = text.replace(/(?:^|\s)tonight(?=\s|$)/i, ' ');
  } else if (!targetDate) {
    const weekdayRegex =
      /(?:^|\s)(?:on\s+)?(next\s+)?(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)(?=\s|$)/i;
    const weekdayMatch = text.match(weekdayRegex);
    if (weekdayMatch) {
      const hasNext = Boolean(weekdayMatch[1]);
      const dayKey = weekdayMatch[2].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(WEEKDAYS, dayKey)) {
        const targetDay = WEEKDAYS[dayKey];
        const currentDay = safeNow.getDay();
        let diff = targetDay - currentDay;
        if (diff <= 0) {
          diff += 7;
        } else if (hasNext) {
          diff += 7;
        }

        targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate() + diff);
        text = text.replace(weekdayMatch[0], ' ');
      }
    }
  }

  // Compose ISO dueDate safely
  if (targetDate || parsedHour !== null) {
    const finalDate =
      targetDate || new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate());
    if (parsedHour !== null) {
      finalDate.setHours(parsedHour, parsedMinute || 0, 0, 0);
      if (!targetDate && finalDate.getTime() <= safeNow.getTime()) {
        const nextDay = new Date(
          safeNow.getFullYear(),
          safeNow.getMonth(),
          safeNow.getDate() + 1,
          parsedHour,
          parsedMinute || 0,
          0,
          0
        );
        finalDate.setTime(nextDay.getTime());
      }
    } else {
      finalDate.setHours(18, 0, 0, 0);
      if (isTodayTarget && finalDate.getTime() <= safeNow.getTime()) {
        finalDate.setHours(21, 0, 0, 0);
        if (finalDate.getTime() <= safeNow.getTime()) {
          const plusHour = new Date(safeNow.getTime() + 60 * 60 * 1000);
          const cap = new Date(
            safeNow.getFullYear(),
            safeNow.getMonth(),
            safeNow.getDate(),
            23,
            59,
            0,
            0
          );
          if (cap.getTime() <= safeNow.getTime()) {
            cap.setHours(23, 59, 59, 999);
          }
          const chosen = plusHour.getTime() <= cap.getTime() ? plusHour : cap;
          finalDate.setTime(chosen.getTime());
        }
      }
    }
    if (!isNaN(finalDate.getTime())) {
      dueDate = finalDate.toISOString();
    }
  }

  const cleanedTitle = text.replace(/\s+/g, ' ').trim();

  const result: ParsedTaskInput = {
    title: cleanedTitle || trimmed,
    labels,
    assignees,
    projectName,
    priority,
    dueDate,
    repeatAfter,
  };

  if (repeatMode !== undefined) {
    result.repeatMode = repeatMode;
  }

  return result;
}
