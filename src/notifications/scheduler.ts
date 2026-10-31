/**
 * Local notifications, scheduled and removed by identifier: the helpers every
 * notification feature uses (class reminders, health reminders, the rest
 * timer, the monthly feedback, the engagement nudges). LifePass sends no push
 * (owner ruling 4, as on iOS): everything is scheduled on the phone, and
 * every identifier names what it is (`health.workoutday.2026-10-17`,
 * `health.resttimer`, `engagement.stayactive`), so a family of them is found
 * and removed by its prefix.
 *
 * THE `health.` PREFIX IS A PROMISE. Everything a member's health data could
 * be read from (a workout note, the check-in, the rest timer, the feedback
 * notices) is scheduled under `health.`, and the local wipe removes every
 * pending and delivered notification with that prefix (./cleanup.ts). A
 * health notification under any other identifier would survive a sign-out.
 *
 * Nothing here asks for permission (./permissions.ts decides when that may
 * happen) and nothing throws: a notification that cannot be scheduled is a
 * notification the member does not get, never a failed screen.
 */
import * as Notifications from 'expo-notifications';

import { ensureChannels, type ChannelId } from './channels';

export interface LocalNotificationContent {
  readonly title: string;
  readonly body: string;
  /** What a tap routes on (src/navigation's notification router reads it). Never a health value. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** An identifier prefix (`'health.'`) or a test on the whole identifier. */
export type IdentifierMatch = string | ((identifier: string) => boolean);

function matcher(match: IdentifierMatch): (identifier: string) => boolean {
  return typeof match === 'string' ? (identifier) => identifier.startsWith(match) : match;
}

/**
 * Schedules `content` at `date` on `channel` under `identifier`, replacing
 * one with the same identifier. A date that has already passed is not
 * scheduled (Android drops a past one-off trigger; this says so). Answers
 * whether it was scheduled.
 */
export async function scheduleAt(
  identifier: string,
  date: Date,
  content: LocalNotificationContent,
  channel: ChannelId,
  now: Date = new Date(),
): Promise<boolean> {
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) return false;
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: content.title, body: content.body, data: { ...(content.data ?? {}) } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: channel },
    });
    return true;
  } catch {
    return false;
  }
}

/** The identifiers of every pending (scheduled, not yet shown) notification that matches. */
export async function pendingIdentifiers(match: IdentifierMatch): Promise<string[]> {
  try {
    const test = matcher(match);
    return (await Notifications.getAllScheduledNotificationsAsync()).map((request) => request.identifier).filter(test);
  } catch {
    return [];
  }
}

/** The identifiers of every delivered notification (in the shade) that matches. */
export async function deliveredIdentifiers(match: IdentifierMatch): Promise<string[]> {
  try {
    const test = matcher(match);
    return (await Notifications.getPresentedNotificationsAsync())
      .map((notification) => notification.request.identifier)
      .filter(test);
  } catch {
    return [];
  }
}

/** Cancels every pending notification that matches. */
export async function removePending(match: IdentifierMatch): Promise<void> {
  const identifiers = await pendingIdentifiers(match);
  await Promise.all(identifiers.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

/** Takes every delivered notification that matches out of the shade. */
export async function removeDelivered(match: IdentifierMatch): Promise<void> {
  const identifiers = await deliveredIdentifiers(match);
  await Promise.all(identifiers.map((id) => Notifications.dismissNotificationAsync(id).catch(() => undefined)));
}

/** Both: nothing that matches stays scheduled or on screen. */
export async function removeEverywhere(match: IdentifierMatch): Promise<void> {
  await Promise.all([removePending(match), removeDelivered(match)]);
}
