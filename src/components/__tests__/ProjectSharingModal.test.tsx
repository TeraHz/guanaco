import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ProjectSharingModal } from '../ProjectSharingModal';
import { useTaskStore } from '../../store/taskStore';
import { Project, ProjectUserShare, ProjectTeamShare, Team } from '../../types/vikunja';

describe('ProjectSharingModal', () => {
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

  const mockClient = {
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

  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useTaskStore.setState({ client: mockClient as any });
  });

  it('loads and displays shared users and teams', async () => {
    const { getByText } = render(
      <ProjectSharingModal
        visible={true}
        project={mockProject}
        onClose={mockOnClose}
      />
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

  it('allows adding a new user with selected permission', async () => {
    const newUserShare: ProjectUserShare = {
      id: 30,
      username: 'charlie',
      permission: 1,
    };
    mockClient.addProjectUser.mockResolvedValueOnce(newUserShare);

    const { getByTestId, getByText } = render(
      <ProjectSharingModal
        visible={true}
        project={mockProject}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => expect(getByText('alice')).toBeTruthy());

    // Switch/focus on Add User input
    fireEvent.changeText(getByTestId('share-user-input'), 'charlie');
    fireEvent.press(getByTestId('share-add-user-btn'));

    await waitFor(() => {
      expect(mockClient.addProjectUser).toHaveBeenCalledWith(1, {
        username: 'charlie',
        permission: 1, // default write or selected
      });
      expect(getByText('charlie')).toBeTruthy();
    });
  });

  it('allows updating permission for an existing user', async () => {
    mockClient.updateProjectUser.mockResolvedValueOnce({
      id: 20,
      username: 'bob',
      permission: 1,
    });

    const { getByTestId, getByText } = render(
      <ProjectSharingModal
        visible={true}
        project={mockProject}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => expect(getByText('bob')).toBeTruthy());

    // Cycle or select new permission for bob (0 -> 1)
    fireEvent.press(getByTestId('share-user-perm-20'));

    await waitFor(() => {
      expect(mockClient.updateProjectUser).toHaveBeenCalledWith(1, 20, 1);
    });
  });

  it('allows removing a user share', async () => {
    mockClient.removeProjectUser.mockResolvedValueOnce({ message: 'removed' });

    const { getByTestId, getByText, queryByText } = render(
      <ProjectSharingModal
        visible={true}
        project={mockProject}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => expect(getByText('bob')).toBeTruthy());

    fireEvent.press(getByTestId('share-remove-user-20'));

    await waitFor(() => {
      expect(mockClient.removeProjectUser).toHaveBeenCalledWith(1, 20);
      expect(queryByText('bob')).toBeNull();
    });
  });

  it('allows adding and removing a team share', async () => {
    const newTeamShare: ProjectTeamShare = {
      id: 6,
      name: 'Designers',
      permission: 0,
    };
    mockClient.addProjectTeam.mockResolvedValueOnce(newTeamShare);
    mockClient.removeProjectTeam.mockResolvedValueOnce({ message: 'removed' });

    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <ProjectSharingModal
        visible={true}
        project={mockProject}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => expect(getByText('alice')).toBeTruthy());

    // Switch to teams tab
    fireEvent.press(getByTestId('share-tab-teams'));
    await waitFor(() => expect(getByText('Core Team')).toBeTruthy());

    // Select designer team from dropdown / picker
    fireEvent.press(getByTestId('share-select-team-6'));
    fireEvent.press(getByTestId('share-add-team-btn'));

    await waitFor(() => {
      expect(mockClient.addProjectTeam).toHaveBeenCalledWith(1, {
        team_id: 6,
        permission: 0,
      });
      expect(getByText('Designers')).toBeTruthy();
    });

    // Remove team
    fireEvent.press(getByTestId('share-remove-team-6'));
    await waitFor(() => {
      expect(mockClient.removeProjectTeam).toHaveBeenCalledWith(1, 6);
      expect(queryByTestId('share-remove-team-6')).toBeNull();
    });
  });

  it('displays offline warning if client is not connected', async () => {
    useTaskStore.setState({ client: null });

    const { getByText } = render(
      <ProjectSharingModal
        visible={true}
        project={mockProject}
        onClose={mockOnClose}
      />
    );

    expect(getByText('Network connection required to manage sharing.')).toBeTruthy();
  });
});
