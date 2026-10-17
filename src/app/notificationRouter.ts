/**
 * Where a tapped notification takes the member: the Android port of iOS
 * `NotificationRouter` (Services/NotificationRouter.swift) and its consumer in
 * `MainTabView.consumeNotificationRoute`.
 *
 * Only `data.route` is read (and `data.reportId` with a feedback route).
 * Notifications without a route (class reminders, engagement nudges) keep
 * their behaviour, which is that the app simply opens. LifePass sends LOCAL
 * notifications only; there is no push.
 *
 * A tap is PARKED here, then performed by the tabs shell once it is on screen
 * (`consumeNotificationRoute`): a cold start delivers the tap before any
 * screen exists, and before launch knows who is signed in. A route that finds
 * the member signed out is DROPPED, not queued: by the time anyone signs in,
 * this morning's workout note is no longer where they wanted to be. So a tap
 * is dropped when it arrives while the app is known to be signed out, and a
 * parked one is dropped the moment launch settles on "signed out" (iOS keeps
 * it until the tabs appear, which after a sign-in performed it after all;
 * Android keeps the rule its comment states). Each tap is performed once: the
 * listener and the cold-start read can both report the same tap, and the
 * last response is cleared once taken so a relaunch never replays it.
 */
import * as Notifications from 'expo-notifications';
import { create } from 'zustand';

import { track } from '../lib/analytics';
import type { MainTab } from '../navigation/types';
import { useAppStore } from '../stores/appStore';
import { useIntentStore, type PlanAction } from '../stores/intentStore';

/** The routes a notification can carry (iOS `NotificationRouter.Route` raw values). */
export const NOTIFICATION_ROUTES = ['plan', 'plan.checkin', 'runner', 'plan.feedback', 'plan.feedback_note'] as const;

export type NotificationRoute = (typeof NOTIFICATION_ROUTES)[number];

/** `notification_opened.kind` per route (a notification kind, never a health value). */
export const NOTIFICATION_ANALYTICS_KIND: Readonly<Record<NotificationRoute, string>> = {
  plan: 'workoutday',
  'plan.checkin': 'weeklycheckin',
  runner: 'resttimer',
  'plan.feedback': 'feedback_monthly',
  'plan.feedback_note': 'feedback_note',
};

/** A parked tap: the route, and the report a feedback notification named (an id, never a line of it). */
export interface ParkedNotificationRoute {
  readonly route: NotificationRoute;
  readonly reportId: string | null;
}

/** What a route asks of the tabs (iOS `consumeNotificationRoute`). */
export interface NotificationDestination {
  readonly tab: MainTab;
  readonly planAction: PlanAction | null;
}

/** The route a notification's `data` carries, or null (no route, or one this build does not know). */
export function routeFromData(data: unknown): ParkedNotificationRoute | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const raw = record.route;
  if (typeof raw !== 'string' || !(NOTIFICATION_ROUTES as readonly string[]).includes(raw)) return null;
  const reportId = typeof record.reportId === 'string' && record.reportId.length > 0 ? record.reportId : null;
  return { route: raw as NotificationRoute, reportId };
}

/** Where a parked route goes. Pure. */
export function destinationFor(parked: ParkedNotificationRoute): NotificationDestination {
  switch (parked.route) {
    case 'plan':
      return { tab: 'Plan', planAction: null };
    case 'plan.checkin':
      return { tab: 'Plan', planAction: { kind: 'openWeeklyCheckIn' } };
    case 'runner':
      // The runner is still up if the process lived; otherwise Plan shows its Resume row.
      return { tab: 'Plan', planAction: null };
    case 'plan.feedback':
      return { tab: 'Plan', planAction: { kind: 'openFeedback', reportId: parked.reportId } };
    case 'plan.feedback_note':
      return { tab: 'Plan', planAction: { kind: 'openFeedbackNote' } };
  }
}

interface RouterState {
  readonly pending: ParkedNotificationRoute | null;
}

/** The parked tap (the tabs shell subscribes to it). */
export const useNotificationRouter = create<RouterState>()(() => ({ pending: null }));

/** The last tap taken, so the listener and the cold-start read never perform one tap twice. */
let lastTapKey: string | null = null;

type ResponseLike = Pick<Notifications.NotificationResponse, 'notification' | 'actionIdentifier'>;

function tapKey(response: ResponseLike): string {
  const { notification } = response;
  return `${notification.request.identifier}@${notification.date}`;
}

/** Parks a tapped notification's route (iOS `NotificationRouter.handle`). Returns whether it had one. */
export function handleNotificationResponse(response: ResponseLike | null | undefined): boolean {
  if (!response) return false;
  const key = tapKey(response);
  if (key === lastTapKey) return false;
  lastTapKey = key;
  const parked = routeFromData(response.notification.request.content.data);
  if (!parked) return false;
  track('notification_opened', { kind: NOTIFICATION_ANALYTICS_KIND[parked.route] });
  if (knownSignedOut()) return true;
  useNotificationRouter.setState({ pending: parked });
  return true;
}

/** Launch has settled and nobody is signed in. */
function knownSignedOut(): boolean {
  const { isLoading, isAuthenticated } = useAppStore.getState();
  return !isLoading && !isAuthenticated;
}

/** Drops a parked tap once the app is known to be signed out. */
function dropIfSignedOut(): void {
  if (useNotificationRouter.getState().pending !== null && knownSignedOut()) {
    useNotificationRouter.setState({ pending: null });
  }
}

/**
 * Performs the parked tap, once: Plan, plus Plan's action when the route has
 * one. Dropped (and cleared) while signed out. Returns what was performed.
 */
export function consumeNotificationRoute(isAuthenticated: boolean): NotificationDestination | null {
  const parked = useNotificationRouter.getState().pending;
  if (!parked) return null;
  useNotificationRouter.setState({ pending: null });
  if (!isAuthenticated) return null;
  const destination = destinationFor(parked);
  const intents = useIntentStore.getState();
  if (destination.planAction) intents.parkPlanAction(destination.planAction);
  intents.requestTab(destination.tab);
  return destination;
}

/**
 * Listens for taps for the life of the app, and reads the tap that
 * cold-started it. Returns a stop.
 */
export function startNotificationRouter(): () => void {
  const stopWatchingSession = useAppStore.subscribe(dropIfSignedOut);
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    if (handleNotificationResponse(response)) clearLastResponse();
  });
  // The tap that cold-started the app (SDK 54's synchronous read).
  let launchResponse: Notifications.NotificationResponse | null = null;
  try {
    launchResponse = Notifications.getLastNotificationResponse();
  } catch {
    launchResponse = null;
  }
  // Taken: a later relaunch must not find it again.
  if (handleNotificationResponse(launchResponse)) clearLastResponse();
  return () => {
    subscription.remove();
    stopWatchingSession();
  };
}

function clearLastResponse(): void {
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Nothing to clear on this platform build; the tap is still taken once here.
  }
}

/** Back to a fresh process (tests). */
export function resetNotificationRouterForTests(): void {
  lastTapKey = null;
  useNotificationRouter.setState({ pending: null });
}
