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

  it('renders "My Open Tasks" item with active count assigned to current user and allows selecting it', () => {
    useTaskStore.setState({
      currentUser: { id: 101, username: 'terahz' },
      tasks: [
        { id: 10, title: 'Task for me', done: false, priority: 1, project_id: 1, assignees: [{ id: 101, username: 'terahz' }] },
        { id: 11, title: 'Done task for me', done: true, priority: 1, project_id: 1, assignees: [{ id: 101, username: 'terahz' }] },
        { id: 20, title: 'Task for alex', done: false, priority: 2, project_id: 2, assignees: [{ id: 102, username: 'alex' }] },
        { id: 30, title: 'Unassigned task', done: false, priority: 0, project_id: 1 },
      ],
    });

    const { getByTestId, getByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    expect(getByText('My Open Tasks')).toBeTruthy();
    // 1 active task assigned to current user (id 10)
    expect(getByTestId('drawer-count-my-tasks').props.children).toBe(1);

    const myTasksItem = getByTestId('drawer-project-my-tasks');
    fireEvent.press(myTasksItem);

    expect(useTaskStore.getState().selectedProjectId).toBe(-1);
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

  it('renders settings button in footer and opens SettingsModal when pressed', () => {
    const { getByTestId, getByText } = render(
      <ProjectDrawer visible={true} onClose={mockOnClose} />
    );

    const settingsBtn = getByTestId('drawer-settings-btn');
    expect(settingsBtn).toBeTruthy();

    fireEvent.press(settingsBtn);

    // SettingsModal opens with close button
    expect(getByTestId('close-settings-btn')).toBeTruthy();
  });
});

