/**
 * The app's state: the Android port of iOS `AppState` (App/AppState.swift).
 * One store owns who is signed in, their profile and plan, the language the
 * app speaks, what the server supports, the health access signal, and the
 * session lifecycle around them. Screens read it with `useAppStore(selector)`;
 * code outside React with `useAppStore.getState()`.
 *
 * THE LIFECYCLE, as iOS runs it:
 *
 * - `bootstrap()` (iOS `checkSession`) runs once at launch while
 *   `isLoading` shows the launch screen. A stored session is restored, its
 *   Coach chats claimed, the plan read in the background, and the profile
 *   read AWAITED before the launch screen goes. An offline cold start (or a
 *   failing auth server) with an expired access token is NOT signed out: the
 *   refresh token is still on the phone, so the member stays in the app on
 *   the stored session and the reads retry as screens appear. Only a missing
 *   stored session means signed out.
 * - `handleSignIn(userId)` after a sign-in: claims, forgets the cached
 *   account language (it may be a different member), reads the profile, and
 *   arms the Kenni nudge unless this is a password-recovery sign-in.
 * - `signOut()` gives the pre-sign-out hooks a short try, ends the session
 *   (locally too when the auth server cannot be reached: an offline sign-out
 *   still signs out), and `handleSignOut()` clears the state and runs every
 *   sign-out cleaner with the member's id, captured before anything is
 *   cleared, so the wipe works even when the profile never loaded.
 * - One auth listener for the life of the app: SIGNED_OUT runs
 *   `handleSignOut` (once), USER_UPDATED re-reads the profile, a refreshed
 *   token replaces the session. A SIGNED_IN that nobody announced (an auth
 *   link, the first build's sign-in screens) runs `handleSignIn`.
 *
 * Each sign-in and sign-out starts a new GENERATION: an answer that arrives
 * after the member it was read for has left is dropped, so one member's
 * profile never lands under the next.
 *
 * THE LANGUAGE (iOS `AppState.language`): the profile's `locale`; else, while
 * signed in, the account language cached at the last profile read on this
 * phone (`account.language`, so an offline read at the gym door stays
 * Icelandic); else the device's. A signed-out phone always follows the
 * device, whoever was signed in last. Kept in step with src/i18n's
 * `currentLanguage` on every change, so text built outside React (errors,
 * notifications) speaks it too.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import { onRefreshTrouble } from '../api/authFetch';
import { LOGOUT_WAIT_MS, supabaseSessionDeps } from '../api/client';
import { deviceDisconnected } from '../api/connectivity';
import {
  activePasses,
  fetchProfile,
  healthBlockWithConsent,
  replacingHealth,
  setProfileLocale,
  withHealthConsent,
  withHealthDataDeleted,
  type ActivePass,
  type HealthAccess,
  type HealthConsent,
  type Profile,
  type Usage,
} from '../api/profile';
import {
  fetchActiveSubscription,
  isSubscriptionActive,
  isSubscriptionPastDue,
  planDisplayName,
  type Subscription,
} from '../api/subscriptions';
import { wireId } from '../api/wire';
import '../app/registrations';
import { runActivationHooks, runPreSignOutHooks, runSignInHooks, runSignOutCleaners } from '../app/signOut';
import { fixtureProfile, FIXTURE_PROFILE_ID, requestedFixtureState } from '../dev/fixtureSession';
import { deviceLanguage, normaliseLang, setCurrentLanguage, type Lang } from '../i18n';
import { errorDescription, track } from '../lib/analytics';
import { readStoredSession } from '../lib/secureSessionStorage';
import { SUPABASE_STORAGE_KEY, supabase } from '../supabase/lib/client';

// ---------------------------------------------------------------------------
// Keys and limits

/** The account language as last read on this phone (iOS `AppState.accountLanguageKey`). */
export const ACCOUNT_LANGUAGE_KEY = 'account.language';

/** The Kenni nudge was closed once on this phone; it never fires again here. */
export const KENNITALA_PROMPT_DISMISSED_KEY = 'kennitalaPromptDismissed';

/** The sign-up nudge is for fresh accounts only: 48 hours. */
export const KENNITALA_PROMPT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * How long launch waits for the session before trusting the stored one, if
 * no failed refresh was reported sooner (iOS rides the 60 s URLSession
 * default; ./authFetch gives each auth request the same ceiling).
 */
export const SESSION_RESTORE_CEILING_MS = 60_000;

/** The server's optional features (`health.features` and friends). */
export const ServerFeature = {
  targetWeight: 'target_weight',
  planRevision: 'plan_revision',
  feedback: 'health_feedback',
  mealDescribe: 'meal_describe',
} as const;

// ---------------------------------------------------------------------------
// State

export interface AppStoreState {
  /** The Supabase session (possibly an expired one restored offline). */
  readonly session: Session | null;
  /** The signed-in member's id, lower case; set before the profile loads. */
  readonly userId: string | null;
  readonly isAuthenticated: boolean;
  /** True from launch until the session is resolved and the first profile read has answered. */
  readonly isLoading: boolean;
  /** `GET /profile`; null until it loads. A failed read keeps the last one. */
  readonly profile: Profile | null;
  /**
   * When the read behind `profile` was SENT, not when it answered. The Coach
   * compares it with the counts its own answers carried.
   */
  readonly profileReadAt: Date | null;
  /** The recurring plan. A failed read KEEPS it; only a successful "no plan" clears it. */
  readonly subscription: Subscription | null;
  /** A `GET /subscriptions` has answered this session: a null plan means "no plan", not "not read yet". */
  readonly subscriptionLoaded: boolean;
  /** `profiles.locale` as last read on this phone; consulted only while signed in. */
  readonly cachedAccountLanguage: Lang | null;
  /** The language the app speaks (see the file comment). */
  readonly language: Lang;
  /**
   * What the server supports beyond the base contract: the last `features`
   * an answer carried (last writer wins; an answer without the key empties
   * it, so a rollback hides the UI). Not health data: no wipe touches it.
   */
  readonly serverFeatures: readonly string[];
  /** The health access signal (`resolveHealthAccess`). */
  readonly healthAccess: HealthAccess;
  /** Set from a 403 `no_active_plan_or_pass` until the next read that can answer it. */
  readonly healthAccessOverride: HealthAccess | null;
  /** An auth link that could not be exchanged; the sign-in screen shows it once. */
  readonly deepLinkError: string | null;
  /** The member arrived by a password-reset link; the set-new-password screen shows. */
  readonly pendingPasswordRecovery: boolean;
  /** The post-sign-up Kenni nudge is due (`evaluateKennitalaPrompt`). */
  readonly pendingKennitalaPrompt: boolean;
}

export interface SignInOptions {
  /**
   * A password-recovery sign-in must not arm the Kenni nudge: its sheet would
   * fight the set-new-password screen.
   */
  readonly suppressKennitalaPrompt?: boolean;
  /** The session the sign-in produced, when the caller has it. */
  readonly session?: Session | null;
}

export interface AppStoreActions {
  /** Launch: restore the session and load the member (iOS `checkSession`). Runs once; later calls share it. */
  bootstrap(): Promise<void>;
  /** After a sign-in (iOS `handleSignIn`). A second call for the same member joins the first. */
  handleSignIn(userId: string, options?: SignInOptions): Promise<void>;
  /** The member's Sign out: pre-sign-out hooks, end the session, then `handleSignOut`. Never throws. */
  signOut(): Promise<void>;
  /** Clears the member's state and runs the sign-out cleaners (iOS `handleSignOut`). */
  handleSignOut(): Promise<void>;
  /** `GET /profile` (iOS `loadProfile`). Never throws; a failure keeps the profile it had. */
  loadProfile(): Promise<void>;
  /** `GET /subscriptions` (iOS `loadSubscription`). Never throws; a failure keeps the plan it had. */
  loadSubscription(): Promise<void>;
  /** Both reads together, after any booking, cancel, check-in, top-up or purchase. */
  refreshCredits(): Promise<void>;
  /** Closing the auto-presented Kenni sheet, verified or not: the nudge fires at most once per phone. */
  dismissKennitalaPrompt(): Promise<void>;
  setDeepLinkError(message: string | null): void;
  setPendingPasswordRecovery(pending: boolean): void;
  /** Record what an answer said the server supports; `null`/`undefined` is an answer WITHOUT the list. */
  noteServerFeatures(features: readonly string[] | null | undefined): void;
  /** A route that should exist answered 404 although its whole list was stale: hide everything. */
  clearServerFeatures(): void;
  /** One route answered 404 although advertised: that feature alone hides until the next list. */
  dropServerFeature(name: string): void;
  /** From a 403 `no_active_plan_or_pass`'s `memberPricing`, so the screen corrects itself at once. */
  applyHealthAccessOverride(memberPricing: string | null | undefined): void;
  clearHealthAccessOverride(): void;
  /** The server CONFIRMED consent is withdrawn: no health data on any screen, before the next read. */
  applyHealthDataDeleted(): void;
  /** The server CONFIRMED a new consent: show it at once, whatever the read after it does. */
  applyHealthConsentGranted(consent: HealthConsent): void;
}

export type AppStore = AppStoreState & AppStoreActions;

// ---------------------------------------------------------------------------
// Derived values

/**
 * The language the app speaks: the profile's `locale`, else (signed in) the
 * cached account language, else the device's.
 */
export function deriveLanguage(
  state: Pick<AppStoreState, 'profile' | 'isAuthenticated' | 'cachedAccountLanguage'>,
  device: Lang = deviceLanguage(),
): Lang {
  const locale = state.profile?.locale;
  if (locale !== null && locale !== undefined) return normaliseLang(locale);
  if (state.isAuthenticated && state.cachedAccountLanguage) return state.cachedAccountLanguage;
  return device;
}

/**
 * What this member may do with the plan and the food log right now. The
 * server decides it (`health.access`); the fallback only covers a server
 * that has not shipped the field or a block that failed to read: dunning,
 * then a tier, then a pass, else no membership.
 *
 * Never derived from `isSubscriptionActive`: that is true in dunning, and a
 * member in dunning is exactly who must NOT be shown a live plan.
 */
export function resolveHealthAccess(
  profile: Profile | null | undefined,
  subscription: Subscription | null | undefined,
  override: HealthAccess | null = null,
): HealthAccess {
  if (override) return override;
  const serverValue = profile?.health?.access;
  if (serverValue && serverValue !== 'unknown') return serverValue;
  if (isSubscriptionPastDue(subscription)) return 'past_due';
  if (profile?.usage?.tier !== null && profile?.usage?.tier !== undefined) return 'entitled';
  if (activePasses(profile).length > 0) return 'pass_only';
  return 'not_member';
}

/** The override a 403 `no_active_plan_or_pass` implies. Never `minor` or `company_inactive` from nothing. */
export function accessOverrideFor(memberPricing: string | null | undefined): HealthAccess {
  switch (memberPricing) {
    case 'company_covered':
      return 'company_inactive';
    case 'pass_holder':
      return 'pass_only';
    default:
      return 'not_member';
  }
}

function uniqueFeatures(features: readonly string[] | null | undefined): readonly string[] {
  return [...new Set(features ?? [])].sort();
}

// Selectors, for `useAppStore(selector)` and `getState()` alike.

export const selectHasActiveSubscription = (s: AppStoreState): boolean => isSubscriptionActive(s.subscription);
export const selectIsPastDue = (s: AppStoreState): boolean => isSubscriptionPastDue(s.subscription);
export const selectPlanName = (s: AppStoreState): string | null =>
  s.subscription ? planDisplayName(s.subscription) : null;
export const selectUsage = (s: AppStoreState): Usage | null => s.profile?.usage ?? null;
export const selectActivePasses = (s: AppStoreState): readonly ActivePass[] => activePasses(s.profile);
export const selectIsKennitalaVerified = (s: AppStoreState): boolean => s.profile?.kennitalaVerified ?? false;
export const selectHasHealthConsent = (s: AppStoreState): boolean => !!s.profile?.health?.consent;
export const selectSupportsTargetWeight = (s: AppStoreState): boolean =>
  s.serverFeatures.includes(ServerFeature.targetWeight);
export const selectSupportsPlanRevision = (s: AppStoreState): boolean =>
  s.serverFeatures.includes(ServerFeature.planRevision);
/** The server advertises the monthly feedback. FEED-1 adds its own stale-flag check on top (iOS `AppState.supportsFeedback`). */
export const selectSupportsFeedback = (s: AppStoreState): boolean => s.serverFeatures.includes(ServerFeature.feedback);
export const selectSupportsMealDescribe = (s: AppStoreState): boolean =>
  s.serverFeatures.includes(ServerFeature.mealDescribe);
/**
 * Whether "has this member bought anything" can be decided: signed out, or
 * both the profile and the plan have been read (iOS
 * `EngagementNotificationService.purchaseStateKnown`). A failed plan read
 * decides nothing.
 */
export const selectPurchaseStateKnown = (s: AppStoreState): boolean =>
  !s.isAuthenticated || (s.subscriptionLoaded && s.profile !== null);

// ---------------------------------------------------------------------------
// Module state: one app, one session lifecycle

/** Bumped on every sign-in and sign-out; work for an older generation is dropped. */
let generation = 0;
let bootstrapPromise: Promise<void> | null = null;
let bootstrapping = false;

interface SignInFlight {
  readonly userId: string;
  readonly generation: number;
  suppressKennitalaPrompt: boolean;
  promise: Promise<void>;
}
let signInFlight: SignInFlight | null = null;

/** The member whose first-profile activation hooks have run this sign-in. */
let activatedFor: string | null = null;

let authListener: { unsubscribe(): void } | null = null;
let appStateListener: NativeEventSubscription | null = null;

/** Things that can hold the Kenni nudge back (a scan link this session: F4's intent store). */
const kennitalaPromptBlockers = new Set<() => boolean>();

/**
 * Registers a check that holds the post-sign-up Kenni nudge back while it
 * answers true. F4's intent store registers "a check-in link arrived this
 * session": never block a member walking up to a door. Returns an unregister.
 */
export function registerKennitalaPromptBlocker(blocker: () => boolean): () => void {
  kennitalaPromptBlockers.add(blocker);
  return () => {
    kennitalaPromptBlockers.delete(blocker);
  };
}

const initialState: AppStoreState = {
  session: null,
  userId: null,
  isAuthenticated: false,
  isLoading: true,
  profile: null,
  profileReadAt: null,
  subscription: null,
  subscriptionLoaded: false,
  cachedAccountLanguage: null,
  language: deviceLanguage(),
  serverFeatures: [],
  healthAccess: 'not_member',
  healthAccessOverride: null,
  deepLinkError: null,
  pendingPasswordRecovery: false,
  pendingKennitalaPrompt: false,
};

// ---------------------------------------------------------------------------
// The store

export const useAppStore = create<AppStore>()((set, get) => {
  /** Reads the cached account language from storage (iOS reads it at `AppState.init`). */
  async function hydrateCachedAccountLanguage(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY);
      set({ cachedAccountLanguage: raw ? normaliseLang(raw) : null });
    } catch {
      // No cache: the device decides until the profile answers.
    }
  }

  async function rememberAccountLanguage(profile: Profile): Promise<void> {
    if (profile.locale === null) return;
    const lang = normaliseLang(profile.locale);
    if (lang === get().cachedAccountLanguage) return;
    set({ cachedAccountLanguage: lang });
    try {
      await AsyncStorage.setItem(ACCOUNT_LANGUAGE_KEY, lang);
    } catch {
      // Kept in memory for this run.
    }
  }

  /** Sign-out, and a fresh sign-in (which may be a different member): the cache is not theirs. */
  async function forgetAccountLanguage(): Promise<void> {
    set({ cachedAccountLanguage: null });
    try {
      await AsyncStorage.removeItem(ACCOUNT_LANGUAGE_KEY);
    } catch {
      // The next sign-out or sign-in tries again.
    }
  }

  async function evaluateKennitalaPrompt(): Promise<void> {
    const profile = get().profile;
    if (!profile || profile.kennitalaVerified || !profile.createdAt) return;
    if (Date.now() - profile.createdAt.getTime() >= KENNITALA_PROMPT_WINDOW_MS) return;
    for (const blocked of kennitalaPromptBlockers) {
      try {
        if (blocked()) return;
      } catch {
        // A blocker that fails blocks nothing.
      }
    }
    let dismissed = false;
    try {
      dismissed = (await AsyncStorage.getItem(KENNITALA_PROMPT_DISMISSED_KEY)) === 'true';
    } catch {
      dismissed = false;
    }
    if (dismissed || get().profile?.id !== profile.id) return;
    set({ pendingKennitalaPrompt: true });
  }

  /**
   * The background activation work for a member, once per sign-in after the
   * first profile read (the outboxes, the nudges).
   */
  function activateOnce(memberId: string): void {
    if (activatedFor === memberId) return;
    activatedFor = memberId;
    void runActivationHooks({ memberId, trigger: 'profile' });
  }

  async function signedIn(session: Session | null, userId: string, restoredSession: boolean, flight?: SignInFlight) {
    const mine = generation;
    const current = get();
    // A different member than the one whose profile is in hand (their
    // session lapsed without a sign-out): nothing of theirs stays on screen.
    const otherMember = current.profile !== null && current.profile.id !== userId;
    set({
      session: session ?? (current.userId === userId ? current.session : null),
      userId,
      ...(otherMember
        ? { profile: null, profileReadAt: null, subscription: null, subscriptionLoaded: false, healthAccessOverride: null }
        : {}),
    });
    await runSignInHooks({ userId, restoredSession });
    if (!restoredSession) await forgetAccountLanguage();
    if (mine !== generation) return;
    set({ isAuthenticated: true });
    void get().loadSubscription();
    await get().loadProfile();
    if (mine !== generation || flight?.suppressKennitalaPrompt) return;
    await evaluateKennitalaPrompt();
  }

  /**
   * The session at launch: supabase-js's own (refreshed when expired), or the
   * stored one when the refresh failed on the way. Waits for the SDK only
   * until the first failed refresh is reported (./authFetch): supabase-js
   * retries a failing refresh for 30 s, iOS fails at the first failure.
   */
  async function restoreSession(): Promise<Session | null> {
    const stored = async (): Promise<Session | null> =>
      (await readStoredSession(SUPABASE_STORAGE_KEY)) as Session | null;
    // No network at all: nothing to ask, and asking would wait out the SDK's retries.
    if (await deviceDisconnected()) return stored();
    const outcome = await new Promise<{ session: Session | null } | { transport: true }>((resolve) => {
      let done = false;
      const finish = (value: { session: Session | null } | { transport: true }) => {
        if (done) return;
        done = true;
        unsubscribe();
        clearTimeout(timer);
        resolve(value);
      };
      const unsubscribe = onRefreshTrouble(() => finish({ transport: true }));
      const timer = setTimeout(() => finish({ transport: true }), SESSION_RESTORE_CEILING_MS);
      supabase.auth.getSession().then(
        ({ data, error }) => {
          if (data.session) finish({ session: data.session });
          // A refresh that failed: the SDK keeps the stored session unless
          // the server refused it, so whatever storage still holds decides.
          else if (error) finish({ transport: true });
          else finish({ session: null });
        },
        () => finish({ transport: true }),
      );
    });
    if ('session' in outcome) return outcome.session;
    return stored();
  }

  /** Development only: a fixture member (src/dev/fixtureSession.ts). */
  function applyFixture(): boolean {
    if (!__DEV__) return false;
    const state = requestedFixtureState();
    if (!state) return false;
    generation += 1;
    set({
      userId: FIXTURE_PROFILE_ID,
      isAuthenticated: true,
      profile: fixtureProfile(state),
      subscription: null,
    });
    return true;
  }

  async function onAuthEvent(event: AuthChangeEvent, session: Session | null): Promise<void> {
    const state = get();
    switch (event) {
      case 'SIGNED_OUT':
        // Once per sign-out: `signOut()` may have run it already.
        if (state.isAuthenticated || state.userId !== null) await state.handleSignOut();
        return;
      case 'USER_UPDATED':
        if (session && state.userId === wireId(session.user.id)) set({ session });
        if (state.isAuthenticated) await state.loadProfile();
        return;
      case 'TOKEN_REFRESHED':
        if (session && state.userId === wireId(session.user.id)) set({ session });
        return;
      case 'SIGNED_IN': {
        if (!session || bootstrapping || state.isLoading) return;
        const userId = wireId(session.user.id);
        if (state.isAuthenticated && state.userId === userId) {
          set({ session });
          return;
        }
        await state.handleSignIn(userId, { session });
        return;
      }
      default:
        return;
    }
  }

  function startAuthListener(): void {
    if (authListener) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // supabase-js awaits this callback while it holds its session lock, so
      // any Supabase call made from inside it (a profile read asks for the
      // token) would wait on itself. The work runs on the next turn instead.
      setTimeout(() => {
        void onAuthEvent(event, session);
      }, 0);
    });
    authListener = data.subscription;
  }

  /**
   * The React Native recipe for supabase-js: refresh the token while the app
   * is on screen, stop while it is not. Each return to the foreground also
   * runs the activation hooks (outbox flushes) for a signed-in member.
   */
  function startForegroundWatch(): void {
    if (appStateListener) return;
    if (AppState.currentState === 'active') void supabase.auth.startAutoRefresh();
    appStateListener = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void supabase.auth.startAutoRefresh();
        const { isAuthenticated, isLoading, profile } = get();
        if (isAuthenticated && !isLoading && profile) {
          void runActivationHooks({ memberId: profile.id, trigger: 'foreground' });
        }
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    });
  }

  /**
   * Ends the Supabase session: everywhere when the auth server answers, else
   * on this phone (supabase-js keeps a session whose logout failed on the
   * way; iOS ends it regardless). The SIGNED_OUT this fires is handled once.
   */
  async function endSession(): Promise<void> {
    if (!(await deviceDisconnected())) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          supabase.auth.signOut(),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), LOGOUT_WAIT_MS);
          }),
        ]);
        if (result && !result.error) return;
      } catch {
        // Fall through to the local end.
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    try {
      await supabaseSessionDeps(supabase).endRevokedSession();
    } catch {
      // The state is cleared by `handleSignOut` either way.
    }
  }

  return {
    ...initialState,

    bootstrap() {
      if (bootstrapPromise) return bootstrapPromise;
      bootstrapPromise = (async () => {
        bootstrapping = true;
        set({ isLoading: true });
        try {
          await hydrateCachedAccountLanguage();
          startAuthListener();
          startForegroundWatch();
          if (applyFixture()) return;
          const session = await restoreSession();
          if (!session) {
            set({ isAuthenticated: false });
            return;
          }
          generation += 1;
          await signedIn(session, wireId(session.user.id), true);
        } catch (error) {
          track('service_error', { op: 'bootstrap', error: errorDescription(error) });
        } finally {
          bootstrapping = false;
          set({ isLoading: false });
        }
      })();
      return bootstrapPromise;
    },

    handleSignIn(rawUserId, options = {}) {
      const userId = wireId(rawUserId);
      if (signInFlight && signInFlight.userId === userId && signInFlight.generation === generation) {
        if (options.suppressKennitalaPrompt) {
          signInFlight.suppressKennitalaPrompt = true;
          set({ pendingKennitalaPrompt: false });
        }
        if (options.session) set({ session: options.session });
        return signInFlight.promise;
      }
      generation += 1;
      const flight: SignInFlight = {
        userId,
        generation,
        suppressKennitalaPrompt: options.suppressKennitalaPrompt === true,
        promise: Promise.resolve(),
      };
      signInFlight = flight;
      flight.promise = signedIn(options.session ?? null, userId, false, flight).catch((error: unknown) => {
        track('service_error', { op: 'handleSignIn', error: errorDescription(error) });
      });
      return flight.promise;
    },

    async signOut() {
      const state = get();
      const memberId = state.profile?.id ?? state.userId;
      await runPreSignOutHooks({ memberId });
      await endSession();
      // The SIGNED_OUT event runs `handleSignOut` too; whichever comes first does it.
      const after = get();
      if (after.isAuthenticated || after.userId !== null) await after.handleSignOut();
    },

    async handleSignOut() {
      // The id BEFORE anything is cleared: the profile often never loaded (an
      // offline cold start, a failed read), and the session's user is the
      // same member (`profiles.id` is the auth user id).
      const state = get();
      const memberId = state.profile?.id ?? state.userId ?? null;
      generation += 1;
      signInFlight = null;
      activatedFor = null;
      set({
        session: null,
        userId: null,
        isAuthenticated: false,
        profile: null,
        profileReadAt: null,
        subscription: null,
        subscriptionLoaded: false,
        pendingKennitalaPrompt: false,
        healthAccessOverride: null,
      });
      await Promise.all([forgetAccountLanguage(), runSignOutCleaners({ memberId })]);
    },

    async loadProfile() {
      const mine = generation;
      const sentAt = new Date();
      try {
        let loaded = await fetchProfile();
        if (mine !== generation) return;
        // A new account has no language yet (`profiles.locale` is null until
        // someone sets it), and read as English it would switch an Icelandic
        // sign-up to English at its first read. Record the language the
        // screens have been speaking. Best effort: a failure is tried again at
        // the next read.
        if (loaded.locale === null) {
          const lang = get().language;
          try {
            await setProfileLocale(lang);
            loaded = { ...loaded, locale: lang };
          } catch {
            // Tried again at the next read.
          }
          if (mine !== generation) return;
        }
        const health = loaded.health;
        set({
          profile: loaded,
          profileReadAt: sentAt,
          // What the server supports rides on the health block. A block that
          // failed to read says nothing either way; a readable block without
          // the key is an older server and hides the features. A readable
          // block also answers any access override.
          ...(health ? { serverFeatures: uniqueFeatures(health.features), healthAccessOverride: null } : {}),
        });
        await rememberAccountLanguage(loaded);
        if (mine === generation && get().isAuthenticated) activateOnce(loaded.id);
      } catch (error) {
        if (mine === generation) track('service_error', { op: 'loadProfile', error: errorDescription(error) });
      }
    },

    async loadSubscription() {
      const mine = generation;
      try {
        const subscription = await fetchActiveSubscription();
        if (mine !== generation) return;
        set({ subscription, subscriptionLoaded: true });
      } catch (error) {
        // Keep what we knew. A dropped connection or an unreadable body is not
        // evidence the plan is gone, and clearing it showed a paying member
        // "View plans" with their plan, cancel and billing rows hidden until
        // the next good read.
        if (mine === generation) track('service_error', { op: 'loadSubscription', error: errorDescription(error) });
      }
    },

    async refreshCredits() {
      // Independent reads: their requests overlap.
      await Promise.all([get().loadSubscription(), get().loadProfile()]);
    },

    async dismissKennitalaPrompt() {
      set({ pendingKennitalaPrompt: false });
      try {
        await AsyncStorage.setItem(KENNITALA_PROMPT_DISMISSED_KEY, 'true');
      } catch {
        // It may come back at the next sign-in; nothing worse.
      }
    },

    setDeepLinkError(message) {
      set({ deepLinkError: message });
    },

    setPendingPasswordRecovery(pending) {
      set({ pendingPasswordRecovery: pending });
    },

    noteServerFeatures(features) {
      set({ serverFeatures: uniqueFeatures(features) });
    },

    clearServerFeatures() {
      set({ serverFeatures: [] });
    },

    dropServerFeature(name) {
      set({ serverFeatures: get().serverFeatures.filter((feature) => feature !== name) });
    },

    applyHealthAccessOverride(memberPricing) {
      set({ healthAccessOverride: accessOverrideFor(memberPricing) });
    },

    clearHealthAccessOverride() {
      set({ healthAccessOverride: null });
    },

    applyHealthDataDeleted() {
      const profile = get().profile;
      if (!profile?.health) return;
      set({ profile: replacingHealth(profile, withHealthDataDeleted(profile.health)) });
    },

    applyHealthConsentGranted(consent) {
      const profile = get().profile;
      if (!profile) return;
      const block = profile.health ? withHealthConsent(profile.health, consent) : healthBlockWithConsent(consent);
      set({ profile: replacingHealth(profile, block) });
    },
  };
});

// ---------------------------------------------------------------------------
// Derived state, kept in step on every change (by the store or by a test's setState)

function syncDerived(state: AppStore): void {
  const language = deriveLanguage(state);
  const healthAccess = resolveHealthAccess(state.profile, state.subscription, state.healthAccessOverride);
  if (state.language !== language || state.healthAccess !== healthAccess) {
    useAppStore.setState({ language, healthAccess });
  }
  setCurrentLanguage(language);
}

useAppStore.subscribe(syncDerived);
syncDerived(useAppStore.getState());

// ---------------------------------------------------------------------------
// Tests

/**
 * Back to a fresh launch, as a new process would start: the state, the
 * session lifecycle and the listeners. What is stored (AsyncStorage,
 * SecureStore) is left alone, as it would be across a relaunch. Tests only.
 */
export function resetAppStoreForTests(): void {
  authListener?.unsubscribe();
  authListener = null;
  appStateListener?.remove();
  appStateListener = null;
  void supabase.auth.stopAutoRefresh();
  generation += 1;
  bootstrapPromise = null;
  bootstrapping = false;
  signInFlight = null;
  activatedFor = null;
  kennitalaPromptBlockers.clear();
  useAppStore.setState({ ...initialState, language: deviceLanguage() });
}

/** Reads the cached account language, as a relaunch does before the session (tests). */
export async function hydrateAccountLanguageForTests(): Promise<void> {
  const raw = await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY);
  useAppStore.setState({ cachedAccountLanguage: raw ? normaliseLang(raw) : null });
}
