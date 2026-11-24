import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { useUpdateStore } from '../store/updateStore';
import { APP_VERSION, versionFromCode } from '../constants/version';
import { useTranslation } from '../i18n';

export const AppUpdatePromptModal: React.FC = () => {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const {
    updateInfo,
    installProgress,
    isPromptVisible,
    isDownloadedDismissed,
    dismissPrompt,
    hidePrompt,
    startUpdate,
    completeDownloadedUpdate,
    openStore,
  } = useUpdateStore();

  const isDownloaded = installProgress?.status === 'DOWNLOADED';
  const isDownloading =
    installProgress?.status === 'DOWNLOADING' ||
    installProgress?.status === 'PENDING';
  const isVisible = isPromptVisible || (isDownloaded && !isDownloadedDismissed);

  if (!isVisible) {
    return null;
  }

  const availableVersion = versionFromCode(updateInfo?.availableVersionCode);

  const handlePrimaryPress = async () => {
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isDownloaded) {
      await completeDownloadedUpdate();
    } else if (isDownloading) {
      hidePrompt();
    } else {
      const preferredType =
        updateInfo && !updateInfo.isFlexibleAllowed && updateInfo.isImmediateAllowed
          ? 'immediate'
          : 'flexible';
      await startUpdate(preferredType);
    }
  };

  const handleDismissPress = async () => {
    safeHaptics.selection();
    if (isDownloading) {
      hidePrompt();
      return;
    }
    await dismissPrompt(24);
  };

  const handleOpenPlayStore = async () => {
    safeHaptics.selection();
    const opened = await openStore();
    if (opened) {
      hidePrompt();
    }
  };

  let downloadPercent: number | null = null;
  if (
    installProgress?.status === 'DOWNLOADING' &&
    installProgress.totalBytesToDownload > 0 &&
    installProgress.bytesDownloaded >= 0
  ) {
    downloadPercent = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (installProgress.bytesDownloaded / installProgress.totalBytesToDownload) * 100
        )
      )
    );
  }

  const titleText = isDownloaded
    ? t('updates.restartToUpdate')
    : isDownloading
    ? t('updates.downloadingUpdate')
    : t('updates.updateAvailable');

  const subtitleText = isDownloaded
    ? availableVersion
      ? t('updates.versionReady', { version: availableVersion })
      : t('updates.newVersionReady')
    : isDownloading
    ? null
    : availableVersion
    ? t('updates.versionAvailable', { version: availableVersion, current: APP_VERSION })
    : t('updates.newVersionAvailable', { current: APP_VERSION });

  return (
    <Modal
      testID="app-update-prompt-modal"
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={handleDismissPress}
    >
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal={true}
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.cardBackground,
              borderColor: theme.colors.cardBorder,
            },
          ]}
        >
          <Text style={[styles.title, { color: theme.colors.text }]}>
            {titleText}
          </Text>

          {subtitleText && (
            <Text
              style={[styles.description, { color: theme.colors.textSecondary }]}
            >
              {subtitleText}
            </Text>
          )}

          {isDownloading && (
            <View style={styles.progressContainer}>
              <View
                style={[
                  styles.progressBarBackground,
                  { backgroundColor: theme.colors.surfaceSecondary },
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${downloadPercent ?? 35}%`,
                      backgroundColor: theme.colors.accent,
                    },
                  ]}
                />
              </View>
              {downloadPercent !== null ? (
                <Text
                  testID="update-download-percent"
                  style={[styles.percentText, { color: theme.colors.textSecondary }]}
                >
                  {downloadPercent}%
                </Text>
              ) : (
                <ActivityIndicator
                  size="small"
                  color={theme.colors.accent}
                  style={styles.spinner}
                />
              )}
            </View>
          )}

          <TouchableOpacity
            testID="update-prompt-primary-btn"
            accessibilityRole="button"
            style={[
              styles.primaryBtn,
              isDownloading
                ? {
                    backgroundColor: theme.colors.surfaceSecondary,
                    borderWidth: 1,
                    borderColor: theme.colors.borderStrong,
                    marginBottom: 0,
                  }
                : {
                    backgroundColor: theme.colors.accent,
                  },
            ]}
            onPress={handlePrimaryPress}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.primaryBtnText,
                { color: isDownloading ? theme.colors.text : '#FFFFFF' },
              ]}
            >
              {isDownloaded
                ? t('updates.restartNow')
                : isDownloading
                ? t('updates.hide')
                : t('updates.update')}
            </Text>
          </TouchableOpacity>

          {!isDownloading && (
            <>
              <TouchableOpacity
                testID="update-prompt-dismiss-btn"
                accessibilityRole="button"
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: theme.colors.surfaceSecondary,
                    borderColor: theme.colors.borderStrong,
                  },
                ]}
                onPress={handleDismissPress}
                activeOpacity={0.75}
              >
                <Text style={[styles.secondaryBtnText, { color: theme.colors.text }]}>
                  {t('updates.later')}
                </Text>
              </TouchableOpacity>

              {!isDownloaded && (
                <TouchableOpacity
                  testID="update-prompt-store-btn"
                  accessibilityRole="button"
                  style={styles.storeBtn}
                  onPress={handleOpenPlayStore}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.storeBtnText, { color: theme.colors.textSecondary }]}
                  >
                    {t('updates.googlePlay')}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  progressContainer: {
    width: '100%',
    marginTop: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  percentText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  spinner: {
    marginTop: 10,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  storeBtn: {
    marginTop: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  storeBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
