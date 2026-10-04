import { renderHook } from '@testing-library/react-native';
import { useFilteredSortedTasks } from '../useFilteredSortedTasks';
import { Project, Task, Label, User } from '../../types/vikunja';

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
    expect(result.current.projectTasks.length).toBe(2);
    expect(result.current.doneTasks.length).toBe(1);
    expect(result.current.filteredTasks.length).toBe(1);
    expect(result.current.filteredTasks[0].title).toBe('Milk');
    expect(result.current.activeCount).toBe(1);
  });

  it('filters tasks by selected label', () => {
    const { result } = renderHook(() =>
      useFilteredSortedTasks({
        projects: mockProjects,
        tasks: mockTasks,
        labels: mockLabels,
        selectedProjectId: null, // All Tasks
        currentUser: null,
        filter: 'all',
        selectedLabel: 'Urgent',
        sortBy: 'default',
      })
    );

    expect(result.current.isAllTasksView).toBe(true);
    expect(result.current.filteredTasks.length).toBe(1);
    expect(result.current.filteredTasks[0].title).toBe('Write report');
  });

  it('sorts tasks by priority descending', () => {
    const { result } = renderHook(() =>
      useFilteredSortedTasks({
        projects: mockProjects,
        tasks: mockTasks,
        labels: mockLabels,
        selectedProjectId: null,
        currentUser: null,
        filter: 'active',
        selectedLabel: null,
        sortBy: 'priority',
      })
    );

    expect(result.current.sortedTasks.length).toBe(2);
    // Write report (priority 4) should come before Milk (priority 2)
    expect(result.current.sortedTasks[0].title).toBe('Write report');
    expect(result.current.sortedTasks[1].title).toBe('Milk');
  });

  it('extracts unique available labels', () => {
    const { result } = renderHook(() =>
      useFilteredSortedTasks({
        projects: mockProjects,
        tasks: mockTasks,
        labels: mockLabels,
        selectedProjectId: 1,
        currentUser: null,
        filter: 'all',
        selectedLabel: null,
        sortBy: 'default',
      })
    );

    expect(result.current.availableLabels).toContain('Dairy');
    expect(result.current.availableLabels).toContain('Urgent');
  });
});
