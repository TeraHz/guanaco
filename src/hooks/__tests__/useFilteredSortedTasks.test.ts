import { renderHook, waitFor } from '@testing-library/react-native';
import { useFilteredSortedTasks } from '../useFilteredSortedTasks';
import { clearAICoreCache } from '../../utils/aiCore';
import { Project, Task, Label } from '../../types/vikunja';

describe('useFilteredSortedTasks Hook', () => {
  const mockProjects: Project[] = [
    { id: 1, title: 'Groceries', hex_color: '#2ecc71' },
    { id: 2, title: 'Work', hex_color: '#3498db' },
  ];

  const mockTasks: Task[] = [
    { id: 10, title: 'Milk', done: false, priority: 2, project_id: 1, labels: [{ id: 100, title: 'Dairy' }] },
    { id: 11, title: 'Eggs', done: true, priority: 1, project_id: 1, labels: [{ id: 100, title: 'Dairy' }] },
    { id: 20, title: 'Write report', done: false, priority: 4, project_id: 2, labels: [{ id: 200, title: 'Urgent' }] },
  ];

  const mockLabels: Label[] = [
    { id: 100, title: 'Dairy', hex_color: '#ffffff' },
    { id: 200, title: 'Urgent', hex_color: '#e74c3c' },
  ];

  afterEach(async () => {
    await clearAICoreCache();
  });

  it('filters tasks to active project and active filter status', () => {
    const { result } = renderHook(() =>
      useFilteredSortedTasks({
        projects: mockProjects,
        tasks: mockTasks,
        labels: mockLabels,
        selectedProjectId: 1,
        currentUser: null,
        filter: 'active',
        selectedLabel: null,
        sortBy: 'default',
      })
    );

    expect(result.current.activeProject.title).toBe('Groceries');
    expect(result.current.projectTasks).toHaveLength(2);
    expect(result.current.doneTasks).toHaveLength(1);
    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].title).toBe('Milk');
    expect(result.current.activeCount).toBe(1);
  });

  it('prefers non-archived project when selectedProjectId was deleted, while still allowing explicit archived selection', () => {
    const projectsWithLeadingArchived: Project[] = [
      { id: 1, title: 'Old Archived List', is_archived: true },
      { id: 2, title: 'Active Work List', is_archived: false },
    ];

    // Deleted selectedProjectId (999) falls back to Active Work List (id: 2), skipping archived [0]
    const { result: fallbackResult } = renderHook(() =>
      useFilteredSortedTasks({
        projects: projectsWithLeadingArchived,
        tasks: mockTasks,
        labels: mockLabels,
        selectedProjectId: 999,
        currentUser: null,
        filter: 'active',
        selectedLabel: null,
        sortBy: 'default',
      })
    );
    expect(fallbackResult.current.activeProject.id).toBe(2);

    // Explicit selectedProjectId (1) still opens the archived list directly
    const { result: explicitArchivedResult } = renderHook(() =>
      useFilteredSortedTasks({
        projects: projectsWithLeadingArchived,
        tasks: mockTasks,
        labels: mockLabels,
        selectedProjectId: 1,
        currentUser: null,
        filter: 'active',
        selectedLabel: null,
        sortBy: 'default',
      })
    );
    expect(explicitArchivedResult.current.activeProject.id).toBe(1);
  });

  it('filters tasks by selected label and deduplicates availableLabels case-insensitively', () => {
    const tasksWithLowerLabel: Task[] = [
      ...mockTasks,
      { id: 21, title: 'Butter', done: false, priority: 1, project_id: 1, labels: [{ id: 101, title: 'dairy' }] },
    ];
    const { result } = renderHook(() =>
      useFilteredSortedTasks({
        projects: mockProjects,
        tasks: tasksWithLowerLabel,
        labels: mockLabels,
        selectedProjectId: null,
        currentUser: null,
        filter: 'all',
        selectedLabel: 'Urgent',
        sortBy: 'default',
      })
    );

    expect(result.current.isAllTasksView).toBe(true);
    expect(result.current.filteredTasks).toHaveLength(1);
    expect(result.current.filteredTasks[0].title).toBe('Write report');
    expect(result.current.availableLabels.filter((l) => l.toLowerCase() === 'dairy')).toEqual(['Dairy']);
  });

  it('sorts tasks by aiSmart cleanly without spurious act(...) warnings, and re-sorts if Prompt API updates categories', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() =>
        useFilteredSortedTasks({
          projects: mockProjects,
          tasks: [
            { id: 1, title: 'Apples', done: false, priority: 1, project_id: 1 },
            { id: 2, title: 'Milk', done: false, priority: 1, project_id: 1 },
          ],
          labels: mockLabels,
          selectedProjectId: 1,
          currentUser: null,
          filter: 'active',
          selectedLabel: null,
          sortBy: 'aiSmart',
        })
      );

      // Synchronous heuristic already sorted Dairy ('Milk') before Produce ('Apples')
      expect(result.current.sortedTasks.map((t) => t.title)).toEqual(['Milk', 'Apples']);

      // Flush microtasks and verify zero React act(...) console errors
      await new Promise((r) => setTimeout(r, 20));
      const actWarnings = errorSpy.mock.calls.filter((args) =>
        String(args[0] || '').includes('not wrapped in act')
      );
      expect(actWarnings).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }

    // Now test live Prompt API returning custom alphabetical categories ('Alpha' for Apples, 'Zeta' for Milk)
    const originalAi = (globalThis as any).ai;
    (globalThis as any).ai = {
      languageModel: {
        create: jest.fn().mockResolvedValue({
          prompt: jest.fn().mockResolvedValue('Apples -> Alpha\nMilk -> Zeta'),
          destroy: jest.fn(),
        }),
      },
    };
    try {
      const { result } = renderHook(() =>
        useFilteredSortedTasks({
          projects: mockProjects,
          tasks: [
            { id: 31, title: 'Apples', done: false, priority: 1, project_id: 1 },
            { id: 32, title: 'Milk', done: false, priority: 1, project_id: 1 },
          ],
          labels: mockLabels,
          selectedProjectId: 1,
          currentUser: null,
          filter: 'active',
          selectedLabel: null,
          sortBy: 'aiSmart',
        })
      );

      await waitFor(() => {
        expect(result.current.sortedTasks.map((t) => t.title)).toEqual(['Apples', 'Milk']);
      });
    } finally {
      (globalThis as any).ai = originalAi;
    }
  });
});
