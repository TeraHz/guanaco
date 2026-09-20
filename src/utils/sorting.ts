import { Task } from '../types/vikunja';

export type SortOption = 'default' | 'name' | 'label' | 'dueDate' | 'priority';

export function sortTasks(tasks: Task[], sortBy: SortOption): Task[] {
  const list = [...tasks];

  return list.sort((a, b) => {
    // 1. Completed tasks always appear after active tasks
    if (a.done !== b.done) {
      return a.done ? 1 : -1;
    }

    switch (sortBy) {
      case 'name': {
        const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        if (titleCompare !== 0) return titleCompare;
        // Honor priority within identical name
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

        // Within same label (or both no label): honor priority!
        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return a.title.localeCompare(b.title);
      }

      case 'dueDate': {
        const aDate = a.due_date && a.due_date !== '0001-01-01T00:00:00Z' ? new Date(a.due_date).getTime() : null;
        const bDate = b.due_date && b.due_date !== '0001-01-01T00:00:00Z' ? new Date(b.due_date).getTime() : null;

        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;

        if (aDate && bDate && aDate !== bDate) {
          return aDate - bDate;
        }

        // Within same due date: honor priority!
        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return a.title.localeCompare(b.title);
      }

      case 'priority': {
        const prioDiff = (b.priority || 0) - (a.priority || 0);
        if (prioDiff !== 0) return prioDiff;
        return a.title.localeCompare(b.title);
      }

      case 'default':
      default: {
        return (a.position || 0) - (b.position || 0);
      }
    }
  });
}
