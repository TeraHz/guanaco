import { sortTasks, cleanCategoryForSort } from '../sorting';
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
      priority: 4,
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
    const sorted = sortTasks(mockTasks, 'name');
    expect(sorted.map((t) => t.title)).toEqual([
      'Almonds',
      'Apples',
      'Batteries',
      'Zucchini',
    ]);
  });

  it('sorts by label and honors priority within same label', () => {
    const sorted = sortTasks(mockTasks, 'label');
    expect(sorted[0].title).toBe('Batteries');
    expect(sorted[1].title).toBe('Apples');
    expect(sorted[2].title).toBe('Zucchini');
    expect(sorted[3].title).toBe('Almonds');
  });

  it('sorts by dueDate and honors priority within same due date', () => {
    const sameDateTasks: Task[] = [
      ...mockTasks,
      {
        id: 5,
        title: 'Urgent Same-Day',
        done: false,
        priority: 5,
        project_id: 1,
        due_date: '2026-09-21T12:00:00Z',
      },
    ];
    const sorted = sortTasks(sameDateTasks, 'dueDate');
    expect(sorted.map((t) => t.id)).toEqual([5, 3, 2, 1, 4]);
  });

  it('sorts by dueDate and places ALL Vikunja zero-date variants (UTC & non-UTC) at the bottom as unscheduled', () => {
    const tasksWithZeroDates: Task[] = [
      {
        id: 10,
        title: 'Non-UTC Zero Date (+01:00)',
        done: false,
        priority: 5,
        project_id: 1,
        due_date: '0001-01-01T01:00:00+01:00',
      },
      {
        id: 11,
        title: 'UTC Zero Date',
        done: false,
        priority: 1,
        project_id: 1,
        due_date: '0001-01-01T00:00:00Z',
      },
      {
        id: 12,
        title: 'Scheduled Tomorrow',
        done: false,
        priority: 1,
        project_id: 1,
        due_date: '2026-09-22T12:00:00Z',
      },
      {
        id: 13,
        title: 'Scheduled Today',
        done: false,
        priority: 1,
        project_id: 1,
        due_date: '2026-09-21T12:00:00Z',
      },
    ];

    const sorted = sortTasks(tasksWithZeroDates, 'dueDate');
    expect(sorted.map((t) => t.id)).toEqual([13, 12, 10, 11]);
  });

  it('sorts by priority descending (highest priority first)', () => {
    const sorted = sortTasks(mockTasks, 'priority');
    expect(sorted.map((t) => t.priority)).toEqual([4, 2, 1, 1]);
  });

  describe('Default Sort (recently updated/modified first within priority)', () => {
    it('places newly added/recently updated tasks at top within same priority and ignores zero-dates', () => {
      const tasks: Task[] = [
        {
          id: 1,
          title: 'Older task',
          done: false,
          priority: 2,
          project_id: 1,
          done_at: '0001-01-01T01:00:00+01:00',
          created: '2026-09-20T10:00:00Z',
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
      expect(sorted.map((t) => t.title)).toEqual(['Newest task', 'Mid task', 'Older task']);
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

    it('places unpositioned active tasks after explicitly positioned tasks', () => {
      const tasks: Task[] = [
        { id: 1, title: 'Unpositioned Task B', done: false, priority: 1, project_id: 1 },
        { id: 2, title: 'Positioned Task 2', done: false, priority: 1, project_id: 1, position: 2000 },
        { id: 3, title: 'Positioned Task 1', done: false, priority: 1, project_id: 1, position: 1000 },
        { id: 4, title: 'Unpositioned Task A', done: false, priority: 1, project_id: 1, position: 0 },
      ];

      const sorted = sortTasks(tasks, 'manual');
      expect(sorted.map((t) => t.title)).toEqual([
        'Positioned Task 1',
        'Positioned Task 2',
        'Unpositioned Task A',
        'Unpositioned Task B',
      ]);
    });
  });

  describe('Department / Contextual & AI Sort', () => {
    it('sorts tasks by contextual category', () => {
      const tasks: Task[] = [
        { id: 1, title: 'Milk', done: false, priority: 1, project_id: 1, labels: [{ id: 1, title: 'Dairy' }] },
        { id: 2, title: 'Apples', done: false, priority: 1, project_id: 1, labels: [{ id: 2, title: 'Produce' }] },
        { id: 3, title: '[Bakery] Bagels', done: false, priority: 1, project_id: 1 },
      ];

      const sorted = sortTasks(tasks, 'department', 'Weekly Groceries');
      expect(sorted.map((t) => t.title)).toEqual(['[Bakery] Bagels', 'Milk', 'Apples']);
    });

    it('strips leading emojis in cleanCategoryForSort and prevents alternating split headers', () => {
      expect(cleanCategoryForSort('🥦 Produce')).toBe('Produce');
      expect(cleanCategoryForSort('✈️ Пътуване')).toBe('Пътуване');

      const tasks: Task[] = [
        { id: 1, title: '[Produce] Apples', done: false, priority: 3, project_id: 1 },
        { id: 2, title: 'Bananas', done: false, priority: 2, project_id: 1 },
        { id: 3, title: '[Produce] Carrots', done: false, priority: 1, project_id: 1 },
        { id: 4, title: '[Bakery] Bagels', done: false, priority: 1, project_id: 1 },
      ];

      const sorted = sortTasks(tasks, 'department', 'Weekly Groceries');
      expect(sorted.map((t) => t.title)).toEqual([
        '[Bakery] Bagels',
        '[Produce] Apples',
        'Bananas',
        '[Produce] Carrots',
      ]);
    });

    it('resists Object.prototype prefixes like [Constructor] without throwing', () => {
      const protoTasks: Task[] = [
        { id: 10, title: '[Constructor] Call general contractor', done: false, priority: 1, project_id: 1 },
        { id: 11, title: '[ToString] Check serialization', done: false, priority: 1, project_id: 1 },
      ];
      expect(() => sortTasks(protoTasks, 'aiSmart', 'Home')).not.toThrow();
      expect(sortTasks(protoTasks, 'aiSmart', 'Home').map((t) => t.id)).toEqual([10, 11]);
    });
  });
});
