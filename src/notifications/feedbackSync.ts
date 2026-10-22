/**
 * Schedules and removes the monthly feedback's notifications so the pending
 * set equals the planner's (iOS `FeedbackNotificationService.sync`).
 * Idempotent and cheap; runs after every summary read, every switch, every
 * "seen", a consent or feature change, and from the background refresh.
 *
 * This is the core only: it knows nothing of the app's stores, so the
 * background refresh can run it in a process with no screen
 * (src/features/feedback/backgroundJob.ts has the app-aware half).
 *
 * WHAT IT WRITES. Fixed words (./feedbackPlanner.ts lists the four keys) in
 * the language it is handed, on the `health` channel, with `data` holding the
 * tap route and an id. The fire dates it scheduled go to
 * `health.feedback.<profileId>.notified` (src/health/localKeys.ts, so the
 * health wipe removes them), capped at 24.
 *
 * Nothing here asks for permission (./permissions.ts says when that may
 * happen) and nothing throws: a notification that cannot be scheduled is one
 * the member does not get.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FeedbackSummary } from '../api/feedback';
import { FeedbackKeys } from '../health/localKeys';
import { translate, type Lang } from '../i18n';

import {
  FEEDBACK_PREFIX,
  cappedMarks,
  deliveredToRemove,
  deviceCalendar,
  feedbackPermission,
  planFeedbackNotifications,
  readMarks,
  writeMarks,
  type PhoneCalendar,
  type PlannedFeedbackNotification,
} from './feedbackPlanner';
import { permissionStatus } from './permissions';
import {
  deliveredIdentifiers,
  pendingIdentifiers,
  removeDelivered,
  removeEverywhere,
  removePending,
  scheduleAt,
  type LocalNotificationContent,
} from './scheduler';

/** The channel every feedback notification goes on (iOS `threadIdentifier = "health"`). */
export const FEEDBACK_CHANNEL = 'health' as const;

export interface FeedbackSyncInput {
  /** The summary as the app knows it; null when nothing has been read yet. */
  readonly summary: FeedbackSummary | null;
  /** The server advertises the feedback and the member's consent stands. */
  readonly eligible: boolean;
  /** Whose marks these are. */
  readonly profileId: string;
  /** The account language the words are written in. */
  readonly language: Lang;
  /** The app is on screen: nothing "learned" is added (the Plan card does the telling). */
  readonly appActive: boolean;
  readonly now?: Date;
  readonly calendar?: PhoneCalendar;
}

/** The words and the tap data a planned notification becomes. Fixed words only. */
export function feedbackNotificationContent(item: PlannedFeedbackNotification, language: Lang): LocalNotificationContent {
  return {
    title: translate(item.titleKey, language),
    body: translate(item.bodyKey, language),
    data: { ...item.data },
  };
}

/** Every `health.feedback.*` notification, pending and delivered. */
export function removeAllFeedbackNotifications(): Promise<void> {
  return removeEverywhere(FEEDBACK_PREFIX);
}

async function readStoredMarks(profileId: string): Promise<Map<string, Date>> {
  try {
    return readMarks(await AsyncStorage.getItem(FeedbackKeys.notified(profileId)));
  } catch {
    return new Map();
  }
}

async function storeMarks(profileId: string, marks: ReadonlyMap<string, Date>): Promise<void> {
  try {
    await AsyncStorage.setItem(FeedbackKeys.notified(profileId), writeMarks(cappedMarks(marks)));
  } catch {
    // The next sync recomputes from what is pending.
  }
}

async function performSync(input: FeedbackSyncInput): Promise<void> {
  const now = input.now ?? new Date();
  const calendar = input.calendar ?? deviceCalendar;
  const permission = feedbackPermission(await permissionStatus());
  const marks = await readStoredMarks(input.profileId);
  const pending = new Set(await pendingIdentifiers(FEEDBACK_PREFIX));

  const decision = planFeedbackNotifications({
    summary: input.summary,
    eligible: input.eligible,
    permission,
    appActive: input.appActive,
    marks,
    pending,
    now,
    calendar,
  });
  switch (decision.kind) {
    case 'leaveAlone':
      return;
    case 'removeAll':
      await removeAllFeedbackNotifications();
      return;
    case 'schedule':
      break;
  }

  const wanted = new Set(decision.notifications.map((item) => item.identifier));
  const stale = [...pending].filter((id) => !wanted.has(id));
  if (stale.length > 0) {
    const staleSet = new Set(stale);
    await removePending((id) => staleSet.has(id));
  }
  const updated = new Map(marks);
  for (const item of decision.notifications) {
    if (item.isAlreadyPending) continue;
    const scheduled = await scheduleAt(
      item.identifier,
      item.fireDate,
      feedbackNotificationContent(item, input.language),
      FEEDBACK_CHANNEL,
      now,
    );
    if (scheduled) updated.set(item.identifier, item.fireDate);
  }
  // A removed request that never fired is not a notification the member got:
  // its mark goes with it.
  for (const id of stale) {
    const fire = updated.get(id);
    if (fire && fire.getTime() > now.getTime()) updated.delete(id);
  }
  await storeMarks(input.profileId, updated);

  const delivered = await deliveredIdentifiers(FEEDBACK_PREFIX);
  const gone = new Set(deliveredToRemove(input.summary, delivered));
  if (gone.size > 0) await removeDelivered((id) => gone.has(id));
}

/** Syncs run one after another, so two never read the same pending set and both schedule. */
let queue: Promise<void> = Promise.resolve();

/**
 * One sync (iOS `FeedbackNotificationService.sync(summary:eligible:profileId:language:appActive:now:)`).
 * Queued behind any sync still running; never throws.
 */
export function syncFeedbackNotifications(input: FeedbackSyncInput): Promise<void> {
  const run = queue.then(() => performSync(input)).catch(() => undefined);
  queue = run;
  return run;
}

/** Tests: a fresh queue. */
export function resetFeedbackSyncForTests(): void {
  queue = Promise.resolve();
}
