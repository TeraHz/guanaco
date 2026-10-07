import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import {
  getStoredAuth,
  isBiometricEnabled,
  authenticateWithBiometrics,
} from '../utils/biometrics';

interface LoginScreenProps {
  onConnect: (serverUrl: string, username: string, pass: string) => Promise<void>;
  defaultServerUrl?: string;
}

const STORAGE_KEY_URL = '@vikunja_server_url';
const STORAGE_KEY_USERNAME = '@vikunja_username';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onConnect,
  defaultServerUrl = '',
}) => {
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canBiometricUnlock, setCanBiometricUnlock] = useState(false);
  const [savedAuthData, setSavedAuthData] = useState<{
    serverUrl: string;
    username: string;
    password: string;
  } | null>(null);

  // Restore saved URL, Username, and check Biometric Unlock capability on mount
  useEffect(() => {
    let mounted = true;
    const loadSavedCredentials = async () => {
      try {
        const stored = await getStoredAuth();
        if (!mounted) return;

        if (stored.serverUrl) setServerUrl(stored.serverUrl);
        if (stored.username) setUsername(stored.username);

        const biometricActive = await isBiometricEnabled();
        if (
          biometricActive &&
          stored.serverUrl &&
          stored.username &&
          stored.password
        ) {
          setCanBiometricUnlock(true);
          setSavedAuthData({
            serverUrl: stored.serverUrl,
            username: stored.username,
            password: stored.password,
          });
        }
      } catch (_) {}
    };
    loadSavedCredentials();
    return () => {
      mounted = false;
    };
  }, []);

  const handleBiometricUnlock = async () => {
    if (!savedAuthData) return;
    setErrorMessage(null);
    try {
      const passed = await authenticateWithBiometrics('Unlock Guanaco');
      if (passed) {
        setLoading(true);
        await onConnect(
          savedAuthData.serverUrl,
          savedAuthData.username,
          savedAuthData.password
        );
        safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Biometric authentication failed');
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setErrorMessage(null);

    const cleanUrl = serverUrl.trim();
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUrl || !cleanUser || !cleanPass) {
      setErrorMessage('Please fill in all fields');
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    try {
      await onConnect(cleanUrl, cleanUser, cleanPass);

      // Persist credentials on successful connection (Regression Issue #3)
      try {
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEY_URL, cleanUrl),
          AsyncStorage.setItem(STORAGE_KEY_USERNAME, cleanUser),
        ]);
      } catch (_) {}

      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect to Vikunja server');
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Logo / Header */}
          <View style={styles.header}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
            <Text style={styles.title}>Guanaco</Text>
            <Text style={styles.subtitle}>
              Connect your self-hosted or cloud Vikunja instance
            </Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            {errorMessage && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Server URL</Text>
              <TextInput
                style={styles.input}
                placeholder="https://vikunja.example.com"
                placeholderTextColor="#636366"
                value={serverUrl}
                onChangeText={setServerUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Username or Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#636366"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password / API Token</Text>
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#636366"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
              />
            </View>

            {canBiometricUnlock && (
              <TouchableOpacity
                testID="login-biometric-btn"
                style={[styles.biometricButton, loading && styles.buttonDisabled]}
                onPress={handleBiometricUnlock}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Text style={styles.biometricButtonText}>🔒 Unlock with Biometrics</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              testID="login-submit-btn"
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Connect to Vikunja</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0E',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 76,
    height: 76,
    borderRadius: 22,
    marginBottom: 16,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 69, 58, 0.15)',
    borderWidth: 1,
    borderColor: '#FF453A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 13,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E5EA',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
  },
  biometricButton: {
    backgroundColor: '#30D158',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  biometricButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
