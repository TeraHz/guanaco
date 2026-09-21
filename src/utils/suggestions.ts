import { Task } from '../types/vikunja';

export function getTaskSuggestions(
  currentInput: string,
  doneTasks: Task[],
  limit = 5
): Task[] {
  const query = currentInput.trim().toLowerCase();
  if (query.length < 2) return [];

  const seenTitles = new Set<string>();
  const matches: Task[] = [];

  for (const task of doneTasks) {
    const titleLower = task.title.toLowerCase();
    if (titleLower.includes(query) && !seenTitles.has(titleLower)) {
      seenTitles.add(titleLower);
      matches.push(task);
      if (matches.length >= limit) break;
    }
  }

  return matches;
}

export function getLabelSuggestions(
  currentInput: string,
  availableLabels: string[],
  lastUsedLabel?: string
): string[] {
  // Check if input currently ends with * or *partial_name
  const match = currentInput.match(/\*([a-zA-Z0-9_-]*)$/);
  if (!match) return [];

  const partial = match[1].toLowerCase();
  let filtered = !partial
    ? [...availableLabels]
    : availableLabels.filter((lbl) => lbl.toLowerCase().includes(partial));

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
  const formatted = selectedLabel.includes(' ')
    ? `*"${selectedLabel}" `
    : `*${selectedLabel} `;

  return currentInput.replace(/\*([a-zA-Z0-9_-]*)$/, formatted);
}
