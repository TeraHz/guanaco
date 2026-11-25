import React from 'react';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { ProjectEditorModal } from '../ProjectEditorModal';
import { useTaskStore } from '../../store/taskStore';
import { Project } from '../../types/vikunja';

describe('ProjectEditorModal', () => {
  const initialStoreState = useTaskStore.getState();
  const originalOS = Platform.OS;

  const mockProjects: Project[] = [
    { id: 1, title: 'Parent List', hex_color: '3498db' },
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
    Platform.OS = originalOS;
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert');
    useTaskStore.setState({
      ...initialStoreState,
      createProject: mockCreateProject,
      updateProject: mockUpdateProject,
      deleteProject: mockDeleteProject,
      archiveProject: mockArchiveProject,
      duplicateProject: mockDuplicateProject,
      projects: mockProjects,
    });
  });

  afterEach(() => {
    Platform.OS = originalOS;
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  describe('Create Mode', () => {
    it('renders empty form with "New List" heading', () => {
      const { getByText, getByTestId, queryByTestId } = render(
        <ProjectEditorModal visible={true} onClose={mockOnClose} allProjects={mockProjects} />
      );

      expect(getByText('New List')).toBeTruthy();
      expect(getByTestId('project-modal-title-input').props.value).toBe('');
      expect(queryByTestId('project-modal-delete-btn')).toBeNull();
      expect(queryByTestId('project-modal-archive-btn')).toBeNull();
    });

    it('submits new project and calls onSaved and onClose', async () => {
      const newProj: Project = { id: 10, title: 'Groceries', hex_color: '#0A84FF' };
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
            hex_color: '#0A84FF',
          })
        );
        expect(mockOnSaved).toHaveBeenCalledWith(newProj);
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('shows error banner when createProject throws (e.g. offline)', async () => {
      mockCreateProject.mockRejectedValueOnce(
        new Error('Network connection required to manage lists.')
      );

      const { getByTestId, getByText } = render(
        <ProjectEditorModal visible={true} onClose={mockOnClose} allProjects={mockProjects} />
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
      hex_color: '0A84FF', // un-prefixed hex from Vikunja
      is_favorite: true,
      is_archived: false,
    };

    it('pre-populates existing project fields and normalizes un-prefixed hex_color', () => {
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
      expect(getByTestId('project-color-dot-#0A84FF').props.accessibilityState).toEqual({
        selected: true,
      });
      expect(getByTestId('project-modal-delete-btn')).toBeTruthy();
      expect(getByTestId('project-modal-archive-btn')).toBeTruthy();
    });

    it('updates project on save with normalized #hex_color', async () => {
      const updated: Project = { ...editProj, title: 'Work Project Updated', hex_color: '#0A84FF' };
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
            hex_color: '#0A84FF',
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

    it('prompts confirmation and deletes project on native and on Web', async () => {
      mockDeleteProject.mockResolvedValue(undefined);

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

      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const confirmButton = alertCall[2].find(
        (btn: any) => btn.style === 'destructive' || btn.text === 'Delete'
      );
      await act(async () => {
        await confirmButton.onPress();
      });

      expect(mockDeleteProject).toHaveBeenCalledWith(2);
      expect(mockOnDeleted).toHaveBeenCalledWith(2);
      expect(mockOnClose).toHaveBeenCalled();

      // Verify Web window.confirm fallback (Alert.alert is a no-op on react-native-web!)
      jest.clearAllMocks();
      Platform.OS = 'web';
      const origWindow = (global as any).window;
      const confirmMock = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      (global as any).window = { ...(origWindow || {}), confirm: confirmMock };

      try {
        fireEvent.press(getByTestId('project-modal-delete-btn'));
        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(mockDeleteProject).not.toHaveBeenCalled();

        await act(async () => {
          fireEvent.press(getByTestId('project-modal-delete-btn'));
        });
        expect(confirmMock).toHaveBeenCalledTimes(2);
        expect(mockDeleteProject).toHaveBeenCalledWith(2);
      } finally {
        (global as any).window = origWindow;
      }
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

    it('treats Vikunja unset "000000" hex_color as default #0A84FF swatch and excludes archived parent lists', async () => {
      const uncoloredProj: Project = {
        id: 5,
        title: 'Uncolored List',
        hex_color: '000000',
      };
      const projectsWithArchived: Project[] = [
        ...mockProjects,
        uncoloredProj,
        { id: 6, title: 'Hidden Archived Parent', hex_color: '000000', is_archived: true },
      ];
      mockUpdateProject.mockResolvedValueOnce({ ...uncoloredProj, hex_color: '#0A84FF' });

      const { getByTestId, queryByText } = render(
        <ProjectEditorModal
          visible={true}
          project={uncoloredProj}
          onClose={mockOnClose}
          allProjects={projectsWithArchived}
        />
      );

      // Default #0A84FF swatch is selected instead of saving #000000 black
      expect(getByTestId('project-color-dot-#0A84FF').props.accessibilityState).toEqual({
        selected: true,
      });

      // Open parent dropdown -> archived list is excluded
      fireEvent.press(getByTestId('project-modal-parent-selector'));
      expect(queryByText('Hidden Archived Parent')).toBeNull();

      fireEvent.press(getByTestId('project-modal-save-btn'));
      await waitFor(() => {
        expect(mockUpdateProject).toHaveBeenCalledWith(
          5,
          expect.objectContaining({
            hex_color: '#0A84FF',
          })
        );
      });
    });

    it('filters read-only projects out of validParentProjects, hides Delete List for non-admin projects, and warns about sub-lists on delete', () => {
      const projectsWithPerms: Project[] = [
        { id: 1, title: 'Parent List', hex_color: '#3498db', max_permission: 2 },
        { id: 2, title: 'Child List', hex_color: '#e74c3c', parent_project_id: 1, max_permission: 1 },
        { id: 3, title: 'Grandchild List', hex_color: '#2ecc71', parent_project_id: 2, max_permission: 2 },
        { id: 7, title: 'Shared ReadOnly List', hex_color: '#9b59b6', max_permission: 0 },
      ];

      // 1. Editing non-admin (max_permission: 1) list hides Delete List and excludes ReadOnly parent
      const { getByTestId, queryByTestId, queryByText, queryAllByText, rerender } = render(
        <ProjectEditorModal
          visible={true}
          project={projectsWithPerms[1]}
          onClose={mockOnClose}
          allProjects={projectsWithPerms}
        />
      );

      expect(queryByTestId('project-modal-delete-btn')).toBeNull();
      fireEvent.press(getByTestId('project-modal-parent-selector'));
      expect(queryByText('Shared ReadOnly List')).toBeNull();
      expect(queryAllByText('Parent List').length).toBeGreaterThanOrEqual(2);

      // 2. Editing admin parent list (id: 1, which has 2 descendants: id 2 & id 3) warns about 2 sub-lists
      rerender(
        <ProjectEditorModal
          visible={true}
          project={projectsWithPerms[0]}
          onClose={mockOnClose}
          allProjects={projectsWithPerms}
        />
      );

      fireEvent.press(getByTestId('project-modal-delete-btn'));
      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete List',
        expect.stringContaining('2 sub-list(s)'),
        expect.any(Array)
      );
    });
  });
});
