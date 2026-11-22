import { useMemo, useState, useEffect, useRef } from 'react';
import { Project, Task, Label, User } from '../types/vikunja';
import { SortOption, sortTasks } from '../utils/sorting';
import { isShoppingList } from '../utils/smartClassifier';
import { classifyTaskWithAI, classifyTasksWithAIAsync } from '../utils/aiCore';
import { MY_TASKS_PROJECT_ID, MY_TASKS_PROJECT, isTaskAssignedToUser } from '../utils/taskFilters';

export type FilterType = 'all' | 'active' | 'done';

export interface UseFilteredSortedTasksParams {
  projects: Project[];
  tasks: Task[];
  labels: Label[];
  selectedProjectId: number | null;
  currentUser: User | null;
  filter: FilterType;
  selectedLabel: string | null;
  sortBy: SortOption;
}

export interface UseFilteredSortedTasksResult {
  activeProject: Project;
  isAllTasksView: boolean;
  isMyTasksView: boolean;
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
}: UseFilteredSortedTasksParams): UseFilteredSortedTasksResult {
  const safeProjects = useMemo(
    () => (Array.isArray(projects) ? projects.filter((p) => p && p.id > 0) : []),
    [projects]
  );
  const safeTasks = useMemo(() => (Array.isArray(tasks) ? tasks.filter(Boolean) : []), [tasks]);

  const isAllTasksView = selectedProjectId === null;
  const isMyTasksView = selectedProjectId === MY_TASKS_PROJECT_ID;

  const activeProject: Project = useMemo(() => {
    if (isMyTasksView) return MY_TASKS_PROJECT;
    if (isAllTasksView) return { id: 0, title: 'All Tasks', hex_color: '#007AFF' };
    return (
      safeProjects.find((p) => p.id === selectedProjectId) ||
      safeProjects.find((p) => !p.is_archived) ||
      safeProjects[0] || { id: 0, title: 'All Tasks', hex_color: '#007AFF' }
    );
  }, [isMyTasksView, isAllTasksView, safeProjects, selectedProjectId]);

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

  const projectTasks = useMemo(() => {
    if (isMyTasksView) {
      return safeTasks.filter((t) => isTaskAssignedToUser(t, currentUser));
    }
    if (isAllTasksView) {
      return safeTasks;
    }
    return safeTasks.filter((t) => t.project_id === activeProject.id);
  }, [isMyTasksView, isAllTasksView, safeTasks, currentUser, activeProject.id]);

  const doneTasks = useMemo(() => projectTasks.filter((t) => t.done), [projectTasks]);

  const filteredTasks = useMemo(() => {
    return projectTasks.filter((task) => {
      if (filter === 'active' && task.done) return false;
      if (filter === 'done' && !task.done) return false;
      if (selectedLabel) {
        const hasLabel = task.labels?.some(
          (l) => (l?.title || '').toLowerCase() === selectedLabel.toLowerCase()
        );
        if (!hasLabel) return false;
      }
      return true;
    });
  }, [projectTasks, filter, selectedLabel]);

  const [aiVersion, setAiVersion] = useState(0);
  const filteredTasksRef = useRef(filteredTasks);
  filteredTasksRef.current = filteredTasks;

  const tasksSignature = useMemo(
    () => filteredTasks.map((t) => `${t.id}:${t.title}`).join('|'),
    [filteredTasks]
  );

  useEffect(() => {
    let isMounted = true;
    const currentTasks = filteredTasksRef.current;

    if (sortBy === 'aiSmart' && currentTasks.length > 0) {
      // Snapshot synchronous categories first so we ONLY update state if async classification
      // (from AsyncStorage or live Prompt API) actually changes at least one category!
      // Prevents spurious post-microtask re-renders and React `act(...)` warnings in tests.
      const syncSnapshot: Record<number, string> = {};
      for (const t of currentTasks) {
        syncSnapshot[t.id] = classifyTaskWithAI(t, activeProject?.title);
      }

      classifyTasksWithAIAsync(currentTasks, activeProject?.title)
        .then((cats) => {
          if (!isMounted || !cats) return;
          const changed = currentTasks.some(
            (t) => Boolean(cats[t.id]) && cats[t.id] !== syncSnapshot[t.id]
          );
          if (changed) {
            setAiVersion((v) => v + 1);
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [sortBy, tasksSignature, activeProject?.title]);

  const sortedTasks = useMemo(() => {
    // Reference aiVersion so async classification updates trigger re-sorting
    void aiVersion;
    return sortTasks(filteredTasks, sortBy, activeProject?.title);
  }, [filteredTasks, sortBy, activeProject?.title, aiVersion]);

  const activeCount = useMemo(
    () => projectTasks.filter((t) => !t.done).length,
    [projectTasks]
  );

  return {
    activeProject,
    isAllTasksView,
    isMyTasksView,
    isShopping,
    availableLabels,
    projectTasks,
    doneTasks,
    filteredTasks,
    sortedTasks,
    activeCount,
  };
}
