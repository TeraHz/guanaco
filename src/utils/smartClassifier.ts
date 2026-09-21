import { Task } from '../types/vikunja';

const SHOPPING_KEYWORDS = [
  'grocer',
  'shop',
  'supermarket',
  'market',
  'pantry',
  'costco',
  'trader joe',
  'target',
  'walmart',
  'store',
  'food',
];

/**
 * Checks if a project/list is contextually related to shopping or groceries.
 */
export function isShoppingList(listTitle?: string): boolean {
  if (!listTitle) return false;
  const lower = listTitle.toLowerCase();
  return SHOPPING_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Contextually classifies a task into a category.
 * Prioritizes:
 * 1. Explicit labels assigned to the task (e.g. "Produce", "Aisle 4")
 * 2. Bracketed or colon prefixes in the title (e.g. "[Bakery] Croissant", "Deli: Ham")
 * 3. Fallback to "General"
 *
 * Designed to be cleanly extendable with an on-device ML / LLM hook
 * without needing a static hardcoded database.
 */
export function classifyTaskContextually(task: Task, contextTitle?: string): string {
  // 1. Task labels are top priority
  if (task.labels && task.labels.length > 0 && task.labels[0].title) {
    return task.labels[0].title.trim();
  }

  // 2. Bracketed prefix: [Produce] Apples -> Produce
  const bracketMatch = task.title.match(/^\[(.*?)\]/);
  if (bracketMatch && bracketMatch[1]?.trim()) {
    return bracketMatch[1].trim();
  }

  // 3. Colon prefix: Produce: Apples -> Produce
  const colonMatch = task.title.match(/^([A-Za-z0-9\s]{2,15}):\s+/);
  if (colonMatch && colonMatch[1]?.trim()) {
    return colonMatch[1].trim();
  }

  return 'General';
}

export interface TaskGroup {
  category: string;
  tasks: Task[];
}

/**
 * Groups tasks by contextual category.
 */
export function groupTasksContextually(tasks: Task[], contextTitle?: string): TaskGroup[] {
  const groupsMap = new Map<string, Task[]>();

  for (const task of tasks) {
    const category = classifyTaskContextually(task, contextTitle);
    if (!groupsMap.has(category)) {
      groupsMap.set(category, []);
    }
    groupsMap.get(category)!.push(task);
  }

  const result: TaskGroup[] = [];
  for (const [category, groupTasks] of groupsMap.entries()) {
    result.push({
      category,
      tasks: groupTasks,
    });
  }

  return result;
}
