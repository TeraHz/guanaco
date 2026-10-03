import { Task, Label } from '../types/vikunja';
import { extractCoreSubject } from './aiCore';

export interface StoreSuggestion {
  label: Label;
  count: number;
  confidence: number;
}

/**
 * Learns store associations from the user's task history.
 * Requires:
 * 1. At least 2 past tasks with the same core subject
 * 2. At least 75% confidence (3/4, 2/2, 4/5, etc.) for a single store label
 * 
 * Returns the suggested StoreSuggestion, or null if below threshold.
 * This is designed for optional one-tap suggestion chips to completely prevent false positives.
 */
export function getHistoricalStoreSuggestion(
  currentInput: string,
  allTasks: Task[],
  availableLabels: Label[]
): StoreSuggestion | null {
  if (!currentInput || !allTasks || allTasks.length === 0) return null;

  // If user already typed a label tag (*store), do not suggest
  if (/\*([a-zA-Z0-9_\u0400-\u04FF\s"'-]+)/.test(currentInput)) {
    return null;
  }

  const core = extractCoreSubject(currentInput).trim().toLowerCase();
  if (core.length < 2) return null;

  const labelCounts = new Map<number, { label: Label; count: number }>();
  let totalTaggedMatches = 0;

  for (const task of allTasks) {
    if (!task.labels || task.labels.length === 0) continue;

    const taskCore = extractCoreSubject(task.title).trim().toLowerCase();
    const taskTitle = task.title.toLowerCase();

    // Check if past task matches the core subject
    const isMatch =
      taskCore === core ||
      taskCore.includes(core) ||
      taskTitle.includes(core);

    if (isMatch) {
      for (const label of task.labels) {
        totalTaggedMatches++;
        const current = labelCounts.get(label.id);
        if (current) {
          current.count++;
        } else {
          labelCounts.set(label.id, { label, count: 1 });
        }
      }
    }
  }

  if (totalTaggedMatches < 2 || labelCounts.size === 0) {
    return null;
  }

  // Find label with highest count
  let bestLabel: Label | null = null;
  let maxCount = 0;

  for (const entry of labelCounts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      bestLabel = entry.label;
    }
  }

  if (!bestLabel) return null;

  const confidence = maxCount / totalTaggedMatches;

  // Strict threshold: at least 2 occurrences AND at least 75% confidence
  if (maxCount >= 2 && confidence >= 0.75) {
    return {
      label: bestLabel,
      count: maxCount,
      confidence,
    };
  }

  return null;
}
