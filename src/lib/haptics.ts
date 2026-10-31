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
// haptics off feels nothing) and the phone's own haptic engine shapes it.
//
// WHY THE CONSTANT IS CHOSEN BY API LEVEL, UP FRONT. Some constants only exist
// on newer Android (Confirm and Reject from API 30, Segment_Tick from 34); on
// an older phone the native side throws for them. That failure never reaches
// JavaScript: expo-haptics 15 fires the native call without awaiting it, so
// its promise always resolves and a try-the-next-one fallback would never
// run (Android 7 to 10 would feel nothing). So each cue names the constant
// the phone's API level has, and the app's minimum (24) has every fallback.
//
// Haptics never break a flow: every call is fire and forget, and a phone
// without a haptic engine, or a test without the native module, is silent.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type ImpactStyle = 'light' | 'medium' | 'heavy';
export type NotificationStyle = 'success' | 'warning' | 'error';
export type HapticCue = ImpactStyle | NotificationStyle | 'selection';

const { AndroidHaptics } = Haptics;

/** The first API level with HapticFeedbackConstants.CONFIRM and REJECT. */
export const CONFIRM_REJECT_API = 30;
/** The first API level with HapticFeedbackConstants.SEGMENT_TICK. */
export const SEGMENT_TICK_API = 34;

/** The Android haptic constant for a cue on a phone at `apiLevel`. */
export function androidCueFor(cue: HapticCue, apiLevel: number): Haptics.AndroidHaptics {
  const confirmReject = apiLevel >= CONFIRM_REJECT_API;
  switch (cue) {
    case 'light':
      return AndroidHaptics.Clock_Tick;
    case 'medium':
    case 'success':
      return confirmReject ? AndroidHaptics.Confirm : AndroidHaptics.Virtual_Key;
    case 'heavy':
      return AndroidHaptics.Long_Press;
    case 'warning':
    case 'error':
      return confirmReject ? AndroidHaptics.Reject : AndroidHaptics.Long_Press;
    case 'selection':
      return apiLevel >= SEGMENT_TICK_API ? AndroidHaptics.Segment_Tick : AndroidHaptics.Clock_Tick;
  }
}

/** The phone's API level (Platform.Version on Android). */
function apiLevel(): number {
  const version = Number(Platform.Version);
  return Number.isFinite(version) ? version : 0;
}

function fire(task: () => Promise<void>): void {
  try {
    task().catch(() => undefined);
  } catch {
    // A missing native module throws synchronously; still silent.
  }
}

function performAndroid(cue: HapticCue): void {
  fire(() => Haptics.performAndroidHapticsAsync(androidCueFor(cue, apiLevel())));
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
    if (Platform.OS === 'android') performAndroid(style);
    else fire(() => Haptics.impactAsync(IMPACT[style]));
  },
  /** iOS UINotificationFeedbackGenerator / `.sensoryFeedback(.success)`. */
  notification(type: NotificationStyle = 'success'): void {
    if (Platform.OS === 'android') performAndroid(type);
    else fire(() => Haptics.notificationAsync(NOTIFICATION[type]));
  },
  /** A selection change (a picker step). */
  selection(): void {
    if (Platform.OS === 'android') performAndroid('selection');
    else fire(() => Haptics.selectionAsync());
  },
};
