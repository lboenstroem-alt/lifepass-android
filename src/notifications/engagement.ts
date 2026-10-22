/**
 * The engagement nudges: the Android port of iOS
 * `EngagementNotificationService` (Services/EngagementNotificationService.swift,
 * NOTIFICATIONS.md phase 1). Everything is scheduled ON THE PHONE from state
 * the app already holds (no push), and every sync is idempotent: fixed
 * identifiers mean a re-sync replaces rather than stacks, and a state change
 * (a purchase, a return visit) removes what no longer applies.
 *
 * THE LADDER:
 * - NO PURCHASE, day 5 (`engagement.nopurchase.d5`): the app has been on the
 *   phone 5 days with no membership or pass: one nudge toward the plans.
 * - NO PURCHASE, day 12 (`engagement.nopurchase.d12`): the free trial
 *   (2 visits, 14 days). Both go the moment a subscription or pass appears.
 *   A rung less than an hour away is removed, never fired late: "you've had
 *   the app 5 days" on day 40 is noise.
 * - STAY ACTIVE, + 7 days (`engagement.stayactive`): a member who has not
 *   OPENED THE APP for a week. Each activation schedules it again, so it only
 *   ever fires after seven silent days (opening the app is the activity the
 *   phone can see).
 * - VISITS RESET, period end - 3 days (`engagement.visitsreset`): a member
 *   with monthly visits still unspent, when the reset is more than 4 days
 *   away (so "soon" is honest).
 *
 * A LIVE PLAN SWITCHES STAY ACTIVE OFF (`ios-ux.md` 19.5): a member with an
 * active or paused workout plan has the plan's own notes and the weekly
 * check-in. That is the ONLY thing health state changes here: no nudge is
 * moved, retimed or reworded from it, and nothing else is read from the
 * health store.
 *
 * All fire at 18:00 on the phone's clock (after work, when a visit is
 * actually possible), on the `engagement` channel, in the account language,
 * with no route (a tap opens the app).
 *
 * PERMISSION: asked on the first sync of a SIGNED-IN session (plan 5.5; the
 * class booking may have asked already, and asking is a no-op once
 * answered). A signed-out phone waits. A refusal degrades to silence:
 * nothing here may ever block, and nothing is removed for it.
 *
 * WHEN IT RUNS (iOS `ContentView`): once launch has settled, on every return
 * to the foreground, and whenever the plan read answers, the plan turns
 * active or not, or the member gains or loses their last pass. A signed-in
 * member's purchase state is unknown until both the profile and the plan
 * have been read: deciding earlier would treat a subscriber as "no
 * purchase" (buy-a-plan rungs on), so the sync waits for both.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import type { UsageLane } from '../api/profile';
import { requestedFixtureState } from '../dev/fixtureSession';
import { isLiveStatus, selectHasLiveProgram, useHealthStore } from '../health';
import { translate, type Lang } from '../i18n';
import {
  selectActivePasses,
  selectHasActiveSubscription,
  selectPurchaseStateKnown,
  useAppStore,
  type AppStoreState,
} from '../stores/appStore';

import { permissionStatus, requestIfUndetermined } from './permissions';
import { removePending, scheduleAt } from './scheduler';

/** When the app first ran on this phone (iOS `engagement.first_open_at`), ISO 8601. Never wiped: it is the phone's. */
export const FIRST_OPEN_KEY = 'engagement.first_open_at';

export const ENGAGEMENT_IDS = {
  noPurchaseDay5: 'engagement.nopurchase.d5',
  noPurchaseDay12: 'engagement.nopurchase.d12',
  stayActive: 'engagement.stayactive',
  visitsReset: 'engagement.visitsreset',
} as const;

export type EngagementId = (typeof ENGAGEMENT_IDS)[keyof typeof ENGAGEMENT_IDS];

/** The house engagement time: 18:00 local. */
export const ENGAGEMENT_HOUR = 18;
/** A nudge closer than this is not scheduled (iOS `add`). */
export const NUDGE_MIN_LEAD_MS = 60_000;
/** A ladder rung closer than this is removed instead (iOS `scheduleLadderRung`). */
export const LADDER_MIN_LEAD_MS = 60 * 60 * 1000;
/** "Your visits reset soon" only when the reset is more than this far away. */
export const VISITS_RESET_MIN_AWAY_MS = 4 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The plan (pure)

export interface EngagementNudge {
  readonly id: EngagementId;
  readonly fireAt: Date;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface EngagementPlan {
  /** Scheduled (an existing one with the same id is replaced). */
  readonly schedule: readonly EngagementNudge[];
  /** Removed if pending. */
  readonly remove: readonly EngagementId[];
}

export interface EngagementInput {
  /** An active (or past-due) subscription, or any active pass. */
  readonly hasPurchase: boolean;
  /** An active or paused workout plan. */
  readonly hasLiveProgram: boolean;
  readonly firstOpen: Date;
  /** The monthly network lane (`usage.network`): cap, used, resetsAt. */
  readonly network: UsageLane | null;
  readonly now: Date;
}

/** 18:00 on the phone's calendar, `days` after `date` (negative counts back). */
export function at18(days: number, date: Date): Date {
  const target = new Date(date.getTime());
  target.setDate(target.getDate() + days);
  target.setHours(ENGAGEMENT_HOUR, 0, 0, 0);
  return target;
}

/** What should be pending and what should go, from the member's state alone. */
export function planEngagementNudges(input: EngagementInput): EngagementPlan {
  const { now } = input;
  const schedule: EngagementNudge[] = [];
  const remove: EngagementId[] = [];
  const add = (nudge: EngagementNudge): void => {
    if (nudge.fireAt.getTime() - now.getTime() > NUDGE_MIN_LEAD_MS) schedule.push(nudge);
  };

  if (input.hasPurchase) {
    // The conversion ladder is over: a stale "buy a plan" nudge to a paying
    // member reads as the app not knowing them.
    remove.push(ENGAGEMENT_IDS.noPurchaseDay5, ENGAGEMENT_IDS.noPurchaseDay12);

    // Stay active: scheduled again on EVERY activation, so it only fires
    // after seven days without an open. Not while a workout plan is live.
    if (input.hasLiveProgram) {
      remove.push(ENGAGEMENT_IDS.stayActive);
    } else {
      add({
        id: ENGAGEMENT_IDS.stayActive,
        fireAt: at18(7, now),
        titleKey: 'notif.stayactive.title',
        bodyKey: 'notif.stayactive.body',
        params: {},
      });
    }

    // Visits reset: only with visits left to lose and the reset far enough
    // away that "soon" is honest.
    const network = input.network;
    const resetsAt = network?.resetsAt ?? null;
    if (
      network !== null &&
      network.cap > network.used &&
      resetsAt !== null &&
      resetsAt.getTime() - now.getTime() > VISITS_RESET_MIN_AWAY_MS
    ) {
      add({
        id: ENGAGEMENT_IDS.visitsReset,
        fireAt: at18(-3, resetsAt),
        titleKey: 'notif.visitsreset.title',
        bodyKey: 'notif.visitsreset.body',
        params: { count: String(network.cap - network.used) },
      });
    } else {
      remove.push(ENGAGEMENT_IDS.visitsReset);
    }
    return { schedule, remove };
  }

  // No purchase: the subscriber nudges off, the conversion ladder on.
  remove.push(ENGAGEMENT_IDS.stayActive, ENGAGEMENT_IDS.visitsReset);
  const rungs = [
    { id: ENGAGEMENT_IDS.noPurchaseDay5, days: 5, titleKey: 'notif.nopurchase.d5.title', bodyKey: 'notif.nopurchase.d5.body' },
    { id: ENGAGEMENT_IDS.noPurchaseDay12, days: 12, titleKey: 'notif.nopurchase.d12.title', bodyKey: 'notif.nopurchase.d12.body' },
  ] as const;
  for (const rung of rungs) {
    const fireAt = at18(rung.days, input.firstOpen);
    if (fireAt.getTime() - now.getTime() <= LADDER_MIN_LEAD_MS) {
      remove.push(rung.id);
    } else {
      add({ id: rung.id, fireAt, titleKey: rung.titleKey, bodyKey: rung.bodyKey, params: {} });
    }
  }
  return { schedule, remove };
}

// ---------------------------------------------------------------------------
// The sync

/** What the sync reads from the app store and the health store, snapshotted at its start. */
export interface EngagementState {
  readonly signedIn: boolean;
  readonly hasPurchase: boolean;
  readonly hasLiveProgram: boolean;
  readonly network: UsageLane | null;
  readonly language: Lang;
}

/** The sync's inputs from the stores (iOS reads them on the main actor before anything awaits). */
export function engagementState(app: AppStoreState, hasLiveProgramInHealth: boolean): EngagementState {
  return {
    signedIn: app.isAuthenticated,
    hasPurchase: selectHasActiveSubscription(app) || selectActivePasses(app).length > 0,
    hasLiveProgram: hasLiveProgramInHealth || isLiveStatus(app.profile?.health?.program?.status ?? null),
    network: app.profile?.usage?.network ?? null,
    language: app.language,
  };
}

/**
 * When the app first ran here; stored the first time it is asked for (the
 * first sync that could decide anything). A value that cannot be read as a
 * date is replaced, as iOS replaces one that is not a Date.
 */
export async function firstOpenDate(now: Date = new Date()): Promise<Date> {
  try {
    const raw = await AsyncStorage.getItem(FIRST_OPEN_KEY);
    if (raw) {
      const stored = new Date(raw);
      if (!Number.isNaN(stored.getTime())) return stored;
    }
  } catch {
    // Unreadable now: today stands in, and the next sync reads it again.
    return now;
  }
  try {
    await AsyncStorage.setItem(FIRST_OPEN_KEY, now.toISOString());
  } catch {
    // Kept for this sync only.
  }
  return now;
}

async function apply(plan: EngagementPlan, language: Lang, now: Date): Promise<void> {
  if (plan.remove.length > 0) {
    const ids = new Set<string>(plan.remove);
    await removePending((identifier) => ids.has(identifier));
  }
  for (const nudge of plan.schedule) {
    await scheduleAt(
      nudge.id,
      nudge.fireAt,
      { title: translate(nudge.titleKey, language), body: translate(nudge.bodyKey, language, nudge.params) },
      'engagement',
      now,
    );
  }
}

/**
 * Re-derives every nudge from the current state, once. Never throws. Use
 * `runEngagementSync` (serial) rather than this directly.
 */
export async function syncEngagementNudges(): Promise<void> {
  // A development fixture run is signed in from a fixture and would meet the
  // permission dialog on launch (iOS DEBUG `suppressesSystemPrompts`).
  if (requestedFixtureState() !== null) return;
  const app = useAppStore.getState();
  // Signed out there is nothing to know; signed in, both reads must have answered.
  if (!selectPurchaseStateKnown(app)) return;
  const state = engagementState(app, selectHasLiveProgram(useHealthStore.getState()));
  const firstOpen = await firstOpenDate();

  const permission = await permissionStatus();
  if (permission === 'undetermined') {
    // Asked once the member is actually engaged (signed in): a cold prompt
    // on first launch is where refusals come from. Signed out just waits.
    if (!state.signedIn) return;
    if (!(await requestIfUndetermined())) return;
  } else if (permission !== 'granted') {
    return;
  }

  // Timed from after the answer: the dialog can stay up a while.
  const now = new Date();
  await apply(planEngagementNudges({ ...state, firstOpen, now }), state.language, now);
}

let chain: Promise<void> = Promise.resolve();
let waiting: Promise<void> | null = null;

/**
 * A sync after the one in progress. Requests while one is waiting join it,
 * so a burst of changes gives one more sync, never two dialogs.
 */
export function runEngagementSync(): Promise<void> {
  if (waiting !== null) return waiting;
  const next = chain
    .then(() => {
      waiting = null;
      return syncEngagementNudges();
    })
    .catch(() => undefined);
  waiting = next;
  chain = next;
  return next;
}

// ---------------------------------------------------------------------------
// Installation

/**
 * What, in the app store, changes the purchase state the nudges are planned
 * from (iOS `onChange` of `subscriptionLoaded`, `hasActiveSubscription` and
 * `activePasses.isEmpty`), and the moment it becomes known at all. iOS reads
 * the profile before the plan at launch, so the plan answering is that
 * moment there; an Android sign-in reads both at once, and a plan that
 * answers first would leave the profile's arrival with no sync until the
 * next foreground (no prompt, no nudge for a member who just signed in).
 */
function purchaseSignals(state: AppStoreState): readonly boolean[] {
  return [
    state.subscriptionLoaded,
    selectHasActiveSubscription(state),
    selectActivePasses(state).length === 0,
    selectPurchaseStateKnown(state),
  ];
}

let installed = false;

/**
 * Wires the sync to launch, the foreground and the purchase state (once;
 * loaded with the notification layer's session hooks,
 * src/notifications/register.ts).
 *
 * Changes while the launch screen is still up wait for it: launch ending is
 * itself a sync, with everything launch read.
 */
export function installEngagementNudges(): void {
  if (installed) return;
  installed = true;

  // Every return to the foreground pushes the stay-active clock out another
  // week and picks up purchases made since the last sync.
  AppState.addEventListener('change', (next) => {
    if (next === 'active' && !useAppStore.getState().isLoading) void runEngagementSync();
  });

  useAppStore.subscribe((state, previous) => {
    if (state.isLoading) return;
    const launched = previous.isLoading;
    const before = purchaseSignals(previous);
    const after = purchaseSignals(state);
    const changed = after.some((value, index) => value !== before[index]);
    if (launched || changed) void runEngagementSync();
  });
}

/** Tests: no sync waiting. The wiring stays installed. */
export function resetEngagementForTests(): void {
  chain = Promise.resolve();
  waiting = null;
}
