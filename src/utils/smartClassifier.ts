import { Task } from '../types/vikunja';

const SHOPPING_PATTERNS: RegExp[] = [
  /\bgrocer(?:y|ies)?\b/i,
  /\bshop(?:ping|s)?\b/i,
  /\bsupermarket(?:s)?\b/i,
  /\bmarket(?:s)?\b/i,
  /\bpantry\b/i,
  /\bcostco\b/i,
  /\btrader\s*joe(?:'?s)?\b/i,
  /\bwalmart\b/i,
  /\bwhole\s*foods\b/i,
  /\baldi\b/i,
  /\blidl\b/i,
  /\btarget\b/i,
  /\bstore\b/i,
  /\bfood(?:s)?\b/i,
  /\b(?:supermercado|compras?|mercado|despensa|mercadona|carrefour|alcampo|eroski|tienda|comida|alimentaci[oó]n)\b/iu,
  /(?:^|[^\p{L}])(пазар|покупк|магазин|хран|супермаркет)/iu,
];

const NON_SHOPPING_STORE_EXCLUSIONS = /\b(?:app\s+store|play\s+store|sales\s+target|revenue\s+target|q[1-4]\s+target)\b/i;

const IGNORED_COLON_PREFIXES = new Set([
  're',
  'fw',
  'fwd',
  'note',
  'notes',
  'todo',
  'todos',
  'fixme',
  'wip',
  'fyi',
  'nb',
  'ps',
  'http',
  'https',
  'mailto',
  'tel',
  'step',
  'part',
  'ch',
  'chapter',
  'reminder',
  'update',
  'warning',
  'error',
  'info',
  'бележка',
  'забележка',
  'nota',
  'notas',
  'aviso',
  'recordatorio',
  'paso',
  'parte',
  'capítulo',
  'capitulo',
]);

/**
 * Checks if a project/list is contextually related to shopping or groceries.
 */
export function isShoppingList(listTitle?: string): boolean {
  if (!listTitle || typeof listTitle !== 'string') return false;
  const trimmed = listTitle.trim();
  if (!trimmed) return false;
  if (NON_SHOPPING_STORE_EXCLUSIONS.test(trimmed)) return false;
  return SHOPPING_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Contextually classifies a task into a category based on explicit title syntax.
 * Prioritizes:
 * 1. Bracketed prefixes in the title (e.g. "[Bakery] Croissant", "[Отдел] Хляб")
 * 2. Colon prefixes in the title (e.g. "Produce: Apples", "Отдел: Хляб"), ignoring Re:/Fwd:/Note:/TODO:
 * 3. Fallback to "General"
 */
export function classifyTaskContextually(task: Task, _contextTitle?: string): string {
  if (!task?.title || typeof task.title !== 'string') return 'General';
  const trimmed = task.title.trim();
  if (!trimmed) return 'General';

  // 1. Bracketed prefix: [Produce] Apples or [Отдел] Хляб -> ignore markdown checkboxes [ ] / [x]
  const bracketMatch = trimmed.match(/^\[([^\]]{2,25})\]\s+\S/u);
  if (bracketMatch && bracketMatch[1]?.trim()) {
    const candidate = bracketMatch[1].trim();
    if (!/^[xX\s\d]$/.test(candidate)) {
      return candidate;
    }
  }

  // 2. Colon prefix: Produce: Apples or Отдел: Хляб (Unicode-aware, ignoring email/note prefixes)
  const colonMatch = trimmed.match(/^([\p{L}][\p{L}\p{N}\s&/-]{1,20}):\s+\S/u);
  if (colonMatch && colonMatch[1]?.trim()) {
    const candidate = colonMatch[1].trim();
    if (!IGNORED_COLON_PREFIXES.has(candidate.toLowerCase())) {
      return candidate;
    }
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
  if (!Array.isArray(tasks)) return [];
  const groupsMap = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task) continue;
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
