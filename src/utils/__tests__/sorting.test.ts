import { sortTasks, SortOption } from '../sorting';
import { Task } from '../../types/vikunja';

describe('Task Sorting Utility', () => {
  const mockTasks: Task[] = [
    {
      id: 1,
      title: 'Zucchini',
      done: false,
      priority: 1,
      project_id: 1,
      labels: [{ id: 10, title: 'Produce' }],
      due_date: '2026-09-25T12:00:00Z',
    },
    {
      id: 2,
      title: 'Apples',
      done: false,
      priority: 4, // Higher priority!
      project_id: 1,
      labels: [{ id: 10, title: 'Produce' }],
      due_date: '2026-09-22T12:00:00Z',
    },
    {
      id: 3,
      title: 'Batteries',
      done: false,
      priority: 2,
      project_id: 1,
      labels: [{ id: 20, title: 'Hardware' }],
      due_date: '2026-09-21T12:00:00Z',
    },
    {
      id: 4,
      title: 'Almonds',
      done: false,
      priority: 1,
      project_id: 1,
      labels: [],
      due_date: null,
    },
  ];

  it('sorts by name and honors priority within category', () => {
    // Both 'Almonds' and 'Apples' start with A, but when grouped or compared:
    const sorted = sortTasks(mockTasks, 'name');
    expect(sorted.map((t) => t.title)).toEqual([
      'Almonds',
      'Apples',
      'Batteries',
      'Zucchini',
    ]);
  });

  it('sorts by label and honors priority within same label', () => {
    // Both 'Zucchini' (P1) and 'Apples' (P4) have label 'Produce'.
    // 'Hardware' label comes before 'Produce' alphabetically.
    // Within 'Produce', Apples (P4) MUST come before Zucchini (P1)!
    const sorted = sortTasks(mockTasks, 'label');

    expect(sorted[0].title).toBe('Batteries'); // Hardware label
    expect(sorted[1].title).toBe('Apples'); // Produce, P4
    expect(sorted[2].title).toBe('Zucchini'); // Produce, P1
    expect(sorted[3].title).toBe('Almonds'); // No label (bottom)
  });

  it('sorts by dueDate and honors priority within same due date', () => {
    const sorted = sortTasks(mockTasks, 'dueDate');
    expect(sorted.map((t) => t.id)).toEqual([3, 2, 1, 4]);
  });

  it('sorts by priority descending (highest priority first)', () => {
    const sorted = sortTasks(mockTasks, 'priority');
    expect(sorted.map((t) => t.priority)).toEqual([4, 2, 1, 1]);
  });

  describe('Default Sort (recently updated/modified first within priority)', () => {
    it('places newly added/recently updated tasks at top within same priority', () => {
      const tasks: Task[] = [
        {
          id: 1,
          title: 'Older task',
          done: false,
          priority: 2,
          project_id: 1,
          updated: '2026-09-20T10:00:00Z',
        },
        {
          id: 2,
          title: 'Newest task',
          done: false,
          priority: 2,
          project_id: 1,
          updated: '2026-09-20T12:00:00Z',
        },
        {
          id: 3,
          title: 'Mid task',
          done: false,
          priority: 2,
          project_id: 1,
          updated: '2026-09-20T11:00:00Z',
        },
      ];

      const sorted = sortTasks(tasks, 'default');
      expect(sorted.map((t) => t.title)).toEqual([
        'Newest task',
        'Mid task',
        'Older task',
      ]);
    });

    it('honors higher priority over newer update time', () => {
      const tasks: Task[] = [
        {
          id: 1,
          title: 'Low priority brand new',
          done: false,
          priority: 1,
          project_id: 1,
          updated: '2026-09-20T12:00:00Z',
        },
        {
          id: 2,
          title: 'Urgent priority older',
          done: false,
          priority: 4,
          project_id: 1,
          updated: '2026-09-20T10:00:00Z',
        },
      ];

      const sorted = sortTasks(tasks, 'default');
      expect(sorted[0].title).toBe('Urgent priority older');
      expect(sorted[1].title).toBe('Low priority brand new');
    });

    it('places newly completed task at the top of the done list within priority', () => {
      const tasks: Task[] = [
        {
          id: 1,
          title: 'Completed earlier',
          done: true,
          priority: 1,
          project_id: 1,
          done_at: '2026-09-20T09:00:00Z',
          updated: '2026-09-20T09:00:00Z',
        },
        {
          id: 2,
          title: 'Completed just now',
          done: true,
          priority: 1,
          project_id: 1,
          done_at: '2026-09-20T12:00:00Z',
          updated: '2026-09-20T12:00:00Z',
        },
      ];

      const sorted = sortTasks(tasks, 'default');
      expect(sorted[0].title).toBe('Completed just now');
      expect(sorted[1].title).toBe('Completed earlier');
    });
  });

  describe('Manual Sort', () => {
    it('sorts tasks strictly by position ascending', () => {
      const tasks: Task[] = [
        { id: 1, title: 'Task B', done: false, priority: 1, project_id: 1, position: 2000 },
        { id: 2, title: 'Task C', done: false, priority: 1, project_id: 1, position: 3000 },
        { id: 3, title: 'Task A', done: false, priority: 1, project_id: 1, position: 1000 },
      ];

      const sorted = sortTasks(tasks, 'manual');
      expect(sorted.map((t) => t.title)).toEqual(['Task A', 'Task B', 'Task C']);
    });

    it('keeps completed tasks at the bottom even in manual sort', () => {
      const tasks: Task[] = [
        { id: 1, title: 'Done Task', done: true, priority: 1, project_id: 1, position: 500 },
        { id: 2, title: 'Active Task', done: false, priority: 1, project_id: 1, position: 2000 },
      ];

      const sorted = sortTasks(tasks, 'manual');
      expect(sorted.map((t) => t.title)).toEqual(['Active Task', 'Done Task']);
    });
  });

  describe('Department / Contextual Sort', () => {
    it('sorts tasks by contextual category', () => {
      const tasks: Task[] = [
        { id: 1, title: 'Milk', done: false, priority: 1, project_id: 1, labels: [{ id: 1, title: 'Dairy' }] },
        { id: 2, title: 'Apples', done: false, priority: 1, project_id: 1, labels: [{ id: 2, title: 'Produce' }] },
        { id: 3, title: '[Bakery] Bagels', done: false, priority: 1, project_id: 1 },
      ];

      const sorted = sortTasks(tasks, 'department', 'Weekly Groceries');
      expect(sorted.map((t) => t.title)).toEqual([
        '[Bakery] Bagels',
        'Milk',
        'Apples',
      ]);
    });
  });
});

