/**
 * The Plan tab's controller: everything iOS PlanView.swift does that is not
 * a card. The load sequence, the parked actions, the week moves, the action
 * answers, the outbox decisions, the adopted banner, the bookings hint and
 * the scroll requests live here, so every section (each another package's)
 * calls the SAME functions the screen does instead of keeping its own copy:
 *
 *   import { reloadPlan, selectPlanDate, applySessionAction, usePlanView } from '../shell';
 *
 * THE LOAD SEQUENCE (iOS `load`, `ios-ux.md` 3.3):
 *   1. nothing for a minor or a member without consent: the gate and the
 *      under-18 card render from the profile alone, and a Today read would
 *      spend a request to be told 409. CONSENT IS THE WHOLE TEST, not the
 *      membership: a lapsed member with consent gets read-only content (their
 *      nutrition, review and history under the gate card);
 *   2. the workout outbox, then the meal outbox, so the day that comes back
 *      already counts what this phone saved while it was offline;
 *   3. `GET /health` for the date on screen;
 *   4. the monthly feedback's own read, when the server has it.
 * (iOS then uploads Apple Health in the background; Android has no Health
 * Connect, owner decision.)
 *
 * THE SCREEN ATTACHES ITS NAVIGATION while it is mounted, so a parked action
 * pushes onto Plan's own stack (iOS `planPath`), and a section can push
 * without props.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { ApiError, newIdempotencyKey } from '../../../api';
import {
  openHealthConsent,
  presentMealGate,
  selectHasLiveProgram,
  updateProgram,
  useHealthStore,
  type HealthAccess,
  type SessionActionResponse,
  type SessionView,
  type WeekView,
} from '../../../health';
import type { Lang } from '../../../i18n';
import { todayServerDay } from '../../../i18n/format';
import { track } from '../../../lib/analytics';
import { openRootModal } from '../../../navigation/navigationRef';
import { UPGRADED_FROM_PROFILE_TAB_KEY } from '../../../navigation/navPrefs';
import { planVisitsKey, profileOpenedKey } from '../../../navigation/profile';
import type {
  MealCaptureMode,
  MealCaptureParams,
  RootModalName,
  RootModalRoutes,
  SharedRouteName,
  SharedRoutes,
} from '../../../navigation/types';
import { selectHasHealthConsent, selectSupportsFeedback, useAppStore } from '../../../stores/appStore';
import { useIntentStore, type ParkedPlanAction, type PlanAction } from '../../../stores/intentStore';
import { hasPendingWorkout, openRunner } from '../../runner';
import { movedWeekStart, relativeDay } from '../week/weekRules';

import { planActionAnswer } from './actionAnswer';
import { failedOutboxItems, installedOutboxes, usePlanBridges, type PlanOutboxItem } from './bridges';
import { canAnswerPlanAction, isParkedActionExpired, type PlanActionContext } from './parkedActions';
import { currentPlanView } from './planView';
import { planSectionAnalyticsState, type PlanSectionAnchor } from './sectionRule';

// ---------------------------------------------------------------------------
// Navigation

/** How the shell moves on Plan's stack: the mounted Plan screen's own navigation. */
export interface PlanNavigator {
  navigate(name: string, params?: object): void;
  popToTop(): void;
}

let navigator: PlanNavigator | null = null;

/** The Plan screen attaches its navigation while mounted; the answer detaches it. */
export function attachPlanNavigator(next: PlanNavigator): () => void {
  navigator = next;
  return () => {
    if (navigator === next) navigator = null;
  };
}

/** Pushes a shared route onto Plan's stack (iOS `planPath.append`). */
export function pushPlanRoute<Name extends SharedRouteName>(
  name: Name,
  ...params: undefined extends SharedRoutes[Name] ? [params?: SharedRoutes[Name]] : [params: SharedRoutes[Name]]
): void {
  navigator?.navigate(name, params[0] as object | undefined);
}

/** Opens a root modal over the tabs (the Plans sheet, the meal page). */
export function openPlanModal<Name extends RootModalName>(
  name: Name,
  ...params: undefined extends RootModalRoutes[Name] ? [params?: RootModalRoutes[Name]] : [params: RootModalRoutes[Name]]
): void {
  if (navigator) navigator.navigate(name, params[0] as object | undefined);
  else (openRootModal as (n: RootModalName, p?: object) => boolean)(name, params[0] as object | undefined);
}

/** Back to Plan's first screen (iOS `planPath = NavigationPath()`). */
export function popPlanToRoot(): void {
  navigator?.popToTop();
}

// ---------------------------------------------------------------------------
// State

export interface PlanShellState {
  /** The one-time banner after an adopt: the day the plan starts (null when the answer had none). */
  readonly adoptedBanner: { readonly startsOn: string | null } | null;
  /** The banner belongs to ONE appearance: the next one clears it. */
  readonly adoptedBannerShown: boolean;
  /**
   * The proposal this member just adopted. Its card is not drawn again while
   * the read that turns it into a plan is in flight, so Start cannot be
   * tapped twice.
   */
  readonly adoptedProposalId: string | null;
  /**
   * When the adopt was taken in (ms). Only a read that LANDED after it can
   * lift `adoptedProposalId`: a non-forced read that returns at once inside
   * the freshness window leaves the 'loaded' state from before the adopt,
   * and lifting on that would draw the proposal card again under the green
   * banner while the forced read is still in flight.
   */
  readonly adoptedAt: number | null;
  /** A section a parked action asked to land on; the screen scrolls when it exists. */
  readonly scrollTarget: PlanSectionAnchor | null;
  /** Moves when TalkBack should follow a scroll onto the review card. */
  readonly reviewFocusNonce: number;
  /** An action taken off the intent store, held until the screen can answer it. */
  readonly parked: ParkedPlanAction | null;
  /** Items this phone saved that the server refused (3.5's banner). */
  readonly failedOutboxItems: readonly PlanOutboxItem[];
  /** Outbox items with a Save as extra or a Discard in flight: a second tap would post twice. */
  readonly busyOutboxIds: readonly string[];
  /** The next appearance reads again with force (a meal page or the classes sheet closed). */
  readonly reloadOnNextFocus: boolean;
  /** Whose bookings hint shows on this appearance (null: none). */
  readonly bookingsHintFor: string | null;
  /** Consent asked for by Log a meal with no app-wide host mounted: the screen draws the sheet. */
  readonly localConsent: { readonly onGranted: () => void } | null;
  /** The membership gate with no app-wide host mounted: the screen draws it. */
  readonly localMealGate: HealthAccess | null;
}

const initialState: PlanShellState = {
  adoptedBanner: null,
  adoptedBannerShown: false,
  adoptedProposalId: null,
  adoptedAt: null,
  scrollTarget: null,
  reviewFocusNonce: 0,
  parked: null,
  failedOutboxItems: [],
  busyOutboxIds: [],
  reloadOnNextFocus: false,
  bookingsHintFor: null,
  localConsent: null,
  localMealGate: null,
};

export const usePlanShell = create<PlanShellState>()(() => initialState);

const set = (patch: Partial<PlanShellState>): void => usePlanShell.setState(patch);
const get = (): PlanShellState => usePlanShell.getState();

/** The language the last read was asked in: a change re-reads, since every title is server copy. */
let lastLoadLanguage: Lang | null = null;

// ---------------------------------------------------------------------------
// The load sequence

function hasConsentNow(): boolean {
  return selectHasHealthConsent(useAppStore.getState());
}

/** iOS `supportsFeedback`: the server advertises it, FEED-1 is here, and its own check agrees. */
export function supportsFeedbackNow(): boolean {
  const bridge = usePlanBridges.getState().feedback;
  if (!bridge || !selectSupportsFeedback(useAppStore.getState())) return false;
  try {
    return bridge.isAvailable();
  } catch {
    return false;
  }
}

/** Runs the load sequence (see the top of this file). Never throws. */
export async function reloadPlan(options: { force?: boolean } = {}): Promise<void> {
  const force = options.force ?? false;
  const before = useAppStore.getState();
  if (before.healthAccess === 'minor' || !selectHasHealthConsent(before)) return;

  for (const source of installedOutboxes()) {
    try {
      await source.flush();
    } catch {
      // An item that cannot go yet stays queued; its owner reports a failure.
    }
  }
  refreshOutbox();

  const app = useAppStore.getState();
  const store = useHealthStore.getState();
  const isToday = store.selectedDate === todayServerDay();
  const languageChanged = lastLoadLanguage !== null && lastLoadLanguage !== app.language;
  lastLoadLanguage = app.language;
  await store.load({
    date: isToday ? undefined : store.selectedDate,
    force: force || languageChanged,
    profile: app.profile,
    language: app.language,
  });

  // The read has spoken, so the adopt suppression is over: either the
  // programme arrived or the server says there is none, and the proposal
  // card is the honest thing to show again. Kept over a FAILED read, where
  // the card would be a second Start button with no way to know whether the
  // first one worked, and over a 'loaded' from BEFORE the adopt (a call that
  // returned inside the freshness window, or whose outbox flush let it in
  // ahead of the forced read): only a read that landed since says anything.
  liftAdoptGuardIfAnswered();

  const bridge = usePlanBridges.getState().feedback;
  if (bridge && supportsFeedbackNow() && hasConsentNow()) {
    try {
      await bridge.refresh(force);
    } catch {
      // The card shows what it has.
    }
  }
}

function liftAdoptGuardIfAnswered(): void {
  const { adoptedProposalId, adoptedAt } = get();
  if (adoptedProposalId === null) return;
  const loadState = useHealthStore.getState().loadState;
  if (loadState.kind !== 'loaded') return;
  if (adoptedAt !== null && loadState.at.getTime() <= adoptedAt) return;
  set({ adoptedProposalId: null, adoptedAt: null });
}

/** Ask the next appearance to read with force (iOS's `onDismiss` reload after a sheet or cover). */
export function reloadPlanOnNextFocus(): void {
  set({ reloadOnNextFocus: true });
}

// ---------------------------------------------------------------------------
// The week strip

/** Selects a day on the strip, reading it when it is not in memory (iOS `select(date:)`). */
export function selectPlanDate(date: string): void {
  const store = useHealthStore.getState();
  if (date === store.selectedDate) return;
  track('plan_week_day_selected', { relative: relativeDay(date, todayServerDay()) });
  store.setSelectedDate(date);
  if (store.days[date]) return;
  void reloadPlan({ force: true });
}

/** A chevron or a swipe: the Monday `delta` weeks away (iOS `moveWeek`). */
export function movePlanWeek(delta: number, week: Pick<WeekView, 'weekStartsOn'>): void {
  const start = movedWeekStart(week, delta);
  if (start) selectPlanDate(start);
}

// ---------------------------------------------------------------------------
// Actions on the plan

/**
 * An action's answer replaces the day, the week and the upcoming rows without
 * a second read (iOS `apply`), except that the week in an answer is the week
 * of the session acted on: an answer about another week re-reads the date on
 * screen instead of putting last week under this week's strip.
 */
export function applySessionAction(response: SessionActionResponse): void {
  const store = useHealthStore.getState();
  const rule = planActionAnswer(response, store.today?.week?.weekStartsOn, todayServerDay());
  store.applyActionResult({ session: rule.session, changed: response.changed, week: rule.week, upcoming: response.upcoming });
  // A row on another date (a workout logged on yesterday's card) goes into
  // that date's remembered read, which is the one on screen.
  store.applySessionsToOtherDays([...(response.session ? [response.session] : []), ...(response.changed ?? [])]);
  if (rule.rereadsShownDate) void reloadPlan({ force: true });
}

/** Pause, resume or end the programme (iOS `setStatus`), then read again. Never throws. */
export async function setProgramStatus(status: 'paused' | 'active' | 'abandoned', programId: string): Promise<void> {
  try {
    await updateProgram(programId, { status }, newIdempotencyKey());
    track(status === 'paused' ? 'program_paused' : status === 'active' ? 'program_resumed' : 'program_ended');
  } catch (error) {
    if (error instanceof ApiError) useHealthStore.getState().handle(error, { foreground: true });
    else useHealthStore.getState().setToast('health.err.changed');
  }
  await reloadPlan({ force: true });
}

/**
 * Opens the workout runner on a session (iOS `presentRunner`). A workout
 * saved on this phone and waiting to sync is done, and a second run would
 * log it twice, so it says so instead. Whether a saved run is resumed is the
 * runner's decision (`openRunner`, RUN-3).
 */
export async function presentPlanRunner(session: SessionView): Promise<void> {
  if (await hasPendingWorkout(session.id)) {
    useHealthStore.getState().setToast('health.saved_offline');
    return;
  }
  const today = todayServerDay();
  const missed = (session.status ?? 'planned') === 'missed' || (session.scheduledFor !== null && session.scheduledFor < today);
  // The runner's close reads the day again (iOS `runnerClosed`: a saved,
  // skipped or needs-reload close reads with force). The runner is a root
  // modal with no answer to hand back, so every close reads: otherwise the
  // Today card and the strip keep "planned" and Start until the freshness
  // window runs out. A close that queued the workout shows in the banner
  // from the same return (`planReturnedFromSheet`).
  set({ reloadOnNextFocus: true });
  openRunner(session, missed ? 'missed' : 'today');
}

/**
 * The meal page for today or the past date the card shows, never a future
 * date (iOS `openMealCapture`). An entitled member with consent only: the
 * membership gate otherwise, and the consent sheet first when consent is
 * missing.
 */
export function openPlanMealCapture(mode: MealCaptureMode, date: string): void {
  const app = useAppStore.getState();
  const today = todayServerDay();
  const params: MealCaptureParams = { origin: 'plan', mode, date: date < today ? date : today };
  if (app.healthAccess !== 'entitled') {
    if (!presentMealGate(app.healthAccess)) set({ localMealGate: app.healthAccess });
    return;
  }
  const open = (): void => {
    // The page's close re-reads the day (iOS `onDismiss`).
    set({ reloadOnNextFocus: true });
    openPlanModal('MealCapture', params);
  };
  if (selectHasHealthConsent(app)) {
    open();
    return;
  }
  if (!openHealthConsent({ entry: 'plan', onGranted: open })) set({ localConsent: { onGranted: open } });
}

/** The screen's own consent sheet or gate closed. */
export function clearLocalPlanSheets(): void {
  set({ localConsent: null, localMealGate: null });
}

// ---------------------------------------------------------------------------
// The outbox banner (3.5)

export function refreshOutbox(): void {
  const items = failedOutboxItems();
  const current = get().failedOutboxItems;
  const same = items.length === current.length && items.every((item, index) => item.id === current[index]?.id && item.kind === current[index]?.kind);
  if (!same) set({ failedOutboxItems: items });
}

/**
 * Marks an outbox item busy for the length of `work`, or answers false when
 * it already is. Save as extra posts the workout again under a NEW key, so a
 * quick double tap would log it twice as two extras; Discard beside it waits
 * too, since the item is mid-post.
 */
async function whileOutboxItemBusy(item: PlanOutboxItem, work: () => Promise<void>): Promise<boolean> {
  if (get().busyOutboxIds.includes(item.id)) return false;
  set({ busyOutboxIds: [...get().busyOutboxIds, item.id] });
  try {
    await work();
  } finally {
    set({ busyOutboxIds: get().busyOutboxIds.filter((id) => id !== item.id) });
  }
  return true;
}

/** "Save as extra": a failed workout reposted with a new key and `asExtra: true` (7.7). */
export async function saveOutboxItemAsExtra(item: PlanOutboxItem): Promise<void> {
  const ran = await whileOutboxItemBusy(item, async () => {
    const source = usePlanBridges.getState().outboxes[item.kind];
    try {
      await source?.saveAsExtra?.(item);
    } catch {
      // Still failed: the banner stays.
    }
    refreshOutbox();
  });
  if (ran) await reloadPlan({ force: true });
}

/** "Discard", after the member confirmed: it throws away something they did. */
export async function discardOutboxItem(item: PlanOutboxItem): Promise<void> {
  const ran = await whileOutboxItemBusy(item, async () => {
    track('outbox_item_discarded', { kind: item.kind });
    const source = usePlanBridges.getState().outboxes[item.kind];
    try {
      await source?.discard(item);
    } catch {
      // Still there: the banner stays.
    }
    refreshOutbox();
  });
  if (ran) await reloadPlan({ force: true });
}

// ---------------------------------------------------------------------------
// Scroll requests

/** Land on a section once it exists (the screen does the scrolling). */
export function requestPlanScroll(anchor: PlanSectionAnchor): void {
  set({ scrollTarget: anchor });
}

/** The screen scrolled (or gave up); a landing on the review moves TalkBack there too. */
export function finishPlanScroll(anchor: PlanSectionAnchor, scrolled: boolean): void {
  if (get().scrollTarget !== anchor) return;
  set({
    scrollTarget: null,
    ...(scrolled && anchor === 'review' ? { reviewFocusNonce: get().reviewFocusNonce + 1 } : {}),
  });
}

// ---------------------------------------------------------------------------
// Parked actions (ios-ux.md 0.3)

function actionContext(): PlanActionContext {
  const app = useAppStore.getState();
  const store = useHealthStore.getState();
  return {
    access: app.healthAccess,
    accessKnown: app.healthAccessOverride !== null || (app.profile !== null && app.healthAccess !== 'unknown'),
    hasConsent: selectHasHealthConsent(app),
    hasProfile: app.profile !== null,
    loadState: store.loadState,
    todaySessionId: store.today?.day?.session?.id ?? null,
  };
}

/**
 * Take whatever another screen or a notification parked for Plan, and clear
 * it there at once: a flag that is written and never read sits there for
 * the rest of the session and fires late, against a session that may not be
 * today's any more. The action is held HERE until the screen can answer it.
 */
export function consumePendingPlanAction(now: number = Date.now()): void {
  const taken = useIntentStore.getState().takePlanAction(now);
  if (taken) set({ parked: taken });
  deliverParkedPlanAction(now);
}

/** Perform the held action once the read that answers it has landed; drop it after five minutes. */
export function deliverParkedPlanAction(now: number = Date.now()): void {
  const parked = get().parked;
  if (!parked) return;
  if (isParkedActionExpired(parked.parkedAt, now)) {
    set({ parked: null });
    return;
  }
  if (!canAnswerPlanAction(parked.action, parked.parkedAt, actionContext())) return;
  set({ parked: null });
  perform(parked.action);
}

function perform(action: PlanAction): void {
  const app = useAppStore.getState();
  const store = useHealthStore.getState();
  switch (action.kind) {
    case 'startWorkout': {
      // From the cached or in-memory day, before any network, and only for
      // today's planned session. A session that changed since is Save's
      // business, not a reason to refuse.
      const session = store.today?.day?.session;
      if (
        session &&
        session.id === action.sessionId &&
        session.scheduledFor === todayServerDay() &&
        (session.status ?? 'planned') === 'planned' &&
        app.healthAccess === 'entitled'
      ) {
        void presentPlanRunner(session);
      }
      return;
    }
    case 'openWeeklyCheckIn': {
      // The sheet when it is still due, otherwise the review card: a member
      // who checked in on the web an hour ago lands on the week they asked
      // for. ENTITLEMENT FIRST: a past_due or lapsed member who walked
      // through the notification would type a weight and meet a silent 403;
      // they get the week they already have instead.
      const open = usePlanBridges.getState().weeklyCheckIn;
      if (store.today?.checkIn?.due === true && app.healthAccess === 'entitled' && open) {
        open('notification');
      } else {
        requestPlanScroll('review');
      }
      return;
    }
    case 'openDiary':
      pushPlanRoute('Diary', { date: action.date });
      return;
    case 'showAdoptedBanner':
      set({
        adoptedBanner: { startsOn: action.startsOn },
        adoptedBannerShown: true,
        // The proposal in the store is the one just adopted; its card stays
        // off screen until the read below replaces it with the plan.
        adoptedProposalId: store.today?.proposal?.program.id ?? null,
        adoptedAt: Date.now(),
      });
      // The adopt set the programme on the server; Plan's own day, week and
      // upcoming come from this read (its freshness window would skip it).
      void reloadPlan({ force: true });
      return;
    case 'openProposal': {
      const proposal = store.today?.proposal;
      if (proposal && selectHasLiveProgram(store)) {
        pushPlanRoute('ProgramOverview', { programId: proposal.program.id, mode: 'proposal' });
      }
      return;
    }
    case 'openPastPlans':
      pushPlanRoute('WorkoutHistory', { segment: 'pastPlans' });
      return;
    case 'openDraft':
      pushPlanRoute('MealEditor', { mode: 'stored', mealId: action.mealId });
      return;
    case 'openFeedback':
      void openFeedback(action.reportId);
      return;
    case 'openFeedbackNote': {
      const bridge = usePlanBridges.getState().feedback;
      if (!bridge || !supportsFeedbackNow() || !hasConsentNow()) return;
      popPlanToRoot();
      requestPlanScroll('feedback');
      void bridge.refresh(true).catch(() => undefined);
      return;
    }
  }
}

/**
 * A tapped monthly feedback notification (SPEC 9.1): the report it names at
 * once, or, for the pre-scheduled one, the current report once a fresh read
 * says which it is. With none yet, the card and "on its way".
 */
async function openFeedback(reportId: string | null): Promise<void> {
  const bridge = usePlanBridges.getState().feedback;
  if (!bridge || !supportsFeedbackNow() || !hasConsentNow()) return;
  if (reportId) {
    track('feedback_opened', { entry: 'notification' });
    popPlanToRoot();
    pushPlanRoute('FeedbackReport', { reportId });
    void bridge.refresh(true).catch(() => undefined);
    return;
  }
  try {
    await bridge.refresh(true);
  } catch {
    // Decided on what the store has.
  }
  const latest = bridge.latestCurrentReportId();
  if (latest) {
    track('feedback_opened', { entry: 'notification' });
    popPlanToRoot();
    pushPlanRoute('FeedbackReport', { reportId: latest });
  } else {
    requestPlanScroll('feedback');
    useHealthStore.getState().setToast('feedback.detail.pending');
  }
}

// ---------------------------------------------------------------------------
// Appearances

/**
 * The Plan screen came on screen (iOS `onAppear` and `.task`): the adopted
 * banner of the last appearance goes, the bookings hint counts a visit, the
 * strip goes back to today, the day is read (inside its freshness window,
 * for free), and whatever was parked is taken.
 */
export function planDidAppear(): void {
  track('plan_viewed', { state: planSectionAnalyticsState(currentPlanView().section) });
  // Cleared here rather than on a timer, so a member who leaves and comes
  // back does not meet the same congratulation twice.
  if (get().adoptedBannerShown) set({ adoptedBanner: null, adoptedBannerShown: false });
  void countPlanVisit();
  consumePendingPlanAction();
  runPlanTask(get().reloadOnNextFocus);
}

/**
 * The read part of an appearance, also run when the account language
 * changes on screen: the other dates the strip opened are in the old
 * language too, so they go, and the strip starts again from today.
 */
export function runPlanTask(force = false): void {
  const store = useHealthStore.getState();
  store.forgetOtherDays();
  store.setSelectedDate(todayServerDay());
  set({ reloadOnNextFocus: false });
  void reloadPlan({ force }).then(() => consumePendingPlanAction());
}

/**
 * Back from a sheet over Plan (the meal page, the Plans sheet, the runner):
 * iOS's sheets leave Plan where it was, so the strip keeps its day. A page
 * whose close re-reads (`reloadPlanOnNextFocus`) reads now.
 */
export function planReturnedFromSheet(): void {
  // A workout the runner queued offline (iOS `.queued`) is in the banner at once.
  refreshOutbox();
  if (get().reloadOnNextFocus) {
    set({ reloadOnNextFocus: false });
    void reloadPlan({ force: true });
  }
  consumePendingPlanAction();
}

// ---------------------------------------------------------------------------
// "Looking for your bookings?" (R19)

/** At most this many appearances show the hint; 99 means "never again". */
export const BOOKINGS_HINT_VISITS = 3;
const VISITS_NEVER_AGAIN = 99;

/**
 * Counts this appearance and decides the hint: an install that knew Profile
 * as a tab, a member who has not found Profile from Home yet, and no more
 * than three appearances. The x ends it for good (99).
 */
export async function countPlanVisit(): Promise<void> {
  const profileId = useAppStore.getState().profile?.id ?? null;
  if (!profileId) {
    set({ bookingsHintFor: null });
    return;
  }
  try {
    const rawVisits = await AsyncStorage.getItem(planVisitsKey(profileId));
    const seen = Number.parseInt(rawVisits ?? '0', 10) || 0;
    if (seen < VISITS_NEVER_AGAIN) await AsyncStorage.setItem(planVisitsKey(profileId), String(seen + 1));
  } catch {
    // Not counted: the decision below reads what is there.
  }
  await evaluateBookingsHint();
}

/**
 * Decides the hint for the member on screen WITHOUT counting a visit. iOS
 * computes it live, so on a cold launch whose first appearance came before
 * the profile, the hint shows once the profile arrives, and that appearance
 * was never counted (iOS `countPlanVisit` needs the profile too).
 */
export async function evaluateBookingsHint(): Promise<void> {
  const profileId = useAppStore.getState().profile?.id ?? null;
  if (!profileId) {
    set({ bookingsHintFor: null });
    return;
  }
  try {
    const [upgraded, opened, rawVisits] = await Promise.all([
      AsyncStorage.getItem(UPGRADED_FROM_PROFILE_TAB_KEY),
      AsyncStorage.getItem(profileOpenedKey(profileId)),
      AsyncStorage.getItem(planVisitsKey(profileId)),
    ]);
    const visits = Number.parseInt(rawVisits ?? '0', 10) || 0;
    const shows = upgraded === 'true' && opened !== 'true' && visits <= BOOKINGS_HINT_VISITS;
    // The member may have changed while storage answered.
    if (useAppStore.getState().profile?.id !== profileId) return;
    set({ bookingsHintFor: shows ? profileId : null });
  } catch {
    set({ bookingsHintFor: null });
  }
}

/** The hint's x: gone for good for this member. */
export function dismissBookingsHint(): void {
  track('profile_hint_dismissed');
  const profileId = get().bookingsHintFor ?? useAppStore.getState().profile?.id ?? null;
  set({ bookingsHintFor: null });
  if (profileId) AsyncStorage.setItem(planVisitsKey(profileId), String(VISITS_NEVER_AGAIN)).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Reset

/**
 * The health data on this phone was wiped (consent withdrawn on another
 * device, a Kenni check that says under 18, an account deletion): iOS
 * `wipeLocal` sets `planPath = NavigationPath()`, so a Diary, a meal
 * history, a feedback report or the measurements open on Plan's stack close
 * and the gate or the under-18 card shows; nothing keeps drawing what the
 * member just withdrew. Nothing aimed at the wiped day fires later either:
 * no scroll, no held action, no adopt suppression or banner, no failed item
 * from an outbox that is gone (the next refresh reads what is left).
 */
export function planHealthWiped(): void {
  popPlanToRoot();
  set({
    scrollTarget: null,
    parked: null,
    adoptedBanner: null,
    adoptedBannerShown: false,
    adoptedProposalId: null,
    adoptedAt: null,
    failedOutboxItems: [],
  });
}

/** Sign-out and tests: nothing parked, no banner, no member's hint. */
export function resetPlanShell(): void {
  usePlanShell.setState(initialState);
  lastLoadLanguage = null;
}
