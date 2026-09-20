import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MoveListModal } from '../MoveListModal';
import { Project } from '../../types/vikunja';

describe('MoveListModal', () => {
  const mockProjects: Project[] = [
    { id: 1, title: 'Inbox', hex_color: '#3498db' },
    { id: 2, title: 'Work Projects', hex_color: '#e74c3c' },
    { id: 3, title: 'Personal Habits', hex_color: '#2ecc71' },
  ];

  const mockOnSelectProject = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders list of projects with project titles and colors', () => {
    const { getByText } = render(
      <MoveListModal
        visible={true}
        currentProjectId={1}
        projects={mockProjects}
        onSelectProject={mockOnSelectProject}
        onClose={mockOnClose}
      />
    );

    expect(getByText('Move to List')).toBeTruthy();
    expect(getByText('Work Projects')).toBeTruthy();
    expect(getByText('Personal Habits')).toBeTruthy();
  });

  it('calls onSelectProject with selected project id when tapped', () => {
    const { getByTestId } = render(
      <MoveListModal
        visible={true}
        currentProjectId={1}
        projects={mockProjects}
        onSelectProject={mockOnSelectProject}
        onClose={mockOnClose}
      />
    );

    const projectOption = getByTestId('move-project-option-2');
    fireEvent.press(projectOption);

    expect(mockOnSelectProject).toHaveBeenCalledWith(2);
  });

  it('calls onClose when close button is pressed', () => {
    const { getByTestId } = render(
      <MoveListModal
        visible={true}
        currentProjectId={1}
        projects={mockProjects}
        onSelectProject={mockOnSelectProject}
        onClose={mockOnClose}
      />
    );

    const closeBtn = getByTestId('move-modal-close');
    fireEvent.press(closeBtn);

    expect(mockOnClose).toHaveBeenCalled();
  });
});
