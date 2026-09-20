import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../haptics';

describe('safeHaptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('safely calls impactAsync without throwing even if promise rejects', async () => {
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(
      new Error('UnavailabilityError: not available on web')
    );

    expect(() => {
      safeHaptics.impact(Haptics.ImpactFeedbackStyle.Light);
    }).not.toThrow();
  });

  it('safely calls notificationAsync without throwing even if promise rejects', async () => {
    (Haptics.notificationAsync as jest.Mock).mockRejectedValueOnce(
      new Error('UnavailabilityError: not available on web')
    );

    expect(() => {
      safeHaptics.notification(Haptics.NotificationFeedbackType.Success);
    }).not.toThrow();
  });

  it('safely calls selectionAsync without throwing even if promise rejects', async () => {
    (Haptics.selectionAsync as jest.Mock).mockRejectedValueOnce(
      new Error('UnavailabilityError: not available on web')
    );

    expect(() => {
      safeHaptics.selection();
    }).not.toThrow();
  });
});
