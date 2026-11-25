import { useMemo } from 'react';
import { Project, Task, Label, User } from '../types/vikunja';
import { SortOption, sortTasks } from '../utils/sorting';
import { isShoppingList } from '../utils/smartClassifier';
import { MY_TASKS_PROJECT_ID, MY_TASKS_PROJECT, isTaskAssignedToUser } from '../utils/taskFilters';
import { htmlToPlainText } from '../utils/htmlDescription';
import { isOverdue, normalizeVikunjaDate } from '../utils/dates';
import { useTranslation } from '../i18n';

export type FilterType = 'all' | 'active' | 'done';
export type DueFilterType = 'all' | 'overdue' | 'today' | 'has_due' | 'no_due';

export interface UseFilteredSortedTasksParams {
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  selectedProjectId: number | null;
  currentUser: User | null;
  filter: FilterType;
  selectedLabel: string | null;
  sortBy: SortOption;
  savedFilterTaskIds?: Record<number, number[]>;
  searchQuery?: string;
  searchAllLists?: boolean;
  minPriority?: number;
  dueFilter?: DueFilterType;
  isLocalMode?: boolean;
}

export interface UseFilteredSortedTasksResult {
  activeProject: Project;
  isAllTasksView: boolean;
  isMyTasksView: boolean;
  isSavedFilterView: boolean;
  isShopping: boolean;
  availableLabels: string[];
  projectTasks: Task[];
  doneTasks: Task[];
  filteredTasks: Task[];
  sortedTasks: Task[];
  activeCount: number;
}

export function useFilteredSortedTasks({
  projects,
  tasks,
  labels: storeLabels,
  selectedProjectId,
  currentUser,
  filter,
  selectedLabel,
  sortBy,
  savedFilterTaskIds,
  searchQuery = '',
  searchAllLists = false,
  minPriority = 0,
  dueFilter = 'all',
  isLocalMode = false,
}: UseFilteredSortedTasksParams): UseFilteredSortedTasksResult {
  const { t, locale } = useTranslation();
  const safePositiveProjects = useMemo(
    () => (Array.isArray(projects) ? projects.filter((p) => p && p.id > 0) : []),
    [projects]
  );
  const savedFilterProjects = useMemo(
    () =>
      !isLocalMode && Array.isArray(projects)
        ? projects.filter(
            (p) => p && (p.is_saved_filter || (p.id < 0 && p.id !== MY_TASKS_PROJECT_ID))
          )
        : [],
    [projects, isLocalMode]
  );
  const safeTasks = useMemo(() => (Array.isArray(tasks) ? tasks.filter(Boolean) : []), [tasks]);

  const isAllTasksView = selectedProjectId === null;
  const isMyTasksView = !isLocalMode && selectedProjectId === MY_TASKS_PROJECT_ID;
  const matchedSavedFilter = useMemo(
    () =>
      selectedProjectId !== null && selectedProjectId < 0 && !isMyTasksView
        ? savedFilterProjects.find((p) => p.id === selectedProjectId) || null
        : null,
    [selectedProjectId, isMyTasksView, savedFilterProjects]
  );
  const isSavedFilterView = Boolean(matchedSavedFilter);

  const activeProject: Project = useMemo(() => {
    if (isMyTasksView) {
      return { ...MY_TASKS_PROJECT, title: t('drawer.myOpenTasks') };
    }
    const allTasksTitle = t('drawer.allTasks');
    if (isAllTasksView) return { id: 0, title: allTasksTitle, hex_color: '#007AFF' };
    if (matchedSavedFilter) return matchedSavedFilter;
    return (
      safePositiveProjects.find((p) => p.id === selectedProjectId) ||
      safePositiveProjects.find((p) => !p.is_archived) ||
      safePositiveProjects[0] || { id: 0, title: allTasksTitle, hex_color: '#007AFF' }
    );
  }, [
    isMyTasksView,
    isAllTasksView,
    matchedSavedFilter,
    safePositiveProjects,
    selectedProjectId,
    locale,
    t,
  ]);

  const isShopping = useMemo(() => isShoppingList(activeProject?.title), [activeProject?.title]);

  // Extract unique labels (case-insensitively deduplicated, prioritizing storeLabels casing)
  const availableLabels = useMemo(() => {
    const seenLower = new Set<string>();
    const unique: string[] = [];
    const candidates = [
      ...(Array.isArray(storeLabels) ? storeLabels.map((l) => l?.title) : []),
      ...safeTasks.flatMap((t) => (Array.isArray(t.labels) ? t.labels.map((l) => l?.title) : [])),
    ];
    for (const raw of candidates) {
      const trimmed = (raw || '').trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        unique.push(trimmed);
      }
    }
    return unique;
  }, [storeLabels, safeTasks]);

  const trimmedQuery = searchQuery.trim().toLowerCase();

  const projectTasks = useMemo(() => {
    if (searchAllLists && (trimmedQuery.length > 0 || minPriority > 0 || dueFilter !== 'all')) {
      return safeTasks;
    }
    if (isMyTasksView) {
      return safeTasks.filter((t) => isTaskAssignedToUser(t, currentUser));
    }
    if (isAllTasksView) {
      return safeTasks;
    }
    if (isSavedFilterView && matchedSavedFilter) {
      const idList = savedFilterTaskIds?.[matchedSavedFilter.id] || [];
      const idSet = new Set<number>(idList);
      return safeTasks.filter((t) => idSet.has(t.id));
    }
    return safeTasks.filter((t) => t.project_id === activeProject.id);
  }, [
    searchAllLists,
    trimmedQuery,
    minPriority,
    dueFilter,
    isMyTasksView,
    isAllTasksView,
    isSavedFilterView,
    matchedSavedFilter,
    savedFilterTaskIds,
    safeTasks,
    currentUser,
    activeProject.id,
  ]);

  const doneTasks = useMemo(() => projectTasks.filter((t) => t.done), [projectTasks]);

  const filteredTasks = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const startOfTodayMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();
    const endOfTodayMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    ).getTime();

    return projectTasks.filter((task) => {
      if (filter === 'active' && task.done) return false;
      if (filter === 'done' && !task.done) return false;

      if (selectedLabel) {
        const hasLabel = task.labels?.some(
          (l) => (l?.title || '').toLowerCase() === selectedLabel.toLowerCase()
        );
        if (!hasLabel) return false;
      }

      if (minPriority > 0 && (task.priority || 0) < minPriority) {
        return false;
      }

      if (dueFilter !== 'all') {
        const normDue = normalizeVikunjaDate(task.due_date);
        if (dueFilter === 'no_due' && normDue !== null) return false;
        if (dueFilter === 'has_due' && normDue === null) return false;
        if (dueFilter === 'overdue') {
          if (!normDue || task.done || !isOverdue(normDue, nowMs)) return false;
        }
        if (dueFilter === 'today') {
          if (!normDue) return false;
          const dueMs = new Date(normDue).getTime();
          if (dueMs < startOfTodayMs || dueMs > endOfTodayMs) return false;
        }
      }

      if (trimmedQuery.length > 0) {
        const inTitle = (task.title || '').toLowerCase().includes(trimmedQuery);
        const inDesc = task.description
          ? htmlToPlainText(task.description).toLowerCase().includes(trimmedQuery)
          : false;
        const inLabels = Boolean(
          task.labels?.some((l) => (l?.title || '').toLowerCase().includes(trimmedQuery))
        );
        const inAssignees = Boolean(
          task.assignees?.some(
            (u) =>
              (u?.username || '').toLowerCase().includes(trimmedQuery) ||
              (u?.name || '').toLowerCase().includes(trimmedQuery)
          )
        );
        if (!inTitle && !inDesc && !inLabels && !inAssignees) {
          return false;
        }
      }

      return true;
    });
  }, [projectTasks, filter, selectedLabel, minPriority, dueFilter, trimmedQuery]);

  const sortedTasks = useMemo(
    () => sortTasks(filteredTasks, sortBy, activeProject?.title),
    [filteredTasks, sortBy, activeProject?.title, locale]
  );

  const activeCount = useMemo(
    () => projectTasks.filter((t) => !t.done).length,
    [projectTasks]
  );

  return {
    activeProject,
    isAllTasksView,
    isMyTasksView,
    isSavedFilterView,
    isShopping,
    availableLabels,
    projectTasks,
    doneTasks,
    filteredTasks,
    sortedTasks,
    activeCount,
  };
}
