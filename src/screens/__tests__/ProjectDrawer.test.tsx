import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProjectDrawer } from '../ProjectDrawer';
import { useTaskStore } from '../../store/taskStore';

describe('ProjectDrawer', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    useTaskStore.setState({
      projects: [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
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

  it('renders all lists/projects and their active task counts', () => {
    const { getByText, getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    expect(getByText('Inbox')).toBeTruthy();
    expect(getByText('Work')).toBeTruthy();
    expect(getByText('Personal')).toBeTruthy();

    // Inbox has 1 active task (1 is done)
    expect(getByTestId('drawer-count-1').props.children).toBe(1);
    // Work has 1 active task
    expect(getByTestId('drawer-count-2').props.children).toBe(1);
  });

  it('renders "All Tasks" item with total active count across all lists and allows selecting it', () => {
    const { getByTestId, getByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    expect(getByText('All Tasks')).toBeTruthy();
    // 2 active tasks total (1 inbox, 1 work)
    expect(getByTestId('drawer-count-all').props.children).toBe(2);

    const allTasksItem = getByTestId('drawer-project-all');
    fireEvent.press(allTasksItem);

    expect(useTaskStore.getState().selectedProjectId).toBeNull();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('switches active project when a list item is selected', () => {
    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    const workItem = getByTestId('drawer-project-2');
    fireEvent.press(workItem);

    expect(useTaskStore.getState().selectedProjectId).toBe(2);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when close button is pressed', () => {
    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    const closeBtn = getByTestId('drawer-close-btn');
    fireEvent.press(closeBtn);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onLogout when logout button is pressed', () => {
    const mockOnLogout = jest.fn();
    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} onLogout={mockOnLogout} />
    );

    const logoutBtn = getByTestId('drawer-logout-btn');
    fireEvent.press(logoutBtn);

    expect(mockOnLogout).toHaveBeenCalled();
  });

  it('renders re-enable staple tasks setting toggle and toggles setting', () => {
    const mockSetReenableStaples = jest.fn();
    useTaskStore.setState({
      reenableStaples: true,
      setReenableStaples: mockSetReenableStaples,
    });

    const { getByTestId } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    const stapleSwitch = getByTestId('drawer-staples-switch');
    expect(stapleSwitch.props.value).toBe(true);

    fireEvent(stapleSwitch, 'valueChange', false);
    expect(mockSetReenableStaples).toHaveBeenCalledWith(false);
  });

  it('renders "Sync & Overwrite from Server" button and triggers resetAndSyncFromServer', async () => {
    const mockResetAndSync = jest.fn().mockResolvedValue(undefined);
    useTaskStore.setState({
      resetAndSyncFromServer: mockResetAndSync,
    });

    const { getByTestId, findByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    const resetBtn = getByTestId('drawer-reset-sync-btn');
    expect(resetBtn).toBeTruthy();

    fireEvent.press(resetBtn);
    expect(mockResetAndSync).toHaveBeenCalled();

    // After success, it should display completion feedback
    expect(await findByText('✓ Overwrite Complete!')).toBeTruthy();
  });
});

