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
    const { getByText, getAllByText, getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onLogout={mockOnLogout}
        onOpenLabelManagement={mockOnOpenLabels}
      />
    );

    expect(getByText('Settings')).toBeTruthy();
    expect(getByText(/tasks\.geodar\.com/)).toBeTruthy();
    expect(getByText(/Version/)).toBeTruthy();
    expect(getAllByText(/v1\.0\.1/).length).toBeGreaterThanOrEqual(1);
    expect(getByText(/Task Item Size/)).toBeTruthy();
    expect(getByTestId('settings-large-items-switch')).toBeTruthy();
    expect(getByText('Re-enable Staple Tasks')).toBeTruthy();
    expect(getByTestId('settings-staples-switch')).toBeTruthy();
  });

  it('allows configuring task item scale with stepper and presets', () => {
    const { getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onLogout={mockOnLogout}
      />
    );

    // Select 150% preset
    const preset150 = getByTestId('settings-scale-preset-150');
    fireEvent.press(preset150);
    expect(useTaskStore.getState().taskItemScale).toBe(150);
    expect(useTaskStore.getState().largeTaskItems).toBe(true);

    // Increment
    const incBtn = getByTestId('settings-scale-increment');
    fireEvent.press(incBtn);
    expect(useTaskStore.getState().taskItemScale).toBe(175);

    // Decrement
    const decBtn = getByTestId('settings-scale-decrement');
    fireEvent.press(decBtn);
    expect(useTaskStore.getState().taskItemScale).toBe(150);

    // Reset to 100%
    const preset100 = getByTestId('settings-scale-preset-100');
    fireEvent.press(preset100);
    expect(useTaskStore.getState().taskItemScale).toBe(100);
    expect(useTaskStore.getState().largeTaskItems).toBe(false);
  });

  it('allows toggling large items preference in task store', () => {
    const { getByTestId } = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onLogout={mockOnLogout}
      />
    );

    const switchEl = getByTestId('settings-large-items-switch');
    fireEvent(switchEl, 'valueChange', true);

    expect(useTaskStore.getState().largeTaskItems).toBe(true);
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

  describe('On-Device AI (AICore) Section', () => {
    const { __setMockAICoreSupportedForTesting } = require('../../utils/aiCore');

    afterEach(() => {
      __setMockAICoreSupportedForTesting(null);
    });

    it('renders on-device intelligence section when device supports AICore', async () => {
      __setMockAICoreSupportedForTesting(true);

      const { getByTestId, getByText } = render(
        <SettingsModal
          visible={true}
          onClose={mockOnClose}
        />
      );

      expect(getByTestId('settings-aicore-section')).toBeTruthy();
      expect(getByText(/Android AICore \(Gemini Nano\)/)).toBeTruthy();
      expect(getByTestId('settings-clear-ai-cache-btn')).toBeTruthy();

      // Press clear cache button
      fireEvent.press(getByTestId('settings-clear-ai-cache-btn'));
      await waitFor(() => {
        expect(getByText('✓ AI Cache Cleared')).toBeTruthy();
      });
    });

    it('does NOT render on-device intelligence section when device does not support it', () => {
      __setMockAICoreSupportedForTesting(false);

      const { queryByTestId } = render(
        <SettingsModal
          visible={true}
          onClose={mockOnClose}
        />
      );

      // Ensures unsupported devices are not bothered with AICore options
      expect(queryByTestId('settings-aicore-section')).toBeNull();
    });
  });
});
