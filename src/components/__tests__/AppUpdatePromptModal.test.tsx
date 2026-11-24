import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native';
import { AppUpdatePromptModal } from '../AppUpdatePromptModal';
import { useUpdateStore } from '../../store/updateStore';
import { APP_VERSION, versionFromCode } from '../../constants/version';

describe('AppUpdatePromptModal', () => {
  const initialStoreState = useUpdateStore.getState();

  beforeEach(async () => {
    await AsyncStorage.clear();
    useUpdateStore.setState(initialStoreState, true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    useUpdateStore.setState(initialStoreState, true);
  });

  it('renders nothing when not visible and not downloaded', () => {
    const { queryByTestId } = render(<AppUpdatePromptModal />);
    expect(queryByTestId('app-update-prompt-modal')).toBeNull();
  });

  it('decodes Mmmpp versionCodes cleanly into semantic versions via versionFromCode', () => {
    expect(versionFromCode(10401)).toBe('1.4.1');
    expect(versionFromCode(11203)).toBe('1.12.3');
    expect(versionFromCode(20000)).toBe('2.0.0');
    expect(versionFromCode(22)).toBeNull();
    expect(versionFromCode(null)).toBeNull();
  });

  it('renders semantic version in update prompt modal and falls back cleanly for legacy versionCodes', () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 10500,
        currentVersionCode: 10400,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 1,
        updatePriority: 0,
        inProgress: false,
      },
    });

    const { getByTestId, getByText, queryByText, rerender } = render(<AppUpdatePromptModal />);

    expect(getByTestId('app-update-prompt-modal')).toBeTruthy();
    expect(getByText('Update Available')).toBeTruthy();
    expect(getByText(`Version 1.5.0 is available (current: v${APP_VERSION}).`)).toBeTruthy();
    expect(queryByText(/Build /i)).toBeNull();
    expect(getByText('Update')).toBeTruthy();
    expect(getByText('Later')).toBeTruthy();
    expect(getByTestId('update-prompt-primary-btn')).toBeTruthy();
    expect(getByTestId('update-prompt-dismiss-btn')).toBeTruthy();
    expect(getByTestId('update-prompt-store-btn')).toBeTruthy();

    // Legacy (< 10000) versionCode never exposes raw "Build NN" integers
    act(() => {
      useUpdateStore.setState({
        updateInfo: {
          isAvailable: true,
          availableVersionCode: 23,
          currentVersionCode: 22,
          updateAvailability: 2,
          isImmediateAllowed: true,
          isFlexibleAllowed: true,
          clientVersionStalenessDays: 1,
          updatePriority: 0,
          inProgress: false,
        },
      });
    });
    rerender(<AppUpdatePromptModal />);
    expect(getByText(`A new version is available (current: v${APP_VERSION}).`)).toBeTruthy();
    expect(queryByText(/Build /i)).toBeNull();
  });

  it('handles Update button press (flexible when allowed, immediate when flexible disallowed)', async () => {
    const mockStartUpdate = jest.fn().mockResolvedValue(undefined);
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 0,
        updatePriority: 0,
        inProgress: false,
      },
      startUpdate: mockStartUpdate,
    });

    const { getByTestId } = render(<AppUpdatePromptModal />);
    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-primary-btn'));
    });
    expect(mockStartUpdate).toHaveBeenCalledWith('flexible');

    mockStartUpdate.mockClear();
    act(() => {
      useUpdateStore.setState({
        updateInfo: {
          isAvailable: true,
          availableVersionCode: 20,
          currentVersionCode: 16,
          updateAvailability: 3,
          isImmediateAllowed: true,
          isFlexibleAllowed: false,
          clientVersionStalenessDays: 5,
          updatePriority: 4,
          inProgress: true,
        },
      });
    });
    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-primary-btn'));
    });
    expect(mockStartUpdate).toHaveBeenCalledWith('immediate');
  });

  it('handles Later dismiss button press using real store action and hides modal', async () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 0,
        updatePriority: 0,
        inProgress: false,
      },
    });

    const { getByTestId, queryByTestId } = render(<AppUpdatePromptModal />);
    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-dismiss-btn'));
    });

    await waitFor(() => {
      expect(queryByTestId('app-update-prompt-modal') === null).toBe(true);
    });
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
  });

  it('handles Google Play button press and hides prompt when store opens', async () => {
    const mockOpenStore = jest.fn().mockResolvedValue(true);
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 0,
        updatePriority: 0,
        inProgress: false,
      },
      openStore: mockOpenStore,
    });

    const { getByTestId, queryByTestId } = render(<AppUpdatePromptModal />);
    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-store-btn'));
    });

    expect(mockOpenStore).toHaveBeenCalled();
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    expect(queryByTestId('app-update-prompt-modal')).toBeNull();
  });

  it('treats PENDING status as active backgroundable download without re-triggering startUpdate', async () => {
    const mockStartUpdate = jest.fn();
    useUpdateStore.setState({
      isPromptVisible: true,
      startUpdate: mockStartUpdate,
      installProgress: {
        status: 'PENDING',
        bytesDownloaded: 0,
        totalBytesToDownload: 0,
        errorCode: 0,
      },
    });

    const { getByTestId, getByText, queryByTestId } = render(<AppUpdatePromptModal />);
    expect(getByText('Downloading Update')).toBeTruthy();
    expect(getByText('Hide')).toBeTruthy();
    expect(queryByTestId('update-prompt-store-btn')).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-primary-btn'));
    });

    expect(mockStartUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    expect(queryByTestId('app-update-prompt-modal')).toBeNull();
  });

  it('renders downloading state with single percentage and hides modal on Hide without re-calling startUpdate', async () => {
    const mockStartUpdate = jest.fn();
    useUpdateStore.setState({
      isPromptVisible: true,
      startUpdate: mockStartUpdate,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 0,
        updatePriority: 0,
        inProgress: false,
      },
      installProgress: {
        status: 'DOWNLOADING',
        bytesDownloaded: 50,
        totalBytesToDownload: 100,
        errorCode: 0,
      },
    });

    const { getByTestId, getByText, queryByTestId } = render(<AppUpdatePromptModal />);
    expect(getByText('Downloading Update')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
    expect(getByText('Hide')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-primary-btn'));
    });

    expect(mockStartUpdate).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    expect(queryByTestId('app-update-prompt-modal')).toBeNull();
  });

  it('renders Restart to Update state when status is DOWNLOADED and restarts on primary press', async () => {
    const mockComplete = jest.fn().mockResolvedValue(true);
    useUpdateStore.setState({
      isPromptVisible: false,
      isDownloadedDismissed: false,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 10502,
        currentVersionCode: 10400,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 0,
        updatePriority: 0,
        inProgress: false,
      },
      installProgress: {
        status: 'DOWNLOADED',
        bytesDownloaded: 100,
        totalBytesToDownload: 100,
        errorCode: 0,
      },
      completeDownloadedUpdate: mockComplete,
    });

    const { getByTestId, getByText, queryByText } = render(<AppUpdatePromptModal />);
    expect(getByText('Restart to Update')).toBeTruthy();
    expect(getByText('Version 1.5.2 is ready to install.')).toBeTruthy();
    expect(queryByText(/Build /i)).toBeNull();
    expect(getByText('Restart Now')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-primary-btn'));
    });
    expect(mockComplete).toHaveBeenCalled();
  });

  it('dismisses cleanly when tapping Later in DOWNLOADED state (never an undismissable brick)', async () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      isDownloadedDismissed: false,
      installProgress: {
        status: 'DOWNLOADED',
        bytesDownloaded: 100,
        totalBytesToDownload: 100,
        errorCode: 0,
      },
    });

    const { getByTestId, getByText, queryByTestId } = render(<AppUpdatePromptModal />);
    expect(getByText('Restart to Update')).toBeTruthy();
    expect(getByText('Later')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('update-prompt-dismiss-btn'));
    });

    await waitFor(() => {
      expect(queryByTestId('app-update-prompt-modal') === null).toBe(true);
    });
    expect(useUpdateStore.getState().isPromptVisible).toBe(false);
    expect(useUpdateStore.getState().isDownloadedDismissed).toBe(true);
  });
});
