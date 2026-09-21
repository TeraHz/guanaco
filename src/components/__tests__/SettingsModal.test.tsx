import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SettingsModal } from '../SettingsModal';
import { useTaskStore } from '../../store/taskStore';

describe('SettingsModal', () => {
  const mockOnClose = jest.fn();
  const mockOnLogout = jest.fn();
  const mockOnOpenLabels = jest.fn();

  beforeEach(() => {
    useTaskStore.setState({
      reenableStaples: true,
      syncStatus: 'synced',
      pendingSyncCount: 0,
      client: {
        getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      } as any,
    });
    jest.clearAllMocks();
  });

  it('renders settings title, server info, and preferences', () => {
    const { getByText, getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onLogout={mockOnLogout}
        onOpenLabelManagement={mockOnOpenLabels}
      />
    );

    expect(getByText('Settings')).toBeTruthy();
    expect(getByText(/tasks\.geodar\.com/)).toBeTruthy();
    expect(getByText('Re-enable Staple Tasks')).toBeTruthy();
    expect(getByTestId('settings-staples-switch')).toBeTruthy();
  });

  it('allows toggling staple tasks preference in task store', () => {
    const { getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onLogout={mockOnLogout}
      />
    );

    const switchEl = getByTestId('settings-staples-switch');
    fireEvent(switchEl, 'valueChange', false);

    expect(useTaskStore.getState().reenableStaples).toBe(false);
  });

  it('calls onOpenLabelManagement when Manage Labels button is pressed', () => {
    const { getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onOpenLabelManagement={mockOnOpenLabels}
      />
    );

    const labelsBtn = getByTestId('settings-manage-labels-btn');
    fireEvent.press(labelsBtn);

    expect(mockOnOpenLabels).toHaveBeenCalled();
  });

  it('triggers resetAndSyncFromServer when overwrite button is pressed', async () => {
    const mockReset = jest.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ resetAndSyncFromServer: mockReset });

    const { getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
      />
    );

    const resetBtn = getByTestId('settings-reset-sync-btn');
    fireEvent.press(resetBtn);

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
    });
  });
});
