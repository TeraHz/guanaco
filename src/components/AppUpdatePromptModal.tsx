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
import { APP_BUILD_NUMBER } from '../constants/version';

export const AppUpdatePromptModal: React.FC = () => {
  const theme = useAppTheme();
  const {
    updateInfo,
    installProgress,
    isPromptVisible,
    dismissPrompt,
    startUpdate,
    completeDownloadedUpdate,
    openStore,
  } = useUpdateStore();

  if (!isPromptVisible && installProgress?.status !== 'DOWNLOADED') {
    return null;
  }

  const isDownloaded = installProgress?.status === 'DOWNLOADED';
  const isDownloading = installProgress?.status === 'DOWNLOADING';

  const newBuild = updateInfo?.availableVersionCode || 'Latest';
  const currentBuild = updateInfo?.currentVersionCode || APP_BUILD_NUMBER;

  const handleUpdatePress = async () => {
    safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isDownloaded) {
      await completeDownloadedUpdate();
    } else {
      await startUpdate('flexible');
    }
  };

  const handleDismissPress = async () => {
    safeHaptics.selection();
    await dismissPrompt(24);
  };

  const handleOpenPlayStore = async () => {
    safeHaptics.selection();
    await openStore();
  };

  // Calculate download percentage if available
  let downloadPercent: number | null = null;
  if (
    isDownloading &&
    installProgress.totalBytesToDownload > 0 &&
    installProgress.bytesDownloaded >= 0
  ) {
    downloadPercent = Math.min(
      100,
      Math.round(
        (installProgress.bytesDownloaded / installProgress.totalBytesToDownload) * 100
      )
    );
  }

  return (
    <Modal
      testID="app-update-prompt-modal"
      visible={isPromptVisible || isDownloaded}
      transparent
      animationType="fade"
      onRequestClose={handleDismissPress}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.cardBackground,
              borderColor: theme.colors.cardBorder,
            },
          ]}
        >
          {/* Badge */}
          <View
            style={[
              styles.badge,
              { backgroundColor: isDownloaded ? '#30D15822' : '#0A84FF22' },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: isDownloaded ? '#30D158' : '#0A84FF' },
              ]}
            >
              {isDownloaded
                ? '✓ READY TO INSTALL'
                : isDownloading
                ? '⬇ DOWNLOADING'
                : '🚀 UPDATE AVAILABLE'}
            </Text>
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: theme.colors.text }]}>
            {isDownloaded
              ? 'Update Ready to Install'
              : isDownloading
              ? 'Downloading Update...'
              : 'New Version Available'}
          </Text>

          {/* Subtitle / Description */}
          <Text
            style={[styles.description, { color: theme.colors.textSecondary }]}
          >
            {isDownloaded
              ? 'The update has been downloaded via Google Play. Restart Guanaco now to apply the changes.'
              : isDownloading
              ? downloadPercent !== null
                ? `Downloading from Google Play: ${downloadPercent}%`
                : 'Downloading update in the background via Google Play...'
              : `A new build (Build ${newBuild}) is available on Google Play. You are currently on Build ${currentBuild}.`}
          </Text>

          {/* Progress bar if downloading */}
          {isDownloading && (
            <View style={styles.progressContainer}>
              <View
                style={[
                  styles.progressBarBackground,
                  { backgroundColor: theme.colors.cardSecondary },
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${downloadPercent ?? 40}%`,
                      backgroundColor: theme.colors.accent,
                    },
                  ]}
                />
              </View>
              {downloadPercent === null && (
                <ActivityIndicator
                  size="small"
                  color={theme.colors.accent}
                  style={styles.spinner}
                />
              )}
            </View>
          )}

          {/* Primary Action Button */}
          <TouchableOpacity
            testID="update-prompt-primary-btn"
            style={[
              styles.primaryBtn,
              { backgroundColor: isDownloaded ? '#30D158' : theme.colors.accent },
            ]}
            onPress={handleUpdatePress}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>
              {isDownloaded
                ? 'Restart & Apply Update'
                : isDownloading
                ? 'Continue in Background'
                : 'Update Now'}
            </Text>
          </TouchableOpacity>

          {/* Secondary Actions */}
          <View style={styles.secondaryRow}>
            <TouchableOpacity
              testID="update-prompt-dismiss-btn"
              style={styles.dismissBtn}
              onPress={handleDismissPress}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.dismissBtnText, { color: theme.colors.textSecondary }]}
              >
                {isDownloaded ? 'Later' : 'Remind Me Tomorrow'}
              </Text>
            </TouchableOpacity>

            {!isDownloaded && !isDownloading && (
              <TouchableOpacity
                testID="update-prompt-store-btn"
                style={styles.storeBtn}
                onPress={handleOpenPlayStore}
                activeOpacity={0.7}
              >
                <Text style={[styles.storeBtnText, { color: theme.colors.accent }]}>
                  Play Store Listing ›
                </Text>
              </TouchableOpacity>
            )}
          </View>
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
    maxWidth: 420,
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
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 14,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 20,
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
  spinner: {
    marginTop: 8,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  dismissBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dismissBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  storeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  storeBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
