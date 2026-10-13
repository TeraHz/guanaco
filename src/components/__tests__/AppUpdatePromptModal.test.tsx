import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AppUpdatePromptModal } from '../AppUpdatePromptModal';
import { useUpdateStore } from '../../store/updateStore';

describe('AppUpdatePromptModal', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      updateInfo: null,
      installProgress: null,
      isPromptVisible: false,
    });
    jest.clearAllMocks();
  });

  it('renders nothing when not visible and not downloaded', () => {
    const { queryByTestId } = render(<AppUpdatePromptModal />);
    expect(queryByTestId('app-update-prompt-modal')).toBeNull();
  });

  it('renders update prompt modal when isPromptVisible is true', () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 20,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 1,
        updatePriority: 0,
        inProgress: false,
      },
    });

    const { getByTestId, getByText } = render(<AppUpdatePromptModal />);

    expect(getByTestId('app-update-prompt-modal')).toBeTruthy();
    expect(getByText('New Version Available')).toBeTruthy();
    expect(getByText(/Build 20/)).toBeTruthy();
    expect(getByTestId('update-prompt-primary-btn')).toBeTruthy();
    expect(getByTestId('update-prompt-dismiss-btn')).toBeTruthy();
    expect(getByTestId('update-prompt-store-btn')).toBeTruthy();
  });

  it('handles Update Now button press', () => {
    const mockStartUpdate = jest.fn();
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
    fireEvent.press(getByTestId('update-prompt-primary-btn'));

    expect(mockStartUpdate).toHaveBeenCalledWith('flexible');
  });

  it('handles Remind Me Tomorrow button press', () => {
    const mockDismissPrompt = jest.fn();
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
      dismissPrompt: mockDismissPrompt,
    });

    const { getByTestId } = render(<AppUpdatePromptModal />);
    fireEvent.press(getByTestId('update-prompt-dismiss-btn'));

    expect(mockDismissPrompt).toHaveBeenCalledWith(24);
  });

  it('handles Play Store Listing button press', () => {
    const mockOpenStore = jest.fn();
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

    const { getByTestId } = render(<AppUpdatePromptModal />);
    fireEvent.press(getByTestId('update-prompt-store-btn'));

    expect(mockOpenStore).toHaveBeenCalled();
  });

  it('renders downloading state with percentage', () => {
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
      installProgress: {
        status: 'DOWNLOADING',
        bytesDownloaded: 50,
        totalBytesToDownload: 100,
        errorCode: 0,
      },
    });

    const { getByText } = render(<AppUpdatePromptModal />);
    expect(getByText('Downloading Update...')).toBeTruthy();
    expect(getByText(/50%/)).toBeTruthy();
  });

  it('renders ready to install state when status is DOWNLOADED and restarts on press', () => {
    const mockComplete = jest.fn();
    useUpdateStore.setState({
      isPromptVisible: false,
      installProgress: {
        status: 'DOWNLOADED',
        bytesDownloaded: 100,
        totalBytesToDownload: 100,
        errorCode: 0,
      },
      completeDownloadedUpdate: mockComplete,
    });

    const { getByTestId, getByText } = render(<AppUpdatePromptModal />);
    expect(getByText('Update Ready to Install')).toBeTruthy();
    expect(getByText('Restart & Apply Update')).toBeTruthy();

    fireEvent.press(getByTestId('update-prompt-primary-btn'));
    expect(mockComplete).toHaveBeenCalled();
  });
});
