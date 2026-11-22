import React from 'react';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native';
import { Alert, Modal } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { ProjectDrawer } from '../ProjectDrawer';
import { useTaskStore } from '../../store/taskStore';

describe('ProjectDrawer', () => {
  const initialStoreState = useTaskStore.getState();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    useTaskStore.setState({
      ...initialStoreState,
      projects: [
        { id: 1, title: 'Inbox', hex_color: '3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
        { id: 3, title: 'Personal', hex_color: '#2ecc71' },
      ],
      tasks: [
        { id: 10, title: 'Inbox Task', done: false, priority: 1, project_id: 1 },
        { id: 11, title: 'Done Inbox Task', done: true, priority: 1, project_id: 1 },
        { id: 20, title: 'Work Task', done: false, priority: 2, project_id: 2 },
      ],
      selectedProjectId: 1,
      isLoading: false,
      error: null,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  it('skips rendering completely when visible=false and inline=false with no sub-modals open', () => {
    const { queryByText } = render(
      <ProjectDrawer visible={false} inline={false} onClose={mockOnClose} />
    );

    expect(queryByText('Lists')).toBeNull();
    expect(queryByText('All Tasks')).toBeNull();
  });

  it('renders clean LISTS header without patronizing hints and displays active lists with counts', () => {
    const { getByText, queryByText, getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    expect(getByText('LISTS')).toBeTruthy();
    expect(queryByText(/Tap ⋯ or long-press/i)).toBeNull();
    expect(queryByText('MY LISTS')).toBeNull();
    expect(getByText('Inbox')).toBeTruthy();
    expect(getByText('Work')).toBeTruthy();
    expect(getByText('Personal')).toBeTruthy();
    expect(getByTestId('drawer-count-1').props.children).toBe(1);
    expect(getByTestId('drawer-count-2').props.children).toBe(1);
  });

  it('renders "All Tasks" and "My Open Tasks" views and allows selecting them', () => {
    useTaskStore.setState({
      currentUser: { id: 101, username: 'terahz' },
      tasks: [
        {
          id: 10,
          title: 'Task for me',
          done: false,
          priority: 1,
          project_id: 1,
          assignees: [{ id: 101, username: 'terahz' }],
        },
        {
          id: 20,
          title: 'Task for alex',
          done: false,
          priority: 2,
          project_id: 2,
          assignees: [{ id: 102, username: 'alex' }],
        },
      ],
    });

    const { getByTestId, getByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    expect(getByText('All Tasks')).toBeTruthy();
    expect(getByTestId('drawer-count-all').props.children).toBe(2);
    expect(getByTestId('drawer-count-my-tasks').props.children).toBe(1);

    fireEvent.press(getByTestId('drawer-project-my-tasks'));
    expect(useTaskStore.getState().selectedProjectId).toBe(-1);

    fireEvent.press(getByTestId('drawer-project-all'));
    expect(useTaskStore.getState().selectedProjectId).toBeNull();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders collapsible Archived Lists section cleanly without emoji clutter and allows unarchiving in 1 tap', async () => {
    const mockArchiveProject = jest.fn().mockResolvedValue({ id: 9, is_archived: false });
    useTaskStore.setState({
      archiveProject: mockArchiveProject,
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 9, title: '2025 Taxes', hex_color: '#8e8e93', is_archived: true },
      ],
    });

    const { getByTestId, queryByText, getByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    // Collapsed by default
    expect(getByTestId('drawer-archived-toggle')).toBeTruthy();
    expect(queryByText('2025 Taxes')).toBeNull();

    // Expand Archived Lists
    fireEvent.press(getByTestId('drawer-archived-toggle'));
    expect(getByText('2025 Taxes')).toBeTruthy();
    expect(queryByText(/📦/)).toBeNull();

    // Tap Unarchive button
    fireEvent.press(getByTestId('drawer-unarchive-9'));
    await waitFor(() => {
      expect(mockArchiveProject).toHaveBeenCalledWith(9, false);
    });
  });

  it('never nests or shows two visible <Modal> components simultaneously on iOS when opening Settings -> Manage Labels or Action Sheet -> Edit List', async () => {
    const { getByTestId, UNSAFE_getAllByType } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    const countVisibleModals = () =>
      UNSAFE_getAllByType(Modal).filter((m) => m.props.visible === true).length;

    // 1. Only Drawer Modal is visible initially
    expect(countVisibleModals()).toBe(1);

    // 2. Open Settings -> Drawer Modal closes, SettingsModal opens (still exactly 1 visible Modal!)
    fireEvent.press(getByTestId('drawer-settings-btn'));
    await waitFor(() => {
      expect(LocalAuthentication.hasHardwareAsync).toHaveBeenCalled();
    });
    expect(getByTestId('close-settings-btn')).toBeTruthy();
    expect(countVisibleModals()).toBe(1);

    // 3. From Settings -> Open Manage Labels -> SettingsModal closes, LabelManagementModal opens (still 1!)
    fireEvent.press(getByTestId('settings-manage-labels-btn'));
    expect(getByTestId('close-label-management-btn')).toBeTruthy();
    expect(countVisibleModals()).toBe(1);

    // Close LabelManagementModal -> returns to Drawer (1 visible Modal)
    fireEvent.press(getByTestId('close-label-management-btn'));
    expect(countVisibleModals()).toBe(1);

    // 4. Long-press list -> Action Sheet opens (1 visible Modal) -> tap Edit List -> ProjectEditorModal opens (1 visible Modal)
    fireEvent(getByTestId('drawer-project-1'), 'longPress');
    expect(getByTestId('drawer-option-edit')).toBeTruthy();
    expect(countVisibleModals()).toBe(1);

    fireEvent.press(getByTestId('drawer-option-edit'));
    expect(getByTestId('project-modal-title-input')).toBeTruthy();
    expect(countVisibleModals()).toBe(1);
  });

  it('switches active project and calls onClose when a list item is tapped', () => {
    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    fireEvent.press(getByTestId('drawer-project-2'));
    expect(useTaskStore.getState().selectedProjectId).toBe(2);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when drawer-close-btn is pressed', () => {
    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    fireEvent.press(getByTestId('drawer-close-btn'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('opens ProjectEditorModal when drawer-add-list-btn ("New List") is pressed', () => {
    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    fireEvent.press(getByTestId('drawer-add-list-btn'));
    expect(getByTestId('project-modal-title-input')).toBeTruthy();
    expect(getByTestId('project-modal-save-btn')).toBeTruthy();
  });

  it('presents complete 5-action List Options menu (Edit, Share, Favorite, Archive, Delete) on ⋯ tap and long-press', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const mockArchive = jest.fn().mockResolvedValue({ id: 1, is_archived: true });
    const mockDelete = jest.fn().mockResolvedValue(undefined);
    useTaskStore.setState({
      archiveProject: mockArchive,
      deleteProject: mockDelete,
    });

    const { getByTestId, getByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    // 1. Tapping ⋯ opens all 5 options cleanly
    fireEvent.press(getByTestId('drawer-project-options-1'));
    expect(getByText('Edit List')).toBeTruthy();
    expect(getByText('Share List')).toBeTruthy();
    expect(getByText('Add to Favorites')).toBeTruthy();
    expect(getByText('Archive List')).toBeTruthy();
    expect(getByText('Delete List')).toBeTruthy();

    // Archive List calls archiveProject(1, true)
    fireEvent.press(getByTestId('drawer-option-archive'));
    expect(mockArchive).toHaveBeenCalledWith(1, true);

    // 2. Long-press opens same 5 options and Delete List confirms before calling deleteProject(1)
    fireEvent(getByTestId('drawer-project-1'), 'longPress');
    fireEvent.press(getByTestId('drawer-option-delete'));
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
});
