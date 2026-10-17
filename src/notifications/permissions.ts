/**
 * The notification permission, asked only in context.
 *
 * iOS NEVER asks on first launch. It asks where the member has just done
 * something a notification would serve: the first class booking (the
 * check-in reminders), the first signed-in session (the engagement nudges),
 * Start this plan with reminders on, turning ON a Body and goals reminder or
 * feedback switch. Everywhere else the answer the member already gave is
 * used, and "denied" degrades to silence.
 *
 * On Android 13+ that matters more than on iOS: a member who refuses twice
 * can never be asked again (`canAskAgain: false`), so a dialog at the wrong
 * moment burns the permission for good. The first Android build asked at
 * first launch, before sign-in; this module is the only way to ask now.
 *
 * THE THREE STATES, as iOS has them:
 * - `granted`: notifications arrive.
 * - `denied`: refused, or no longer askable. A refusal Android would still
 *   let the app ask about again is DENIED too: iOS never asks twice, and a
 *   second dialog for the same thing is the nagging the in-context rule
 *   exists to avoid. The member turns it on in settings
 *   (`openNotificationSettings`).
 * - `undetermined`: never asked (and still askable).
 */
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { ensureChannels } from './channels';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

/** The package name, for the app notification settings screen. */
export const ANDROID_PACKAGE = 'is.lifepass.android';

/** iOS `UNAuthorizationStatus` in three words (see the file comment). */
export function permissionFrom(response: { status: string; granted?: boolean; canAskAgain?: boolean }): NotificationPermission {
  if (response.granted === true || response.status === 'granted') return 'granted';
  if (response.status === 'undetermined' && response.canAskAgain !== false) return 'undetermined';
  return 'denied';
}

/** Where the member stands, without asking. Never throws: unknown reads as denied (silence). */
export async function permissionStatus(): Promise<NotificationPermission> {
  try {
    return permissionFrom(await Notifications.getPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/**
 * Asks, only when the member has never answered; otherwise answers what
 * they said. Answers whether notifications will arrive (iOS
 * `requestAuthorizationIfNeeded`). Call it ONLY from one of the in-context
 * places above. The channels are made first: Android 13 shows no dialog to
 * an app that has none.
 */
export async function requestIfUndetermined(): Promise<boolean> {
  const status = await permissionStatus();
  if (status !== 'undetermined') return status === 'granted';
  try {
    await ensureChannels();
    const answer = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return permissionFrom(answer) === 'granted';
  } catch {
    return false;
  }
}

/**
 * The app's notification settings, where a member who said no can say yes
 * (iOS `openNotificationSettingsURLString`). Falls back to the app's own
 * settings page on a phone without the notification screen.
 */
export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE },
      ]);
      return;
    } catch {
      // Older or unusual builds: the app's settings page has a Notifications row.
    }
  }
  try {
    await Linking.openSettings();
  } catch {
    // Nothing more to open.
  }
}
