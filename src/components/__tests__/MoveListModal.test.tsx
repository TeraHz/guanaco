import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { MoveListModal } from '../MoveListModal';
import { Project } from '../../types/vikunja';

describe('MoveListModal', () => {
  const mockProjects: Project[] = [
    { id: 1, title: 'Inbox', hex_color: '3498db' }, // un-prefixed Vikunja hex
    { id: 2, title: 'Work Projects', hex_color: '#e74c3c' },
    { id: 3, title: 'Personal Habits', hex_color: '2ecc71' },
    { id: 4, title: 'Old Archived List', hex_color: '#8e8e93', is_archived: true },
  ];

  const mockOnSelectProject = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('renders active projects sorted alphabetically, normalizes # prefix on hex_color, and excludes archived lists', () => {
    const { getByText, queryByText, getByTestId } = render(
      <MoveListModal
        visible={true}
        currentProjectId={1}
        projects={mockProjects}
        onSelectProject={mockOnSelectProject}
        onClose={mockOnClose}
      />
    );

    expect(getByText('Move to List')).toBeTruthy();
    expect(getByText('Inbox')).toBeTruthy();
    expect(getByText('Work Projects')).toBeTruthy();
    expect(getByText('Personal Habits')).toBeTruthy();
    // Archived list should not appear as a destination
    expect(queryByText('Old Archived List')).toBeNull();

    // Verify un-prefixed hex '3498db' is normalized to '#3498db'
    const dot1 = getByTestId('move-project-dot-1');
    const flatStyle = ReactNative.StyleSheet.flatten(dot1.props.style);
    expect(flatStyle.backgroundColor).toBe('#3498db');
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

    fireEvent.press(getByTestId('move-project-option-2'));

    expect(mockOnSelectProject).toHaveBeenCalledWith(2);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('highlights current list using semantic accent blue in Light and Dark modes and calls onClose when close button is pressed', () => {
    const schemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');

    const { getByTestId, getByText, rerender } = render(
      <MoveListModal
        visible={true}
        currentProjectId={1}
        projects={mockProjects}
        onSelectProject={mockOnSelectProject}
        onClose={mockOnClose}
      />
    );

    expect(ReactNative.StyleSheet.flatten(getByText('Inbox').props.style).color).toBe('#007AFF');

    schemeSpy.mockReturnValue('dark');
    rerender(
      <MoveListModal
        visible={true}
        currentProjectId={1}
        projects={mockProjects}
        onSelectProject={mockOnSelectProject}
        onClose={mockOnClose}
      />
    );
    expect(ReactNative.StyleSheet.flatten(getByText('Inbox').props.style).color).toBe('#0A84FF');
    expect(ReactNative.StyleSheet.flatten(getByText('Current').props.style).color).toBe('#A1A1AA');

    fireEvent.press(getByTestId('move-modal-close'));
    expect(mockOnClose).toHaveBeenCalled();
  });
});
