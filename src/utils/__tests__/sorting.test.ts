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
});
