import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ProjectEditorModal } from '../ProjectEditorModal';
import { useTaskStore } from '../../store/taskStore';
import { Project } from '../../types/vikunja';

jest.spyOn(Alert, 'alert');

describe('ProjectEditorModal', () => {
  const mockProjects: Project[] = [
    { id: 1, title: 'Parent List', hex_color: '#3498db' },
    { id: 2, title: 'Child List', hex_color: '#e74c3c', parent_project_id: 1 },
    { id: 3, title: 'Grandchild List', hex_color: '#2ecc71', parent_project_id: 2 },
    { id: 4, title: 'Other List', hex_color: '#9b59b6' },
  ];

  const mockCreateProject = jest.fn();
  const mockUpdateProject = jest.fn();
  const mockDeleteProject = jest.fn();
  const mockArchiveProject = jest.fn();
  const mockDuplicateProject = jest.fn();
  const mockOnClose = jest.fn();
  const mockOnSaved = jest.fn();
  const mockOnDeleted = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useTaskStore.setState({
      createProject: mockCreateProject,
      updateProject: mockUpdateProject,
      deleteProject: mockDeleteProject,
      archiveProject: mockArchiveProject,
      duplicateProject: mockDuplicateProject,
      projects: mockProjects,
    } as any);
  });

  describe('Create Mode', () => {
    it('renders empty form with "New List" heading', () => {
      const { getByText, getByTestId, queryByTestId } = render(
        <ProjectEditorModal
          visible={true}
          onClose={mockOnClose}
          allProjects={mockProjects}
        />
      );

      expect(getByText('New List')).toBeTruthy();
      expect(getByTestId('project-modal-title-input').props.value).toBe('');
      // In create mode, archive and delete should not appear
      expect(queryByTestId('project-modal-delete-btn')).toBeNull();
      expect(queryByTestId('project-modal-archive-btn')).toBeNull();
    });

    it('submits new project and calls onSaved and onClose', async () => {
      const newProj: Project = { id: 10, title: 'Groceries', hex_color: '#3498db' };
      mockCreateProject.mockResolvedValueOnce(newProj);

      const { getByTestId } = render(
        <ProjectEditorModal
          visible={true}
          onClose={mockOnClose}
          onSaved={mockOnSaved}
          allProjects={mockProjects}
        />
      );

      fireEvent.changeText(getByTestId('project-modal-title-input'), 'Groceries');
      fireEvent.press(getByTestId('project-modal-save-btn'));

      await waitFor(() => {
        expect(mockCreateProject).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Groceries',
          })
        );
        expect(mockOnSaved).toHaveBeenCalledWith(newProj);
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('shows error banner when createProject throws (e.g. offline)', async () => {
      mockCreateProject.mockRejectedValueOnce(new Error('Network connection required to manage lists.'));

      const { getByTestId, getByText } = render(
        <ProjectEditorModal
          visible={true}
          onClose={mockOnClose}
          allProjects={mockProjects}
        />
      );

      fireEvent.changeText(getByTestId('project-modal-title-input'), 'Offline List');
      fireEvent.press(getByTestId('project-modal-save-btn'));

      await waitFor(() => {
        expect(getByText('Network connection required to manage lists.')).toBeTruthy();
      });
    });
  });

  describe('Edit Mode', () => {
    const editProj: Project = {
      id: 2,
      title: 'Work Project',
      description: 'Important work',
      hex_color: '#e74c3c',
      is_favorite: true,
      is_archived: false,
    };

    it('pre-populates existing project fields', () => {
      const { getByText, getByTestId } = render(
        <ProjectEditorModal
          visible={true}
          project={editProj}
          onClose={mockOnClose}
          allProjects={mockProjects}
        />
      );

      expect(getByText('Edit List')).toBeTruthy();
      expect(getByTestId('project-modal-title-input').props.value).toBe('Work Project');
      expect(getByTestId('project-modal-desc-input').props.value).toBe('Important work');
      expect(getByTestId('project-modal-delete-btn')).toBeTruthy();
      expect(getByTestId('project-modal-archive-btn')).toBeTruthy();
    });

    it('updates project on save', async () => {
      const updated: Project = { ...editProj, title: 'Work Project Updated' };
      mockUpdateProject.mockResolvedValueOnce(updated);

      const { getByTestId } = render(
        <ProjectEditorModal
          visible={true}
          project={editProj}
          onClose={mockOnClose}
          onSaved={mockOnSaved}
          allProjects={mockProjects}
        />
      );

      fireEvent.changeText(getByTestId('project-modal-title-input'), 'Work Project Updated');
      fireEvent.press(getByTestId('project-modal-save-btn'));

      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalledWith(
          2,
          expect.objectContaining({
            title: 'Work Project Updated',
          })
        );
        expect(mockOnSaved).toHaveBeenCalledWith(updated);
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('archives project when archive button is pressed', async () => {
      mockArchiveProject.mockResolvedValueOnce({ ...editProj, is_archived: true });

      const { getByTestId } = render(
        <ProjectEditorModal
          visible={true}
          project={editProj}
          onClose={mockOnClose}
          allProjects={mockProjects}
        />
      );

      fireEvent.press(getByTestId('project-modal-archive-btn'));

      await waitFor(() => {
        expect(mockArchiveProject).toHaveBeenCalledWith(2, true);
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('prompts confirmation and deletes project', async () => {
      mockDeleteProject.mockResolvedValueOnce(undefined);

      const { getByTestId } = render(
        <ProjectEditorModal
          visible={true}
          project={editProj}
          onClose={mockOnClose}
          onDeleted={mockOnDeleted}
          allProjects={mockProjects}
        />
      );

      fireEvent.press(getByTestId('project-modal-delete-btn'));

      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete List',
        expect.stringContaining('Are you sure you want to delete "Work Project"?'),
        expect.any(Array)
      );

      // Trigger confirm action in alert
      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const confirmButton = alertCall[2].find((btn: any) => btn.style === 'destructive' || btn.text === 'Delete');
      await act(async () => {
        await confirmButton.onPress();
      });

      expect(mockDeleteProject).toHaveBeenCalledWith(2);
      expect(mockOnDeleted).toHaveBeenCalledWith(2);
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('duplicates project when duplicate button is pressed', async () => {
      mockDuplicateProject.mockResolvedValueOnce({ id: 99, title: 'Work Project Copy' });

      const { getByTestId } = render(
        <ProjectEditorModal
          visible={true}
          project={editProj}
          onClose={mockOnClose}
          allProjects={mockProjects}
        />
      );

      fireEvent.press(getByTestId('project-modal-duplicate-btn'));

      await waitFor(() => {
        expect(mockDuplicateProject).toHaveBeenCalledWith(2);
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });
});
