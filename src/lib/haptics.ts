// Haptic feedback, the port of the five moments iOS gives a physical cue:
//
//   haptics.impact('medium')         a LifePass venue QR is recognised on Scan
//                                    (pair it with announce(t('common.processing')));
//                                    a barcode is read in meal capture;
//                                    the runner's "switch sides"
//   haptics.impact('light')          the runner's countdown ticks
//   haptics.notification('success')  a rest finishes; a food is added from search
//
// A foreign code, or a code ignored while the meal page is open, gives none:
// that rule lives with the caller, which simply does not call.
//
// WHY NOT expo-haptics' impactAsync ON ANDROID. Its Android side drives the
// Vibrator with fixed waveforms, which ignores the system's "Touch feedback"
// setting. `performAndroidHapticsAsync` asks the view to perform a haptic
// constant instead, so the system setting decides (a member who turned
// haptics off feels nothing) and the phone's own haptic engine shapes it. Some
// constants only exist on newer Android (Confirm and Reject from API 30,
// Segment_Tick from 34), so each cue names a fallback that exists everywhere.
//
// Haptics never break a flow: every call is fire and forget, and a phone
// without a haptic engine, or a test without the native module, is silent.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type ImpactStyle = 'light' | 'medium' | 'heavy';
export type NotificationStyle = 'success' | 'warning' | 'error';

const { AndroidHaptics } = Haptics;

/** Android constants per cue, preferred first; the last exists on every API level. */
export const ANDROID_CUES = {
  impact: {
    light: [AndroidHaptics.Clock_Tick],
    medium: [AndroidHaptics.Confirm, AndroidHaptics.Virtual_Key],
    heavy: [AndroidHaptics.Long_Press],
  },
  notification: {
    success: [AndroidHaptics.Confirm, AndroidHaptics.Virtual_Key],
    warning: [AndroidHaptics.Reject, AndroidHaptics.Long_Press],
    error: [AndroidHaptics.Reject, AndroidHaptics.Long_Press],
  },
  selection: [AndroidHaptics.Segment_Tick, AndroidHaptics.Clock_Tick],
} as const;

async function performFirstSupported(cues: readonly Haptics.AndroidHaptics[]): Promise<void> {
  for (const cue of cues) {
    try {
      await Haptics.performAndroidHapticsAsync(cue);
      return;
    } catch {
      // Not on this API level (or no engine): try the next, older constant.
    }
  }
}

function fire(task: () => Promise<void>): void {
  try {
    task().catch(() => undefined);
  } catch {
    // A missing native module throws synchronously; still silent.
  }
}

const IMPACT: Record<ImpactStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

const NOTIFICATION: Record<NotificationStyle, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

export const haptics = {
  /** iOS UIImpactFeedbackGenerator / `.sensoryFeedback(.impact(weight:))`. */
  impact(style: ImpactStyle = 'medium'): void {
    if (Platform.OS === 'android') fire(() => performFirstSupported(ANDROID_CUES.impact[style]));
    else fire(() => Haptics.impactAsync(IMPACT[style]));
  },
  /** iOS UINotificationFeedbackGenerator / `.sensoryFeedback(.success)`. */
  notification(type: NotificationStyle = 'success'): void {
    if (Platform.OS === 'android') fire(() => performFirstSupported(ANDROID_CUES.notification[type]));
    else fire(() => Haptics.notificationAsync(NOTIFICATION[type]));
  },
  /** A selection change (a picker step). */
  selection(): void {
    if (Platform.OS === 'android') fire(() => performFirstSupported(ANDROID_CUES.selection));
    else fire(() => Haptics.selectionAsync());
  },
};
