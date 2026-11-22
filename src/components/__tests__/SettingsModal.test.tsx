import React from 'react';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as biometricsModule from '../../utils/biometrics';
import { SettingsModal } from '../SettingsModal';
import { useTaskStore } from '../../store/taskStore';
import { APP_VERSION } from '../../constants/version';
import { __setMockAICoreSupportedForTesting } from '../../utils/aiCore';

describe('SettingsModal', () => {
  const initialStoreState = useTaskStore.getState();
  const originalOS = Platform.OS;

  const mockOnClose = jest.fn();
  const mockOnLogout = jest.fn();
  const mockOnOpenLabels = jest.fn();

  beforeEach(async () => {
    Platform.OS = originalOS;
    await AsyncStorage.clear();
    useTaskStore.setState({
      ...initialStoreState,
      reenableStaples: true,
      largeTaskItems: false,
      taskItemScale: 100,
      taskItemTextScale: 100,
      syncStatus: 'synced',
      pendingSyncCount: 0,
      currentUser: null,
      cachedUsers: [],
      client: {
        getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      } as any,
    });
    jest.clearAllMocks();
    __setMockAICoreSupportedForTesting(null);
  });

  afterEach(() => {
    Platform.OS = originalOS;
    __setMockAICoreSupportedForTesting(null);
    cleanup();
    useTaskStore.setState(initialStoreState, true);
    jest.restoreAllMocks();
  });

  const renderSettings = async (props?: Partial<React.ComponentProps<typeof SettingsModal>>) => {
    const utils = render(
      <SettingsModal
        visible={true}
        onClose={mockOnClose}
        onLogout={mockOnLogout}
        onOpenLabelManagement={mockOnOpenLabels}
        {...props}
      />
    );
    await waitFor(() => {
      expect(LocalAuthentication.hasHardwareAsync).toHaveBeenCalled();
    });
    return utils;
  };

  it('renders settings title, server info, preferences, and hides Google Play APP UPDATES on iOS', async () => {
    Platform.OS = 'ios';
    const { getByText, getAllByText, getByTestId, queryByTestId } = await renderSettings();

    expect(getByText('Settings')).toBeTruthy();
    expect(getByText(/vikunja\.example\.com/)).toBeTruthy();
    expect(getAllByText(/Version/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(new RegExp(APP_VERSION)).length).toBeGreaterThanOrEqual(1);
    expect(getByText(/Task Box Size/)).toBeTruthy();
    expect(getByText(/Task Text Size/)).toBeTruthy();
    expect(
      getByTestId('settings-large-items-switch', { includeHiddenElements: true })
    ).toBeTruthy();
    expect(getByText('Re-enable Staple Tasks')).toBeTruthy();
    expect(getByTestId('settings-staples-switch')).toBeTruthy();
    expect(queryByTestId('settings-updates-section')).toBeNull();
  });

  it('renders Google Play APP UPDATES card on Android when native Play Core module is supported', async () => {
    Platform.OS = 'android';
    const { getByTestId } = await renderSettings();

    expect(getByTestId('settings-updates-section')).toBeTruthy();
    expect(getByTestId('settings-check-updates-btn')).toBeTruthy();
  });

  it('resolves saved username from @vikunja_username storage key', async () => {
    await AsyncStorage.setItem('@vikunja_username', 'georgi');
    const { getByTestId } = await renderSettings();

    await waitFor(() => {
      expect(getByTestId('settings-display-username').props.children).toBe('@georgi');
    });
  });

  it('displays accurate sync status for synced, syncing, and offline states', async () => {
    useTaskStore.setState({ syncStatus: 'syncing', pendingSyncCount: 3 });
    const { getByTestId, rerender } = await renderSettings();

    expect(getByTestId('settings-sync-status-text').props.children).toBe('◌ Syncing...');

    act(() => {
      useTaskStore.setState({ syncStatus: 'offline', pendingSyncCount: 3 });
    });
    rerender(<SettingsModal visible={true} onClose={mockOnClose} />);
    expect(getByTestId('settings-sync-status-text').props.children).toBe('⚡ Offline (3 pending)');
  });

  it('requires authenticateWithBiometrics before enabling or disabling Biometric Unlock', async () => {
    const { getByTestId } = await renderSettings();

    const bioSwitch = getByTestId('settings-biometric-switch');
    expect(bioSwitch.props.value).toBe(false);

    // 1. User cancels biometric prompt -> switch MUST remain false!
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });
    await act(async () => {
      fireEvent(bioSwitch, 'valueChange', true);
    });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled();
    expect(getByTestId('settings-biometric-switch').props.value).toBe(false);
    expect(await AsyncStorage.getItem('@vikunja_biometric_enabled')).toBeNull();

    // 2. User passes biometric prompt -> switch becomes true and persists!
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    await act(async () => {
      fireEvent(getByTestId('settings-biometric-switch'), 'valueChange', true);
    });
    expect(getByTestId('settings-biometric-switch').props.value).toBe(true);
    expect(await AsyncStorage.getItem('@vikunja_biometric_enabled')).toBe('true');
  });

  it('catches storage/biometric errors in handleToggleBiometric without desyncing switch state', async () => {
    const { getByTestId } = await renderSettings();
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    jest
      .spyOn(biometricsModule, 'setBiometricEnabled')
      .mockRejectedValueOnce(new Error('Keychain unavailable'));

    await act(async () => {
      fireEvent(getByTestId('settings-biometric-switch'), 'valueChange', true);
    });

    // Switch remains false when persistence fails — no unhandled rejection or desync!
    expect(getByTestId('settings-biometric-switch').props.value).toBe(false);
  });

  it('allows configuring task box scale and text scale independently', async () => {
    const { getByTestId } = await renderSettings();

    fireEvent.press(getByTestId('settings-scale-preset-150'));
    expect(useTaskStore.getState().taskItemScale).toBe(150);
    expect(useTaskStore.getState().largeTaskItems).toBe(true);

    fireEvent.press(getByTestId('settings-scale-increment'));
    expect(useTaskStore.getState().taskItemScale).toBe(175);

    fireEvent.press(getByTestId('settings-scale-decrement'));
    expect(useTaskStore.getState().taskItemScale).toBe(150);

    fireEvent.press(getByTestId('settings-text-scale-preset-125'));
    expect(useTaskStore.getState().taskItemTextScale).toBe(125);

    fireEvent.press(getByTestId('settings-scale-preset-100'));
    fireEvent.press(getByTestId('settings-text-scale-preset-100'));
    expect(useTaskStore.getState().taskItemScale).toBe(100);
    expect(useTaskStore.getState().taskItemTextScale).toBe(100);
  });

  it('allows toggling hidden automation large items switch and staple tasks switch', async () => {
    const { getByTestId } = await renderSettings();

    const largeSwitch = getByTestId('settings-large-items-switch', {
      includeHiddenElements: true,
    });
    fireEvent(largeSwitch, 'valueChange', true);
    expect(useTaskStore.getState().largeTaskItems).toBe(true);

    const staplesSwitch = getByTestId('settings-staples-switch');
    fireEvent(staplesSwitch, 'valueChange', false);
    expect(useTaskStore.getState().reenableStaples).toBe(false);
  });

  it('closes SettingsModal before opening Manage Labels to prevent stacked iOS modals', async () => {
    const callOrder: string[] = [];
    const trackedClose = jest.fn(() => callOrder.push('closeSettings'));
    const trackedOpenLabels = jest.fn(() => callOrder.push('openLabels'));

    const { getByTestId } = await renderSettings({
      onClose: trackedClose,
      onOpenLabelManagement: trackedOpenLabels,
    });

    fireEvent.press(getByTestId('settings-manage-labels-btn'));
    expect(callOrder).toEqual(['closeSettings', 'openLabels']);
  });

  it('requires confirmation before Overwrite & Sync from Server', async () => {
    const mockReset = jest.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ resetAndSyncFromServer: mockReset, pendingSyncCount: 2 });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByTestId } = await renderSettings();

    fireEvent.press(getByTestId('settings-reset-sync-btn'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Overwrite & Sync from Server',
      expect.stringContaining('2 unsynced offline change(s)'),
      expect.any(Array)
    );
    expect(mockReset).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as any[];
    const overwriteBtn = buttons.find((b) => b.text === 'Overwrite');
    await act(async () => {
      await overwriteBtn.onPress();
    });

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('logs out immediately when pendingSyncCount is 0', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByTestId } = await renderSettings();

    fireEvent.press(getByTestId('settings-logout-btn'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockOnLogout).toHaveBeenCalledTimes(1);
  });

  it('warns and requires confirmation before logging out when pendingSyncCount > 0', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    useTaskStore.setState({ pendingSyncCount: 4 });

    const { getByTestId } = await renderSettings();
    fireEvent.press(getByTestId('settings-logout-btn'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Unsynced Changes',
      expect.stringContaining('4 unsynced offline change(s)'),
      expect.any(Array)
    );
    expect(mockOnLogout).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as any[];
    const confirmLogout = buttons.find((b) => b.text === 'Log Out');
    act(() => {
      confirmLogout.onPress();
    });
    expect(mockOnLogout).toHaveBeenCalledTimes(1);
  });

  describe('On-Device AI (AICore) Section — Honest Engine Reporting', () => {
    it('reports On-Device Contextual Heuristics when Prompt API is absent', async () => {
      __setMockAICoreSupportedForTesting(true);
      const origAi = (globalThis as any).ai;
      delete (globalThis as any).ai;

      try {
        const { getByTestId, getByText } = await renderSettings();

        expect(getByTestId('settings-aicore-section')).toBeTruthy();
        expect(getByText('● On-Device Contextual Heuristics')).toBeTruthy();

        fireEvent.press(getByTestId('settings-clear-ai-cache-btn'));
        await waitFor(() => {
          expect(getByText('✓ AI Cache Cleared')).toBeTruthy();
        });
      } finally {
        (globalThis as any).ai = origAi;
      }
    });

    it('reports Gemini Nano only when live Prompt API is present', async () => {
      __setMockAICoreSupportedForTesting(true);
      const origAi = (globalThis as any).ai;
      (globalThis as any).ai = { languageModel: { create: jest.fn() } };

      try {
        const { getByText } = await renderSettings();
        expect(getByText('● Gemini Nano (On-Device Prompt API)')).toBeTruthy();
      } finally {
        (globalThis as any).ai = origAi;
      }
    });

    it('does NOT render on-device intelligence section when device does not support it', async () => {
      __setMockAICoreSupportedForTesting(false);
      const { queryByTestId } = await renderSettings();
      expect(queryByTestId('settings-aicore-section')).toBeNull();
    });
  });
});
