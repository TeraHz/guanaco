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
import { useAppTheme } from '../utils/theme';
import { hexToRgba } from '../utils/colors';
import {
  getStoredAuth,
  checkBiometricAvailable,
  isBiometricEnabled,
  authenticateWithBiometrics,
  isPersonalApiToken,
  STORAGE_KEY_SERVER_URL,
  STORAGE_KEY_USERNAME,
  STORAGE_KEY_SAVED_USERNAME,
} from '../utils/biometrics';
import {
  parseAndValidateServerUrl,
  isTotpRequiredError,
} from '../api/client';
import { LanguagePreference, useTranslation } from '../i18n';
import { useTaskStore } from '../store/taskStore';

export interface LoginConnectOptions {
  authMethod?: 'password' | 'api_token';
  totpPasscode?: string;
  allowInsecureHttp?: boolean;
}

export interface LoginScreenProps {
  onConnect: (
    serverUrl: string,
    username: string,
    pass: string,
    options?: LoginConnectOptions
  ) => Promise<void>;
  onBiometricUnlock?: () => Promise<void>;
  defaultServerUrl?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onConnect,
  onBiometricUnlock,
  defaultServerUrl = '',
}) => {
  const theme = useAppTheme();
  const { t, languagePreference, setLanguagePreference } = useTranslation();

  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [authMode, setAuthMode] = useState<'password' | 'api_token'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpPasscode, setTotpPasscode] = useState('');
  const [showTotp, setShowTotp] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingInsecureHttpUrl, setPendingInsecureHttpUrl] = useState<string | null>(null);
  const [confirmedInsecureHttpUrl, setConfirmedInsecureHttpUrl] = useState<string | null>(null);
  const [canBiometricUnlock, setCanBiometricUnlock] = useState(false);
  const usernameInputRef = React.useRef<TextInput>(null);
  const passwordInputRef = React.useRef<TextInput>(null);
  const totpInputRef = React.useRef<TextInput>(null);

  useEffect(() => {
    let mounted = true;
    const loadSavedCredentials = async () => {
      try {
        const stored = await getStoredAuth();
        if (!mounted) return;

        if (stored.serverUrl) setServerUrl(stored.serverUrl);
        if (stored.username) setUsername(stored.username);

        const biometricActive =
          (await isBiometricEnabled()) && (await checkBiometricAvailable());
        if (!mounted) return;

        if (biometricActive && stored.serverUrl && stored.token && onBiometricUnlock) {
          setCanBiometricUnlock(true);
        }
      } catch (_) {}
    };
    loadSavedCredentials();
    return () => {
      mounted = false;
    };
  }, [onBiometricUnlock]);

  const handleBiometricUnlock = async () => {
    if (!onBiometricUnlock) return;
    setErrorMessage(null);
    try {
      const passed = await authenticateWithBiometrics(t('lock.unlockGuanaco'), { forceReset: true });
      if (passed) {
        setLoading(true);
        await onBiometricUnlock();
        safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) {
      setErrorMessage(err.message || t('auth.biometricFailed'));
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const executeConnect = async (allowInsecureHttpOverride = false) => {
    setErrorMessage(null);

    const rawUrl = serverUrl.trim();
    const cleanUser = username.trim();
    const autoDetectedToken = isPersonalApiToken(password);
    const effectiveTokenMode = authMode === 'api_token' || autoDetectedToken;
    // IMPORTANT: Never call password.trim() for user passwords! Only trim pasted API tokens.
    const secretValue = effectiveTokenMode ? password.trim() : password;

    if (!rawUrl || !secretValue || (!effectiveTokenMode && !cleanUser)) {
      setErrorMessage(t('auth.fillAllFields'));
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    let normalizedUrl: string;
    let isInsecureHttp: boolean;
    try {
      const validated = parseAndValidateServerUrl(rawUrl);
      normalizedUrl = validated.serverUrl;
      isInsecureHttp = validated.isInsecureHttp;
    } catch (urlErr: any) {
      setErrorMessage(urlErr.message || t('auth.invalidServerUrl'));
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const isHttpConfirmed =
      allowInsecureHttpOverride || confirmedInsecureHttpUrl === normalizedUrl;

    if (isInsecureHttp && !isHttpConfirmed) {
      setPendingInsecureHttpUrl(normalizedUrl);
      safeHaptics.notification(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setPendingInsecureHttpUrl(null);
    setLoading(true);

    try {
      const cleanTotp = totpPasscode.trim();
      const needsOptions =
        effectiveTokenMode || Boolean(cleanTotp) || isInsecureHttp;

      if (needsOptions) {
        const opts: LoginConnectOptions = {};
        if (effectiveTokenMode) opts.authMethod = 'api_token';
        if (cleanTotp && !effectiveTokenMode) opts.totpPasscode = cleanTotp;
        if (isInsecureHttp) opts.allowInsecureHttp = true;
        await onConnect(normalizedUrl, cleanUser, secretValue, opts);
      } else {
        await onConnect(normalizedUrl, cleanUser, secretValue);
      }

      try {
        const existingStored = await getStoredAuth();
        const writes: Promise<void>[] = [];
        if (!existingStored.serverUrl || existingStored.serverUrl !== normalizedUrl) {
          writes.push(AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, normalizedUrl));
        }
        if (!effectiveTokenMode && cleanUser && !existingStored.username) {
          writes.push(AsyncStorage.setItem(STORAGE_KEY_USERNAME, cleanUser));
          writes.push(AsyncStorage.setItem(STORAGE_KEY_SAVED_USERNAME, cleanUser));
        }
        if (writes.length > 0) {
          await Promise.all(writes);
        }
      } catch (_) {}

      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      if (!effectiveTokenMode && isTotpRequiredError(err)) {
        const hadCode = totpPasscode.trim().length > 0;
        setShowTotp(true);
        setErrorMessage(hadCode ? t('auth.invalid2fa') : t('auth.enter2fa'));
      } else {
        setErrorMessage(err.message || t('auth.failedToConnect'));
      }
      safeHaptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    executeConnect(false);
  };

  const handleSwitchToHttps = () => {
    if (pendingInsecureHttpUrl) {
      const upgraded = pendingInsecureHttpUrl.replace(/^http:\/\//i, 'https://');
      setServerUrl(upgraded);
    }
    setPendingInsecureHttpUrl(null);
  };

  const handleConfirmInsecureHttp = () => {
    if (pendingInsecureHttpUrl) {
      setConfirmedInsecureHttpUrl(pendingInsecureHttpUrl);
    }
    executeConnect(true);
  };

  const isTokenMode = authMode === 'api_token';

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
            <Text style={[styles.title, { color: theme.colors.text }]}>Guanaco</Text>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.cardBackground,
                borderColor: theme.colors.cardBorder,
              },
            ]}
          >
            <View
              style={[
                styles.modeTabs,
                { backgroundColor: theme.colors.surfaceSecondary },
              ]}
            >
              <TouchableOpacity
                testID="login-mode-password-btn"
                accessibilityRole="tab"
                accessibilityState={{ selected: !isTokenMode }}
                style={[
                  styles.modeTab,
                  !isTokenMode && [
                    styles.modeTabActive,
                    {
                      backgroundColor: theme.colors.cardBackground,
                      borderColor: theme.colors.borderStrong,
                    },
                  ],
                ]}
                onPress={() => {
                  setAuthMode('password');
                  setErrorMessage(null);
                }}
                disabled={loading}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    {
                      color: !isTokenMode
                        ? theme.colors.text
                        : theme.colors.textSecondary,
                      fontWeight: !isTokenMode ? '700' : '500',
                    },
                  ]}
                >
                  {t('auth.passwordTab')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="login-mode-token-btn"
                accessibilityRole="tab"
                accessibilityState={{ selected: isTokenMode }}
                style={[
                  styles.modeTab,
                  isTokenMode && [
                    styles.modeTabActive,
                    {
                      backgroundColor: theme.colors.cardBackground,
                      borderColor: theme.colors.borderStrong,
                    },
                  ],
                ]}
                onPress={() => {
                  setAuthMode('api_token');
                  setErrorMessage(null);
                }}
                disabled={loading}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    {
                      color: isTokenMode
                        ? theme.colors.text
                        : theme.colors.textSecondary,
                      fontWeight: isTokenMode ? '700' : '500',
                    },
                  ]}
                >
                  {t('auth.apiTokenTab')}
                </Text>
              </TouchableOpacity>
            </View>

            {errorMessage && (
              <View
                testID="login-error-banner"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[
                  styles.errorBanner,
                  {
                    backgroundColor: hexToRgba(
                      theme.colors.danger,
                      theme.isDark ? 0.16 : 0.08
                    ),
                    borderColor: theme.colors.danger,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.errorText,
                    { color: theme.colors.danger },
                  ]}
                >
                  {errorMessage}
                </Text>
              </View>
            )}

            {pendingInsecureHttpUrl && (
              <View
                testID="insecure-http-warning"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[
                  styles.warningBanner,
                  {
                    backgroundColor: hexToRgba(
                      theme.colors.warning,
                      theme.isDark ? 0.16 : 0.08
                    ),
                    borderColor: theme.colors.warning,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.warningTitle,
                    { color: theme.colors.warning },
                  ]}
                >
                  {t('auth.unencryptedHttpTitle')}
                </Text>
                <Text
                  style={[
                    styles.warningBody,
                    { color: theme.colors.text },
                  ]}
                >
                  {t('auth.unencryptedHttpBody', { url: pendingInsecureHttpUrl })}
                </Text>
                <View style={styles.warningActions}>
                  <TouchableOpacity
                    testID="http-switch-https-btn"
                    accessibilityRole="button"
                    style={[styles.warningSafeBtn, { backgroundColor: theme.colors.accent }]}
                    onPress={handleSwitchToHttps}
                  >
                    <Text style={styles.warningSafeBtnText}>{t('auth.useHttps')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="http-confirm-insecure-btn"
                    accessibilityRole="button"
                    style={[
                      styles.warningProceedBtn,
                      {
                        backgroundColor: theme.colors.surfaceSecondary,
                        borderColor: theme.colors.borderStrong,
                      },
                    ]}
                    onPress={handleConfirmInsecureHttp}
                  >
                    <Text
                      style={[
                        styles.warningProceedBtnText,
                        { color: theme.colors.text },
                      ]}
                    >
                      {t('common.continueAnyway')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: theme.colors.text }]}>
                {t('auth.serverUrl')}
              </Text>
              <TextInput
                testID="login-server-url-input"
                accessibilityLabel={t('auth.serverUrl')}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.colors.inputBg,
                    borderColor: theme.colors.borderStrong,
                    color: theme.colors.text,
                  },
                ]}
                placeholder="https://vikunja.example.com"
                placeholderTextColor={theme.colors.placeholder}
                value={serverUrl}
                onChangeText={(val) => {
                  setServerUrl(val);
                  if (pendingInsecureHttpUrl) setPendingInsecureHttpUrl(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardType="url"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => {
                  if (isTokenMode) {
                    passwordInputRef.current?.focus();
                  } else {
                    usernameInputRef.current?.focus();
                  }
                }}
              />
            </View>

            {!isTokenMode && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.text }]}>
                  {t('auth.usernameOrEmail')}
                </Text>
                <TextInput
                  ref={usernameInputRef}
                  testID="login-username-input"
                  accessibilityLabel={t('auth.usernameOrEmail')}
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.colors.inputBg,
                      borderColor: theme.colors.borderStrong,
                      color: theme.colors.text,
                    },
                  ]}
                  placeholder={t('auth.usernamePlaceholder')}
                  placeholderTextColor={theme.colors.placeholder}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.colors.text, marginBottom: 0 }]}>
                  {isTokenMode ? t('auth.apiTokenLabel') : t('auth.passwordLabel')}
                </Text>
                <TouchableOpacity
                  testID="login-toggle-secret-visibility-btn"
                  accessibilityRole="button"
                  accessibilityLabel={
                    showSecret ? t('auth.hidePasswordA11y') : t('auth.showPasswordA11y')
                  }
                  onPress={() => setShowSecret((prev) => !prev)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.inlineLink, { color: theme.colors.accent }]}>
                    {showSecret ? t('auth.hide') : t('auth.show')}
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                ref={passwordInputRef}
                testID="login-password-input"
                accessibilityLabel={
                  isTokenMode ? t('auth.personalApiTokenA11y') : t('auth.passwordOrTokenA11y')
                }
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.colors.inputBg,
                    borderColor: theme.colors.borderStrong,
                    color: theme.colors.text,
                  },
                ]}
                placeholder={isTokenMode ? 'tk_...' : t('auth.passwordLabel')}
                placeholderTextColor={theme.colors.placeholder}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showSecret}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                textContentType={isTokenMode ? 'none' : 'password'}
                autoComplete={isTokenMode ? 'off' : 'password'}
                returnKeyType={showTotp && !isTokenMode ? 'next' : 'go'}
                blurOnSubmit={!(showTotp && !isTokenMode)}
                onSubmitEditing={
                  showTotp && !isTokenMode
                    ? () => totpInputRef.current?.focus()
                    : handleSubmit
                }
              />
            </View>

            {!isTokenMode && (
              <>
                {showTotp ? (
                  <View style={styles.inputGroup}>
                    <View style={styles.labelRow}>
                      <Text style={[styles.label, { color: theme.colors.text, marginBottom: 0 }]}>
                        {t('auth.twoFactorCode')}
                      </Text>
                      <TouchableOpacity
                        testID="login-hide-totp-btn"
                        accessibilityRole="button"
                        onPress={() => {
                          setShowTotp(false);
                          setTotpPasscode('');
                        }}
                      >
                        <Text style={[styles.inlineLink, { color: theme.colors.textSecondary }]}>
                          {t('common.cancel')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      ref={totpInputRef}
                      testID="login-totp-input"
                      accessibilityLabel={t('auth.twoFactorCode')}
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.colors.inputBg,
                          borderColor: theme.colors.borderStrong,
                          color: theme.colors.text,
                        },
                      ]}
                      placeholder={t('auth.twoFactorPlaceholder')}
                      placeholderTextColor={theme.colors.placeholder}
                      value={totpPasscode}
                      onChangeText={setTotpPasscode}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={8}
                      returnKeyType="go"
                      onSubmitEditing={handleSubmit}
                    />
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="login-toggle-totp-btn"
                    accessibilityRole="button"
                    style={styles.totpToggleRow}
                    onPress={() => setShowTotp(true)}
                  >
                    <Text style={[styles.inlineLink, { color: theme.colors.accent }]}>
                      {t('auth.totpToggle')}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <TouchableOpacity
              testID="login-submit-btn"
              accessibilityRole="button"
              style={[
                styles.button,
                { backgroundColor: theme.colors.accent },
                loading && styles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{t('auth.connect')}</Text>
              )}
            </TouchableOpacity>

            {canBiometricUnlock && (
              <TouchableOpacity
                testID="login-biometric-btn"
                accessibilityRole="button"
                style={[
                  styles.biometricButton,
                  {
                    backgroundColor: theme.colors.surfaceSecondary,
                    borderColor: theme.colors.borderStrong,
                  },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleBiometricUnlock}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Text style={[styles.biometricButtonText, { color: theme.colors.text }]}>
                  {t('auth.unlock')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View testID="login-language-switcher" style={styles.langRow}>
            {(
              [
                { key: 'system', label: t('settings.langSystem') },
                { key: 'en', label: 'English' },
                { key: 'bg', label: 'Български' },
                { key: 'es', label: 'Español' },
              ] as { key: LanguagePreference; label: string }[]
            ).map((opt) => {
              const selected = languagePreference === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  testID={`login-lang-${opt.key}`}
                  style={[
                    styles.langPill,
                    selected
                      ? {
                          backgroundColor: theme.colors.accent,
                          borderColor: theme.colors.accent,
                        }
                      : {
                          backgroundColor: theme.colors.cardBackground,
                          borderColor: theme.colors.cardBorder,
                        },
                  ]}
                  onPress={() => {
                    safeHaptics.selection();
                    setLanguagePreference(opt.key).catch(() => {});
                    useTaskStore.getState().setLanguagePreference?.(opt.key).catch(() => {});
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.langPillText,
                      {
                        color: selected ? '#FFFFFF' : theme.colors.textSecondary,
                        fontWeight: selected ? '700' : '500',
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    marginBottom: 24,
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
  },
  card: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  modeTabs: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeTabActive: {
    borderWidth: 1,
  },
  modeTabText: {
    fontSize: 13,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
  },
  warningBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  warningBody: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  warningActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  warningSafeBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  warningSafeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  warningProceedBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  warningProceedBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  inlineLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  totpToggleRow: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingVertical: 2,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  biometricButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  biometricButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  langPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  langPillText: {
    fontSize: 12,
  },
});
