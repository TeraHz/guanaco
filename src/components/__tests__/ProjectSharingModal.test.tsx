import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { ProjectSharingModal } from '../ProjectSharingModal';
import { useTaskStore } from '../../store/taskStore';
import { Project, ProjectUserShare, ProjectTeamShare, Team } from '../../types/vikunja';

describe('ProjectSharingModal', () => {
  const initialStoreState = useTaskStore.getState();

  const mockProject: Project = {
    id: 1,
    title: 'Collaborative Project',
    hex_color: '#3498db',
  };

  const mockUsers: ProjectUserShare[] = [
    {
      id: 10,
      username: 'alice',
      name: 'Alice Smith',
      permission: 1, // Write
    },
    {
      id: 20,
      username: 'bob',
      name: 'Bob Jones',
      permission: 0, // Read
    },
  ];

  const mockTeams: ProjectTeamShare[] = [
    {
      id: 5,
      name: 'Core Team',
      description: 'Engineers',
      permission: 2, // Admin
    },
  ];

  const availableTeams: Team[] = [
    { id: 5, name: 'Core Team', description: 'Engineers' },
    { id: 6, name: 'Designers', description: 'Designers' },
  ];

  let mockClient: any;
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      getProjectUsers: jest.fn().mockResolvedValue(mockUsers),
      getProjectTeams: jest.fn().mockResolvedValue(mockTeams),
      getTeams: jest.fn().mockResolvedValue(availableTeams),
      addProjectUser: jest.fn(),
      updateProjectUser: jest.fn(),
      removeProjectUser: jest.fn(),
      addProjectTeam: jest.fn(),
      updateProjectTeam: jest.fn(),
      removeProjectTeam: jest.fn(),
    };
    useTaskStore.setState({ ...initialStoreState, client: mockClient });
  });

  afterEach(() => {
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  it('loads and displays shared users and teams', async () => {
    const { getByText } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    await waitFor(() => {
      expect(mockClient.getProjectUsers).toHaveBeenCalledWith(1);
      expect(mockClient.getProjectTeams).toHaveBeenCalledWith(1);
      expect(getByText('alice')).toBeTruthy();
      expect(getByText('bob')).toBeTruthy();
    });

    fireEvent.press(getByText(/Teams/));
    await waitFor(() => {
      expect(getByText('Core Team')).toBeTruthy();
    });
  });

  it('surfaces load errors visually instead of silently showing empty state', async () => {
    mockClient.getProjectUsers.mockRejectedValueOnce(new Error('403 Forbidden: No admin access'));

    const { getByTestId, getByText } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    await waitFor(() => {
      expect(getByTestId('project-sharing-error')).toBeTruthy();
      expect(getByText('403 Forbidden: No admin access')).toBeTruthy();
    });
  });

  it('allows adding a new user with selected permission', async () => {
    const newUserShare: ProjectUserShare = {
      id: 30,
      username: 'charlie',
      permission: 2,
    };
    mockClient.addProjectUser.mockResolvedValueOnce(newUserShare);

    const { getByTestId, getByText } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    await waitFor(() => expect(getByText('alice')).toBeTruthy());

    fireEvent.press(getByTestId('share-new-user-perm-2')); // Select Admin
    fireEvent.changeText(getByTestId('share-user-input'), '@charlie');
    fireEvent.press(getByTestId('share-add-user-btn'));

    await waitFor(() => {
      expect(mockClient.addProjectUser).toHaveBeenCalledWith(1, {
        username: 'charlie',
        permission: 2,
      });
      expect(getByText('charlie')).toBeTruthy();
    });
  });

  it('allows updating and removing user shares', async () => {
    mockClient.updateProjectUser.mockResolvedValueOnce({
      id: 20,
      username: 'bob',
      permission: 1,
    });
    mockClient.removeProjectUser.mockResolvedValueOnce({ message: 'removed' });

    const { getByTestId, getByText, queryByText } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    await waitFor(() => expect(getByText('bob')).toBeTruthy());

    fireEvent.press(getByTestId('share-user-perm-20'));
    await waitFor(() => {
      expect(mockClient.updateProjectUser).toHaveBeenCalledWith(1, 20, 1);
    });

    fireEvent.press(getByTestId('share-remove-user-20'));
    await waitFor(() => {
      expect(mockClient.removeProjectUser).toHaveBeenCalledWith(1, 20);
      expect(queryByText('bob')).toBeNull();
    });
  });

  it('allows adding, cycling team permissions (updateProjectTeam), and removing a team share', async () => {
    const newTeamShare: ProjectTeamShare = {
      id: 6,
      name: 'Designers',
      permission: 0,
    };
    mockClient.addProjectTeam.mockResolvedValueOnce(newTeamShare);
    mockClient.updateProjectTeam.mockResolvedValueOnce({
      id: 5,
      name: 'Core Team',
      permission: 0,
    });
    mockClient.removeProjectTeam.mockResolvedValueOnce({ message: 'removed' });

    const { getByTestId, getByText, queryByTestId } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    await waitFor(() => expect(getByText('alice')).toBeTruthy());

    fireEvent.press(getByTestId('share-tab-teams'));
    await waitFor(() => expect(getByText('Core Team')).toBeTruthy());

    // Cycle Core Team permission (2 Admin -> 0 Read) via updateProjectTeam!
    fireEvent.press(getByTestId('share-team-perm-5'));
    await waitFor(() => {
      expect(mockClient.updateProjectTeam).toHaveBeenCalledWith(1, 5, 0);
    });

    // Add Designers team
    fireEvent.press(getByTestId('share-select-team-6'));
    fireEvent.press(getByTestId('share-add-team-btn'));

    await waitFor(() => {
      expect(mockClient.addProjectTeam).toHaveBeenCalledWith(1, {
        team_id: 6,
        permission: 0,
      });
      expect(getByText('Designers')).toBeTruthy();
    });

    // Remove Designers team
    fireEvent.press(getByTestId('share-remove-team-6'));
    await waitFor(() => {
      expect(mockClient.removeProjectTeam).toHaveBeenCalledWith(1, 6);
      expect(queryByTestId('share-remove-team-6')).toBeNull();
    });
  });

  it('displays offline warning if client is not connected', () => {
    useTaskStore.setState({ client: null });

    const { getByText } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    expect(getByText('Network connection required to manage sharing.')).toBeTruthy();
  });

  it('ignores stale loadData responses when switching projects mid-fetch', async () => {
    let resolveProj1Users!: (value: ProjectUserShare[]) => void;
    const proj1UsersPromise = new Promise<ProjectUserShare[]>((resolve) => {
      resolveProj1Users = resolve;
    });

    const project2: Project = { id: 2, title: 'Second Project', hex_color: '#2ecc71' };
    mockClient.getProjectUsers.mockImplementation((pid: number) => {
      if (pid === 1) return proj1UsersPromise;
      return Promise.resolve([{ id: 99, username: 'dana', permission: 1 }]);
    });

    const { rerender, getByText, queryByText } = render(
      <ProjectSharingModal visible={true} project={mockProject} onClose={mockOnClose} />
    );

    // Switch to project 2 before project 1's request resolves
    rerender(<ProjectSharingModal visible={true} project={project2} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(getByText('dana')).toBeTruthy();
    });

    // Now resolve project 1's stale response -> must NOT overwrite project 2's user list!
    const { act } = require('@testing-library/react-native');
    await act(async () => {
      resolveProj1Users(mockUsers);
      await proj1UsersPromise;
    });

    expect(getByText('dana')).toBeTruthy();
    expect(queryByText('alice')).toBeNull();
  });
});
