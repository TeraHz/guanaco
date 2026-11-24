import React from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import App, { BIOMETRIC_LOCK_GRACE_MS } from '../App';
import { useTaskStore } from '../store/taskStore';
import { useUpdateStore } from '../store/updateStore';
import {
  setStoredAuth,
  setBiometricEnabled,
  SECURE_KEY_AUTH_TOKEN,
  SECURE_KEY_REFRESH_TOKEN,
  SECURE_KEY_USERNAME,
  SECURE_KEY_PASSWORD,
} from '../utils/biometrics';

function makeAppTestJwt(expSec: number): string {
  const b64 = (o: any) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', exp: expSec })}.sig`;
}

describe('App Root Integration, Offline Biometric Gate & Session Security', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    await useTaskStore.getState().clearSession();
    await AsyncStorage.clear();
    await SecureStore.deleteItemAsync(SECURE_KEY_AUTH_TOKEN);
    await SecureStore.deleteItemAsync(SECURE_KEY_REFRESH_TOKEN);
    await SecureStore.deleteItemAsync(SECURE_KEY_USERNAME);
    await SecureStore.deleteItemAsync(SECURE_KEY_PASSWORD);

    useTaskStore.setState({
      client: null,
      syncQueue: null,
      projects: [],
      tasks: [],
      labels: [],
      cachedUsers: [],
      currentUser: null,
      selectedProjectId: null,
      isLoading: false,
      error: null,
      syncStatus: 'synced',
      pendingSyncCount: 0,
      isSyncingAll: false,
      authRequired: false,
    });
    useUpdateStore.setState({ isPromptVisible: false, updateInfo: null });

    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
    jest.clearAllMocks();

    if (jest.isMockFunction(AppState.addEventListener)) {
      (AppState.addEventListener as jest.Mock).mockImplementation(() => ({
        remove: jest.fn(),
      }));
    }

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock-jwt-token' }),
        } as Response);
      }
      if (url.endsWith('/user')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, username: 'alice' }),
        } as Response);
      }
      if (url.includes('/projects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Main Project', hex_color: '#3498db' }],
        } as Response);
      }
      if (url.includes('/labels') || url.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }
      return Promise.reject(new Error(`Unknown endpoint: ${url}`));
    });
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    useUpdateStore.setState({ isPromptVisible: false, updateInfo: null });
  });

  it('renders LoginScreen when unauthenticated and hides AppUpdatePromptModal while unauthenticated', () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 99,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 3,
        updatePriority: 0,
        inProgress: false,
      },
    });

    const { getByText, getByPlaceholderText, queryByText } = render(<App />);

    expect(getByText('Guanaco')).toBeTruthy();
    expect(getByPlaceholderText('Username')).toBeTruthy();
    // Update prompt modal MUST be hidden on LoginScreen!
    expect(queryByText(/Update Available/i)).toBeNull();
  });

  it('auto-authenticates on launch when valid stored token exists', async () => {
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');

    const { findByText } = render(<App />);
    expect(await findByText('Main Project')).toBeTruthy();
  });

  it('unlocks cached local tasks OFFLINE via Biometric Lock Screen (hiding AppUpdatePromptModal while locked) without POST /login', async () => {
    useUpdateStore.setState({
      isPromptVisible: true,
      updateInfo: {
        isAvailable: true,
        availableVersionCode: 99,
        currentVersionCode: 16,
        updateAvailability: 2,
        isImmediateAllowed: true,
        isFlexibleAllowed: true,
        clientVersionStalenessDays: 3,
        updatePriority: 0,
        inProgress: false,
      },
    });

    await AsyncStorage.setItem(
      '@vikunja_cached_projects',
      JSON.stringify([{ id: 1, title: 'Offline Vault List', hex_color: '#3498db' }])
    );
    await AsyncStorage.setItem(
      '@vikunja_cached_tasks',
      JSON.stringify([
        { id: 77, title: 'Offline Secret Task', done: false, priority: 2, project_id: 1 },
      ])
    );
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
    await setBiometricEnabled(true);

    // Entire device is offline — every fetch call fails!
    global.fetch = jest.fn().mockRejectedValue(new Error('Network completely offline'));

    // First biometric prompt cancelled on launch
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });

    const { findByTestId, queryByText, findByText } = render(<App />);

    // Biometric lock screen is shown with clean minimal UI (Guanaco + Unlock + Sign Out, zero bloat); tasks AND update modal are strictly hidden!
    expect(await findByTestId('biometric-lock-screen')).toBeTruthy();
    expect(await findByText('Guanaco')).toBeTruthy();
    expect(await findByText('Unlock')).toBeTruthy();
    expect(queryByText(/Guanaco is Locked/i)).toBeNull();
    expect(queryByText('Offline Secret Task')).toBeNull();
    expect(queryByText(/Update Available/i)).toBeNull();

    // User taps Unlock with Biometrics and passes while STILL completely offline
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    fireEvent.press(await findByTestId('login-biometric-btn'));

    expect(await findByText('Offline Secret Task')).toBeTruthy();
    // Verify ZERO /login calls were attempted
    const loginCalls = (global.fetch as jest.Mock).mock.calls.filter(([u]) =>
      String(u).includes('/login')
    );
    expect(loginCalls).toHaveLength(0);
  });

  it('allows explicit manual PIN / Password fallback from Biometric Lock Screen when user taps Enter PIN / Password', async () => {
    await AsyncStorage.setItem(
      '@vikunja_cached_projects',
      JSON.stringify([{ id: 1, title: 'PIN Fallback List', hex_color: '#3498db' }])
    );
    await AsyncStorage.setItem(
      '@vikunja_cached_tasks',
      JSON.stringify([
        { id: 88, title: 'Unlocked With Device PIN', done: false, priority: 1, project_id: 1 },
      ])
    );
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
    await setBiometricEnabled(true);
    global.fetch = jest.fn().mockRejectedValue(new Error('Network completely offline'));

    // Cold-start biometric prompt dismissed
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'user_cancel',
    });

    const { findByTestId, findByText } = render(<App />);
    expect(await findByTestId('biometric-lock-screen')).toBeTruthy();

    // User explicitly taps "Enter PIN / Password" secondary button
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    fireEvent.press(await findByTestId('lock-pin-fallback-btn'));

    expect(await findByText('Unlocked With Device PIN')).toBeTruthy();
    const lastCallOpts = (LocalAuthentication.authenticateAsync as jest.Mock).mock.calls.slice(
      -1
    )[0][0];
    expect(lastCallOpts).toEqual(expect.objectContaining({ disableDeviceFallback: false }));
  });

  it('re-locks app when returning from background after BIOMETRIC_LOCK_GRACE_MS (15s)', async () => {
    let appStateHandler: ((state: AppStateStatus) => void) | null = null;
    const origImpl = (AppState.addEventListener as jest.Mock)?.getMockImplementation?.();
    const addListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type: any, listener: any) => {
        appStateHandler = listener;
        return { remove: jest.fn() } as any;
      });

    const baseNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    try {
      await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
      await setBiometricEnabled(true);

      const { findByText, findByTestId, queryByTestId } = render(<App />);
      expect(await findByText('Main Project')).toBeTruthy();
      expect(appStateHandler).not.toBeNull();

      // 1. Short background (< 15s grace period) does NOT lock
      nowSpy.mockReturnValue(baseNow);
      await act(async () => {
        appStateHandler!('background');
      });

      nowSpy.mockReturnValue(baseNow + 5_000);
      await act(async () => {
        appStateHandler!('active');
      });
      expect(queryByTestId('biometric-lock-screen')).toBeNull();

      // 2. Long background (>= 15s grace period) locks immediately on resume!
      nowSpy.mockReturnValue(baseNow + 10_000);
      await act(async () => {
        appStateHandler!('background');
      });

      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      nowSpy.mockReturnValue(baseNow + 10_000 + BIOMETRIC_LOCK_GRACE_MS + 1_000);
      await act(async () => {
        appStateHandler!('active');
      });

      expect(await findByTestId('biometric-lock-screen')).toBeTruthy();

      // Unlocking restores the app shell
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: true,
      });
      await act(async () => {
        fireEvent.press(await findByTestId('login-biometric-btn'));
      });

      await waitFor(() => {
        expect(queryByTestId('biometric-lock-screen') === null).toBe(true);
      });
    } finally {
      nowSpy.mockRestore();
      addListenerSpy.mockRestore();
      if (origImpl && jest.isMockFunction(AppState.addEventListener)) {
        (AppState.addEventListener as jest.Mock).mockImplementation(origImpl);
      }
    }
  });

  it('validates Personal API Token (tk_...) via GET /user without calling POST /login', async () => {
    const { getByPlaceholderText, getByTestId, findByText } = render(<App />);

    fireEvent.press(getByTestId('login-mode-token-btn'));
    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://try.vikunja.io'
    );
    fireEvent.changeText(getByPlaceholderText('tk_...'), 'tk_valid_api_token_999');
    fireEvent.press(getByTestId('login-submit-btn'));

    expect(await findByText('Main Project')).toBeTruthy();

    const calledUrls = (global.fetch as jest.Mock).mock.calls.map(([u]) => String(u));
    expect(calledUrls.some((u) => u.includes('/user'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/login'))).toBe(false);
  });

  it('preserves offline tasks and debounced edits across email -> tk_ same-user re-auth after 401', async () => {
    await AsyncStorage.setItem(
      '@vikunja_cached_projects',
      JSON.stringify([{ id: 1, title: 'Main Project' }])
    );
    await AsyncStorage.setItem(
      '@vikunja_cached_tasks',
      JSON.stringify([
        { id: -91, title: 'Unsynced Offline Work', done: false, priority: 1, project_id: 1 },
      ])
    );
    await AsyncStorage.setItem(
      '@vikunja_current_user',
      JSON.stringify({ id: 1, username: 'alice', email: 'alice@example.com' })
    );
    await AsyncStorage.setItem(
      '@vikunja_sync_queue',
      JSON.stringify([
        {
          id: 'create--91',
          type: 'CREATE_TASK',
          payload: {
            tempId: -91,
            projectId: 1,
            taskData: { title: 'Unsynced Offline Work', project_id: 1 },
          },
          timestamp: 1000,
        },
      ])
    );
    // Originally signed in using email address!
    await setStoredAuth('expired-jwt', 'https://try.vikunja.io', 'alice@example.com');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Token expired' }),
    } as Response);

    const { findByTestId, findByText, getByTestId, getByPlaceholderText } = render(<App />);

    expect(await findByTestId('auth-required-banner')).toBeTruthy();
    expect(await findByText('Unsynced Offline Work')).toBeTruthy();

    // User adds another offline task right before re-authenticating (250ms persistTasksTimer active!)
    await act(async () => {
      useTaskStore.getState().addTask({ title: 'Last-Second Debounced Task', project_id: 1 });
    });

    // Server now accepts a new tk_ token for the SAME user (id: 1, username: 'alice', email: 'alice@example.com')
    let createdTitles: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
      if (url.endsWith('/user')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, username: 'alice', email: 'alice@example.com' }),
        } as Response);
      }
      if (url.endsWith('/projects/1/tasks') && opts?.method === 'PUT') {
        const body = JSON.parse(opts.body);
        createdTitles.push(body.title);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: 500 + createdTitles.length,
            title: body.title,
            done: false,
            priority: 1,
            project_id: 1,
          }),
        } as Response);
      }
      if (url.includes('/labels')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }
      if (url.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            createdTitles.map((title, idx) => ({
              id: 501 + idx,
              title,
              done: false,
              priority: 1,
              project_id: 1,
            })),
        } as Response);
      }
      if (url.includes('/projects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Main Project' }],
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response);
    });

    fireEvent.press(getByTestId('auth-required-signin-btn'));
    fireEvent.press(await findByTestId('login-mode-token-btn'));
    fireEvent.changeText(getByPlaceholderText('tk_...'), 'tk_reauth_same_user_123');
    fireEvent.press(getByTestId('login-submit-btn'));

    // Both offline tasks were preserved across email -> tk_ re-auth and synced to server!
    expect(await findByText('Unsynced Offline Work')).toBeTruthy();
    expect(await findByText('Last-Second Debounced Task')).toBeTruthy();
    await waitFor(() => {
      expect(createdTitles).toContain('Unsynced Offline Work');
      expect(createdTitles).toContain('Last-Second Debounced Task');
    });
  });

  it('renders dual-pane sidebar layout when screen width >= 768 (tablets / foldables)', async () => {
    const ReactNative = require('react-native');
    const spy = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 1024,
      height: 768,
      scale: 2,
      fontScale: 1,
    });

    try {
      await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
      const { findByTestId, queryByTestId } = render(<App />);

      await findByTestId('drawer-project-1');
      expect(queryByTestId('drawer-toggle-btn')).toBeNull();
      expect(await findByTestId('drawer-settings-btn')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('logs out completely from drawer and returns to LoginScreen', async () => {
    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');

    const { findByText, getByTestId } = render(<App />);
    await findByText('Main Project');

    fireEvent.press(getByTestId('drawer-toggle-btn'));
    fireEvent.press(getByTestId('drawer-settings-btn'));
    fireEvent.press(getByTestId('settings-logout-btn'));

    expect(await findByText('Guanaco')).toBeTruthy();
  });

  it('shows lock-error-banner on failed manual unlock and requires confirmation before Sign Out on Lock Screen when unsynced changes exist', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await AsyncStorage.setItem(
        '@vikunja_sync_queue',
        JSON.stringify([
          {
            id: 'create--55',
            type: 'CREATE_TASK',
            payload: { tempId: -55, projectId: 1, taskData: { title: 'Unsynced Lock Task', project_id: 1 } },
            timestamp: 1000,
          },
        ])
      );
      await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
      await setBiometricEnabled(true);

      // Initial cold-start biometric prompt cancelled
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
      });

      const { findByTestId, queryByTestId, findByText } = render(<App />);
      expect(await findByTestId('biometric-lock-screen')).toBeTruthy();

      // 1. Failed manual unlock surfaces accessible lock-error-banner instead of failing silently
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      fireEvent.press(await findByTestId('login-biometric-btn'));
      expect(await findByTestId('lock-error-banner')).toBeTruthy();

      // 2. Tapping Sign Out on Lock Screen while @vikunja_sync_queue has pending items prompts Alert confirmation
      fireEvent.press(await findByTestId('lock-logout-btn'));
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          'Unsynced Changes',
          expect.stringContaining('1 unsynced offline change'),
          expect.any(Array)
        );
      });
      // Queue is STILL intact before user confirms destructive action!
      expect(await AsyncStorage.getItem('@vikunja_sync_queue')).not.toBeNull();
      expect(queryByTestId('biometric-lock-screen')).toBeTruthy();

      // Confirming destructive Sign Out in Alert clears session and returns to LoginScreen
      const buttons = alertSpy.mock.calls[0][2] as any[];
      const destructiveBtn = buttons.find((b) => b.style === 'destructive');
      await act(async () => {
        destructiveBtn.onPress();
      });

      expect(await findByText('Guanaco')).toBeTruthy();
      expect(await AsyncStorage.getItem('@vikunja_sync_queue')).toBeNull();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('synchronously sets store.client = null before unmounting ProjectTasksScreen on logout so staged Undo Delete never fires DELETE /tasks/{id}', async () => {
    global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/labels')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response);
      }
      if (url.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { id: 404, title: 'Staged Undo Task', done: false, priority: 1, project_id: 1 },
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
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 1, username: 'alice' }) } as Response);
    });

    await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
    const { findByText, findByTestId, getByTestId } = render(<App />);

    expect(await findByText('Staged Undo Task')).toBeTruthy();

    // Trigger staged 5s Undo Delete via delete action hook
    const swipeDeleteBtn = await findByTestId('task-delete-action-404', {
      includeHiddenElements: true,
    });
    fireEvent.press(swipeDeleteBtn);

    // Undo banner is active; immediately log out before the 5s timer expires!
    fireEvent.press(getByTestId('drawer-toggle-btn'));
    fireEvent.press(getByTestId('drawer-settings-btn'));
    fireEvent.press(getByTestId('settings-logout-btn'));

    expect(await findByText('Guanaco')).toBeTruthy();
    expect(useTaskStore.getState().client).toBeNull();

    // Verify ZERO DELETE /tasks/404 requests were sent on unmount!
    const deleteCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([u, o]) => String(u).includes('/tasks/404') && o?.method === 'DELETE'
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('captures Set-Cookie vikunja_refresh_token on password login and persists it to SecureStore', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const initial10mJwt = makeAppTestJwt(nowSec + 600);

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/login')) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (k: string) =>
              k.toLowerCase() === 'set-cookie'
                ? 'vikunja_refresh_token=rt_login_1; Path=/api/v1/user/token; HttpOnly; SameSite=Lax'
                : 'application/json',
          },
          json: async () => ({ token: initial10mJwt }),
        } as unknown as Response;
      }
      if (url.endsWith('/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 1, username: 'alice' }) } as Response;
      }
      if (url.includes('/projects')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Vikunja 2.0 List' }],
        } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    });

    const { getByPlaceholderText, getByTestId, findByText } = render(<App />);
    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://try.vikunja.io'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'alice');
    fireEvent.changeText(getByPlaceholderText('Password'), 'correct-horse-battery');
    fireEvent.press(getByTestId('login-submit-btn'));

    expect(await findByText('Vikunja 2.0 List')).toBeTruthy();
    expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBe('rt_login_1');
  });

  it('seamlessly renews expired 10-min JWT after 2h cold restart without Session expired banner, and runs clearCookies strictly after /user/logout', async () => {
    const rctNetworkingMod = require('react-native/Libraries/Network/RCTNetworking');
    const rctNetworking = rctNetworkingMod?.default ?? rctNetworkingMod;
    const origClearCookies = rctNetworking.clearCookies;

    const nowSec = Math.floor(Date.now() / 1000);
    // Stored 10-minute JWT whose `exp` is 2 hours in the past (cold restart after phone sleep)
    const expired2hAgoJwt = makeAppTestJwt(nowSec - 7200);
    const rotated10mJwt = makeAppTestJwt(nowSec + 600);

    await setStoredAuth(expired2hAgoJwt, 'https://try.vikunja.io', 'alice', {
      refreshToken: 'rt_login_1',
    });

    let refreshRequests = 0;
    let logoutCookieHeader: string | undefined;
    const logoutLifecycleEvents: string[] = [];

    rctNetworking.clearCookies = jest.fn((cb?: (cleared: boolean) => void) => {
      logoutLifecycleEvents.push('clearCookies');
      cb?.(true);
    });

    try {
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: any) => {
        if (url.endsWith('/user/token/refresh')) {
          refreshRequests++;
          expect(opts?.headers?.Authorization).toBeUndefined();
          expect(opts?.headers?.Cookie).toBe('vikunja_refresh_token=rt_login_1');
          return {
            ok: true,
            status: 200,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'set-cookie'
                  ? 'vikunja_refresh_token=rt_cold_rotated_2; Path=/api/v1/user/token; HttpOnly; SameSite=Lax'
                  : 'application/json',
            },
            json: async () => ({ token: rotated10mJwt }),
          } as unknown as Response;
        }
        if (url.endsWith('/user/logout')) {
          logoutLifecycleEvents.push('logoutServer_start');
          logoutCookieHeader = opts?.headers?.Cookie;
          await new Promise((r) => setTimeout(r, 15));
          logoutLifecycleEvents.push('logoutServer_end');
          return { ok: true, status: 200, json: async () => ({ message: 'ok' }) } as Response;
        }
        // Reject if any API call ever sent the expired JWT!
        if (opts?.headers?.Authorization !== `Bearer ${rotated10mJwt}`) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ message: 'Expired JWT should never have been sent' }),
          } as Response;
        }
        if (url.endsWith('/user')) {
          return { ok: true, status: 200, json: async () => ({ id: 1, username: 'alice' }) } as Response;
        }
        if (url.includes('/projects')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: 1, title: 'Renewed After 2 Hours' }],
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const { findByText, queryByTestId, getByTestId } = render(<App />);
      expect(await findByText('Renewed After 2 Hours')).toBeTruthy();
      expect(queryByTestId('auth-required-banner')).toBeNull();
      expect(refreshRequests).toBe(1);
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBe('rt_cold_rotated_2');

      // Explicit Sign Out revokes rotated refresh token via POST /user/logout BEFORE clearing native cookies & SecureStore
      logoutLifecycleEvents.length = 0;
      fireEvent.press(getByTestId('drawer-toggle-btn'));
      fireEvent.press(getByTestId('drawer-settings-btn'));
      fireEvent.press(getByTestId('settings-logout-btn'));

      expect(await findByText('Guanaco')).toBeTruthy();
      await waitFor(() => {
        expect(logoutLifecycleEvents).toEqual([
          'logoutServer_start',
          'logoutServer_end',
          'clearCookies',
        ]);
      });
      expect(logoutCookieHeader).toBe('vikunja_refresh_token=rt_cold_rotated_2');
      expect(await SecureStore.getItemAsync(SECURE_KEY_REFRESH_TOKEN)).toBeNull();
    } finally {
      rctNetworking.clearCookies = origClearCookies;
    }
  });

  it('recovers when screen-wake auto-prompt hangs or Android keyguard is still locked so manual Unlock triggers biometrics cleanly', async () => {
    const { NativeModules, Platform } = require('react-native');
    const origOS = Platform.OS;
    (Platform as any).OS = 'android';

    let changeHandler: ((state: AppStateStatus) => void) | null = null;
    let focusHandler: (() => void) | null = null;
    const origImpl = (AppState.addEventListener as jest.Mock)?.getMockImplementation?.();
    const addListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type: any, listener: any) => {
        if (type === 'change') changeHandler = listener;
        if (type === 'focus') focusHandler = listener;
        return { remove: jest.fn() } as any;
      });

    const baseNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    try {
      await setStoredAuth('stored-valid-token', 'https://try.vikunja.io', 'alice');
      await setBiometricEnabled(true);

      // Cold start unlock passes
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
      const { findByText, findByTestId, queryByTestId } = render(<App />);
      expect(await findByText('Main Project')).toBeTruthy();

      // Case A: Screen wakes while Android Keyguard is still locked -> locks UI immediately WITHOUT premature authenticateAsync
      (LocalAuthentication.authenticateAsync as jest.Mock).mockClear();
      nowSpy.mockReturnValue(baseNow);
      await act(async () => {
        changeHandler!('background');
      });

      (NativeModules.InAppUpdate.isActivityReadyForBiometrics as jest.Mock).mockResolvedValueOnce(
        false
      );
      nowSpy.mockReturnValue(baseNow + BIOMETRIC_LOCK_GRACE_MS + 2_000);
      await act(async () => {
        changeHandler!('active');
      });

      expect(await findByTestId('biometric-lock-screen')).toBeTruthy();
      expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();

      // User unlocks OS lockscreen -> window focus event triggers biometric prompt, which hangs (simulating dropped AndroidX fragment callback)
      (NativeModules.InAppUpdate.isActivityReadyForBiometrics as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockImplementationOnce(
        () => new Promise(() => {}) // never resolves!
      );
      await act(async () => {
        focusHandler?.();
      });
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);

      // Case B: User taps "Unlock" while previous prompt promise hung -> cancels hung prompt, triggers fresh biometric dialog, and unlocks!
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
      await act(async () => {
        fireEvent.press(await findByTestId('login-biometric-btn'));
      });

      await waitFor(() => {
        expect(LocalAuthentication.cancelAuthenticate).toHaveBeenCalled();
        expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
        expect(queryByTestId('biometric-lock-screen') === null).toBe(true);
        expect(queryByTestId('lock-error-banner')).toBeNull();
      });
    } finally {
      (Platform as any).OS = origOS;
      nowSpy.mockRestore();
      addListenerSpy.mockRestore();
      if (origImpl && jest.isMockFunction(AppState.addEventListener)) {
        (AppState.addEventListener as jest.Mock).mockImplementation(origImpl);
      }
    }
  });

  it('supports standalone Offline Mode out-of-the-box, hides multi-user/sync UI, and seamlessly migrates local tasks when connecting a Vikunja server later', async () => {
    const { getByTestId, findByText, queryByTestId, findByTestId, getByPlaceholderText } = render(
      <App />
    );

    // 1. Tap "Use Offline on This Device" on LoginScreen with ZERO network calls
    (global.fetch as jest.Mock).mockClear();
    fireEvent.press(getByTestId('login-use-offline-btn'));

    // Lands in starter "Tasks" list; sync pill and multi-user options are hidden!
    expect(await findByText('Tasks')).toBeTruthy();
    expect(queryByTestId('sync-indicator-btn')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    // Add a local task in "Tasks"
    fireEvent.changeText(getByTestId('quick-add-input'), 'Buy Oat Milk');
    fireEvent.press(getByTestId('quick-add-submit'));
    expect(await findByText('Buy Oat Milk')).toBeTruthy();

    // Open Drawer -> My Open Tasks is hidden in Local Mode; open Settings -> Connect a Vikunja Server
    fireEvent.press(getByTestId('drawer-toggle-btn'));
    expect(queryByTestId('drawer-project-my-tasks')).toBeNull();
    fireEvent.press(getByTestId('drawer-settings-btn'));

    expect(await findByTestId('settings-local-mode-badge')).toBeTruthy();
    expect(getByTestId('settings-backup-section')).toBeTruthy();
    fireEvent.press(getByTestId('settings-connect-server-btn'));

    // 2. Connect Server screen shows Back button and migration options ("1 list(s) and 1 task(s)")
    expect(await findByTestId('login-migration-choice-box')).toBeTruthy();
    // Cancel via Back -> returns straight to local tasks untouched!
    fireEvent.press(getByTestId('reauth-back-btn'));
    expect(await findByText('Buy Oat Milk')).toBeTruthy();

    // 3. Re-open Connect Server and connect to Vikunja with default 'merge' mode
    const uploadedTaskTitles: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'migrated-jwt-token' }),
        } as Response);
      }
      if (url.endsWith('/user')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, username: 'alice' }),
        } as Response);
      }
      if (url.endsWith('/projects/10/tasks') && opts?.method === 'PUT') {
        const body = JSON.parse(opts.body);
        uploadedTaskTitles.push(body.title);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: 777,
            title: body.title,
            done: false,
            priority: 0,
            project_id: 10,
          }),
        } as Response);
      }
      if (url.includes('/labels')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);
      }
      if (url.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            uploadedTaskTitles.map((title, i) => ({
              id: 777 + i,
              title,
              done: false,
              priority: 0,
              project_id: 10,
            })),
        } as Response);
      }
      if (url.includes('/projects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 10, title: 'Tasks', hex_color: '#0A84FF' }],
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response);
    });

    fireEvent.press(getByTestId('drawer-toggle-btn'));
    fireEvent.press(getByTestId('drawer-settings-btn'));
    fireEvent.press(await findByTestId('settings-connect-server-btn'));

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://try.vikunja.io'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'alice');
    fireEvent.changeText(getByPlaceholderText('Password'), 'strongpass');
    fireEvent.press(getByTestId('login-submit-btn'));

    // Local task was uploaded to server project 10, Local Mode exited, and Sync pill is now visible!
    expect(await findByText('Buy Oat Milk')).toBeTruthy();
    expect(await findByTestId('sync-indicator-btn')).toBeTruthy();
    expect(uploadedTaskTitles).toEqual(['Buy Oat Milk']);
    expect(useTaskStore.getState().isLocalMode).toBe(false);
    expect(await AsyncStorage.getItem('@vikunja_local_mode')).toBeNull();
  });

  it('protects standalone Local Mode behind Biometric Lock on cold start without any server token', async () => {
    await AsyncStorage.setItem('@vikunja_local_mode', 'true');
    await AsyncStorage.setItem(
      '@vikunja_cached_projects',
      JSON.stringify([{ id: 1, title: 'Private Local Vault', hex_color: '#0A84FF' }])
    );
    await AsyncStorage.setItem(
      '@vikunja_cached_tasks',
      JSON.stringify([
        { id: -50, title: 'Top Secret Offline Note', done: false, priority: 3, project_id: 1 },
      ])
    );
    await setBiometricEnabled(true);

    // Biometric prompt cancelled on cold launch -> stays locked
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });

    const { findByTestId, queryByText, findByText } = render(<App />);
    expect(await findByTestId('biometric-lock-screen')).toBeTruthy();
    expect(queryByText('Top Secret Offline Note')).toBeNull();
    expect(await findByText('Erase Local Data & Exit')).toBeTruthy();

    // Pass biometrics -> unlocks Local Mode with zero network calls!
    (global.fetch as jest.Mock).mockClear();
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    fireEvent.press(await findByTestId('login-biometric-btn'));

    expect(await findByText('Top Secret Offline Note')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
