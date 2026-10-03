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
  'пазар',
  'покупк',
  'магазин',
  'хран',
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
 * Contextually classifies a task into a category based on explicit title syntax.
 * Prioritizes:
 * 1. Bracketed prefixes in the title (e.g. "[Bakery] Croissant", "[Produce] Apples")
 * 2. Colon prefixes in the title (e.g. "Produce: Apples", "Deli: Ham")
 * 3. Fallback to "General" (allowing AI / zero-shot semantic grouping to classify the item)
 *
 * Note: Labels/tags (like store tags #Costco, #Trader Joe's, #Caraluzzi) are metadata tags
 * and do not override the department category/section header.
 */
export function classifyTaskContextually(task: Task, contextTitle?: string): string {
  // 1. Bracketed prefix: [Produce] Apples -> Produce
  const bracketMatch = task.title.match(/^\[(.*?)\]/);
  if (bracketMatch && bracketMatch[1]?.trim()) {
    return bracketMatch[1].trim();
  }

  // 2. Colon prefix: Produce: Apples -> Produce
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
