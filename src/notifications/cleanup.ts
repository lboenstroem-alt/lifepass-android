/**
 * The notification half of the local health wipe (iOS
 * `HealthNotificationCleanup`): every pending AND delivered notification
 * whose identifier starts with `health.` goes, the workout-day notes, the
 * weekly check-in, the rest timer and the monthly feedback notices among
 * them. Class reminders (`bookings`) and the engagement nudges are not
 * touched: they hold no health data, and their own owners clear them.
 *
 * Run by the health store's `wipeLocal` (sign-out, withdrawal here or on the
 * web, a verified minor, an account deletion), and on its own at a sign-out
 * with no member to name.
 */
import { removeEverywhere } from './scheduler';

/** Every health notification starts with this; nothing else does. */
export const HEALTH_NOTIFICATION_PREFIX = 'health.';

export function removeAllHealthNotifications(): Promise<void> {
  return removeEverywhere(HEALTH_NOTIFICATION_PREFIX);
}
