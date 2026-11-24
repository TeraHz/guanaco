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
  // English
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
  // Bulgarian
  неделя: 0,
  нед: 0,
  понеделник: 1,
  пон: 1,
  вторник: 2,
  вт: 2,
  сряда: 3,
  ср: 3,
  четвъртък: 4,
  четв: 4,
  чет: 4,
  петък: 5,
  пет: 5,
  събота: 6,
  съб: 6,
  // Spanish
  domingo: 0,
  dom: 0,
  lunes: 1,
  lun: 1,
  martes: 2,
  mar: 2,
  miércoles: 3,
  miercoles: 3,
  mié: 3,
  mie: 3,
  jueves: 4,
  jue: 4,
  viernes: 5,
  vie: 5,
  sábado: 6,
  sabado: 6,
  sáb: 6,
  sab: 6,
};

const NAMED_PRIORITIES: Record<string, number> = {
  // English
  low: 1,
  med: 2,
  medium: 2,
  high: 3,
  urgent: 4,
  crit: 5,
  critical: 5,
  // Bulgarian
  нисък: 1,
  ниско: 1,
  ниска: 1,
  среден: 2,
  средно: 2,
  средна: 2,
  висок: 3,
  високо: 3,
  висока: 3,
  спешен: 4,
  спешно: 4,
  спешна: 4,
  критичен: 5,
  критично: 5,
  критична: 5,
  // Spanish
  baja: 1,
  bajo: 1,
  media: 2,
  medio: 2,
  alta: 3,
  alto: 3,
  urgente: 4,
  crítica: 5,
  critica: 5,
  crítico: 5,
  critico: 5,
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

  // 3a. Normalize @today / @tomorrow / @tonight (EN/BG/ES) date shorthands BEFORE @user extraction
  text = text.replace(
    /(?:^|\s)@(today|tomorrow|tonight|днес|утре|довечера|hoy|mañana|manana)(?=\s|$)/giu,
    (_, dateKw) => ` ${dateKw}`
  );

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

  // 5. Extract Priority: !1 to !5 OR !low..!critical (EN/BG/ES)
  const priorityWordsPattern = Object.keys(NAMED_PRIORITIES).join('|');
  const priorityRegex = new RegExp(
    `(?:^|\\s)!(?:([1-5])|(${priorityWordsPattern}))(?=\\s|$)`,
    'giu'
  );
  text = text.replace(priorityRegex, (_, numStr, wordStr) => {
    if (numStr) {
      priority = parseInt(numStr, 10);
    } else if (wordStr) {
      const key = wordStr.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_PRIORITIES, key)) {
        priority = NAMED_PRIORITIES[key];
      }
    }
    return ' ';
  });

  // 6. Extract Repeat: EN ("every [N] days"), BG ("(на) всеки/всяка [N] дни"), ES ("cada [N] días")
  const repeatRegex =
    /(?:^|\s)(?:every|(?:на\s+)?(?:всеки|всяка|всяко)|cada)\s+(?:(\d+)\s+)?(hours?|days?|weeks?|months?|years?|часа?|часове|ден|дни|дена|седмица|седмици|месеца?|месеци|година|години|horas?|días?|dias?|semanas?|mes(?:es)?|años?|anos?)(?=\s|$)/iu;
  const repeatMatch = text.match(repeatRegex);
  if (repeatMatch) {
    const rawCountStr = repeatMatch[1] || '1';
    const count = rawCountStr.length <= 6 ? parseInt(rawCountStr, 10) : NaN;
    const unit = repeatMatch[2].toLowerCase();

    if (Number.isFinite(count) && count >= 1 && count <= MAX_REPEAT_COUNT) {
      if (unit.startsWith('hour') || unit.startsWith('час') || unit.startsWith('hora')) {
        repeatAfter = count * 3600;
        repeatMode = RepeatMode.FromDueDate;
      } else if (
        unit.startsWith('day') ||
        unit === 'ден' ||
        unit === 'дни' ||
        unit === 'дена' ||
        unit.startsWith('día') ||
        unit.startsWith('dia')
      ) {
        repeatAfter = count * 86400;
        repeatMode = RepeatMode.FromDueDate;
      } else if (
        unit.startsWith('week') ||
        unit.startsWith('седмиц') ||
        unit.startsWith('semana')
      ) {
        repeatAfter = count * 604800;
        repeatMode = RepeatMode.FromDueDate;
      } else if (unit.startsWith('month') || unit.startsWith('месец') || unit.startsWith('mes')) {
        repeatAfter = count * 2592000;
        repeatMode = RepeatMode.Monthly;
      } else if (
        unit.startsWith('year') ||
        unit.startsWith('годин') ||
        unit.startsWith('año') ||
        unit.startsWith('ano')
      ) {
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

  // Require :mm OR am/pm (EN), :mm OR ч/ч. (BG), or "a la(s) HH(:MM)" (ES) so bare street/store numbers are NEVER eaten!
  const enTimeMatch = text.match(/(?:^|\s)at\s+(\d{1,2})(?::(\d{2})\s*(am|pm)?|\s*(am|pm))(?=\s|$)/i);
  const bgTimeMatch = !enTimeMatch
    ? text.match(/(?:^|\s)в\s+(\d{1,2})(?::(\d{2})(?:\s*ч\.?)?|\s*ч\.?)(?=\s|$)/iu)
    : null;
  const esTimeMatch =
    !enTimeMatch && !bgTimeMatch
      ? text.match(/(?:^|\s)a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?=\s|$)/iu)
      : null;

  const activeTimeMatch = enTimeMatch || bgTimeMatch || esTimeMatch;
  if (activeTimeMatch) {
    const rawHour = parseInt(activeTimeMatch[1], 10);
    const minute = activeTimeMatch[2] !== undefined ? parseInt(activeTimeMatch[2], 10) : 0;
    const ampm = (activeTimeMatch[3] || activeTimeMatch[4])?.toLowerCase();

    const isMinuteValid = minute >= 0 && minute <= 59;
    const isHourValid = ampm ? rawHour >= 1 && rawHour <= 12 : rawHour >= 0 && rawHour <= 23;

    if (isMinuteValid && isHourValid) {
      let hour = rawHour;
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      parsedHour = hour;
      parsedMinute = minute;
      text = text.replace(activeTimeMatch[0], ' ');
    }
  }

  // Date relative patterns: EN ("in N days"), BG ("след N дни"), ES ("en N días")
  const inDaysRegex =
    /(?:^|\s)(?:in\s+(\d+)\s+days?|след\s+(\d+)\s+(?:ден|дни|дена)|en\s+(\d+)\s+(?:días?|dias?))(?=\s|$)/iu;
  const inDaysMatch = text.match(inDaysRegex);
  if (inDaysMatch) {
    const rawDaysStr = inDaysMatch[1] || inDaysMatch[2] || inDaysMatch[3] || '';
    const days = rawDaysStr.length <= 6 ? parseInt(rawDaysStr, 10) : NaN;
    if (Number.isFinite(days) && days >= 0 && days <= MAX_IN_DAYS) {
      targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate() + days);
      isTodayTarget = days === 0;
      text = text.replace(inDaysMatch[0], ' ');
    }
  }

  const tomorrowRegex = /(?:^|\s)(?:tomorrow|утре|mañana|manana)(?=\s|$)/iu;
  const todayRegex = /(?:^|\s)(?:today|днес|hoy)(?=\s|$)/iu;
  const tonightRegex = /(?:^|\s)(?:tonight|довечера|тази\s+вечер|esta\s+noche)(?=\s|$)/iu;

  if (!targetDate && tomorrowRegex.test(text)) {
    targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate() + 1);
    text = text.replace(tomorrowRegex, ' ');
  } else if (!targetDate && todayRegex.test(text)) {
    targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate());
    isTodayTarget = true;
    text = text.replace(todayRegex, ' ');
  } else if (!targetDate && tonightRegex.test(text)) {
    targetDate = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate());
    if (parsedHour === null) {
      parsedHour = 20;
      parsedMinute = 0;
    }
    text = text.replace(tonightRegex, ' ');
  } else if (!targetDate) {
    const weekdayKeysPattern = Object.keys(WEEKDAYS).join('|');
    const weekdayRegex = new RegExp(
      `(?:^|\\s)(?:(?:on|в|във|el)\\s+)?((?:next|следващия|следващата|другия|другата|próximo|proximo|próxima|proxima)\\s+)?(${weekdayKeysPattern})(?=\\s|$)`,
      'iu'
    );
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
