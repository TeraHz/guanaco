export interface ParsedTaskInput {
  title: string;
  labels: string[];
  assignees: string[];
  projectName?: string;
  priority?: number;
  dueDate?: string | null;
  repeatAfter?: number; // In seconds (Vikunja format)
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

export function parseQuickAdd(rawInput: string, now: Date = new Date()): ParsedTaskInput {
  const trimmed = rawInput.trim();

  // 1. Check if entire string is wrapped in quotes (Skip parsing)
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
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

  // 2. Extract Labels: *label or *"multi word label"
  text = text.replace(/(?:^|\s)\*(?:"([^"]+)"|([^\s*+@!]+))/g, (_, quoted, unquoted) => {
    const val = (quoted || unquoted || '').trim();
    if (val) labels.push(val);
    return ' ';
  });

  // 3. Extract Assignees: @user or @"multi word user"
  text = text.replace(/(?:^|\s)@(?:"([^"]+)"|([^\s*+@!]+))/g, (_, quoted, unquoted) => {
    const val = (quoted || unquoted || '').trim();
    if (val) assignees.push(val);
    return ' ';
  });

  // 4. Extract Project: +Project or +"Project Name"
  text = text.replace(/(?:^|\s)\+(?:"([^"]+)"|([^\s*+@!]+))/g, (_, quoted, unquoted) => {
    const val = (quoted || unquoted || '').trim();
    if (val) projectName = val;
    return ' ';
  });

  // 5. Extract Priority: !1 to !5
  text = text.replace(/(?:^|\s)!([1-5])(?=\s|$)/g, (_, pStr) => {
    priority = parseInt(pStr, 10);
    return ' ';
  });

  // 6. Extract Repeat: every [N] day(s)/week(s)/month(s)
  const repeatRegex = /(?:^|\s)every\s+(?:(\d+)\s+)?(day|days|week|weeks|month|months|year|years)(?=\s|$)/i;
  const repeatMatch = text.match(repeatRegex);
  if (repeatMatch) {
    const count = parseInt(repeatMatch[1] || '1', 10);
    const unit = repeatMatch[2].toLowerCase();

    if (unit.startsWith('day')) {
      repeatAfter = count * 86400;
    } else if (unit.startsWith('week')) {
      repeatAfter = count * 604800;
    } else if (unit.startsWith('month')) {
      repeatAfter = count * 2592000;
    } else if (unit.startsWith('year')) {
      repeatAfter = count * 31536000;
    }
    text = text.replace(repeatMatch[0], ' ');
  }

  // 7. Extract Dates & Times
  let targetDate: Date | null = null;
  let parsedHour: number | null = null;
  let parsedMinute: number | null = null;

  // Check for time: "at 5pm", "at 17:00", "at 10:30am"
  const timeRegex = /(?:^|\s)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?=\s|$)/i;
  const timeMatch = text.match(timeRegex);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3]?.toLowerCase();

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    parsedHour = hour;
    parsedMinute = minute;
    text = text.replace(timeMatch[0], ' ');
  }

  // Date relative patterns
  const inDaysRegex = /(?:^|\s)in\s+(\d+)\s+(day|days)(?=\s|$)/i;
  const inDaysMatch = text.match(inDaysRegex);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    targetDate = new Date(now.getTime());
    targetDate.setDate(targetDate.getDate() + days);
    text = text.replace(inDaysMatch[0], ' ');
  } else if (/(?:^|\s)tomorrow(?=\s|$)/i.test(text)) {
    targetDate = new Date(now.getTime());
    targetDate.setDate(targetDate.getDate() + 1);
    text = text.replace(/(?:^|\s)tomorrow(?=\s|$)/i, ' ');
  } else if (/(?:^|\s)today(?=\s|$)/i.test(text)) {
    targetDate = new Date(now.getTime());
    text = text.replace(/(?:^|\s)today(?=\s|$)/i, ' ');
  } else if (/(?:^|\s)tonight(?=\s|$)/i.test(text)) {
    targetDate = new Date(now.getTime());
    parsedHour = 20;
    parsedMinute = 0;
    text = text.replace(/(?:^|\s)tonight(?=\s|$)/i, ' ');
  } else {
    // Weekdays
    const weekdayRegex = /(?:^|\s)(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=\s|$)/i;
    const weekdayMatch = text.match(weekdayRegex);
    if (weekdayMatch) {
      const targetDay = WEEKDAYS[weekdayMatch[1].toLowerCase()];
      const currentDay = now.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7;

      targetDate = new Date(now.getTime());
      targetDate.setDate(targetDate.getDate() + diff);
      text = text.replace(weekdayMatch[0], ' ');
    }
  }

  // If a date or time was parsed, compose the ISO dueDate string
  if (targetDate || parsedHour !== null) {
    const finalDate = targetDate || new Date(now.getTime());
    if (parsedHour !== null) {
      finalDate.setHours(parsedHour, parsedMinute || 0, 0, 0);
    } else {
      // Default to end of workday (18:00)
      finalDate.setHours(18, 0, 0, 0);
    }
    dueDate = finalDate.toISOString();
  }

  // Clean title: collapse whitespace
  const cleanedTitle = text.replace(/\s+/g, ' ').trim();

  return {
    title: cleanedTitle || rawInput.trim(),
    labels,
    assignees,
    projectName,
    priority,
    dueDate,
    repeatAfter,
  };
}
