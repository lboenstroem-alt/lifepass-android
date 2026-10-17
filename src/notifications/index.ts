/**
 * Local notifications: the Android port of the iOS notification foundation
 * (App/AppDelegate.swift, Services/HealthReminderService.swift, the rules in
 * NOTIFICATIONS.md).
 *
 *   import { scheduleAt, removePending, requestIfUndetermined } from '../notifications';
 *
 * - ./channels: the four channels (`health`, `rest_timer`, `bookings`,
 *   `engagement`), named in the account language.
 * - ./scheduler: `scheduleAt`, `removePending(prefix)`, `removeDelivered(prefix)`.
 * - ./permissions: `permissionStatus()`, `requestIfUndetermined()` (in
 *   context only, never at launch), `openNotificationSettings()`.
 * - ./cleanup: the `health.*` removal the local wipe runs.
 *
 * `startNotifications()` runs once at startup (src/notifications/register.ts,
 * loaded with every session hook): the foreground handler and the channels.
 * It asks for nothing.
 */
import * as Notifications from 'expo-notifications';

import { ensureChannels } from './channels';

export * from './channels';
export * from './scheduler';
export * from './permissions';
export * from './cleanup';

/**
 * NO BANNER WHILE THE APP IS OPEN, for every notification (iOS `willPresent`
 * returns no options): a workout note firing over the workout the member is
 * doing would be absurd, and the screens already say everything the
 * notification does. Not shown, not listed, no sound, no badge.
 */
export const FOREGROUND_BEHAVIOUR: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

let handlerInstalled = false;

/** Installs the foreground handler (once). */
export function installForegroundHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => FOREGROUND_BEHAVIOUR,
  });
}

/**
 * Startup: the foreground handler, then the channels in the app's language.
 * Never asks for permission (the first Android build asked here, before
 * sign-in, and a member who refused twice could never be asked again).
 */
export function startNotifications(): Promise<void> {
  installForegroundHandler();
  return ensureChannels();
}

/** Tests: the handler may be installed again. */
export function resetForegroundHandlerForTests(): void {
  handlerInstalled = false;
}
