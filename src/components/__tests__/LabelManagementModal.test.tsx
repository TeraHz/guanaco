import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { LabelManagementModal } from '../LabelManagementModal';
import { useTaskStore } from '../../store/taskStore';

describe('LabelManagementModal', () => {
  const initialStoreState = useTaskStore.getState();
  const mockOnClose = jest.fn();
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = originalOS;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons: any) => {
      const deleteBtn = (buttons as any[])?.find((b: any) => b.text === 'Delete');
      deleteBtn?.onPress?.();
    });

    useTaskStore.setState({
      ...initialStoreState,
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

  afterEach(() => {
    Platform.OS = originalOS;
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  it('renders KeyboardAvoidingView and all current global labels with their colors', () => {
    const { getByText, getByTestId } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    expect(getByTestId('label-management-keyboard-avoiding')).toBeTruthy();
    expect(getByText('Manage Labels')).toBeTruthy();
    expect(getByText('#Costco')).toBeTruthy();
    expect(getByText('#Produce')).toBeTruthy();
    expect(getByTestId('delete-label-1')).toBeTruthy();
    expect(getByTestId('delete-label-2')).toBeTruthy();
  });

  it('creates a new global label and prevents duplicate label names', async () => {
    const { getByPlaceholderText, getByTestId, getByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    const input = getByPlaceholderText('New label name...');
    fireEvent.changeText(input, 'Bakery');
    fireEvent.press(getByTestId('create-label-btn'));

    await waitFor(() => {
      expect(getByText('#Bakery')).toBeTruthy();
    });

    expect(useTaskStore.getState().labels.some((l) => l.title === 'Bakery')).toBe(true);

    // Attempting to create duplicate 'bakery' shows error banner
    fireEvent.changeText(input, 'bakery');
    fireEvent.press(getByTestId('create-label-btn'));
    expect(getByTestId('label-management-error')).toBeTruthy();
  });

  it('allows renaming a label AND changing its color in edit mode', async () => {
    const { getByTestId, getByDisplayValue, getByText, queryByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    fireEvent.press(getByTestId('edit-label-1'));

    const editInput = getByDisplayValue('Costco');
    fireEvent.changeText(editInput, 'Costco Wholesale');

    // Pick purple preset color (#BF5AF2) while editing
    fireEvent.press(getByTestId('edit-label-color-1-#BF5AF2'));
    fireEvent.press(getByTestId('save-label-1'));

    await waitFor(() => {
      expect(getByText('#Costco Wholesale')).toBeTruthy();
      expect(queryByText('#Costco') === null).toBe(true);
    });

    const updated = useTaskStore.getState().labels.find((l) => l.id === 1);
    expect(updated?.title).toBe('Costco Wholesale');
    expect(updated?.hex_color).toBe('#BF5AF2');
  });

  it('defaults uncolored Vikunja "000000" label to #0A84FF instead of saving #000000 black on edit', async () => {
    useTaskStore.setState({
      labels: [{ id: 9, title: 'UncoloredLabel', hex_color: '000000' }],
    });

    const { getByTestId } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    fireEvent.press(getByTestId('edit-label-9'));
    expect(getByTestId('edit-label-color-9-#0A84FF').props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(getByTestId('save-label-9'));

    await waitFor(() => {
      const saved = useTaskStore.getState().labels.find((l) => l.id === 9);
      expect(saved?.hex_color).toBe('#0A84FF');
    });
  });

  it('surfaces mutation errors visually in error banner instead of swallowing silently', async () => {
    const failingCreate = jest.fn().mockRejectedValueOnce(new Error('Server rejected label'));
    useTaskStore.setState({ createGlobalLabel: failingCreate });

    const { getByPlaceholderText, getByTestId, getByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    fireEvent.changeText(getByPlaceholderText('New label name...'), 'Pharmacy');
    fireEvent.press(getByTestId('create-label-btn'));

    await waitFor(() => {
      expect(getByTestId('label-management-error')).toBeTruthy();
      expect(getByText('Server rejected label')).toBeTruthy();
    });
  });

  it('prompts confirmation before deleting a global label on native and on Web', async () => {
    const { getByTestId, queryByText } = render(
      <LabelManagementModal visible={true} onClose={mockOnClose} />
    );

    fireEvent.press(getByTestId('delete-label-2'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Label',
      expect.stringContaining('#Produce'),
      expect.any(Array)
    );

    await waitFor(() => {
      expect(queryByText('#Produce') === null).toBe(true);
    });

    // Verify Web confirmation guard (does NOT delete when cancelled)
    Platform.OS = 'web';
    const origWindow = (global as any).window;
    const confirmMock = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    (global as any).window = { ...(origWindow || {}), confirm: confirmMock };

    try {
      // First press: user cancels window.confirm -> Costco stays!
      fireEvent.press(getByTestId('delete-label-1'));
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(useTaskStore.getState().labels.some((l) => l.id === 1)).toBe(true);

      // Second press: user confirms -> Costco is deleted!
      fireEvent.press(getByTestId('delete-label-1'));
      expect(confirmMock).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(useTaskStore.getState().labels.some((l) => l.id === 1)).toBe(false);
      });
    } finally {
      (global as any).window = origWindow;
    }
  });
});
