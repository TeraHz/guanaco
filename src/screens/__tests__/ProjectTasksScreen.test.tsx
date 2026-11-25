import React from 'react';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native';
import { Alert, Keyboard, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ProjectTasksScreen } from '../ProjectTasksScreen';
import { useTaskStore } from '../../store/taskStore';
import { RepeatMode, ReminderRelativeTo } from '../../types/vikunja';
import { __setMockAICoreSupportedForTesting } from '../../utils/aiCore';

describe('ProjectTasksScreen', () => {
  const initialStoreState = useTaskStore.getState();
  const originalOS = Platform.OS;

  const mockFetchTasks = jest.fn().mockResolvedValue(undefined);
  const mockFetchAllTasks = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Platform.OS = originalOS;
    __setMockAICoreSupportedForTesting(null);
    useTaskStore.setState({
      ...initialStoreState,
      projects: [
        { id: 1, title: 'Inbox', hex_color: '3498db' }, // un-prefixed Vikunja hex
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [
        { id: 101, title: 'Task in Inbox', done: false, priority: 2, project_id: 1, position: 1000 },
        { id: 102, title: 'Completed Inbox Task', done: true, priority: 1, project_id: 1, position: 2000 },
        { id: 201, title: 'Work task', done: false, priority: 3, project_id: 2, position: 1000 },
      ],
      selectedProjectId: 1,
      isLoading: false,
      error: null,
      fetchTasks: mockFetchTasks,
      fetchAllTasks: mockFetchAllTasks,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    Platform.OS = originalOS;
    __setMockAICoreSupportedForTesting(null);
    jest.useRealTimers();
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  it('renders active project title with normalized #hex_color dot, calls fetchTasks on mount, and filters active tasks by default', () => {
    const { getByText, queryByText, getByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(mockFetchTasks).toHaveBeenCalledWith(1);
    expect(getByText('Inbox')).toBeTruthy();
    expect(getByText('1 open')).toBeTruthy();
    expect(queryByText(/Tap to edit list/i)).toBeNull();
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(queryByText('Completed Inbox Task')).toBeNull();
    expect(queryByText('Work task')).toBeNull();

    const dot = getByTestId('active-project-color-dot');
    const flatDot = Object.assign({}, ...dot.props.style.filter(Boolean));
    expect(flatDot.backgroundColor).toBe('#3498db');
  });

  it('hides active-project-color-dot when project has Vikunja unset "000000" hex_color', () => {
    useTaskStore.setState({
      projects: [{ id: 1, title: 'Uncolored Inbox', hex_color: '000000' }],
      selectedProjectId: 1,
    });

    const { queryByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByText('Uncolored Inbox')).toBeTruthy();
    expect(queryByTestId('active-project-color-dot')).toBeNull();
  });

  it('filters tasks with Active, Done, All pills and label filter chips', () => {
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

    const { getByText, getByTestId, queryByText, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    const filterPills = getAllByTestId(/^filter-/).map((el) => el.props.testID);
    expect(filterPills).toEqual(['filter-active', 'filter-done', 'filter-all']);

    fireEvent.press(getByTestId('task-label-301-Costco'));
    expect(getByText('Apples & Bananas')).toBeTruthy();
    expect(queryByText('Sourdough Bread')).toBeNull();

    fireEvent.press(getByTestId('clear-label-filter'));
    expect(getByText('Sourdough Bread')).toBeTruthy();
  });

  it('forwards ALL fields (including hex_color) from TaskDetailModal onCreateTask to addTask and schedules exact 1 notification', async () => {
    const realAddTask = useTaskStore.getState().addTask;
    const addSpy = jest.fn((input) => realAddTask(input));
    useTaskStore.setState({ addTask: addSpy as any });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    fireEvent.press(getByTestId('green-add-task-fab'));
    fireEvent.changeText(getByTestId('task-detail-title-input'), 'Full Rich Task');
    fireEvent.changeText(getByTestId('task-detail-description-input'), 'Detailed notes');
    fireEvent.press(getByTestId('priority-option-5')); // Critical
    fireEvent.press(getByTestId('progress-option-50')); // 50% -> 0.5
    fireEvent.press(getByTestId('task-color-#30D158'));
    fireEvent.press(getByTestId('preset-tomorrow'));
    fireEvent.press(getByTestId('repeat-preset-monthly')); // RepeatMode.Monthly (1)
    fireEvent.press(getByTestId('quick-add-reminder-btn'));
    fireEvent.press(getByTestId('reminder-preset-15m'));
    fireEvent.changeText(getByTestId('task-detail-label-input'), 'UrgentTag');
    fireEvent.changeText(getByTestId('task-detail-assignee-input'), 'terahz');

    await act(async () => {
      fireEvent.press(getByTestId('task-detail-save-btn'));
    });

    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Full Rich Task',
        description: 'Detailed notes',
        done: false,
        priority: 5,
        percent_done: 0.5,
        color: '#30D158',
        hex_color: '#30D158',
        repeat_after: 2592000,
        repeat_mode: RepeatMode.Monthly,
        due_date: expect.any(String),
        reminders: [
          expect.objectContaining({
            relative_to: ReminderRelativeTo.DueDate,
            relative_period: -900,
          }),
        ],
        labels: [expect.objectContaining({ title: 'UrgentTag' })],
        assignees: [expect.objectContaining({ username: 'terahz' })],
        project_id: 1,
      })
    );

    await waitFor(() => {
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('guards when safeProjects is empty instead of blindly posting to project_id: 1', () => {
    const addSpy = jest.fn();
    useTaskStore.setState({
      projects: [],
      tasks: [],
      selectedProjectId: null,
      addTask: addSpy as any,
    });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    fireEvent.changeText(getByTestId('quick-add-input'), 'Orphan task');
    fireEvent.press(getByTestId('quick-add-submit'));

    expect(addSpy).not.toHaveBeenCalled();
    expect(getByTestId('no-project-warning-banner')).toBeTruthy();
  });

  it('stages task deletion with an Undo toast banner and restores task when Undo is tapped', () => {
    jest.useFakeTimers();
    try {
      const deleteSpy = jest.fn();
      useTaskStore.setState({ deleteTask: deleteSpy });

      const { getByTestId, queryByText, getByText } = render(
        <ProjectTasksScreen onOpenDrawer={jest.fn()} />
      );

      // Trigger delete action on task 101
      fireEvent.press(getByTestId('task-delete-action-101', { includeHiddenElements: true }));

      // Task immediately disappears from view and Undo banner is shown, WITHOUT permanent delete yet!
      expect(queryByText('Task in Inbox')).toBeNull();
      expect(getByTestId('undo-delete-banner')).toBeTruthy();
      expect(deleteSpy).not.toHaveBeenCalled();

      // Tap Undo -> task returns and timer is cancelled!
      fireEvent.press(getByTestId('undo-delete-btn'));
      expect(getByText('Task in Inbox')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(6000);
      });
      expect(deleteSpy).not.toHaveBeenCalled();

      // Delete again and let timer expire -> commits deleteTask(101)
      fireEvent.press(getByTestId('task-delete-action-101', { includeHiddenElements: true }));
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(deleteSpy).toHaveBeenCalledWith(101);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tracks tempId -> serverId remap during 5s Undo Delete window (ignoring older completed staples) and cancels cleanly on session reset', () => {
    jest.useFakeTimers();
    try {
      const deleteSpy = jest.fn();
      useTaskStore.setState({
        deleteTask: deleteSpy,
        tasks: [
          // Older completed staple with identical title
          { id: 12, title: 'Milk', done: true, priority: 0, project_id: 1 },
          // Newly quick-added optimistic task
          { id: -777, title: 'Milk', done: false, priority: 0, project_id: 1 },
        ],
      });

      const { getByTestId, queryByText } = render(
        <ProjectTasksScreen onOpenDrawer={jest.fn()} />
      );

      // Stage delete on optimistic task -777
      fireEvent.press(getByTestId('task-delete-action--777', { includeHiddenElements: true }));
      expect(queryByText('Milk')).toBeNull();
      expect(getByTestId('undo-delete-banner')).toBeTruthy();

      // Background CREATE_TASK resolves -777 -> 404 while Undo window is open
      act(() => {
        useTaskStore.setState({
          tasks: [
            { id: 12, title: 'Milk', done: true, priority: 0, project_id: 1 },
            { id: 404, title: 'Milk', done: false, priority: 0, project_id: 1 },
          ],
        });
      });

      // Task 404 must stay hidden while Undo banner remains open, then commit deleteTask(404) (NOT -777 or 12!)
      expect(queryByText('Milk')).toBeNull();
      expect(getByTestId('undo-delete-banner')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith(404);

      // Now stage another delete and simulate session clear (`tasks: []`) mid-window -> must NOT call deleteTask!
      deleteSpy.mockClear();
      fireEvent.press(getByTestId('task-delete-action-404', { includeHiddenElements: true }));
      act(() => {
        useTaskStore.setState({ tasks: [] });
        jest.advanceTimersByTime(5000);
      });
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('moves a task to another list using MoveListModal', () => {
    const { getByTestId, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    fireEvent.press(getByTestId('task-move-action-101', { includeHiddenElements: true }));
    fireEvent.press(getByTestId('move-project-option-2'));

    expect(queryByText('Task in Inbox')).toBeNull();
  });

  it('preserves collision-free positions on filtered-out tasks when reordering under a partial label filter', () => {
    const reorderSpy = jest.fn();
    useTaskStore.setState({
      reorderTasks: reorderSpy,
      tasks: [
        {
          id: 1,
          title: 'Costco Item A',
          done: false,
          priority: 1,
          project_id: 1,
          position: 1000,
          labels: [{ id: 1, title: 'Costco' }],
        },
        {
          id: 2,
          title: 'TraderJoes Item B',
          done: false,
          priority: 1,
          project_id: 1,
          position: 2000,
          labels: [{ id: 2, title: 'TraderJoes' }],
        },
        {
          id: 3,
          title: 'Costco Item C',
          done: false,
          priority: 1,
          project_id: 1,
          position: 3000,
          labels: [{ id: 1, title: 'Costco' }],
        },
      ],
    });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    // Filter to #Costco only (shows [1, 3], hides [2])
    fireEvent.press(getByTestId('task-label-1-Costco'));

    // Enter reorder mode via Sort modal
    fireEvent.press(getByTestId('sort-trigger-btn'));
    fireEvent.press(getByTestId('sort-option-reorder'));

    // Move item 3 UP before item 1 -> full project order MUST splice to [3, 2, 1], keeping item 2 intact!
    fireEvent.press(getByTestId('move-up-task-3'));
    expect(reorderSpy).toHaveBeenCalledWith(1, [3, 2, 1]);
  });

  it('tracks live server ID when an optimistic negative tempId resolves while TaskDetailModal is open', () => {
    const updateSpy = jest.fn();
    useTaskStore.setState({
      updateTaskDetails: updateSpy,
      tasks: [
        { id: -777, title: 'Optimistic Item', done: false, priority: 1, project_id: 1 },
      ],
    });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    // Open TaskDetailModal while task has negative tempId -777
    fireEvent.press(getByTestId('task-item--777'));
    fireEvent.changeText(getByTestId('task-detail-description-input'), 'Edited while syncing');

    // Simulate SyncQueue replacing -777 with positive server ID 404 in store
    act(() => {
      useTaskStore.setState({
        tasks: [
          { id: 404, title: 'Optimistic Item', done: false, priority: 1, project_id: 1 },
        ],
      });
    });

    // Tapping Save MUST update server ID 404 (not dead -777!)
    fireEvent.press(getByTestId('task-detail-save-btn'));
    expect(updateSpy).toHaveBeenCalledWith(
      404,
      expect.objectContaining({ description: 'Edited while syncing' })
    );
  });

  it('handles Android keyboard events, AI Smart grouping headers, My Open Tasks auto-assign, and header options editor', () => {
    Platform.OS = 'android';
    __setMockAICoreSupportedForTesting(true);
    const mockAddTask = jest.fn();

    useTaskStore.setState({
      currentUser: { id: 101, username: 'terahz' },
      selectedProjectId: -1,
      projects: [{ id: 8, title: 'Trip to Japan', hex_color: '#9b59b6' }],
      tasks: [
        {
          id: 801,
          title: 'Passport',
          done: false,
          priority: 1,
          project_id: 8,
          assignees: [{ id: 101, username: 'terahz' }],
        },
      ],
      addTask: mockAddTask as any,
    });

    const { getByTestId, queryByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    act(() => {
      (Keyboard as any).emit('keyboardDidShow', { endCoordinates: { height: 300 } });
      (Keyboard as any).emit('keyboardDidHide');
    });

    // Quick-add from My Open Tasks auto-assigns currentUser
    fireEvent.changeText(getByTestId('quick-add-input'), 'Pack charger');
    fireEvent.press(getByTestId('quick-add-submit'));
    expect(mockAddTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Pack charger',
        project_id: 8,
        assignees: [{ id: 101, username: 'terahz' }],
      })
    );

    // Switch to project 8 and verify AI Smart grouping + header options sheet
    act(() => {
      useTaskStore.setState({ selectedProjectId: 8 });
    });

    fireEvent.press(getByTestId('sort-trigger-btn'));
    fireEvent.press(getByTestId('sort-option-aiSmart'));
    expect(queryByTestId('category-header-📄 Travel & Documents')).toBeTruthy();

    fireEvent.press(getByTestId('project-header-options-btn'));
    fireEvent.press(getByTestId('project-option-edit'));
    expect(getByTestId('project-modal-title-input')).toBeTruthy();
  });

  it('toggles Done and All filter pills cleanly back to Active filter', () => {
    const { getByText, getByTestId, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    const doneFilter = getByTestId('filter-done');
    fireEvent.press(doneFilter);
    expect(queryByText('Task in Inbox')).toBeNull();
    expect(getByText('Completed Inbox Task')).toBeTruthy();

    fireEvent.press(doneFilter);
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(queryByText('Completed Inbox Task')).toBeNull();

    const allFilter = getByTestId('filter-all');
    fireEvent.press(allFilter);
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(getByText('Completed Inbox Task')).toBeTruthy();

    fireEvent.press(allFilter);
    expect(getByText('Task in Inbox')).toBeTruthy();
    expect(queryByText('Completed Inbox Task')).toBeNull();
  });

  it('renders green floating action button (+) and opens TaskDetailModal in create mode on press', () => {
    const { getByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    fireEvent.press(getByTestId('green-add-task-fab'));
    expect(getByText('New Task')).toBeTruthy();
  });

  it('renders tasks in a flex: 1 list container and docks bottom bar with full clearance', () => {
    const { getByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByText('Task in Inbox')).toBeTruthy();
    const listOuterContainer = getByTestId('draggable-flatlist-outer-container');
    const flattenedListStyle = Array.isArray(listOuterContainer.props.style)
      ? Object.assign({}, ...listOuterContainer.props.style)
      : listOuterContainer.props.style;
    expect(flattenedListStyle).toEqual(expect.objectContaining({ flex: 1 }));
    expect(getByTestId('bottom-dock-container')).toBeTruthy();
  });

  it('adds task rapidly via QuickAddBar and shows it immediately in the list', () => {
    const { getByTestId, getByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    fireEvent.changeText(getByTestId('quick-add-input'), 'Instantly added task');
    fireEvent.press(getByTestId('quick-add-submit'));
    expect(getByText('Instantly added task')).toBeTruthy();
  });

  it('allows sorting tasks by Name and honors priority within categories', () => {
    useTaskStore.setState({
      tasks: [
        { id: 1, title: 'Zebra', priority: 1, done: false, project_id: 1 },
        { id: 2, title: 'Apple', priority: 1, done: false, project_id: 1 },
        { id: 3, title: 'Apple', priority: 3, done: false, project_id: 1 },
      ],
    });

    const { getByTestId, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    fireEvent.press(getByTestId('sort-trigger-btn'));
    fireEvent.press(getByTestId('sort-option-name'));

    const taskTitles = getAllByTestId(/^task-title-/).map((el) => el.props.children);
    expect(taskTitles).toEqual(['Apple', 'Apple', 'Zebra']);
  });

  it('displays live offline sync indicator and calls retrySync on press', () => {
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
    fireEvent.press(getByTestId('sync-indicator-btn'));
    expect(mockRetrySync).toHaveBeenCalledTimes(1);
  });

  it('enters reorder mode on task long press, swaps items up/down, and exits on Done', () => {
    useTaskStore.setState({
      projects: [{ id: 1, title: 'Inbox', hex_color: '#3498db' }],
      tasks: [
        { id: 101, title: 'First Task', done: false, priority: 1, project_id: 1, position: 1000 },
        { id: 102, title: 'Second Task', done: false, priority: 1, project_id: 1, position: 2000 },
      ],
      selectedProjectId: 1,
    });

    const { getByTestId, queryByTestId, getByText, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    fireEvent(getByTestId('task-item-101'), 'longPress');
    expect(getByText(/Drag items by ☰ to reorder/)).toBeTruthy();
    expect(getByTestId('drag-handle-101')).toBeTruthy();
    expect(getByTestId('drag-handle-102')).toBeTruthy();

    fireEvent.press(getByTestId('move-down-task-101'));
    expect(getAllByTestId(/^task-title-/).map((el) => el.props.children)).toEqual([
      'Second Task',
      'First Task',
    ]);

    fireEvent.press(getByTestId('move-up-task-101'));
    expect(getAllByTestId(/^task-title-/).map((el) => el.props.children)).toEqual([
      'First Task',
      'Second Task',
    ]);

    fireEvent.press(getByTestId('reorder-done-btn'));
    expect(queryByTestId('reorder-done-btn')).toBeNull();
  });

  it('exposes department sort option when active project is shopping-related and AICore is unsupported', () => {
    __setMockAICoreSupportedForTesting(false);
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

    fireEvent.press(getByTestId('sort-trigger-btn'));
    expect(getByTestId('sort-option-department')).toBeTruthy();
    fireEvent.press(getByTestId('sort-option-department'));

    const taskTitles = getAllByTestId(/^task-title-/).map((el) => el.props.children);
    expect(taskTitles).toEqual(['Milk', 'Apples']);
  });

  it('does NOT expose department sort when project is generic (e.g. Work)', () => {
    __setMockAICoreSupportedForTesting(false);
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
    expect(queryByTestId('sort-option-aiSmart')).toBeNull();
  });

  it('renders "My Open Tasks" view when selectedProjectId is -1 and filters tasks assigned to current user', () => {
    useTaskStore.setState({
      currentUser: { id: 101, username: 'terahz' },
      selectedProjectId: -1,
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [
        {
          id: 10,
          title: 'My Open Bug Fix',
          done: false,
          priority: 1,
          project_id: 1,
          assignees: [{ id: 101, username: 'terahz' }],
        },
        {
          id: 11,
          title: 'My Done Task',
          done: true,
          priority: 1,
          project_id: 1,
          assignees: [{ id: 101, username: 'terahz' }],
        },
        {
          id: 20,
          title: 'Colleague Task',
          done: false,
          priority: 2,
          project_id: 2,
          assignees: [{ id: 102, username: 'alex' }],
        },
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

  it('exposes complete List Options menu (Edit, Share, Favorite, Archive, Delete) when tapping header title or ⋯ button, and renders clean empty states', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const mockArchive = jest.fn().mockResolvedValue({ id: 1, is_archived: true });
    const mockDelete = jest.fn().mockResolvedValue(undefined);

    useTaskStore.setState({
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [],
      selectedProjectId: 1,
      archiveProject: mockArchive,
      deleteProject: mockDelete,
    });

    const { getByTestId, getByText, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Clean empty state without emoji or patronizing fluff
    expect(getByText('No open tasks')).toBeTruthy();
    expect(queryByText(/Enjoy your free time/i)).toBeNull();
    expect(queryByText(/Tap above/i)).toBeNull();
    expect(queryByText('✨')).toBeNull();

    fireEvent.press(getByTestId('filter-done'));
    expect(getByText('No completed tasks')).toBeTruthy();

    // Tapping list title opens full 5-item List Options menu including Archive List
    fireEvent.press(getByTestId('project-header-title-btn'));
    expect(getByText('Edit List')).toBeTruthy();
    expect(getByText('Share List')).toBeTruthy();
    expect(getByText('Add to Favorites')).toBeTruthy();
    expect(getByText('Archive List')).toBeTruthy();
    expect(getByText('Delete List')).toBeTruthy();

    fireEvent.press(getByTestId('project-option-archive'));
    expect(mockArchive).toHaveBeenCalledWith(1, true);

    // Tapping ⋯ also opens full List Options menu and Delete List confirms via Alert
    fireEvent.press(getByTestId('project-header-options-btn'));
    fireEvent.press(getByTestId('project-option-delete'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete List',
      expect.stringContaining('Inbox'),
      expect.any(Array)
    );
    expect(mockDelete).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as any[];
    act(() => {
      buttons.find((b) => b.style === 'destructive').onPress();
    });
    expect(mockDelete).toHaveBeenCalledWith(1);
  });

  it('supports toggling global Search across lists and opening a duplicated task from the toast banner', () => {
    useTaskStore.setState({
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Ops', hex_color: '#e74c3c' },
      ],
      tasks: [
        { id: 10, title: 'Buy coffee beans', done: false, priority: 1, project_id: 1 },
        {
          id: 20,
          title: 'Rotate TLS cert',
          description: '<p>Caddy internal CA</p>',
          done: false,
          priority: 4,
          project_id: 2,
        },
      ],
      selectedProjectId: 1,
    });

    const { getByTestId, getByText, queryByText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Open search bar and toggle All Lists scope to find task in Ops by HTML-decoded note
    fireEvent.press(getByTestId('header-search-btn'));
    fireEvent.changeText(getByTestId('task-search-input'), 'Caddy');
    expect(queryByText('Rotate TLS cert')).toBeNull(); // still scoped to Inbox

    fireEvent.press(getByTestId('search-scope-all-lists'));
    expect(getByText('Rotate TLS cert')).toBeTruthy();

    // Close search
    fireEvent.press(getByTestId('header-search-btn'));
    expect(getByText('Buy coffee beans')).toBeTruthy();

    // Open task 10 and duplicate it -> shows toast with Open button that opens the copy
    fireEvent.press(getByTestId('task-item-10'));
    fireEvent.press(getByTestId('task-detail-duplicate-btn'));

    expect(getByTestId('duplicated-task-banner')).toBeTruthy();
    fireEvent.press(getByTestId('open-duplicated-task-btn'));
    expect(getByTestId('task-detail-title-input').props.value).toBe('Buy coffee beans (Copy)');
  });

  it('renders count-less Offline and Sign In pills when pendingSyncCount is 0', () => {
    useTaskStore.setState({
      syncStatus: 'offline',
      pendingSyncCount: 0,
    });

    const { getByText, queryByText, rerender } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByText('● Offline')).toBeTruthy();
    expect(queryByText(/Offline \(0\)/)).toBeNull();

    act(() => {
      useTaskStore.setState({
        syncStatus: 'auth_required' as any,
        pendingSyncCount: 0,
      });
    });
    rerender(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    expect(getByText('● Sign In')).toBeTruthy();
    expect(queryByText(/Sign In \(0\)/)).toBeNull();
  });

  it('skips duplicate list fetch when consumeSelectedProjectFetch returns true on drawer switch', () => {
    const consumeMock = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    useTaskStore.setState({
      selectedProjectId: 1,
      consumeSelectedProjectFetch: consumeMock,
    } as any);

    render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);
    expect(mockFetchTasks).toHaveBeenCalledTimes(1);
    expect(mockFetchTasks).toHaveBeenCalledWith(1);

    mockFetchTasks.mockClear();
    act(() => {
      useTaskStore.setState({ selectedProjectId: 2 });
    });
    expect(consumeMock).toHaveBeenCalledWith(2);
    expect(mockFetchTasks).not.toHaveBeenCalled();
  });

  it('remembers sort choice per list across list switches', () => {
    let sortMap: Record<string, string> = {};
    const setProjectSortModeMock = jest.fn((scopeKey: string, mode: string) => {
      sortMap = { ...sortMap, [scopeKey]: mode };
      useTaskStore.setState({ sortModesByProject: sortMap } as any);
    });

    useTaskStore.setState({
      selectedProjectId: 1,
      sortModesByProject: sortMap,
      setProjectSortMode: setProjectSortModeMock,
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ],
      tasks: [
        { id: 11, title: 'Zebra', done: false, priority: 1, project_id: 1, position: 1000 },
        { id: 12, title: 'Alpha', done: false, priority: 1, project_id: 1, position: 2000 },
        { id: 21, title: 'Zulu', done: false, priority: 1, project_id: 2, position: 1000 },
        { id: 22, title: 'Bravo', done: false, priority: 1, project_id: 2, position: 2000 },
      ],
    } as any);

    const { getByTestId, getAllByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    // Sort Inbox (project 1) by Name (A-Z)
    fireEvent.press(getByTestId('sort-trigger-btn'));
    fireEvent.press(getByTestId('sort-option-name'));
    expect(setProjectSortModeMock).toHaveBeenCalledWith('1', 'name');
    expect(getAllByTestId(/^task-title-/).map((el) => el.props.children)).toEqual([
      'Alpha',
      'Zebra',
    ]);

    // Switch to Work (project 2) -> uses its own Default Order ('Zulu', 'Bravo')
    act(() => {
      useTaskStore.setState({ selectedProjectId: 2 });
    });
    expect(getAllByTestId(/^task-title-/).map((el) => el.props.children)).toEqual([
      'Zulu',
      'Bravo',
    ]);

    // Switch back to Inbox (project 1) -> remembers Name (A-Z) ('Alpha', 'Zebra')!
    act(() => {
      useTaskStore.setState({ selectedProjectId: 1 });
    });
    expect(getAllByTestId(/^task-title-/).map((el) => el.props.children)).toEqual([
      'Alpha',
      'Zebra',
    ]);
  });

  it('enforces read-only UI on max_permission=0 shared lists while allowing reading task details and adding to writable lists', () => {
    const toggleSpy = jest.fn();
    useTaskStore.setState({
      isLocalMode: false,
      toggleTask: toggleSpy,
      selectedProjectId: 3,
      projects: [
        { id: 1, title: 'My Personal List', hex_color: '#3498db', max_permission: 2 },
        { id: 2, title: 'Team Write List', hex_color: '#e74c3c', max_permission: 1 },
        { id: 3, title: 'Read-Only Bulletin', hex_color: '#2ecc71', max_permission: 0 },
      ],
      tasks: [
        {
          id: 301,
          title: 'Company Holiday Schedule',
          description: 'Office closed Friday',
          done: false,
          priority: 2,
          project_id: 3,
          position: 1000,
        },
      ],
    });

    const { getByTestId, queryByTestId, getByPlaceholderText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByTestId('header-readonly-badge')).toBeTruthy();
    expect(getByPlaceholderText('Read-only shared list').props.editable).toBe(false);

    // Cannot toggle or drag-reorder task on read-only list
    fireEvent.press(getByTestId('task-checkbox-301'));
    expect(toggleSpy).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('sort-trigger-btn'));
    expect(queryByTestId('sort-option-reorder')).toBeNull();
    fireEvent.press(getByTestId('sort-option-default'));

    // Tapping task opens TaskDetailModal in read-only mode
    fireEvent.press(getByTestId('task-item-301'));
    expect(getByTestId('task-detail-readonly-badge')).toBeTruthy();
    expect(queryByTestId('task-detail-save-btn')).toBeNull();
    fireEvent.press(getByTestId('task-detail-close-btn'));

    // Write-only list (id: 2) action sheet hides Share & Delete while keeping Edit/Favorite/Archive
    act(() => {
      useTaskStore.setState({ selectedProjectId: 2 });
    });
    fireEvent.press(getByTestId('project-header-options-btn'));
    expect(getByTestId('project-option-edit')).toBeTruthy();
    expect(getByTestId('project-option-favorite')).toBeTruthy();
    expect(getByTestId('project-option-archive')).toBeTruthy();
    expect(queryByTestId('project-option-share')).toBeNull();
    expect(queryByTestId('project-option-delete')).toBeNull();
  });

  it('renders sync-failures-banner with recovery action, per-item dismiss, and dismiss all', () => {
    const recoverMock = jest.fn().mockReturnValue(true);
    const dismissMock = jest.fn();
    const dismissAllMock = jest.fn();

    useTaskStore.setState({
      selectedProjectId: 1,
      projects: [{ id: 1, title: 'Inbox', hex_color: '#3498db', max_permission: 2 }],
      syncFailures: [
        {
          id: 'fail-1',
          timestamp: Date.now(),
          source: 'migration',
          mutationType: 'MIGRATE_TASK',
          message: 'Forbidden',
          taskTitle: 'Draft Budget',
          taskSnapshot: { title: 'Draft Budget', priority: 2 },
        },
        {
          id: 'fail-2',
          timestamp: Date.now(),
          source: 'sync',
          mutationType: 'UPDATE_TASK',
          message: 'Task deleted on server',
          taskTitle: 'Old Item',
        },
      ],
      recoverFailedTask: recoverMock,
      dismissSyncFailure: dismissMock,
      dismissAllSyncFailures: dismissAllMock,
    } as any);

    const { getByTestId, getByText, queryByTestId } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByTestId('sync-failures-banner')).toBeTruthy();
    expect(getByText('Could not sync 2 item(s)')).toBeTruthy();
    expect(getByText('Skipped during server upload: Draft Budget (Forbidden)')).toBeTruthy();
    expect(getByText('Old Item: Task deleted on server')).toBeTruthy();

    expect(getByTestId('sync-failure-recover-fail-1')).toBeTruthy();
    expect(queryByTestId('sync-failure-recover-fail-2')).toBeNull();

    fireEvent.press(getByTestId('sync-failure-recover-fail-1'));
    expect(recoverMock).toHaveBeenCalledWith('fail-1', 1);

    fireEvent.press(getByTestId('sync-failure-dismiss-fail-2'));
    expect(dismissMock).toHaveBeenCalledWith('fail-2');

    fireEvent.press(getByTestId('sync-failures-dismiss-all-btn'));
    expect(dismissAllMock).toHaveBeenCalledTimes(1);
  });

  it('warns about sub-lists before deleting a parent list and surfaces deleteProject errors via Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const mockDelete = jest.fn().mockRejectedValueOnce(new Error('Cannot delete shared list'));

    useTaskStore.setState({
      selectedProjectId: 1,
      deleteProject: mockDelete,
      projects: [
        { id: 1, title: 'Parent List', hex_color: '#3498db' },
        { id: 2, title: 'Sublist One', parent_project_id: 1 },
      ],
    });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    fireEvent.press(getByTestId('project-header-options-btn'));
    fireEvent.press(getByTestId('project-option-delete'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete List',
      expect.stringContaining('1 sub-list(s)'),
      expect.any(Array)
    );

    const buttons = alertSpy.mock.calls[0][2] as any[];
    await act(async () => {
      await buttons.find((b) => b.style === 'destructive').onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith('Delete List', 'Cannot delete shared list');
  });

  it('excludes hidden done tasks with position: 0 from reorderTasks payloads while preserving positioned filtered-out tasks', () => {
    const reorderSpy = jest.fn();
    useTaskStore.setState({
      selectedProjectId: 1,
      reorderTasks: reorderSpy,
      projects: [{ id: 1, title: 'Inbox', hex_color: '#3498db' }],
      tasks: [
        { id: 1, title: 'Active A', done: false, priority: 1, project_id: 1, position: 1000 },
        { id: 2, title: 'Active B', done: false, priority: 1, project_id: 1, position: 2000 },
        { id: 90, title: 'Old Done Zero A', done: true, priority: 0, project_id: 1, position: 0 },
        { id: 91, title: 'Old Done Zero B', done: true, priority: 0, project_id: 1 },
      ],
    });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    fireEvent.press(getByTestId('sort-trigger-btn'));
    fireEvent.press(getByTestId('sort-option-reorder'));
    fireEvent.press(getByTestId('move-down-task-1'));

    expect(reorderSpy).toHaveBeenCalledWith(1, [2, 1]);
  });

  it('normalizes persisted sortModesByProject safely across AICore and shopping/non-shopping list contexts', () => {
    __setMockAICoreSupportedForTesting(false);
    useTaskStore.setState({
      selectedProjectId: 2,
      sortModesByProject: {
        '2': 'department', // Work is non-shopping and AICore is false -> must fall back to 'default'
        '5': 'aiSmart', // Groceries is shopping and AICore is false -> must normalize to 'department'
        '9': 'corrupted_value',
      },
      setProjectSortMode: jest.fn(),
      projects: [
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
        { id: 5, title: 'Weekly Groceries', hex_color: '#3498db' },
        { id: 9, title: 'Misc', hex_color: '#2ecc71' },
      ],
      tasks: [],
    } as any);

    const { getByTestId, getByText } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    // Work ('department' when !hasAICore && !isShopping) -> falls back to 'default' ('⇅ Sort')
    expect(getByText('⇅ Sort')).toBeTruthy();

    // Groceries ('aiSmart' when !hasAICore && isShopping) -> normalizes to 'department'
    act(() => {
      useTaskStore.setState({ selectedProjectId: 5 });
    });
    expect(getByText('⇅ Department / Aisle')).toBeTruthy();

    // Corrupted sort value -> falls back to 'default'
    act(() => {
      useTaskStore.setState({ selectedProjectId: 9 });
    });
    expect(getByText('⇅ Sort')).toBeTruthy();

    // When AICore is supported, 'department' normalizes to 'aiSmart'
    __setMockAICoreSupportedForTesting(true);
    act(() => {
      useTaskStore.setState({
        selectedProjectId: 5,
        sortModesByProject: { '5': 'department' },
      } as any);
    });
    expect(getByTestId('sort-trigger-btn')).toBeTruthy();
    expect(getByText('⇅ Smart Grouping')).toBeTruthy();
  });

  it('uses count-less offline accessibilityLabel when pendingSyncCount is 0, sends only dirty fields on Save, and disables QuickAddBar in virtual views when all lists are read-only', () => {
    const updateSpy = jest.fn();
    useTaskStore.setState({
      isLocalMode: false,
      syncStatus: 'offline',
      pendingSyncCount: 0,
      updateTaskDetails: updateSpy,
      selectedProjectId: 1,
      projects: [{ id: 1, title: 'Inbox', hex_color: '#3498db', max_permission: 2 }],
      tasks: [
        {
          id: 55,
          title: 'Initial Title',
          description: 'Initial notes',
          done: false,
          priority: 1,
          project_id: 1,
        },
      ],
    });

    const { getByTestId, getByPlaceholderText } = render(
      <ProjectTasksScreen onOpenDrawer={jest.fn()} />
    );

    expect(getByTestId('sync-indicator-btn').props.accessibilityLabel).toBe(
      'Offline. Tap to retry sync'
    );

    // Open task 55, edit ONLY title while background sync updates priority to 5
    fireEvent.press(getByTestId('task-item-55'));
    fireEvent.changeText(getByTestId('task-detail-title-input'), 'Updated Title');
    act(() => {
      useTaskStore.setState({
        tasks: [
          {
            id: 55,
            title: 'Initial Title',
            description: 'Initial notes',
            done: false,
            priority: 5,
            project_id: 1,
          },
        ],
      });
    });
    fireEvent.press(getByTestId('task-detail-save-btn'));

    // Only dirty field `title` is sent -> concurrent server `priority: 5` is NOT overwritten!
    expect(updateSpy).toHaveBeenCalledWith(55, { title: 'Updated Title' });

    // Switch to All Tasks (selectedProjectId: null) when all projects are read-only -> QuickAddBar is disabled!
    act(() => {
      useTaskStore.setState({
        selectedProjectId: null,
        projects: [{ id: 3, title: 'ReadOnly Shared', hex_color: '#2ecc71', max_permission: 0 }],
      });
    });
    expect(getByPlaceholderText('Read-only shared list').props.editable).toBe(false);
  });

  it('Save Copy prefers the task original writable list over the currently viewed list, falling back when original is missing/read-only', () => {
    const recoverMock = jest.fn().mockReturnValue(true);
    useTaskStore.setState({
      selectedProjectId: 1,
      projects: [
        { id: 1, title: 'Current List', hex_color: '#3498db', max_permission: 2 },
        { id: 2, title: 'Original Writable List', hex_color: '#2ecc71', max_permission: 2 },
        { id: 3, title: 'Original ReadOnly List', hex_color: '#e74c3c', max_permission: 0 },
      ],
      syncFailures: [
        {
          id: 'fail-orig-writable',
          timestamp: Date.now(),
          source: 'sync',
          mutationType: 'CREATE_TASK',
          message: 'Server error',
          taskTitle: 'Groceries Backup',
          projectId: 2,
          taskSnapshot: { title: 'Groceries Backup', project_id: 2 },
        },
        {
          id: 'fail-orig-readonly',
          timestamp: Date.now(),
          source: 'sync',
          mutationType: 'CREATE_TASK',
          message: 'Forbidden',
          taskTitle: 'Blocked Copy',
          projectId: 3,
          taskSnapshot: { title: 'Blocked Copy', project_id: 3 },
        },
      ],
      recoverFailedTask: recoverMock,
    });

    const { getByTestId } = render(<ProjectTasksScreen onOpenDrawer={jest.fn()} />);

    fireEvent.press(getByTestId('sync-failure-recover-fail-orig-writable'));
    expect(recoverMock).toHaveBeenNthCalledWith(1, 'fail-orig-writable', 2);

    fireEvent.press(getByTestId('sync-failure-recover-fail-orig-readonly'));
    expect(recoverMock).toHaveBeenNthCalledWith(2, 'fail-orig-readonly', 1);
  });
});
