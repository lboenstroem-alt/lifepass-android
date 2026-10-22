/**
 * The monthly feedback's notifications, wired to the app, and the background
 * refresh that lets the phone learn of a report or a note while nobody opens
 * it (iOS `FeedbackNotificationService.sync(appState:)`/`scheduleSync`,
 * `FeedbackBackgroundRefresh`, `FeedbackBackgroundCheck`, and their call sites
 * in AppState.wireFeedback and ContentView; `SPEC` 8.1, 8.2).
 *
 * The planner and the core sync are in src/notifications/feedbackPlanner.ts
 * and src/notifications/feedbackSync.ts; this file decides WHEN they run and
 * for WHOM.
 *
 * HOW THE PHONE LEARNS, SINCE THERE IS NO PUSH:
 * 1. Foreground: every activation (FEED-1's activation hook reads FB-1,
 *    throttled) and every Plan load. Each read, switch, "seen" and hidden note
 *    is announced (./changes.ts) and the sync follows, coalesced over 300 ms,
 *    with `appActive` true: while the app is on screen nothing is "learned",
 *    the card does the telling. So do a change of the feature flag and of the
 *    member's consent, either going away removing every `health.feedback.*`.
 * 2. Background: one WorkManager task (src/background), the Android stand-in
 *    for iOS Background App Refresh. As the app leaves the screen it is
 *    registered when the member could get something from it (signed in, the
 *    server has the feedback, consent, a feedback switch on) and cancelled
 *    otherwise. A run reads FB-1 at most every six hours for the member the
 *    foreground last recorded as eligible (`health.feedback.lastProfileId`),
 *    in the language it last recorded, and runs the sync with `appActive`
 *    false. It never shows anything but a "ready" notification and never asks
 *    for anything. No prompt and no Play Console declaration: WorkManager
 *    needs neither. Health Connect wakes (iOS's second way) are not built.
 *
 * HEADLESS. WorkManager can start the app's JavaScript with no screen (the
 * task is defined at the entry, src/background/task.ts). Nothing has
 * restored the session or read the profile then: the app store is still
 * "loading". The check therefore asks nothing of the stores. Who to read for
 * and in which language come from storage, and the API client restores the
 * Supabase session from the phone's own store (refreshing an expired token)
 * for the one read. A refusal (signed out, consent gone, a minor, the route
 * gone) removes every feedback notification quietly and the next foreground
 * decides the rest; no answer at all is a failed run, tried again at the next
 * slot.
 *
 * The local wipe (src/health/store.ts) removes the recorded member, the marks
 * and the last-check time, cancels the task and removes every `health.*`
 * notification, so nothing is read in the background for a member who has
 * signed out or withdrawn.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { ApiError } from '../../api/errors';
import { anyFeedbackOn, feedbackSettings, fetchFeedbackSummary, isFeedbackRouteMissing, type FeedbackSummary } from '../../api/feedback';
import { registerActivationHook } from '../../app/signOut';
import { registerBackgroundJob, syncBackgroundTask, type BackgroundJobResult } from '../../background';
import { FeedbackKeys } from '../../health/localKeys';
import { HealthServerFeature } from '../../health/models';
import { normaliseLang, type Lang } from '../../i18n';
import { NOTIFICATION_LANGUAGE_KEY, rememberNotificationLanguage } from '../../notifications/channels';
import { isoInstant, parseIsoInstant, type PhoneCalendar } from '../../notifications/feedbackPlanner';
import { removeAllFeedbackNotifications, syncFeedbackNotifications } from '../../notifications/feedbackSync';
import { selectHasHealthConsent, useAppStore, type AppStoreState } from '../../stores/appStore';

import { subscribeFeedbackChanges } from './changes';
import { supportsFeedback, useFeedbackStore } from './feedbackStore';

/** The background job's id (src/background/registry.ts). */
export const FEEDBACK_REFRESH_JOB_ID = 'feedback.refresh';
/** iOS asks for a refresh "earliest 6 hours later"; WorkManager's interval, in minutes. */
export const FEEDBACK_REFRESH_INTERVAL_MINUTES = 360;
/** A background read at most this often per member (iOS `FeedbackBackgroundCheck.minimumInterval`). */
export const FEEDBACK_CHECK_INTERVAL_MS = 6 * 3600 * 1000;
/** A burst (a read, a switch, a seen mark) becomes one sync (iOS `scheduleSync`). */
export const FEEDBACK_SYNC_COALESCE_MS = 300;

// ---------------------------------------------------------------------------
// The foreground sync

async function readKey(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeKey(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // The next foreground writes it again.
  }
}

/** The server has the feedback and the member's consent stands (no membership needed to be told). */
function feedbackEligible(app: AppStoreState): boolean {
  return supportsFeedback(app) && selectHasHealthConsent(app);
}

/**
 * The foreground sync (iOS `FeedbackNotificationService.sync(appState:appActive:)`):
 * works out eligibility from the app, records (or forgets) the member the
 * background check reads for and the language it writes in, then syncs.
 * Nothing without a signed-in member whose profile has loaded.
 */
export async function syncFeedbackNotificationsForApp(
  appActive: boolean,
  options: { readonly now?: Date; readonly calendar?: PhoneCalendar } = {},
): Promise<void> {
  const app = useAppStore.getState();
  const profileId = app.profile?.id;
  if (!app.isAuthenticated || !profileId) return;
  const eligible = feedbackEligible(app);
  if (eligible) {
    await Promise.all([writeKey(FeedbackKeys.lastProfileId, profileId), rememberNotificationLanguage(app.language)]);
  } else {
    await writeKey(FeedbackKeys.lastProfileId, null);
  }
  await syncFeedbackNotifications({
    summary: useFeedbackStore.getState().summary,
    eligible,
    profileId,
    language: app.language,
    appActive,
    now: options.now,
    calendar: options.calendar,
  });
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesces a burst into one sync, 300 ms after the last call (iOS
 * `scheduleSync(appState:appActive:)`, which defaults to the app on screen).
 */
export function scheduleFeedbackNotificationSync(appActive = true): void {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncFeedbackNotificationsForApp(appActive);
  }, FEEDBACK_SYNC_COALESCE_MS);
}

// ---------------------------------------------------------------------------
// The background check

/** What one background check did. */
export type FeedbackCheckOutcome =
  /** No member recorded on this phone: nothing read. */
  | 'no-member'
  /** Read for this member less than six hours ago: nothing read. */
  | 'throttled'
  /** Read, and the notifications synced. */
  | 'read'
  /** Refused (signed out, consent gone, a minor, the route gone): every feedback notification removed. */
  | 'refused'
  /** No usable answer: tried again at the next slot. */
  | 'failed';

export interface FeedbackCheckOptions {
  readonly now?: Date;
  readonly calendar?: PhoneCalendar;
  /** FB-1; the API client's by default. */
  readonly fetchSummary?: (language: Lang) => Promise<FeedbackSummary>;
}

/** Statuses that mean "not for you, not now" (iOS: 401, 403, 409). */
const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 409]);

function isRefusal(error: ApiError): boolean {
  return error.kind === 'not-authenticated' || REFUSED_STATUSES.has(error.status ?? 0) || isFeedbackRouteMissing(error);
}

/**
 * One background read of FB-1 and the notification sync after it (iOS
 * `FeedbackBackgroundCheck.run`). Asks nothing of the app's stores (see the
 * file comment, HEADLESS).
 */
export async function runFeedbackBackgroundCheck(options: FeedbackCheckOptions = {}): Promise<FeedbackCheckOutcome> {
  const now = options.now ?? new Date();
  const profileId = await readKey(FeedbackKeys.lastProfileId);
  if (!profileId) return 'no-member';
  const language = normaliseLang((await readKey(NOTIFICATION_LANGUAGE_KEY)) ?? 'en');
  const checkKey = FeedbackKeys.lastCheck(profileId);
  const last = parseIsoInstant(await readKey(checkKey));
  if (last && now.getTime() - last.getTime() < FEEDBACK_CHECK_INTERVAL_MS) return 'throttled';
  let summary: FeedbackSummary;
  try {
    summary = await (options.fetchSummary ?? fetchFeedbackSummary)(language);
  } catch (error) {
    if (error instanceof ApiError && !error.isCancellation && isRefusal(error)) {
      // Refused: nothing feedback stays scheduled, and the next foreground decides the rest.
      await removeAllFeedbackNotifications();
      return 'refused';
    }
    return 'failed';
  }
  await writeKey(checkKey, isoInstant(now));
  await syncFeedbackNotifications({
    summary,
    eligible: (summary.features ?? []).includes(HealthServerFeature.feedback),
    profileId,
    language,
    appActive: false,
    now,
    calendar: options.calendar,
  });
  return 'read';
}

/** The job WorkManager runs: the check, in the registry's words. */
export async function runFeedbackRefreshJob(): Promise<BackgroundJobResult> {
  switch (await runFeedbackBackgroundCheck()) {
    case 'read':
      return 'new-data';
    case 'failed':
      return 'failed';
    default:
      return 'no-data';
  }
}

/**
 * The member could get something from a background read (iOS
 * `FeedbackBackgroundRefresh.scheduleOrCancel`): signed in, the server has
 * the feedback, consent stands, and the report or the note switch is on.
 */
export function canGetFeedbackInBackground(app: AppStoreState = useAppStore.getState()): boolean {
  const settings = useFeedbackStore.getState().summary?.settings ?? feedbackSettings();
  return app.isAuthenticated && app.profile !== null && feedbackEligible(app) && anyFeedbackOn(settings);
}

/**
 * Whether the job may run now. With the app settled on who is signed in, the
 * rule above. Before that (a run in a process WorkManager started with no
 * screen, or a launch still deciding), whether a member is recorded: iOS's
 * run reads for the member the foreground last recorded, and does nothing
 * without one.
 */
export async function feedbackRefreshJobEligible(): Promise<boolean> {
  const app = useAppStore.getState();
  if (app.isLoading) return (await readKey(FeedbackKeys.lastProfileId)) !== null;
  return canGetFeedbackInBackground(app);
}

// ---------------------------------------------------------------------------
// Wiring

let installed: (() => void) | null = null;

/**
 * Wires the notifications and the background job to the app, once (the
 * feedback's register file calls it at startup, a headless run included).
 */
export function installFeedbackNotifications(): void {
  if (installed) return;
  const undo: (() => void)[] = [];

  undo.push(
    registerBackgroundJob(FEEDBACK_REFRESH_JOB_ID, runFeedbackRefreshJob, feedbackRefreshJobEligible, {
      minimumIntervalMinutes: FEEDBACK_REFRESH_INTERVAL_MINUTES,
    }),
  );

  // Every activation: the notifications follow whatever FEED-1's throttled
  // read finds (it announces a fresh summary), and the pre-schedule for the
  // 1st is right even for a member who never opens Plan.
  undo.push(registerActivationHook('feedback.notifications', () => scheduleFeedbackNotificationSync()));

  // A read, a switch, a seen report, a hidden note, a permission answer.
  undo.push(subscribeFeedbackChanges(() => scheduleFeedbackNotificationSync()));

  // The feature flag (the server's list and the feedback's stale flag) and the
  // consent: either changing re-plans, and either going away removes all.
  let supported = supportsFeedback(useAppStore.getState());
  let consented = selectHasHealthConsent(useAppStore.getState());
  const watchEligibility = (): void => {
    const app = useAppStore.getState();
    const nextSupported = supportsFeedback(app);
    const nextConsented = selectHasHealthConsent(app);
    if (nextSupported === supported && nextConsented === consented) return;
    supported = nextSupported;
    consented = nextConsented;
    scheduleFeedbackNotificationSync();
  };
  undo.push(useAppStore.subscribe(watchEligibility));
  undo.push(useFeedbackStore.subscribe(watchEligibility));

  // Leaving the screen: the background task registered while the member could
  // get something from it, cancelled otherwise. Not while launch is still
  // deciding who is signed in.
  const appState = AppState.addEventListener('change', (next) => {
    if (next !== 'background' || useAppStore.getState().isLoading) return;
    void syncBackgroundTask();
  });
  undo.push(() => appState.remove());

  installed = () => {
    for (const step of undo) step();
  };
}

/** Tests: everything installed taken down, and no sync waiting. */
export function resetFeedbackNotificationsForTests(): void {
  installed?.();
  installed = null;
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = null;
}
