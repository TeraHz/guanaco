import { Task, Label } from '../types/vikunja';
import { extractCoreSubject } from './aiCore';
import { parseQuickAdd } from './quickAddParser';

export interface StoreSuggestion {
  label: Label;
  count: number;
  confidence: number;
}

const STOP_WORDS = new Set([
  'at', 'in', 'on', 'to', 'by', 'of', 'or', 'an', 'the', 'for', 'and', 'with', 'from',
  'buy', 'get', 'need', 'pick', 'up', 'new', 'some', 'more',
  'за', 'на', 'от', 'до', 'със', 'купи', 'вземи',
]);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesCoreSubject(queryCore: string, candidateCore: string, candidateTitle: string): boolean {
  if (!queryCore || !candidateTitle) return false;
  if (candidateCore === queryCore) return true;

  const escapedQuery = escapeRegex(queryCore);
  if (queryCore.length === 3) {
    // Strict whole-word (with optional s/es plural) for 3-char words so "tea" never matches "steaks" and "ham" never matches "shampoo"
    const wholeWordRe = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escapedQuery}(?:s|es)?(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );
    return wholeWordRe.test(candidateCore) || wholeWordRe.test(candidateTitle);
  }

  // >= 4 chars: word-start boundary match so "beef" matches "Ground beef" / "Beef steaks" and "croissant" matches "Croissants",
  // while never matching mid-word substrings (e.g. "apple" never matches "pineapple").
  const wordStartRe = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapedQuery}`, 'iu');
  if (wordStartRe.test(candidateCore) || wordStartRe.test(candidateTitle)) {
    return true;
  }

  // Symmetric check when user typed a fuller phrase (e.g. "beef steaks") and history has core "beef" (>= 4 chars)
  if (candidateCore.length >= 4 && !STOP_WORDS.has(candidateCore)) {
    const candidateWordRe = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escapeRegex(candidateCore)}(?:s|es)?(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );
    return candidateWordRe.test(queryCore);
  }

  return false;
}

/**
 * Learns store associations from the user's task history.
 * Requires:
 * 1. Meaningful core subject (>= 3 non-stopword characters, word-boundary matched)
 * 2. Label exists in `availableLabels` (deleted labels are never suggested)
 * 3. At least 2 past tasks with the same core subject
 * 4. At least 75% confidence for a single store label
 */
export function getHistoricalStoreSuggestion(
  currentInput: string,
  allTasks: Task[],
  availableLabels: Label[]
): StoreSuggestion | null {
  if (
    !currentInput ||
    !Array.isArray(allTasks) ||
    allTasks.length === 0 ||
    !Array.isArray(availableLabels) ||
    availableLabels.length === 0
  ) {
    return null;
  }

  // If user already typed a *label or #label tag, do not suggest
  if (/(?:^|\s)[*#](?:"[^"]+"|[^\s*#+@!]+)/.test(currentInput)) {
    return null;
  }

  // Build canonical lookup of currently available (non-deleted) labels
  const availableById = new Map<number, Label>();
  const availableByTitle = new Map<string, Label>();
  for (const lbl of availableLabels) {
    if (!lbl?.title) continue;
    if (lbl.id > 0) availableById.set(lbl.id, lbl);
    availableByTitle.set(lbl.title.trim().toLowerCase(), lbl);
  }
  if (availableByTitle.size === 0) return null;

  const resolveAvailableLabel = (lbl: Label): Label | null => {
    if (!lbl) return null;
    if (lbl.id > 0 && availableById.has(lbl.id)) {
      return availableById.get(lbl.id)!;
    }
    if (lbl.title) {
      const byTitle = availableByTitle.get(lbl.title.trim().toLowerCase());
      if (byTitle) return byTitle;
    }
    return null;
  };

  // Strip quick-add metadata (dates, priorities, projects) before extracting core item
  const parsed = parseQuickAdd(currentInput);
  if (parsed.labels.length > 0) return null;

  const core = extractCoreSubject(parsed.title || currentInput).trim().toLowerCase();
  if (core.length < 3 || STOP_WORDS.has(core)) {
    return null;
  }

  const labelCounts = new Map<string, { label: Label; count: number }>();
  let totalTaggedTaskMatches = 0;

  for (const task of allTasks) {
    if (!task?.title || !Array.isArray(task.labels) || task.labels.length === 0) continue;

    const taskCore = extractCoreSubject(task.title).trim().toLowerCase();
    const taskTitle = task.title.trim().toLowerCase();

    if (matchesCoreSubject(core, taskCore, taskTitle)) {
      const seenKeysForTask = new Set<string>();
      for (const rawLabel of task.labels) {
        const validLabel = resolveAvailableLabel(rawLabel);
        if (!validLabel) continue;
        const key = validLabel.title.trim().toLowerCase();
        if (seenKeysForTask.has(key)) continue;
        seenKeysForTask.add(key);

        const current = labelCounts.get(key);
        if (current) {
          current.count++;
        } else {
          labelCounts.set(key, { label: validLabel, count: 1 });
        }
      }
      if (seenKeysForTask.size > 0) {
        totalTaggedTaskMatches++;
      }
    }
  }

  if (totalTaggedTaskMatches < 2 || labelCounts.size === 0) {
    return null;
  }

  let bestLabel: Label | null = null;
  let maxCount = 0;

  for (const entry of labelCounts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      bestLabel = entry.label;
    }
  }

  if (!bestLabel) return null;

  const confidence = maxCount / totalTaggedTaskMatches;

  if (maxCount >= 2 && confidence >= 0.75) {
    return {
      label: bestLabel,
      count: maxCount,
      confidence,
    };
  }

  return null;
}
