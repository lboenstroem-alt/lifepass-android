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

/**
 * The first Android build's booking reminders (`booking-<id>-24h`,
 * `booking-<id>-1h`). That build scheduled them with English copy and emoji
 * ("Session tomorrow" with a wave), and the update removed the code that
 * cancelled them, so those already scheduled would still fire: for bookings
 * since cancelled, and after a sign-out. Nothing schedules them any more (the
 * class reminders are iOS's `class-checkin-reminder-*`), so every startup
 * removes whatever is left, pending or delivered.
 */
export const LEGACY_BOOKING_REMINDER = /^booking-.+-(24h|1h)$/;

export function removeLegacyBookingReminders(): Promise<void> {
  return removeEverywhere((identifier) => LEGACY_BOOKING_REMINDER.test(identifier));
}
