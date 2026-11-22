import { Task } from '../types/vikunja';

export function getTaskSuggestions(
  currentInput: string,
  doneTasks: Task[],
  limit = 5
): Task[] {
  if (!currentInput || !Array.isArray(doneTasks) || doneTasks.length === 0) return [];
  const query = currentInput.trim().toLowerCase();
  if (query.length < 2 || /^[*#@+!]/.test(query)) return [];

  const seenTitles = new Set<string>();
  const matches: Task[] = [];

  for (const task of doneTasks) {
    if (!task?.title) continue;
    const titleLower = task.title.toLowerCase();
    if (titleLower.includes(query) && !seenTitles.has(titleLower)) {
      seenTitles.add(titleLower);
      matches.push(task);
      if (matches.length >= limit) break;
    }
  }

  return matches;
}

const ACTIVE_LABEL_QUERY_REGEX = /(?:^|\s)([*#])([\p{L}\p{N}_-]*)$/u;

export function getLabelSuggestions(
  currentInput: string,
  availableLabels: string[],
  lastUsedLabel?: string
): string[] {
  if (!currentInput || !Array.isArray(availableLabels) || availableLabels.length === 0) {
    return [];
  }

  // Check if input ends with * or # (preceded by start or whitespace) + optional Unicode partial name
  const match = currentInput.match(ACTIVE_LABEL_QUERY_REGEX);
  if (!match) return [];

  const partial = match[2].toLowerCase();
  let filtered = !partial
    ? [...availableLabels]
    : availableLabels.filter((lbl) => (lbl || '').toLowerCase().includes(partial));

  if (lastUsedLabel) {
    const lastLower = lastUsedLabel.toLowerCase();
    const lastMatches = filtered.filter((lbl) => lbl.toLowerCase() === lastLower);
    const otherMatches = filtered.filter((lbl) => lbl.toLowerCase() !== lastLower);
    filtered = [...lastMatches, ...otherMatches];
  }

  return filtered;
}

export function applyLabelSuggestion(
  currentInput: string,
  selectedLabel: string
): string {
  if (!currentInput) return '';
  const safeLabel = (selectedLabel || '').replace(/"/g, '').trim();

  return currentInput.replace(ACTIVE_LABEL_QUERY_REGEX, (fullMatch, trigger: string) => {
    const leadingWsMatch = fullMatch.match(/^\s+/);
    const leadingWs = leadingWsMatch ? leadingWsMatch[0] : '';
    const formatted = /[\s*#+@!]/.test(safeLabel)
      ? `${trigger}"${safeLabel}" `
      : `${trigger}${safeLabel} `;
    return `${leadingWs}${formatted}`;
  });
}
