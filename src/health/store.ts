/**
 * The one place the app keeps the member's health day: the Android port of
 * iOS ViewModels/HealthStore.swift.
 *
 * Home's Today row, the Plan tab, the Coach, the Scan tab and the reminder
 * planner all read from here. That is the point: today's session has half a
 * dozen states (planned, done, moved away, missed, rest, paused) and two
 * screens each keeping their own copy is two screens that disagree, usually
 * while one of them is mid-request. One store, one read, one truth.
 *
 *   const today = useHealthStore((s) => s.today);
 *   await useHealthStore.getState().load({ force: true });
 *
 * WHAT LIVES ELSEWHERE. The access signal and its 403 override, and the
 * server's feature list, belong to the app store (src/stores/appStore.ts:
 * `healthAccess`, `applyHealthAccessOverride`, `noteServerFeatures`), which
 * reads them off every profile answer; this store feeds them from the Today
 * read and the problem table, as iOS's `HealthStore` does. The reconcile and
 * the sign-out wipe are wired to the app store's hooks in ./register.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { ApiError, foldCode, ProblemError } from '../api';
import { isWearableConnected, type Profile, type ProfileProgramSummary } from '../api/profile';
import { cancelBackgroundTask } from '../background/registry';
import { todayServerDay } from '../i18n/format';
import { track } from '../lib/analytics';
import { removeAllHealthNotifications } from '../notifications/cleanup';
import { useAppStore } from '../stores/appStore';
import type { Lang } from '../i18n';

import { fetchHealthDay } from './api';
import { FeedbackKeys, planIntroCollapsedKey, ReminderKeys, scanMealGateSeenKey, WearableKeys } from './localKeys';
import * as localStore from './localStore';
import {
  decodeHealthDay,
  encodeHealthDay,
  isLiveStatus,
  type HealthDay,
  type HealthProposal,
  type HealthWipeReason,
  type ProgramSummary,
  type SessionBrief,
  type SessionView,
  type WeekView,
} from './models';
import { runHealthWipeHooks } from './wipe';

// ---------------------------------------------------------------------------
// Types

export type HealthLoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly at: Date }
  | { readonly kind: 'failed'; readonly code: string };

/** What a refusal from a health call means for the caller (iOS `HealthProblemOutcome`). */
export type HealthProblemOutcome =
  /** Show the consent sheet: the member just tapped something and is entitled. */
  | 'presentConsent'
  /** A profile read was asked for; `reconcile` decides whether anything is deleted, and says so itself. */
  | 'reconciling'
  /** Local data was deleted by the caller's own action (the in-app withdrawal). Never from a refusal. */
  | 'wiped'
  | 'minor'
  | 'gate'
  | 'pendingDeletion'
  | 'changedElsewhere'
  | 'rateLimited'
  | 'other';

export interface HealthLoadOptions {
  /** A day other than today (`YYYY-MM-DD`); omitted is today. */
  readonly date?: string;
  /** Skip the five-minute freshness check. */
  readonly force?: boolean;
  /** Defaults to the app store's profile. */
  readonly profile?: Profile | null;
  /** Defaults to the app's language. */
  readonly language?: Lang;
}

export interface HealthActionResult {
  readonly session?: SessionView | null;
  readonly changed?: readonly SessionView[] | null;
  readonly week?: WeekView | null;
  readonly upcoming?: readonly SessionBrief[] | null;
}

export interface HealthStoreState {
  /** The last Today read (or the cached one while the network has not answered). */
  readonly today: HealthDay | null;
  /** Other dates the week strip opened, in memory only, at most 14 besides today. */
  readonly days: Readonly<Record<string, HealthDay>>;
  readonly selectedDate: string;
  readonly loadState: HealthLoadState;
  /** What is on screen came off disk and the network has not answered yet. */
  readonly isShowingCache: boolean;
  readonly cachedAt: Date | null;
  /** The last error that was not a cancellation, for the offline and error states. */
  readonly lastError: ApiError | null;
  /** One-shot toast key a screen picks up and clears (the local-wipe notice, "changed on another device"). */
  readonly toastKey: string | null;
  /** Whose data is cached. Set on every load and reconcile, used by the wipe. */
  readonly profileId: string | null;
}

export interface HealthStoreActions {
  /** Render the cache, then read. Never throws. */
  load(options?: HealthLoadOptions): Promise<void>;
  /** Drop every remembered date but today's (a language change: their server copy is in the old one). */
  forgetOtherDays(): void;
  /** Patch today's session, week and upcoming from an action's answer, without a second read. */
  applyActionResult(result: HealthActionResult): void;
  /** An action's answer about a row on another date the store already holds. */
  applySessionsToOtherDays(sessions: readonly SessionView[]): void;
  /** What every health call does with a refusal (see the method). */
  handle(error: unknown, options: { foreground: boolean }): HealthProblemOutcome;
  /** Bring this phone back in line with what the profile says (after every profile read). */
  reconcile(profile: Profile): Promise<void>;
  /** Remove every trace of health data this phone holds for a member. */
  wipeLocal(options: { profileId?: string | null; reason: HealthWipeReason }): Promise<void>;
  setSelectedDate(date: string): void;
  setToast(key: string | null): void;
}

export type HealthStore = HealthStoreState & HealthStoreActions;

// ---------------------------------------------------------------------------
// Constants

/** How many other dates stay in memory. Each carries a week, meals, scores and histories. */
export const MAX_REMEMBERED_DAYS = 14;
/** How long a Today read stays fresh before a tab re-entry re-reads it. */
export const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** The problems that mean "this was changed on another device" (iOS `handle`). */
export const CHANGED_ELSEWHERE_PROBLEMS: readonly string[] = [
  'health_measurement_deleted',
  'health_program_deleted',
  'health_meal_deleted',
  'program_action_not_allowed',
  'session_action_not_allowed',
  'meal_changed',
  'health_program_not_found',
  'health_session_not_found',
  'health_meal_not_found',
  'health_measurement_not_found',
];

// ---------------------------------------------------------------------------
// Pure helpers

/** `day` with an action's week, upcoming rows and session (iOS `HealthDay.rebuilt`). */
export function replacingInDay(
  day: HealthDay,
  patch: { week?: WeekView | null; upcoming?: readonly SessionBrief[] | null; session?: SessionView | null },
): HealthDay {
  const newDay = patch.session && day.day ? { ...day.day, session: patch.session } : day.day;
  return {
    ...day,
    week: patch.week ?? day.week,
    upcoming: patch.upcoming ?? day.upcoming,
    day: newDay,
  };
}

/** Today plus the most recent `MAX_REMEMBERED_DAYS` other dates, by date. */
export function evictOldDays(days: Readonly<Record<string, HealthDay>>, today: string): Record<string, HealthDay> {
  const others = Object.keys(days).filter((date) => date !== today);
  if (Object.keys(days).length <= MAX_REMEMBERED_DAYS + 1) return { ...days };
  const keep = new Set(others.sort().reverse().slice(0, MAX_REMEMBERED_DAYS));
  const kept: Record<string, HealthDay> = {};
  for (const [date, value] of Object.entries(days)) {
    if (date === today || keep.has(date)) kept[date] = value;
  }
  return kept;
}

/**
 * What this phone knows about the goal of the plan that is running (iOS
 * `HealthStore.LivePlanGoal`). Only the Today read carries a plan's goal; the
 * profile's plan summary says whether a plan is live but not what it is for.
 * So when the profile says a plan is live and the Today read has not loaded,
 * failed, or names a different plan, the goal is `unknown`, and the target
 * weight screens treat that as "it may take a target": keep the stored
 * target, show the field, let the server decide.
 */
export type LivePlanGoal =
  | { readonly kind: 'noLivePlan' }
  /** A live plan, and the Today read gives its goal (null: a goal this build does not know). */
  | { readonly kind: 'known'; readonly goal: string | null }
  | { readonly kind: 'unknown' };

const PROGRAM_GOALS: readonly string[] = ['lose_weight', 'gain_weight', 'build_muscle', 'get_fitter'];

export function livePlanGoal(
  dayProgram: Pick<ProgramSummary, 'id' | 'status' | 'goal'> | null | undefined,
  profileProgram: Pick<ProfileProgramSummary, 'id' | 'status'> | null | undefined,
): LivePlanGoal {
  const profileLive = isLiveStatus(profileProgram?.status ?? null);
  if (dayProgram && isLiveStatus(dayProgram.status) && (!profileLive || profileProgram?.id === dayProgram.id)) {
    const goal = dayProgram.goal && PROGRAM_GOALS.includes(dayProgram.goal) ? dayProgram.goal : null;
    return { kind: 'known', goal };
  }
  return profileLive ? { kind: 'unknown' } : { kind: 'noLivePlan' };
}

/** A target could be serving this plan: its goal loses or gains weight, or is not known here. */
export function mayTakeTarget(goal: LivePlanGoal): boolean {
  switch (goal.kind) {
    case 'noLivePlan':
      return false;
    case 'known':
      return goal.goal === 'lose_weight' || goal.goal === 'gain_weight';
    case 'unknown':
      return true;
  }
}

// ---------------------------------------------------------------------------
// The store

/** Which read is the current one: an older answer is dropped rather than overwriting a newer day. */
let loadGeneration = 0;

/**
 * How many wipes have run. A load takes it BEFORE its first await and gives
 * up when it has moved: a wipe (a sign-out, a withdrawal, a minor) that runs
 * while the cache is being read leaves `profileId` as it was and `today`
 * null, so without this the load would put the wiped member's cached day
 * back on screen after the wipe, and its own read (started on a generation
 * taken after the wipe) would rewrite today.json for them. iOS has the same
 * window (`load` sets `today` straight after `await readCache()`); the
 * Android wipe closes it.
 */
let wipeEpoch = 0;

/** Every read in flight, cache or network, is for data that is about to be gone. */
function invalidateReads(): void {
  loadGeneration += 1;
  wipeEpoch += 1;
}

function initialState(): HealthStoreState {
  return {
    today: null,
    days: {},
    selectedDate: todayServerDay(),
    loadState: { kind: 'idle' },
    isShowingCache: false,
    cachedAt: null,
    lastError: null,
    toastKey: null,
    profileId: null,
  };
}

async function removeKeys(keys: readonly string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...keys]);
  } catch {
    // The next wipe tries again.
  }
}

async function readKey(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The wearable marker and its anchors go (iOS `tearDownAppleHealthMarker`).
 * `profileId` is passed in rather than read off the store: sign-out captures
 * the id BEFORE it clears anything, and the anchors are keyed by it.
 */
async function tearDownWearableMarker(profileId: string): Promise<void> {
  const index = await readKey(WearableKeys.anchorIndex(profileId));
  let types: string[] = [];
  try {
    const parsed: unknown = index ? JSON.parse(index) : [];
    if (Array.isArray(parsed)) types = parsed.filter((type): type is string => typeof type === 'string');
  } catch {
    types = [];
  }
  await removeKeys([
    WearableKeys.connectedProfileId,
    WearableKeys.anchorIndex(profileId),
    ...types.map((type) => WearableKeys.anchor(profileId, type)),
  ]);
}

/** The feedback's flags (a sign-out keeps only a pending safety food-off) and the member the background check reads for. */
async function removeFeedbackKeys(profileId: string, reason: HealthWipeReason): Promise<void> {
  const kept = new Set(reason === 'signout' ? FeedbackKeys.keptOnSignOut(profileId) : []);
  await removeKeys([...FeedbackKeys.all(profileId).filter((key) => !kept.has(key)), FeedbackKeys.lastProfileId]);
}

export const useHealthStore = create<HealthStore>()((set, get) => {
  async function readCache(profileId: string): Promise<HealthDay | null> {
    const cached = await localStore.read('today', profileId, decodeHealthDay);
    // A cache from a previous day is history, not today: showing it would put
    // yesterday's session under a "Today" heading.
    if (!cached || cached.date !== todayServerDay()) return null;
    return cached;
  }

  function writeCache(day: HealthDay): void {
    const { profileId } = get();
    if (!profileId || day.date !== todayServerDay()) return;
    // Fire and forget: the server is the record, and the next read rewrites it.
    void localStore.write(encodeHealthDay(day), 'today', profileId);
  }

  function apply(day: HealthDay, isToday: boolean): void {
    // Every Today read says what the server supports, whatever its date.
    useAppStore.getState().noteServerFeatures(day.features);
    const today = todayServerDay();
    const days = evictOldDays({ ...get().days, [day.date]: day }, today);
    if (isToday) {
      set({ today: day, days, cachedAt: new Date() });
      writeCache(day);
    } else {
      set({ days });
    }
  }

  async function hasLocalState(profileId: string): Promise<boolean> {
    if (await localStore.profileFolderExists(profileId)) return true;
    if ((await readKey(WearableKeys.connectedProfileId)) === profileId) return true;
    if ((await readKey(FeedbackKeys.lastProfileId)) === profileId) return true;
    return (await readKey(ReminderKeys.workoutDay(profileId))) !== null;
  }

  return {
    ...initialState(),

    async load(options = {}) {
      const app = useAppStore.getState();
      const profile = options.profile === undefined ? app.profile : options.profile;
      const language = options.language ?? app.language;
      const todayKey = todayServerDay();
      const wanted = options.date ?? todayKey;
      const isToday = wanted === todayKey;
      set({ profileId: profile?.id ?? null });
      const profileId = profile?.id ?? null;
      const epoch = wipeEpoch;

      if (isToday && get().today === null && profileId) {
        const cached = await readCache(profileId);
        // Read BEFORE the check below, so no await sits between the check
        // and the write.
        const at = cached ? await localStore.modifiedAt('today', profileId) : null;
        // A wipe ran while the disk was read: what was read is gone, and so
        // is the member this load was for. No cache, and no network read.
        if (epoch !== wipeEpoch) return;
        if (cached && get().today === null && get().profileId === profileId) {
          useAppStore.getState().noteServerFeatures(cached.features);
          set({ today: cached, isShowingCache: true, cachedAt: at });
        }
      }

      const state = get().loadState;
      if (!options.force && isToday && state.kind === 'loaded' && Date.now() - state.at.getTime() < FRESHNESS_WINDOW_MS) {
        return;
      }

      loadGeneration += 1;
      const generation = loadGeneration;
      set({ loadState: { kind: 'loading' } });
      try {
        const day = await fetchHealthDay({ date: isToday ? null : wanted, language });
        // A slower read started earlier must not land on top of a newer one
        // and rewrite today.json with a stale day.
        if (generation !== loadGeneration) return;
        apply(day, isToday);
        set({ loadState: { kind: 'loaded', at: new Date() }, lastError: null, isShowingCache: false });
        useAppStore.getState().clearHealthAccessOverride();
      } catch (error) {
        if (error instanceof ApiError) {
          // A screen the member dismissed mid-request is not an outage.
          if (error.isCancellation || generation !== loadGeneration) return;
          set({ lastError: error, loadState: { kind: 'failed', code: foldCode(error.code) } });
          get().handle(error, { foreground: true });
          return;
        }
        if (generation !== loadGeneration) return;
        set({ loadState: { kind: 'failed', code: 'unknown' } });
      }
    },

    forgetOtherDays() {
      const today = todayServerDay();
      const kept: Record<string, HealthDay> = {};
      const current = get().days[today];
      if (current) kept[today] = current;
      set({ days: kept });
    },

    applyActionResult({ session, changed, week, upcoming }) {
      const current = get().today;
      if (!current) return;
      let rebuilt = replacingInDay(current, { week, upcoming });
      if (session && session.scheduledFor === current.date) {
        rebuilt = replacingInDay(rebuilt, { session });
      } else {
        const replacement = changed?.find((row) => row.scheduledFor === current.date);
        if (replacement) rebuilt = replacingInDay(rebuilt, { session: replacement });
      }
      // Plan draws `days[selectedDate] ?? today`, and a read of today fills
      // BOTH: updating only `today` left the page drawing the day as it was
      // before the action until the next read.
      const days = get().days[rebuilt.date] ? { ...get().days, [rebuilt.date]: rebuilt } : get().days;
      set({ today: rebuilt, days });
      writeCache(rebuilt);
    },

    applySessionsToOtherDays(sessions) {
      let { today, days } = get();
      let changedDays = false;
      for (const session of sessions) {
        const date = session.scheduledFor;
        if (!date) continue;
        const remembered = days[date];
        if (remembered && remembered.day?.session?.id === session.id) {
          days = { ...days, [date]: replacingInDay(remembered, { session }) };
          changedDays = true;
        }
        // Plan falls back to `today` when the date has no read of its own.
        if (today && today.date === date && today.day?.session?.id === session.id) {
          today = replacingInDay(today, { session });
        }
      }
      set({ today, ...(changedDays ? { days } : {}) });
    },

    /**
     * What every health call does with a refusal, in one place so two screens
     * cannot answer the same problem differently.
     *
     * `foreground` is the whole distinction that matters for consent: a
     * member who just tapped something gets the consent sheet; an outbox
     * flush or a background job NEVER presents a sheet. Popping a consent
     * sheet over whatever screen happens to be open because a background
     * upload failed is how a privacy prompt becomes noise people dismiss.
     */
    handle(error, { foreground }) {
      if (!(error instanceof ProblemError)) return 'other';
      const problem = error;
      const is = (...slugs: string[]): boolean => problem.isProblem(...slugs);
      const app = useAppStore.getState();
      if (is('health_consent_required')) {
        const entitled = (get().today?.access ?? app.healthAccess) === 'entitled';
        if (foreground && app.healthAccessOverride === null && entitled) return 'presentConsent';
        // RECONCILE, not wipe. `reconcile` deletes only when the server
        // actually says consent is gone, and does nothing when the profile
        // block is unreadable. Wiping straight off a 409 deletes the whole
        // profile folder, the workout and meal outboxes included, so one
        // refusal would destroy an unsent workout or meal.
        void app.loadProfile();
        return 'reconciling';
      }
      if (is('health_minor_blocked')) {
        void get().wipeLocal({ reason: 'minor' });
        return 'minor';
      }
      if (is('no_active_plan_or_pass')) {
        app.applyHealthAccessOverride(problem.details.memberPricing);
        return 'gate';
      }
      if (is('account_pending_deletion')) return 'pendingDeletion';
      if (is(...CHANGED_ELSEWHERE_PROBLEMS)) {
        set({ toastKey: 'health.err.changed' });
        return 'changedElsewhere';
      }
      if (is('rate_limited')) {
        set({ toastKey: 'health.err.rate_limited' });
        return 'rateLimited';
      }
      return 'other';
    },

    /**
     * The case this exists for: a member withdraws consent on the web, or a
     * Kenni verification shows they are under 18. The phone still holds their
     * cached day and their outboxes, and nothing on it would ever ask again.
     * So every profile read checks, and wipes. It NEVER presents the consent
     * sheet: a member who switched tracking off somewhere else is telling us
     * no, and answering that by asking again is the opposite of honouring it.
     */
    async reconcile(profile) {
      const id = profile.id;
      set({ profileId: id });
      // 1. The block failed to load. Do nothing: an unreadable garnish is not
      //    evidence that consent was withdrawn, and wiping on it would destroy
      //    a member's queued workout because of a server hiccup.
      const health = profile.health;
      if (!health) return;
      useAppStore.getState().clearHealthAccessOverride();

      // 2. Consent is gone, or the member is a verified minor.
      const consentGone = health.consent === null || health.access === 'minor';
      if (consentGone && (await hasLocalState(id))) {
        await get().wipeLocal({ profileId: id, reason: health.access === 'minor' ? 'minor' : 'withdrawn_elsewhere' });
        set({ toastKey: 'health.consent_off_elsewhere' });
        return;
      }

      // 3. A wearable was disconnected elsewhere while this phone still
      //    thinks it is the connected one: tear down the marker only.
      if (!isWearableConnected(health.appleHealth) && (await readKey(WearableKeys.connectedProfileId)) === id) {
        await tearDownWearableMarker(id);
      }
    },

    /**
     * Called on sign-out, on withdrawal here or elsewhere, when a member turns
     * out to be a minor, and when an account deletion is requested. The order
     * matters: stop what could write (the background task, notifications),
     * delete, reset memory, then tell everyone else (./wipe.ts hooks: the
     * Coach drops its health messages, the feedback its summary).
     */
    async wipeLocal({ profileId: explicitId, reason }) {
      const id = explicitId ?? get().profileId;
      if (!id) return;
      // A read still in flight is for data that is about to be gone.
      invalidateReads();
      const work = Promise.all([
        cancelBackgroundTask(),
        removeAllHealthNotifications(),
        tearDownWearableMarker(id),
        localStore.deleteProfileFolder(id),
        localStore.clearExports(),
        removeKeys([...ReminderKeys.all(id), scanMealGateSeenKey(id), planIntroCollapsedKey(id)]),
        removeFeedbackKeys(id, reason),
      ]);
      set({
        today: null,
        days: {},
        selectedDate: todayServerDay(),
        loadState: { kind: 'idle' },
        isShowingCache: false,
        cachedAt: null,
        lastError: null,
      });
      useAppStore.getState().clearHealthAccessOverride();
      await work;
      await runHealthWipeHooks({ profileId: id, reason });
      track('health_local_wiped', { reason });
    },

    setSelectedDate(date) {
      set({ selectedDate: date });
    },

    setToast(key) {
      set({ toastKey: key });
    },
  };
});

// ---------------------------------------------------------------------------
// Selectors

export const selectProposal = (s: HealthStoreState): HealthProposal | null => s.today?.proposal ?? null;
export const selectHasActiveProgram = (s: HealthStoreState): boolean => s.today?.program?.status === 'active';
export const selectHasLiveProgram = (s: HealthStoreState): boolean => isLiveStatus(s.today?.program?.status ?? null);

/**
 * At a sign-out that names nobody (no profile, no session user, no id the
 * store or the wearable marker last knew): the health notifications, the
 * feedback's member and the background task still go (iOS `handleSignOut`).
 */
export async function wipeWithoutMember(): Promise<void> {
  // A read in flight is for the member who left, whoever that was. Memory
  // goes at once, as in `wipeLocal`, not after the awaits below.
  invalidateReads();
  const work = Promise.all([
    removeAllHealthNotifications(),
    removeKeys([FeedbackKeys.lastProfileId]),
    cancelBackgroundTask(),
  ]);
  useHealthStore.setState({
    today: null,
    days: {},
    selectedDate: todayServerDay(),
    loadState: { kind: 'idle' },
    isShowingCache: false,
    cachedAt: null,
    lastError: null,
  });
  await work;
  await runHealthWipeHooks({ profileId: null, reason: 'signout' });
}

/** The member a sign-out wipe is for: the one the sign-out named, else the store's, else the wearable marker's. */
export async function memberForSignOutWipe(memberId: string | null): Promise<string | null> {
  return memberId ?? useHealthStore.getState().profileId ?? (await readKey(WearableKeys.connectedProfileId));
}

/** Tests: back to a fresh launch (nothing stored is touched). */
export function resetHealthStoreForTests(): void {
  invalidateReads();
  useHealthStore.setState(initialState());
}
