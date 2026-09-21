import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LabelManagementModal } from '../LabelManagementModal';
import { useTaskStore } from '../../store/taskStore';

describe('LabelManagementModal', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.spyOn(require('react-native').Alert, 'alert').mockImplementation((title, msg, buttons: any) => {
      const deleteBtn = (buttons as any[])?.find((b: any) => b.text === 'Delete');
      deleteBtn?.onPress?.();
    });

    useTaskStore.setState({
      labels: [
        { id: 1, title: 'Costco', hex_color: '#E02424' },
        { id: 2, title: 'Produce', hex_color: '#057A55' },
      ],
      tasks: [
        {
          id: 10,
          title: 'Strawberries',
          done: false,
          priority: 1,
          project_id: 1,
          labels: [{ id: 2, title: 'Produce', hex_color: '#057A55' }],
        },
      ],
    });
    jest.clearAllMocks();
  });

  it('renders all current global labels with their colors', () => {
    const { getByText, getByTestId } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    expect(getByText('Manage Labels')).toBeTruthy();
    expect(getByText('#Costco')).toBeTruthy();
    expect(getByText('#Produce')).toBeTruthy();
    expect(getByTestId('delete-label-1')).toBeTruthy();
    expect(getByTestId('delete-label-2')).toBeTruthy();
  });

  it('creates a new global label', async () => {
    const { getByPlaceholderText, getByTestId, getByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    const input = getByPlaceholderText('New label name...');
    fireEvent.changeText(input, 'Bakery');

    const addBtn = getByTestId('create-label-btn');
    fireEvent.press(addBtn);

    await waitFor(() => {
      expect(getByText('#Bakery')).toBeTruthy();
    });

    const storeLabels = useTaskStore.getState().labels;
    expect(storeLabels.some((l) => l.title === 'Bakery')).toBe(true);
  });

  it('deletes a global label and removes it from tasks', async () => {
    const { getByTestId, queryByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    // Delete Produce label (id: 2)
    const deleteBtn = getByTestId('delete-label-2');
    fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(queryByText('#Produce')).toBeNull();
    });

    const storeLabels = useTaskStore.getState().labels;
    expect(storeLabels.some((l) => l.id === 2)).toBe(false);

    // Task that had label 2 should no longer have label 2
    const task = useTaskStore.getState().tasks.find((t) => t.id === 10);
    expect(task?.labels?.some((l) => l.id === 2)).toBe(false);
  });

  it('allows renaming a label', async () => {
    const { getByTestId, getByDisplayValue, getByText, queryByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    // Tap edit on Costco (id: 1)
    const editBtn = getByTestId('edit-label-1');
    fireEvent.press(editBtn);

    const editInput = getByDisplayValue('Costco');
    fireEvent.changeText(editInput, 'Costco Wholesale');

    const saveBtn = getByTestId('save-label-1');
    fireEvent.press(saveBtn);

    await waitFor(() => {
      expect(getByText('#Costco Wholesale')).toBeTruthy();
      expect(queryByText('#Costco')).toBeNull();
    });

    const storeLabels = useTaskStore.getState().labels;
    expect(storeLabels.some((l) => l.title === 'Costco Wholesale')).toBe(true);
  });
});
