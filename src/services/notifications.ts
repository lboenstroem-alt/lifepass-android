/* eslint lifepass/no-literal-copy: "error" */
// FIRST: the background task's definition. WorkManager starts the bundle with
// no screen and runs only what the entry's imports evaluate, so the task must
// be defined at load. index.ts imports App.tsx, which imports this module, so
// this is the earliest F7-owned file every run (headless ones included)
// loads. When QA-1 deletes this shim, the line moves to the top of index.ts
// (F4 contract request; src/background/task.ts says why).
import '../background/task';

/**
 * The first Android build's notification module, kept as a thin shim over
 * src/notifications until its two callers move off it (QA-1 deletes it):
 *
 * - App.tsx (F4) calls `requestNotificationPermission()` on first launch.
 *   That first-launch ask is GONE: it now only reads the answer the member
 *   already gave. iOS never asks before the member does something a
 *   notification serves, and an Android 13+ member who refuses twice can
 *   never be asked again. Importing this module still installs the
 *   foreground handler, which now shows nothing while the app is open.
 * - The legacy booking screen (BOOK-1) calls `scheduleBookingReminders()`
 *   after a booking: the in-context moment iOS asks at. It now schedules what
 *   iOS `ClassReminderService` schedules (the T-30 heads-up and the T-10
 *   "mark yourself present", keyed by the start instant, in the account
 *   language) until BOOK-1 moves the call to its own feature.
 */
import { t } from '../i18n';
import { installForegroundHandler, permissionStatus, removePending, requestIfUndetermined, scheduleAt } from '../notifications';

installForegroundHandler();

/** Whether notifications are allowed. Never asks (see the file comment). */
export async function requestNotificationPermission(): Promise<boolean> {
  return (await permissionStatus()) === 'granted';
}

/** Keyed on the start instant, so a re-booking of the same slot replaces rather than stacks (iOS). */
export function classReminderIdentifiers(startsAt: Date): { t30: string; t10: string } {
  const seconds = Math.floor(startsAt.getTime() / 1000);
  return { t30: `class-checkin-reminder-${seconds}`, t10: `class-checkin-reminder10-${seconds}` };
}

/**
 * The class check-in reminders, 30 and 10 minutes before the start. Asks for
 * notifications on the first one (a contextual ask right after a booking);
 * a refusal degrades silently and never blocks the booking. A rung less than
 * a minute away is skipped: the member is effectively there.
 */
export async function scheduleBookingReminders({
  activityName,
  bookingTime,
}: {
  bookingId?: string;
  venueName?: string;
  activityName: string | null;
  bookingTime: Date;
}): Promise<void> {
  if (!(await requestIfUndetermined())) return;
  const name = activityName || t('booking.reminder.fallback_class');
  const ids = classReminderIdentifiers(bookingTime);
  const rungs = [
    { id: ids.t30, titleKey: 'booking.reminder.title', bodyKey: 'booking.reminder.body', minutes: 30 },
    { id: ids.t10, titleKey: 'booking.reminder10.title', bodyKey: 'booking.reminder10.body', minutes: 10 },
  ];
  for (const rung of rungs) {
    const fireAt = new Date(bookingTime.getTime() - rung.minutes * 60_000);
    if (fireAt.getTime() - Date.now() <= 60_000) continue;
    await scheduleAt(rung.id, fireAt, { title: t(rung.titleKey), body: t(rung.bodyKey, { class: name }) }, 'bookings');
  }
}

/** Removes a class's pending reminders (a cancelled booking must not send the member to the door). */
export async function cancelClassReminders(startsAt: Date): Promise<void> {
  const ids = classReminderIdentifiers(startsAt);
  await removePending((id) => id === ids.t30 || id === ids.t10);
}
