import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoginScreen } from '../LoginScreen';

describe('LoginScreen', () => {
  const mockOnConnect = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('renders server URL, username, and password fields', () => {
    const { getByPlaceholderText, getByText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    expect(getByPlaceholderText('https://vikunja.example.com')).toBeTruthy();
    expect(getByPlaceholderText('Username')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
    expect(getByText('Connect to Vikunja')).toBeTruthy();
  });

  it('validates required fields before submitting', () => {
    const { getByTestId, getByText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    const submitBtn = getByTestId('login-submit-btn');
    fireEvent.press(submitBtn);

    expect(mockOnConnect).not.toHaveBeenCalled();
    expect(getByText('Please fill in all fields')).toBeTruthy();
  });

  it('calls onConnect with server URL and credentials when submitted', async () => {
    mockOnConnect.mockResolvedValueOnce(undefined);

    const { getByPlaceholderText, getByTestId } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://my-vikunja.org'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'testuser');
    fireEvent.changeText(getByPlaceholderText('Password'), 'secretpass');

    fireEvent.press(getByTestId('login-submit-btn'));

    await waitFor(() => {
      expect(mockOnConnect).toHaveBeenCalledWith(
        'https://my-vikunja.org',
        'testuser',
        'secretpass'
      );
    });
  });

  it('displays connection error if login fails', async () => {
    mockOnConnect.mockRejectedValueOnce(new Error('Invalid credentials'));

    const { getByPlaceholderText, getByTestId, findByText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://my-vikunja.org'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'testuser');
    fireEvent.changeText(getByPlaceholderText('Password'), 'wrongpass');

    fireEvent.press(getByTestId('login-submit-btn'));

    const errorMsg = await findByText('Invalid credentials');
    expect(errorMsg).toBeTruthy();
  });

  // --- Regression Test: Issue 2 (Enter key submits login) ---
  it('submits login when Enter is pressed on password input (Regression #2)', async () => {
    mockOnConnect.mockResolvedValueOnce(undefined);

    const { getByPlaceholderText } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    const urlInput = getByPlaceholderText('https://vikunja.example.com');
    const userInput = getByPlaceholderText('Username');
    const passInput = getByPlaceholderText('Password');

    fireEvent.changeText(urlInput, 'https://demo.vikunja.io');
    fireEvent.changeText(userInput, 'admin');
    fireEvent.changeText(passInput, 'password123');

    // Trigger Enter on password field
    fireEvent(passInput, 'submitEditing');

    await waitFor(() => {
      expect(mockOnConnect).toHaveBeenCalledWith(
        'https://demo.vikunja.io',
        'admin',
        'password123'
      );
    });
  });

  // --- Regression Test: Issue 3 (Remember URL and Username) ---
  it('remembers and restores saved server URL and username from AsyncStorage (Regression #3)', async () => {
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

  it('persists server URL and username to AsyncStorage on successful login (Regression #3)', async () => {
    mockOnConnect.mockResolvedValueOnce(undefined);

    const { getByPlaceholderText, getByTestId } = render(
      <LoginScreen onConnect={mockOnConnect} />
    );

    fireEvent.changeText(
      getByPlaceholderText('https://vikunja.example.com'),
      'https://new.vikunja.io'
    );
    fireEvent.changeText(getByPlaceholderText('Username'), 'new_user');
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');

    fireEvent.press(getByTestId('login-submit-btn'));

    await waitFor(async () => {
      expect(await AsyncStorage.getItem('@vikunja_server_url')).toBe('https://new.vikunja.io');
      expect(await AsyncStorage.getItem('@vikunja_username')).toBe('new_user');
    });
  });
});
