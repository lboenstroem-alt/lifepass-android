/* eslint lifepass/no-literal-copy: "error" */
/**
 * "How was your visit?" as a local notification (docs/05, "The local
 * notification"; there is no remote push).
 *
 * WHEN. A check-in reserved an ask (`ratingPrompt`) and the member ALREADY
 * allows notifications: this never asks for the permission (a dialog after
 * a check-in would be the wrong moment to burn Android's two asks).
 *
 * WHAT. ONE notification at `dueAt` (the check-in plus an hour), identifier
 * `visit-rating-<id>`, with the ask's id in its payload and the route the
 * tap takes (`visit.rating`: src/app/notificationRouter.ts). At most one is
 * pending: scheduling removes any older `visit-rating-*`. An ask already due
 * schedules nothing; the Home card covers it.
 *
 * WHERE. The `engagement` channel (default importance), with the app's other
 * nudges: a member who silenced those in system settings has said they do
 * not want to be asked things, and a channel of its own would be another
 * importance fixed for ever (src/notifications/channels.ts).
 *
 * GONE when the ask is answered or dismissed (here or anywhere the app
 * learns of it), when the server says it is closed, when `expiresAt` passes
 * (the sweep on every return to the app takes it out of the shade too), and
 * at sign-out.
 *
 * The words are the account language's (src/notifications/channels.ts
 * `notificationLanguage`); the venue name stands alone after the dash, so it
 * is never inflected.
 */
import * as Notifications from 'expo-notifications';

import type { VisitRatingReservation } from '../../api/visitRating';
import { translate, type Lang } from '../../i18n';
import {
  notificationLanguage,
  permissionStatus,
  removeEverywhere,
  removePending,
  scheduleAt,
  type NotificationPermission,
} from '../../notifications';

/** Every visit rating notification's identifier starts with this; nothing else's does. */
export const VISIT_RATING_NOTIFICATION_PREFIX = 'visit-rating-';

/** The route a tap takes (src/app/notificationRouter.ts). */
export const VISIT_RATING_ROUTE = 'visit.rating';

/** The identifier for the ask `promptId`. */
export function visitRatingNotificationId(promptId: string): string {
  return `${VISIT_RATING_NOTIFICATION_PREFIX}${promptId.toLowerCase()}`;
}

function isVisitRatingNotification(identifier: string): boolean {
  return identifier.startsWith(VISIT_RATING_NOTIFICATION_PREFIX);
}

/** The notification's words, in `language`. */
export function visitRatingNotificationContent(
  venueName: string,
  language: Lang,
): { readonly title: string; readonly body: string } {
  return {
    title: translate('visitRating.notification.title', language),
    body: translate('visitRating.notification.body', language, { venueName }),
  };
}

export interface VisitRatingNotificationDeps {
  permission(): Promise<NotificationPermission>;
  language(): Promise<Lang>;
  now(): Date;
}

const defaultDeps: VisitRatingNotificationDeps = {
  permission: () => permissionStatus(),
  language: () => notificationLanguage(),
  now: () => new Date(),
};

/**
 * Schedules the notification for a reserved ask (see the file comment).
 * Answers whether it was scheduled. Never throws, never asks.
 */
export async function scheduleVisitRatingNotification(
  prompt: VisitRatingReservation,
  deps: VisitRatingNotificationDeps = defaultDeps,
): Promise<boolean> {
  const identifier = visitRatingNotificationId(prompt.id);
  try {
    // A newer ask supersedes any older one, however this one goes.
    await removePending((pending) => isVisitRatingNotification(pending) && pending !== identifier);
    if ((await deps.permission()) !== 'granted') return false;
    const now = deps.now();
    if (prompt.dueAt.getTime() <= now.getTime() || prompt.expiresAt.getTime() <= now.getTime()) return false;
    const content = visitRatingNotificationContent(prompt.venueName, await deps.language());
    return await scheduleAt(
      identifier,
      prompt.dueAt,
      {
        ...content,
        data: { route: VISIT_RATING_ROUTE, promptId: prompt.id, expiresAt: prompt.expiresAt.toISOString() },
      },
      'engagement',
      now,
    );
  } catch {
    return false;
  }
}

/** The ask `promptId` is closed: its notification goes, pending or in the shade. */
export function cancelVisitRatingNotification(promptId: string): Promise<void> {
  const identifier = visitRatingNotificationId(promptId);
  return removeEverywhere((candidate) => candidate === identifier).catch(() => undefined);
}

/** Sign-out: every visit rating notification goes, pending or in the shade. */
export function cancelAllVisitRatingNotifications(): Promise<void> {
  return removeEverywhere(VISIT_RATING_NOTIFICATION_PREFIX).catch(() => undefined);
}

/** When a notification's ask lapses (its payload's `expiresAt`), or null when it does not say. */
function expiresAtOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>).expiresAt;
  if (typeof raw !== 'string') return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

/**
 * Takes out every visit rating notification whose ask has lapsed: one still
 * pending (a clock changed under it) or one sitting in the shade, which a
 * tap would only open onto nothing. Run on every return to the app. Never
 * throws.
 */
export async function removeLapsedVisitRatingNotifications(now: Date = new Date()): Promise<void> {
  const lapsed = (identifier: string, data: unknown): boolean => {
    if (!isVisitRatingNotification(identifier)) return false;
    const expiresAt = expiresAtOf(data);
    return expiresAt !== null && expiresAt <= now.getTime();
  };
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((request) => lapsed(request.identifier, request.content.data))
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined)),
    );
  } catch {
    // Nothing readable: the next return to the app tries again.
  }
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((notification) => lapsed(notification.request.identifier, notification.request.content.data))
        .map((notification) =>
          Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined),
        ),
    );
  } catch {
    // As above.
  }
}
