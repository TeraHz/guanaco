import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import { QuickLabelModal } from '../QuickLabelModal';
import { Task } from '../../types/vikunja';

describe('QuickLabelModal', () => {
  const mockTask: Task = {
    id: 10,
    title: 'Almond Milk',
    done: false,
    priority: 1,
    project_id: 1,
    labels: [{ id: 1, title: 'Costco' }],
  };

  const availableLabels = ['Costco', "Trader Joe's", 'Whole Foods', 'Pharmacy'];
  const mockOnSave = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('renders modal inside KeyboardAvoidingView with task title and existing labels marked active', () => {
    const { getByText, getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    expect(getByTestId('quick-label-keyboard-avoiding')).toBeTruthy();
    expect(getByText('Edit Labels')).toBeTruthy();
    expect(getByText('Almond Milk')).toBeTruthy();
    expect(getByTestId('label-chip-Costco').props.accessibilityState).toEqual({ checked: true });
    expect(getByTestId("label-chip-Trader Joe's").props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it('toggles label selection on tap and saves updated labels', () => {
    const { getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    fireEvent.press(getByTestId("label-chip-Trader Joe's"));
    fireEvent.press(getByTestId('label-chip-Costco'));
    fireEvent.press(getByTestId('label-modal-done-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.arrayContaining([expect.objectContaining({ title: "Trader Joe's" })])
    );
    expect(mockOnSave).not.toHaveBeenCalledWith(
      10,
      expect.arrayContaining([expect.objectContaining({ title: 'Costco' })])
    );
  });

  it('allows adding a new label via + Add or auto-committing typed text when pressing Done', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    const input = getByPlaceholderText('New label name...');
    fireEvent.changeText(input, '#Hardware Store');
    fireEvent.press(getByTestId('label-modal-add-btn'));

    expect(getByTestId('label-chip-Hardware Store')).toBeTruthy();

    // Also type another label and press Done directly without pressing + Add
    fireEvent.changeText(input, 'Farmers Market');
    fireEvent.press(getByTestId('label-modal-done-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.arrayContaining([
        expect.objectContaining({ title: 'Hardware Store' }),
        expect.objectContaining({ title: 'Farmers Market' }),
      ])
    );
  });

  it('preserves in-progress edits when optimistic negative task ID resolves to positive server ID', () => {
    const optimisticTask: Task = { ...mockTask, id: -999, labels: [] };
    const { getByTestId, rerender } = render(
      <QuickLabelModal
        visible={true}
        task={optimisticTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    // User toggles Pharmacy while task still has negative temp ID
    fireEvent.press(getByTestId('label-chip-Pharmacy'));

    // Sync resolves -999 -> 505 while modal stays open
    const syncedTask: Task = { ...optimisticTask, id: 505 };
    rerender(
      <QuickLabelModal
        visible={true}
        task={syncedTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    // Save should use live server ID 505 AND keep user's Pharmacy selection!
    fireEvent.press(getByTestId('label-modal-done-btn'));
    expect(mockOnSave).toHaveBeenCalledWith(
      505,
      expect.arrayContaining([expect.objectContaining({ title: 'Pharmacy' })])
    );
  });

  it('allows removing all labels by unchecking them and returns empty array', () => {
    const { getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    fireEvent.press(getByTestId('label-chip-Costco'));
    fireEvent.press(getByTestId('label-modal-done-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(10, []);
  });

  it('applies server colors from labelDefinitions to chips', () => {
    const labelDefs = [
      { id: 1, title: 'Costco', hex_color: 'ff5722' },
      { id: 2, title: 'Pharmacy', hex_color: '057a55' },
    ];

    const { getByText } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        labelDefinitions={labelDefs}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    const costcoText = getByText(/#Costco/);
    expect(costcoText.props.style).toContainEqual({ color: '#ff5722', fontWeight: '700' });
  });

  it('closes QuickLabelModal before opening Manage Labels to prevent stacked modals', () => {
    const callOrder: string[] = [];
    const mockOnOpenManage = jest.fn(() => callOrder.push('openManage'));
    const trackedClose = jest.fn(() => callOrder.push('closeQuick'));

    const { getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={trackedClose}
        onOpenManageLabels={mockOnOpenManage}
      />
    );

    fireEvent.press(getByTestId('quick-label-manage-btn'));
    expect(callOrder).toEqual(['closeQuick', 'openManage']);
  });
});
