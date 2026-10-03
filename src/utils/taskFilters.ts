import { Task, User } from '../types/vikunja';

export const MY_TASKS_PROJECT_ID = -1;

export const MY_TASKS_PROJECT = {
  id: MY_TASKS_PROJECT_ID,
  title: 'My Open Tasks',
  hex_color: '#AF52DE',
};

/**
 * Checks whether a task is assigned to a specific user (by ID or case-insensitive username).
 */
export function isTaskAssignedToUser(
  task: Task,
  user?: User | { id?: number; username?: string } | null
): boolean {
  if (!task.assignees || task.assignees.length === 0 || !user) return false;

  const targetUsername = user.username?.trim().toLowerCase();
  const targetId = user.id;

  return task.assignees.some((assignee) => {
    if (targetId && assignee.id && targetId > 0 && assignee.id > 0 && targetId === assignee.id) {
      return true;
    }
    if (
      targetUsername &&
      assignee.username &&
      assignee.username.trim().toLowerCase() === targetUsername
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Filters a list of tasks for those assigned to a given user.
 */
export function filterTasksForUser(
  tasks: Task[],
  user?: User | { id?: number; username?: string } | null
): Task[] {
  if (!user) return [];
  return tasks.filter((t) => isTaskAssignedToUser(t, user));
}
