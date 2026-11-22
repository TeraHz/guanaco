import { Task } from '../types/vikunja';
import { classifyTaskWithAI } from './aiCore';
import { normalizeVikunjaDate } from './dates';

export type SortOption =
  | 'default'
  | 'manual'
  | 'aiSmart'
  | 'department'
  | 'name'
  | 'label'
  | 'dueDate'
  | 'priority';

export function cleanCategoryForSort(cat: string): string {
  return (cat || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

export function sortTasks(tasks: Task[], sortBy: SortOption, contextTitle?: string): Task[] {
  if (!Array.isArray(tasks)) return [];
  const list = [...tasks];

  return list.sort((a, b) => {
    // 1. Completed tasks always appear after active tasks
    if (a.done !== b.done) {
      return a.done ? 1 : -1;
    }

    switch (sortBy) {
      case 'manual': {
        const hasPosA = a.position !== undefined && a.position > 0;
        const hasPosB = b.position !== undefined && b.position > 0;
        if (hasPosA && hasPosB) {
          const posDiff = (a.position || 0) - (b.position || 0);
          if (posDiff !== 0) return posDiff;
        } else if (hasPosA && !hasPosB) {
          return -1;
        } else if (!hasPosA && hasPosB) {
          return 1;
        }
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'aiSmart':
      case 'department': {
        const catA = classifyTaskWithAI(a, contextTitle);
        const catB = classifyTaskWithAI(b, contextTitle);
        const cleanA = cleanCategoryForSort(catA);
        const cleanB = cleanCategoryForSort(catB);
        const catCompare = cleanA.localeCompare(cleanB, undefined, { sensitivity: 'base' });
        if (catCompare !== 0) return catCompare;
        // Ensure identical raw category strings stay contiguous so section headers never split/alternate
        if (catA !== catB) {
          const rawCompare = catA.localeCompare(catB);
          if (rawCompare !== 0) return rawCompare;
        }
        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'name': {
        const titleCompare = (a.title || '').localeCompare(b.title || '', undefined, {
          sensitivity: 'base',
        });
        if (titleCompare !== 0) return titleCompare;
        return (b.priority || 0) - (a.priority || 0);
      }

      case 'label': {
        const aLabel = a.labels?.[0]?.title || '';
        const bLabel = b.labels?.[0]?.title || '';

        if (!aLabel && bLabel) return 1;
        if (aLabel && !bLabel) return -1;

        if (aLabel && bLabel) {
          const labelCompare = aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
          if (labelCompare !== 0) return labelCompare;
        }

        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'dueDate': {
        const normA = normalizeVikunjaDate(a.due_date);
        const normB = normalizeVikunjaDate(b.due_date);
        const aDate = normA ? new Date(normA).getTime() : null;
        const bDate = normB ? new Date(normB).getTime() : null;

        if (aDate !== null && bDate === null) return -1;
        if (aDate === null && bDate !== null) return 1;

        if (aDate !== null && bDate !== null && aDate !== bDate) {
          return aDate - bDate;
        }

        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'priority': {
        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'default':
      default: {
        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;

        const getModifiedTime = (t: Task): number => {
          const upd = normalizeVikunjaDate(t.updated);
          if (upd) return new Date(upd).getTime();
          const doneAt = normalizeVikunjaDate(t.done_at);
          if (doneAt) return new Date(doneAt).getTime();
          const created = normalizeVikunjaDate(t.created);
          if (created) return new Date(created).getTime();
          return 0;
        };

        const timeA = getModifiedTime(a);
        const timeB = getModifiedTime(b);
        if (timeA !== timeB) {
          return timeB - timeA;
        }

        return (a.position || 0) - (b.position || 0);
      }
    }
  });
}
