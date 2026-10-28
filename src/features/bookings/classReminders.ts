/**
 * The class check-in reminders: the Android port of iOS `ClassReminderService`
 * (Services/ClassReminderService.swift, NOTIFICATIONS.md).
 *
 * Scheduled the moment a booking lands (a confirmed create, or a payment page
 * that fulfilled), never for a pending one: there is no held seat to remind
 * about. Two rungs, removed together:
 *   - T-30, `class-checkin-reminder-<startEpochSeconds>`: "Time for your
 *     class", get moving;
 *   - T-10, `class-checkin-reminder10-<startEpochSeconds>`: scan the venue QR
 *     and mark yourself present (Abler venues require it), which is free.
 * A rung less than a minute away is skipped (the member is effectively there,
 * and the check-in sheet at the door covers it). Keyed on the start instant,
 * so booking the same time again replaces them rather than stacking, and a
 * cancel (My bookings, LIB-1: `cancelCheckInReminder(startsAt)`) removes
 * them: a "time for your class" nudge for a cancelled class would send the
 * member to the door to pay a walk-in fee for nothing.
 *
 * Written in the account language at scheduling time. The notification
 * permission is asked here, in context, on the first booking
 * (src/notifications/permissions.ts); a refusal is silent and the booking is
 * never touched. Tapping one simply opens the app (no route). They hold no
 * health data and stay scheduled across a sign-out, as on iOS.
 */
import { removePending, requestIfUndetermined, scheduleAt } from '../../notifications';
import { translate, type Lang } from '../../i18n';

/** The two rungs' identifiers for a start instant. */
export function checkInReminderIdentifiers(startsAt: Date): { readonly t30: string; readonly t10: string } {
  const seconds = Math.floor(startsAt.getTime() / 1000);
  return { t30: `class-checkin-reminder-${seconds}`, t10: `class-checkin-reminder10-${seconds}` };
}

/** A rung closer than this is not scheduled. */
export const REMINDER_MIN_LEAD_MS = 60_000;

interface Rung {
  readonly id: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly minutesBefore: number;
}

export interface CheckInReminderRequest {
  /** The class's name, else the activity's; null reads "Your class". */
  readonly className: string | null;
  readonly startsAt: Date;
  /** The account language when the booking landed. */
  readonly language: Lang;
}

/** What `scheduleCheckInReminder` would schedule now (the rungs far enough ahead), for tests and the scheduler. */
export function checkInReminderPlan(
  request: CheckInReminderRequest,
  now: Date = new Date(),
): { readonly id: string; readonly fireAt: Date; readonly title: string; readonly body: string }[] {
  const ids = checkInReminderIdentifiers(request.startsAt);
  const rungs: Rung[] = [
    { id: ids.t30, titleKey: 'booking.reminder.title', bodyKey: 'booking.reminder.body', minutesBefore: 30 },
    { id: ids.t10, titleKey: 'booking.reminder10.title', bodyKey: 'booking.reminder10.body', minutesBefore: 10 },
  ];
  const name = request.className?.trim() || translate('booking.reminder.fallback_class', request.language);
  return rungs
    .map((rung) => ({ rung, fireAt: new Date(request.startsAt.getTime() - rung.minutesBefore * 60_000) }))
    .filter(({ fireAt }) => fireAt.getTime() - now.getTime() > REMINDER_MIN_LEAD_MS)
    .map(({ rung, fireAt }) => ({
      id: rung.id,
      fireAt,
      title: translate(rung.titleKey, request.language),
      body: translate(rung.bodyKey, request.language, { class: name }),
    }));
}

/**
 * Schedules the T-30 and T-10 rungs on the `bookings` channel. Asks for the
 * permission first when the member has never answered; a refusal skips
 * silently. Never throws.
 */
export async function scheduleCheckInReminder(request: CheckInReminderRequest, now?: Date): Promise<void> {
  if (Number.isNaN(request.startsAt.getTime())) return;
  try {
    // Asked first, as iOS asks on every booking that lands; the rungs are
    // timed once the answer is in (the dialog can take a while).
    if (!(await requestIfUndetermined())) return;
    const at = now ?? new Date();
    for (const rung of checkInReminderPlan(request, at)) {
      await scheduleAt(rung.id, rung.fireAt, { title: rung.title, body: rung.body }, 'bookings', at);
    }
  } catch {
    // A reminder is a courtesy: nothing about it may reach the booking.
  }
}

/** Removes a class's pending reminders (a no-op when there are none or they have fired). */
export async function cancelCheckInReminder(startsAt: Date): Promise<void> {
  const ids = checkInReminderIdentifiers(startsAt);
  await removePending((identifier) => identifier === ids.t30 || identifier === ids.t10);
}
