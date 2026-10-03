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

  it('renders active project title and active tasks for that project by default (Active filter)', () => {
    const { getByText, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByText('Inbox')).toBeTruthy();
    expect(getByText('Task in Inbox')).toBeTruthy();
    // Default filter is 'active', so completed task should NOT be visible initially
    expect(queryByText('Completed Inbox Task')).toBeNull();
    // Task belonging to Project 2 should not appear in Project 1 view
    expect(queryByText('Work task')).toBeNull();
  });

  it('filters tasks with pills ordered as Active, Done, All, and allows toggling back to Active', () => {
    const { getByText, getByTestId, queryByText, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Verify filter pills order: active, done, all
    const filterPills = getAllByTestId(/^filter-/).map((el) => el.props.testID);
    expect(filterPills).toEqual(['filter-active', 'filter-done', 'filter-all']);

    // Tap "Done" filter pill
    const doneFilter = getByTestId('filter-done');
    fireEvent.press(doneFilter);

    expect(queryByText('Task in Inbox')).toBeNull();
    expect(getByText('Completed Inbox Task')).toBeTruthy();

    // Tapping already active "Done" pill toggles back to "Active"
    fireEvent.press(doneFilter);
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(queryByText('Completed Inbox Task')).toBeNull();

    // Tap "All" filter pill
    const allFilter = getByTestId('filter-all');
    fireEvent.press(allFilter);
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(getByText('Completed Inbox Task')).toBeTruthy();

    // Tapping already active "All" pill toggles back to "Active"
    fireEvent.press(allFilter);
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(queryByText('Completed Inbox Task')).toBeNull();
  });

  it('renders green floating action button (+) and opens TaskDetailModal in create mode on press', () => {
    const { getByTestId, getByText, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    const fab = getByTestId('green-add-task-fab');
    expect(fab).toBeTruthy();

    // Tap FAB
    fireEvent.press(fab);

    // TaskDetailModal should open in create mode with "New Task"
    expect(getByText('New Task')).toBeTruthy();
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

  // --- Manual Reorder Tests ---
  it('enters reorder mode on task long press, swaps items up/down, and exits on Done', () => {
    useTaskStore.setState({
      projects: [{ id: 1, title: 'Inbox', hex_color: '#3498db' }],
      tasks: [
        { id: 101, title: 'First Task', done: false, priority: 1, project_id: 1, position: 1000 },
        { id: 102, title: 'Second Task', done: false, priority: 1, project_id: 1, position: 2000 },
      ],
      selectedProjectId: 1,
    });

    const { getByTestId, queryByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Long press on first task item
    fireEvent(getByTestId('task-item-101'), 'longPress');

    // Reorder banner and drag handles should now be visible
    expect(getByText(/Drag items by ☰ to reorder/)).toBeTruthy();
    expect(getByTestId('reorder-done-btn')).toBeTruthy();
    expect(getByTestId('drag-handle-101')).toBeTruthy();
    expect(getByTestId('drag-handle-102')).toBeTruthy();

    // Trigger drag on drag handle
    fireEvent(getByTestId('drag-handle-101'), 'pressIn');

    // Tap Done
    fireEvent.press(getByTestId('reorder-done-btn'));
    expect(queryByTestId('reorder-done-btn')).toBeNull();
  });

  // --- Contextual Shopping Department Sort ---
  it('exposes department sort option when active project is shopping-related', () => {
    useTaskStore.setState({
      projects: [{ id: 5, title: 'Weekly Groceries', hex_color: '#3498db' }],
      tasks: [
        { id: 501, title: 'Milk', done: false, priority: 1, project_id: 5, labels: [{ id: 1, title: 'Dairy' }] },
        { id: 502, title: 'Apples', done: false, priority: 1, project_id: 5, labels: [{ id: 2, title: 'Produce' }] },
      ],
      selectedProjectId: 5,
    });

    const { getByTestId, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Open sort picker
    fireEvent.press(getByTestId('sort-trigger-btn'));

    // Department / Aisle sort option should be available!
    expect(getByTestId('sort-option-department')).toBeTruthy();
    expect(getByTestId('sort-option-manual')).toBeTruthy();
    expect(getByTestId('sort-option-reorder')).toBeTruthy();

    // Select Department sort
    fireEvent.press(getByTestId('sort-option-department'));

    // Verify tasks sorted by department (Dairy before Produce)
    const taskTitles = getAllByTestId(/^task-title-/).map((el) => el.props.children);
    expect(taskTitles[0]).toBe('Milk');
    expect(taskTitles[1]).toBe('Apples');
  });

  it('does NOT expose department sort when project is generic (e.g. Work)', () => {
    useTaskStore.setState({
      projects: [{ id: 2, title: 'Work', hex_color: '#e74c3c' }],
      tasks: [{ id: 201, title: 'Code review', done: false, priority: 1, project_id: 2 }],
      selectedProjectId: 2,
    });

    const { getByTestId, queryByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    fireEvent.press(getByTestId('sort-trigger-btn'));
    expect(queryByTestId('sort-option-department')).toBeNull();
  });

  // --- On-Device AI Grouping & Sort ---
  describe('On-Device AI Sort (AICore)', () => {
    const { __setMockAICoreSupportedForTesting } = require('../../utils/aiCore');

    afterEach(() => {
      __setMockAICoreSupportedForTesting(null);
    });

    it('exposes aiSmart sort option on any project when AICore is supported', () => {
      __setMockAICoreSupportedForTesting(true);

      useTaskStore.setState({
        projects: [{ id: 8, title: 'Trip to Japan', hex_color: '#9b59b6' }],
        tasks: [
          { id: 801, title: 'Passport', done: false, priority: 1, project_id: 8 },
          { id: 802, title: 'Warm Jacket', done: false, priority: 1, project_id: 8 },
        ],
        selectedProjectId: 8,
      });

      const { getByTestId, queryByTestId } = render(
        <ProjectTasksScreen onOpenDrawer={jest.fn()} />
      );

      fireEvent.press(getByTestId('sort-trigger-btn'));

      // aiSmart option is present
      expect(getByTestId('sort-option-aiSmart')).toBeTruthy();

      // Select aiSmart sort
      fireEvent.press(getByTestId('sort-option-aiSmart'));

      // Category headers should be rendered
      expect(queryByTestId('category-header-📄 Travel & Documents')).toBeTruthy();
      expect(queryByTestId('category-header-🧳 Clothes & Wearables')).toBeTruthy();
    });

    it('does NOT expose aiSmart sort option when AICore is NOT supported', () => {
      __setMockAICoreSupportedForTesting(false);

      useTaskStore.setState({
        projects: [{ id: 8, title: 'Trip to Japan', hex_color: '#9b59b6' }],
        tasks: [{ id: 801, title: 'Passport', done: false, priority: 1, project_id: 8 }],
        selectedProjectId: 8,
      });

      const { getByTestId, queryByTestId } = render(
        <ProjectTasksScreen onOpenDrawer={jest.fn()} />
      );

      fireEvent.press(getByTestId('sort-trigger-btn'));

      // aiSmart option must NOT be present on unsupported devices
      expect(queryByTestId('sort-option-aiSmart')).toBeNull();
    });
  });

  describe('My Open Tasks View', () => {
    it('renders "My Open Tasks" view when selectedProjectId is -1 and filters tasks assigned to user', () => {
      useTaskStore.setState({
        currentUser: { id: 101, username: 'terahz' },
        selectedProjectId: -1,
        projects: [
          { id: 1, title: 'Inbox', hex_color: '#3498db' },
          { id: 2, title: 'Work', hex_color: '#e74c3c' },
        ],
        tasks: [
          { id: 10, title: 'My Open Bug Fix', done: false, priority: 1, project_id: 1, assignees: [{ id: 101, username: 'terahz' }] },
          { id: 11, title: 'My Done Task', done: true, priority: 1, project_id: 1, assignees: [{ id: 101, username: 'terahz' }] },
          { id: 20, title: 'Colleague Task', done: false, priority: 2, project_id: 2, assignees: [{ id: 102, username: 'alex' }] },
          { id: 30, title: 'Unassigned Item', done: false, priority: 0, project_id: 1 },
        ],
      });

      const { getByText, queryByText } = render(
        <ProjectTasksScreen onOpenDrawer={jest.fn()} />
      );

      expect(getByText('My Open Tasks')).toBeTruthy();
      expect(getByText('My Open Bug Fix')).toBeTruthy();
      expect(queryByText('Colleague Task')).toBeNull();
      expect(queryByText('Unassigned Item')).toBeNull();
    });

    it('automatically assigns currentUser to tasks added from My Open Tasks view via QuickAddBar', () => {
      const mockAddTask = jest.fn();
      useTaskStore.setState({
        currentUser: { id: 101, username: 'terahz' },
        selectedProjectId: -1,
        projects: [{ id: 1, title: 'Inbox', hex_color: '#3498db' }],
        tasks: [],
        addTask: mockAddTask,
      });

      const { getByTestId } = render(
        <ProjectTasksScreen onOpenDrawer={jest.fn()} />
      );

      const input = getByTestId('quick-add-input');
      fireEvent.changeText(input, 'New personal task');
      fireEvent.press(getByTestId('quick-add-submit'));

      expect(mockAddTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New personal task',
          assignees: [{ id: 101, username: 'terahz' }],
        })
      );
    });
  });
});
