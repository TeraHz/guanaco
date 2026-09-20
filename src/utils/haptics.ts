import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export const safeHaptics = {
  impact: (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light): void => {
    if (Platform.OS === 'web') return;
    try {
      Haptics.impactAsync?.(style)?.catch?.(() => {});
    } catch (_) {}
  },

  notification: (
    type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success
  ): void => {
    if (Platform.OS === 'web') return;
    try {
      Haptics.notificationAsync?.(type)?.catch?.(() => {});
    } catch (_) {}
  },

  selection: (): void => {
    if (Platform.OS === 'web') return;
    try {
      Haptics.selectionAsync?.()?.catch?.(() => {});
    } catch (_) {}
  },
};
