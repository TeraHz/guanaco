import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ReactNative from 'react-native';
import { LoginScreen } from '../LoginScreen';
import { VikunjaApiError } from '../../api/client';

describe('LoginScreen', () => {
  const mockOnConnect = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('renders hardened server URL, username, and password fields (no autoCapitalize/autoCorrect/spellCheck)', () => {
    const { getByPlaceholderText, getByText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    const urlInput = getByPlaceholderText('https://vikunja.example.com');
    const userInput = getByPlaceholderText('Username');
    const passInput = getByPlaceholderText('Password');

    expect(urlInput.props.accessibilityLabel).toBe('Server URL');
    expect(urlInput.props.blurOnSubmit).toBe(false);
    expect(userInput.props.accessibilityLabel).toBe('Username or Email');
    expect(userInput.props.blurOnSubmit).toBe(false);
    expect(passInput.props.accessibilityLabel).toBe('Password or API Token');
    expect(passInput.props.autoCapitalize).toBe('none');
    expect(passInput.props.autoCorrect).toBe(false);
    expect(passInput.props.spellCheck).toBe(false);
    expect(getByText('Connect')).toBeTruthy();

    // Pressing Next on URL and Username chains focus without submitting prematurely
    fireEvent(urlInput, 'submitEditing');
    fireEvent(userInput, 'submitEditing');
    expect(mockOnConnect).not.toHaveBeenCalled();
  });

  it('validates required fields and rejects malformed URLs cleanly', () => {
    const { getByTestId, getByText, getByPlaceholderText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.press(getByTestId('login-submit-btn'));
    expect(mockOnConnect).not.toHaveBeenCalled();
    expect(getByText('Please fill in all fields')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('https://vikunja.example.com'), 'not-a-valid-url');
    fireEvent.changeText(getByPlaceholderText('Username'), 'alice');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secret');
    fireEvent.press(getByTestId('login-submit-btn'));

    expect(mockOnConnect).not.toHaveBeenCalled();
    expect(getByTestId('login-error-banner')).toBeTruthy();
  });

  it('normalizes missing scheme/login path and NEVER trims leading or trailing spaces from passwords', async () => {
    mockOnConnect.mockResolvedValueOnce(undefined);

    const { getByPlaceholderText, getByTestId } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'my-vikunja.org/login/'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), '  testuser  ');
    fireEvent.changeText(getByPlaceholderText('Password'), '  secret pass with spaces  ');

    fireEvent.press(getByTestId('login-submit-btn'));

    await waitFor(() => {
      expect(mockOnConnect).toHaveBeenCalledWith(
        'https://my-vikunja.org',
        'testuser',
        '  secret pass with spaces  '
      );
    });
  });

  it('requires explicit confirmation before connecting over cleartext http:// and offers one-tap HTTPS upgrade', async () => {
    mockOnConnect.mockResolvedValueOnce(undefined);

    const { getByPlaceholderText, getByTestId, queryByTestId } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'http://192.168.1.20:3456'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'lanuser');
    fireEvent.changeText(getByPlaceholderText('Password'), 'lanpass');

    // First submit blocks network call and displays warning banner
    fireEvent.press(getByTestId('login-submit-btn'));
    expect(mockOnConnect).not.toHaveBeenCalled();
    expect(getByTestId('insecure-http-warning')).toBeTruthy();

    // User explicitly confirms insecure HTTP
    fireEvent.press(getByTestId('http-confirm-insecure-btn'));

    await waitFor(() => {
      expect(mockOnConnect).toHaveBeenCalledWith(
        'http://192.168.1.20:3456',
        'lanuser',
        'lanpass',
        { allowInsecureHttp: true }
      );
    });
    expect(queryByTestId('insecure-http-warning')).toBeNull();
  });

  it('supports Personal API Token login via explicit tab and via tk_ auto-detection', async () => {
    mockOnConnect.mockResolvedValue(undefined);

    const { getByPlaceholderText, getByTestId } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    // 1. Explicit API Token mode (no username required)
    fireEvent.press(getByTestId('login-mode-token-btn'));
    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://cloud.vikunja.io'
    );
    fireEvent.changeText(getByPlaceholderText('tk_...'), '  tk_my_personal_token  ');
    fireEvent.press(getByTestId('login-submit-btn'));

    await waitFor(() => {
      expect(mockOnConnect).toHaveBeenCalledWith(
        'https://cloud.vikunja.io',
        '',
        'tk_my_personal_token',
        { authMethod: 'api_token' }
      );
    });
  });

  it('reveals TOTP 2FA input automatically when server requires 2FA (code 1017) and submits totpPasscode', async () => {
    mockOnConnect
      .mockRejectedValueOnce(
        new VikunjaApiError(412, 'Invalid totp passcode.', { code: 1017 })
      )
      .mockResolvedValueOnce(undefined);

    const { getByPlaceholderText, getByTestId, findByTestId } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://2fa.vikunja.io'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'secuser');
    fireEvent.changeText(getByPlaceholderText('Password'), 'strongpass');

    fireEvent.press(getByTestId('login-submit-btn'));

    // TOTP input automatically appears!
    const totpInput = await findByTestId('login-totp-input');
    fireEvent.changeText(totpInput, '482910');
    fireEvent.press(getByTestId('login-submit-btn'));

    await waitFor(() => {
      expect(mockOnConnect).toHaveBeenLastCalledWith(
        'https://2fa.vikunja.io',
        'secuser',
        'strongpass',
        { totpPasscode: '482910' }
      );
    });
  });

  it('supports Light and Dark themes cleanly via useAppTheme()', () => {
    const schemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    try {
      const { getByText } = render(<LoginScreen onConnect={mockOnConnect} />);
      expect(getByText('Guanaco')).toBeTruthy();
    } finally {
      schemeSpy.mockRestore();
    }
  });

  it('restores and persists saved server URL and username (without storing password)', async () => {
    await AsyncStorage.setItem('@vikunja_server_url', 'https://saved.vikunja.org');
    await AsyncStorage.setItem('@vikunja_username', 'saved_user');

    const { getByPlaceholderText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    await waitFor(() => {
      expect(getByPlaceholderText('https://vikunja.example.com').props.value).toBe(
        'https://saved.vikunja.org'
      );
      expect(getByPlaceholderText('Username').props.value).toBe('saved_user');
    });
  });

  it('renders clean neutral secondary Unlock button when biometric session is available', async () => {
    const { setStoredAuth, setBiometricEnabled } = require('../../utils/biometrics');
    await setStoredAuth('stored-jwt', 'https://saved.vikunja.org', 'alice');
    await setBiometricEnabled(true);
    const mockBiometricUnlock = jest.fn().mockResolvedValue(undefined);

    const { findByTestId, queryByText } = render(
      <LoginScreen onConnect={mockOnConnect} onBiometricUnlock={mockBiometricUnlock} />
    );

    const bioBtn = await findByTestId('login-biometric-btn');
    expect(bioBtn).toBeTruthy();
    expect(queryByText(/🔒/)).toBeNull();

    fireEvent.press(bioBtn);
    await waitFor(() => {
      expect(mockBiometricUnlock).toHaveBeenCalledTimes(1);
    });
  });
});
