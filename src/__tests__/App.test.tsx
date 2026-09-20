import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import App from '../App';
import { useTaskStore } from '../store/taskStore';
import { setStoredAuth, setBiometricEnabled } from '../utils/biometrics';

describe('App Root Integration & Session Persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useTaskStore.setState({
      client: null,
      syncQueue: null,
      projects: [],
      tasks: [],
      selectedProjectId: null,
      isLoading: false,
      error: null,
    });
    jest.clearAllMocks();

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock-jwt-token' }),
        } as Response);
      }
      if (url.includes('/projects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Main Project', hex_color: '#3498db' }],
        } as Response);
      }
      if (url.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('renders LoginScreen when not authenticated and no stored token', () => {
    const { getByText, getByPlaceholderText } = render(<App />);

    expect(getByText('Vikunja Mobile')).toBeTruthy();
    expect(getByPlaceholderText('Username')).toBeTruthy();
  });

  it('auto-authenticates on launch when valid stored token exists', async () => {
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io');

    const { findByText } = render(<App />);

    const projectTitle = await findByText('Main Project');
    expect(projectTitle).toBeTruthy();
  });

  it('authenticates with biometrics when biometric lock is enabled', async () => {
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io');
    await setBiometricEnabled(true);

    render(<App />);

    await waitFor(() => {
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Unlock Vikunja' })
      );
    });
  });

  it('allows user to log out from drawer and returns to login screen', async () => {
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io');

    const { findByText, getByTestId } = render(<App />);

    await findByText('Main Project');

    // Open drawer
    fireEvent.press(getByTestId('drawer-toggle-btn'));

    // Press logout
    fireEvent.press(getByTestId('drawer-logout-btn'));

    // Should return to LoginScreen
    const loginTitle = await findByText('Vikunja Mobile');
    expect(loginTitle).toBeTruthy();
  });

  it('syncs bidirectional on startup: loads cached tasks and fetches remote tasks from server', async () => {
    // Seed cached offline task
    await AsyncStorage.setItem(
      '@vikunja_cached_tasks',
      JSON.stringify([{ id: 88, title: 'Cached Grocery Item', done: false, project_id: 1 }])
    );
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io');

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { id: 88, title: 'Cached Grocery Item', done: false, project_id: 1 },
            { id: 99, title: 'Newly Synced Remote Task', done: false, priority: 2, project_id: 1 },
          ],
        } as Response);
      }
      if (url.includes('/projects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Main Project' }],
        } as Response);
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    const { findByText } = render(<App />);

    // Both the cached item and the newly synced remote task should be visible!
    expect(await findByText('Cached Grocery Item')).toBeTruthy();
    expect(await findByText('Newly Synced Remote Task')).toBeTruthy();
  });
});
