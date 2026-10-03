import { isTaskAssignedToUser, filterTasksForUser } from '../taskFilters';
import { Task, User } from '../../types/vikunja';

describe('taskFilters utility', () => {
  const user1: User = { id: 101, username: 'terahz', name: 'Terahz' };
  const user2: User = { id: 102, username: 'alex', name: 'Alex' };

  const taskForUser1: Task = {
    id: 1,
    title: 'Review PR',
    done: false,
    priority: 1,
    project_id: 1,
    assignees: [user1],
  };

  const taskForUser2: Task = {
    id: 2,
    title: 'Update documentation',
    done: false,
    priority: 1,
    project_id: 1,
    assignees: [user2],
  };

  const taskMultipleAssignees: Task = {
    id: 3,
    title: 'Team standup',
    done: false,
    priority: 2,
    project_id: 2,
    assignees: [user1, user2],
  };

  const unassignedTask: Task = {
    id: 4,
    title: 'Buy coffee',
    done: false,
    priority: 0,
    project_id: 1,
  };

  describe('isTaskAssignedToUser', () => {
    it('returns true when user matches by ID', () => {
      expect(isTaskAssignedToUser(taskForUser1, { id: 101, username: 'other' })).toBe(true);
    });

    it('returns true when user matches by username (case-insensitive)', () => {
      expect(isTaskAssignedToUser(taskForUser1, { id: 999, username: 'TERAHZ' })).toBe(true);
    });

    it('returns true when user is one of multiple assignees', () => {
      expect(isTaskAssignedToUser(taskMultipleAssignees, user1)).toBe(true);
      expect(isTaskAssignedToUser(taskMultipleAssignees, user2)).toBe(true);
    });

    it('returns false when task is assigned to a different user', () => {
      expect(isTaskAssignedToUser(taskForUser2, user1)).toBe(false);
    });

    it('returns false when task has no assignees', () => {
      expect(isTaskAssignedToUser(unassignedTask, user1)).toBe(false);
    });

    it('returns false when target user is null or undefined', () => {
      expect(isTaskAssignedToUser(taskForUser1, null)).toBe(false);
      expect(isTaskAssignedToUser(taskForUser1, undefined)).toBe(false);
    });
  });

  describe('filterTasksForUser', () => {
    const allTasks = [taskForUser1, taskForUser2, taskMultipleAssignees, unassignedTask];

    it('filters tasks assigned to the given user', () => {
      const myTasks = filterTasksForUser(allTasks, user1);
      expect(myTasks.map((t) => t.id)).toEqual([1, 3]);
    });

    it('returns empty array when user is null or no tasks match', () => {
      expect(filterTasksForUser(allTasks, null)).toEqual([]);
      expect(filterTasksForUser(allTasks, { id: 999, username: 'nobody' })).toEqual([]);
    });
  });
});
