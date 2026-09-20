import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ProjectTasksScreen } from '../ProjectTasksScreen';
import { useTaskStore } from '../../store/taskStore';

describe('ProjectTasksScreen', () => {
  const mockFetchTasks = jest.fn().mockResolvedValue(undefined);
  const mockFetchProjects = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    useTaskStore.setState({
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [
        { id: 101, title: 'Task in Inbox', done: false, priority: 2, project_id: 1, position: 100 },
        { id: 102, title: 'Completed Inbox Task', done: true, priority: 1, project_id: 1, position: 200 },
        { id: 201, title: 'Work task', done: false, priority: 3, project_id: 2, position: 100 },
      ],
      selectedProjectId: 1,
      isLoading: false,
      error: null,
      fetchTasks: mockFetchTasks,
      fetchProjects: mockFetchProjects,
    });
    jest.clearAllMocks();
  });

  it('renders active project title and active tasks for that project', () => {
    const { getByText, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByText('Inbox')).toBeTruthy();
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(getByText('Completed Inbox Task')).toBeTruthy();
    // Task belonging to Project 2 should not appear in Project 1 view
    expect(queryByText('Work task')).toBeNull();
  });

  it('filters tasks when Active / Done filter pills are tapped', () => {
    const { getByText, getByTestId, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Tap "Active" filter pill
    const activeFilter = getByTestId('filter-active');
    fireEvent.press(activeFilter);

    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(queryByText('Completed Inbox Task')).toBeNull();

    // Tap "Done" filter pill
    const doneFilter = getByTestId('filter-done');
    fireEvent.press(doneFilter);

    expect(queryByText('Task in Inbox')).toBeNull();
    expect(getByText('Completed Inbox Task')).toBeTruthy();
  });

  it('adds task rapidly via QuickAddBar and shows it immediately in the list', () => {
    const { getByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    const input = getByTestId('quick-add-input');
    fireEvent.changeText(input, 'Instantly added task');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(getByText('Instantly added task')).toBeTruthy();
  });

  it('allows moving a task to another list using the Move action', () => {
    const { getByTestId, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Press move on task 101
    const moveBtn = getByTestId('task-move-action-101');
    fireEvent.press(moveBtn);

    // Select Project 2 'Work' in the modal
    const project2Option = getByTestId('move-project-option-2');
    fireEvent.press(project2Option);

    // Task 101 should now be moved out of Project 1 (Inbox)
    expect(queryByText('Task in Inbox')).toBeNull();
  });

  // --- Regression Test: Issue 1 (Fetch tasks on mount & when selected project changes) ---
  it('calls fetchTasks on mount when project is selected (Regression #1)', () => {
    render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    expect(mockFetchTasks).toHaveBeenCalledWith(1);
  });

  // --- Feature Test: Label Filtering (Shopping list stores / locations) ---
  it('filters tasks by clicked label and allows clearing the filter', () => {
    // Setup tasks with labels
    useTaskStore.setState({
      tasks: [
        {
          id: 301,
          title: 'Apples & Bananas',
          done: false,
          priority: 0,
          project_id: 1,
          labels: [{ id: 1, title: 'Costco', hex_color: '#E02424' }],
        },
        {
          id: 302,
          title: 'Sourdough Bread',
          done: false,
          priority: 0,
          project_id: 1,
          labels: [{ id: 2, title: 'TraderJoes', hex_color: '#057A55' }],
        },
      ],
    });

    const { getByTestId, queryByText, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Both visible initially
    expect(getByText('Apples & Bananas')).toBeTruthy();
    expect(getByText('Sourdough Bread')).toBeTruthy();

    // Click label "Costco"
    const costcoLabel = getByTestId('task-label-301-Costco');
    fireEvent.press(costcoLabel);

    // Only Apples & Bananas should be visible, Sourdough Bread should be filtered out!
    expect(getByText('Apples & Bananas')).toBeTruthy();
    expect(queryByText('Sourdough Bread')).toBeNull();

    // Clear the label filter
    const clearBtn = getByTestId('clear-label-filter');
    fireEvent.press(clearBtn);

    // Both should be visible again
    expect(getByText('Apples & Bananas')).toBeTruthy();
    expect(getByText('Sourdough Bread')).toBeTruthy();
  });

  // --- Sorting Tests ---
  it('allows sorting tasks and honors priority within categories', () => {
    useTaskStore.setState({
      tasks: [
        { id: 1, title: 'Zebra', priority: 1, done: false, project_id: 1 },
        { id: 2, title: 'Apple', priority: 1, done: false, project_id: 1 },
        { id: 3, title: 'Apple', priority: 3, done: false, project_id: 1 }, // higher priority Apple
      ],
    });

    const { getByTestId, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Open sort picker
    const sortBtn = getByTestId('sort-trigger-btn');
    fireEvent.press(sortBtn);

    // Pick sort by Name
    const sortByNameOption = getByTestId('sort-option-name');
    fireEvent.press(sortByNameOption);

    // Tasks should now be ordered: Apple (priority 3), Apple (priority 1), Zebra (priority 1)
    const taskTitles = getAllByTestId(/^task-title-/).map((el) => el.props.children);
    expect(taskTitles[0]).toBe('Apple');
    expect(taskTitles[1]).toBe('Apple');
    expect(taskTitles[2]).toBe('Zebra');
  });

  // --- Sync Status Indicator Tests ---
  it('displays live sync indicator and calls retrySync on press when offline', () => {
    const mockRetrySync = jest.fn();
    useTaskStore.setState({
      syncStatus: 'offline',
      pendingSyncCount: 2,
      retrySync: mockRetrySync,
    });

    const { getByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByText(/Offline \(2\)/)).toBeTruthy();

    const indicator = getByTestId('sync-indicator-btn');
    fireEvent.press(indicator);

    expect(mockRetrySync).toHaveBeenCalled();
  });
});
