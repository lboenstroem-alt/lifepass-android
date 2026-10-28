/**
 * `health.resttimer`: the one notification a rest gives, "Rest is over" /
 * "Time for your next set." at the rest's end. The Android port of iOS
 * `RunnerRestAlarm` and `LiveRunnerRestAlerts`
 * (Views/Workout/WorkoutRunnerView.swift, NOTIFICATIONS.md 19.1).
 *
 * WHEN. The runner schedules it when the app leaves the foreground with a
 * rest running, or when a rest starts while the app is in the background (a
 * timed set that ran out with the phone locked). It is removed, pending and
 * delivered, when the app comes back, when the rest is skipped or ends on
 * screen, when the runner closes and by the local wipe (every `health.*`
 * notification goes then, src/notifications/cleanup.ts). A rest that ends
 * while the process is still alive in the background leaves it alone: it is
 * the message, and withdrawing it would take it off the lock screen the
 * moment it arrived.
 *
 * IT NEVER ASKS. The runner is not one of the places a permission prompt may
 * appear (iOS 19.7, src/notifications/permissions.ts): the notification is
 * scheduled only when the member has already said yes, and is silently not
 * there otherwise.
 *
 * NO NUMBERS (19.3): no exercise, no weight, no rep count, no time. The
 * words are in the ACCOUNT language. A tap routes to the Plan tab
 * (`data.route: 'runner'`, src/app/notificationRouter.ts), where the runner
 * still is if the process lived, and the Resume row is if it did not.
 *
 * ANDROID. It goes on the `rest_timer` channel, created at startup with HIGH
 * importance (iOS `.timeSensitive`), so it makes a sound and peeks over the
 * screen. The trigger is a date, so a JS timer that stops in the background
 * never moves it. No exact-alarm permission is asked for (D10): Doze may hold
 * a 90 second rest's alert for a little while on some phones.
 */
import { announce } from '../../components/ui/a11y';
import { translate, type Lang } from '../../i18n';
import { permissionStatus, removeEverywhere, scheduleAt } from '../../notifications';

/** The identifier, under the `health.` prefix the local wipe clears. */
export const REST_NOTIFICATION_ID = 'health.resttimer';

/** A rest this close to its end gets no notification (iOS `interval > 0.5`). */
export const REST_NOTIFICATION_MIN_LEAD_MS = 500;

/**
 * The seam the runner reaches the rest alert through (iOS
 * `RunnerRestAlerting`), so a test can hold the runner to "a rest that ends
 * in the background leaves its alert alone" without a notification centre.
 */
export interface RunnerRestAlerting {
  schedule(endsAt: Date, language: Lang): void;
  cancel(): void;
  /** TalkBack's moment (the success haptic's too): only ever in the foreground. */
  announce(text: string): void;
}

/**
 * Every schedule and cancel runs in the order it was asked for. Each is a
 * couple of native calls (the permission read, then the schedule), so
 * without the queue a cancel asked for just after a schedule (the app back
 * within a second) could finish first and leave the alert set.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Schedules the alert for `endsAt`, replacing any earlier one. Resolves to
 * whether it was scheduled: not when the rest ends within half a second, and
 * not when notifications are not allowed (it never asks). Never throws.
 */
export function scheduleRestNotification(endsAt: Date, language: Lang, now: Date = new Date()): Promise<boolean> {
  return enqueue(async () => {
    if (endsAt.getTime() - now.getTime() <= REST_NOTIFICATION_MIN_LEAD_MS) return false;
    if ((await permissionStatus()) !== 'granted') return false;
    return scheduleAt(
      REST_NOTIFICATION_ID,
      endsAt,
      {
        title: translate('notif.health.rest.title', language),
        body: translate('notif.health.rest.body', language),
        data: { route: 'runner' },
      },
      'rest_timer',
      now,
    );
  });
}

/** Removes the alert, scheduled or already in the shade. Never throws. */
export function cancelRestNotification(): Promise<void> {
  return enqueue(() => removeEverywhere((identifier) => identifier === REST_NOTIFICATION_ID));
}

/** The real one: the notification above, and TalkBack's announcement. */
export const liveRestAlerts: RunnerRestAlerting = {
  schedule(endsAt, language) {
    void scheduleRestNotification(endsAt, language);
  },
  cancel() {
    void cancelRestNotification();
  },
  announce(text) {
    announce(text);
  },
};

/** Tests: the queue starts empty. */
export function resetRestNotificationQueueForTests(): void {
  queue = Promise.resolve();
}
