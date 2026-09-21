import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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

  const availableLabels = ['Costco', 'Trader Joe\'s', 'Whole Foods', 'Pharmacy'];
  const mockOnSave = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with task title and existing labels marked active', () => {
    const { getByText, getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    expect(getByText('Edit Labels')).toBeTruthy();
    expect(getByText('Almond Milk')).toBeTruthy();
    expect(getByTestId('label-chip-Costco')).toBeTruthy();
    expect(getByTestId('label-chip-Trader Joe\'s')).toBeTruthy();
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

    // Tap Trader Joe's to select it
    fireEvent.press(getByTestId('label-chip-Trader Joe\'s'));

    // Tap Costco to deselect it
    fireEvent.press(getByTestId('label-chip-Costco'));

    // Tap Save / Done
    fireEvent.press(getByTestId('label-modal-done-btn'));

    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.arrayContaining([
        expect.objectContaining({ title: 'Trader Joe\'s' }),
      ])
    );
    expect(mockOnSave).not.toHaveBeenCalledWith(
      10,
      expect.arrayContaining([
        expect.objectContaining({ title: 'Costco' }),
      ])
    );
  });

  it('allows adding and selecting a new label on the fly', () => {
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
    fireEvent.changeText(input, 'Hardware Store');
    fireEvent.press(getByTestId('label-modal-add-btn'));

    expect(getByTestId('label-chip-Hardware Store')).toBeTruthy();

    fireEvent.press(getByTestId('label-modal-done-btn'));
    expect(mockOnSave).toHaveBeenCalledWith(
      10,
      expect.arrayContaining([
        expect.objectContaining({ title: 'Hardware Store' }),
      ])
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

    // Costco was the only selected label on mockTask, tap it to deselect
    fireEvent.press(getByTestId('label-chip-Costco'));

    // Tap Done
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

    // Costco is selected, text should be styled with normalized #ff5722
    const costcoText = getByText(/#Costco/);
    expect(costcoText.props.style).toContainEqual({ color: '#ff5722', fontWeight: '700' });
  });

  it('triggers onOpenManageLabels when manage button is pressed', () => {
    const mockOnOpenManage = jest.fn();
    const { getByTestId } = render(
      <QuickLabelModal
        visible={true}
        task={mockTask}
        availableLabels={availableLabels}
        onSave={mockOnSave}
        onClose={mockOnClose}
        onOpenManageLabels={mockOnOpenManage}
      />
    );

    fireEvent.press(getByTestId('quick-label-manage-btn'));
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnOpenManage).toHaveBeenCalled();
  });
});
