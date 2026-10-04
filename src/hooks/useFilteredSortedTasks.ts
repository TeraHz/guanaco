import { useMemo, useState, useEffect } from 'react';
import { Project, Task, Label, User } from '../types/vikunja';
import { SortOption, sortTasks } from '../utils/sorting';
import { isShoppingList } from '../utils/smartClassifier';
import { classifyTasksWithAIAsync } from '../utils/aiCore';
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
    () => (Array.isArray(projects) ? projects.filter((p) => p.id > 0) : []),
    [projects]
  );
  const safeTasks = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks]);

  const isAllTasksView = selectedProjectId === null;
  const isMyTasksView = selectedProjectId === MY_TASKS_PROJECT_ID;

  const activeProject: Project = useMemo(() => {
    if (isMyTasksView) return MY_TASKS_PROJECT;
    if (isAllTasksView) return { id: 0, title: 'All Tasks', hex_color: '#007AFF' };
    return (
      safeProjects.find((p) => p.id === selectedProjectId) ||
      safeProjects[0] || { id: 0, title: 'All Tasks', hex_color: '#007AFF' }
    );
  }, [isMyTasksView, isAllTasksView, safeProjects, selectedProjectId]);

  const isShopping = useMemo(() => isShoppingList(activeProject?.title), [activeProject?.title]);

  // Extract all unique labels available across tasks and definitions
  const availableLabels = useMemo(() => {
    const list = [
      ...(storeLabels || []).map((l) => l.title),
      ...safeTasks.flatMap((t) => (t.labels || []).map((l) => l.title)),
    ].filter(Boolean);
    return Array.from(new Set(list));
  }, [storeLabels, safeTasks]);

  // Tasks scoped to the active project/smart-view
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

  // Filter tasks by active/done and label selection
  const filteredTasks = useMemo(() => {
    return projectTasks.filter((task) => {
      if (filter === 'active' && task.done) return false;
      if (filter === 'done' && !task.done) return false;
      if (selectedLabel) {
        const hasLabel = task.labels?.some(
          (l) => l.title.toLowerCase() === selectedLabel.toLowerCase()
        );
        if (!hasLabel) return false;
      }
      return true;
    });
  }, [projectTasks, filter, selectedLabel]);

  const [aiVersion, setAiVersion] = useState(0);
  const tasksSignature = useMemo(
    () => filteredTasks.map((t) => `${t.id}:${t.title}`).join('|'),
    [filteredTasks]
  );

  useEffect(() => {
    let isMounted = true;
    if (sortBy === 'aiSmart' && filteredTasks.length > 0) {
      classifyTasksWithAIAsync(filteredTasks, activeProject?.title)
        .then((cats) => {
          if (isMounted && cats && Object.keys(cats).length > 0) {
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
    // aiVersion referenced to trigger re-sort when async classification finishes
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
