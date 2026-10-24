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
 *   ON THE PHONE at once (as supabase-swift does, so a missing or slow
 *   network never keeps the member on screen), and `handleSignOut()` clears the
 *   state and runs every sign-out cleaner with the member's id, captured
 *   before anything is cleared, so the wipe works even when the profile
 *   never loaded. The auth server is told afterwards, in the background.
 * - `loadProfile()` runs the profile-read hooks after every successful read
 *   (iOS `health.reconcile(profile:)`), src/app/signOut.ts.
 * - One auth listener for the life of the app: SIGNED_OUT runs
 *   `handleSignOut` (once), USER_UPDATED re-reads the profile, a refreshed
 *   token replaces the session. A SIGNED_IN that nobody announced (an auth
 *   link, the first build's sign-in screens) runs `handleSignIn`. A refresh
 *   that brings back the session of a member who signed out ends it again
 *   (`signedOutMember`).
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
 * notifications) speaks it too, and the device's is read again on every
 * return to the foreground.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import { onRefreshTrouble } from '../api/authFetch';
import { LOGOUT_WAIT_MS } from '../api/client';
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
import {
  loadRegistrations,
  runActivationHooks,
  runPreSignOutHooks,
  runProfileReadHooks,
  runSignInHooks,
  runSignOutCleaners,
} from '../app/signOut';
import { fixtureProfile, FIXTURE_PROFILE_ID, requestedFixtureState } from '../dev/fixtureSession';
import { deviceLanguage, normaliseLang, setCurrentLanguage, type Lang } from '../i18n';
import { errorDescription, track } from '../lib/analytics';
import { readStoredSession } from '../lib/secureSessionStorage';
import { endSessionOnPhone, revokeSessionOnServer, SUPABASE_STORAGE_KEY, supabase } from '../supabase/lib/client';

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
  /** Changing the workout plan by talking to the Coach (OP-58 to OP-62). */
  planEdit: 'plan_edit',
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
  /**
   * A session restored rather than just made (launch does this itself): the
   * cached language is kept and chats saved before chats had owners stay.
   */
  readonly restoredSession?: boolean;
}

export interface AppStoreActions {
  /** Launch: restore the session and load the member (iOS `checkSession`). Runs once; later calls share it. */
  bootstrap(): Promise<void>;
  /**
   * After a sign-in (iOS `handleSignIn`). A call for the same member while
   * their sign-in is still running joins it; once it has finished, a call
   * runs in full again.
   */
  handleSignIn(userId: string, options?: SignInOptions): Promise<void>;
  /**
   * The member's Sign out: pre-sign-out hooks, the session off the phone,
   * then `handleSignOut`; the auth server is told in the background. Never
   * throws; a second call while it runs joins it.
   */
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
 * The server changes plans by chat (`plan_edit`). It advertises it only once
 * the privacy text and the consent line that name it are served, so this
 * alone also says the consent version that names it may be sent.
 */
export const selectSupportsPlanEdit = (s: AppStoreState): boolean => s.serverFeatures.includes(ServerFeature.planEdit);
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
/**
 * A SIGNED_IN that arrived while launch was still deciding (an auth link that
 * cold-started the app, the SDK's own restore): settled once launch is done.
 */
let signInDuringLaunch: Session | null = null;

interface SignInFlight {
  readonly userId: string;
  readonly generation: number;
  suppressKennitalaPrompt: boolean;
  promise: Promise<void>;
}
let signInFlight: SignInFlight | null = null;

/** The member whose first-profile activation hooks have run this sign-in. */
let activatedFor: string | null = null;

/**
 * The member who last signed out in this run, until they sign in again.
 *
 * WHY. supabase-js retries a failing token refresh for up to 30 s, and a
 * refresh that answers AFTER the session was removed saves it back
 * (`_callRefreshToken` stores whatever it gets, then says TOKEN_REFRESHED).
 * A member who signs out offline with an expired token, and gets a signal
 * again within that window, would find their session back on the phone: the
 * next person to open the app would be signed in as them. supabase-swift
 * fails at the first failure, so iOS has no such window. A refreshed session
 * for this member, while they are not the one signed in, is ended again.
 */
let signedOutMember: string | null = null;

/** The member's Sign out while it runs: a second tap joins it rather than start another. */
let signOutFlight: Promise<void> | null = null;

/** The last logout sent to the auth server after a session ended (tests wait on it). */
let serverLogout: Promise<void> | null = null;

/**
 * A development fixture member is standing in (src/dev/fixtureSession.ts):
 * a real session the SDK restores or refreshes meanwhile does not replace
 * them. Only a sign-out (or an explicit sign-in) does.
 */
let fixtureApplied = false;

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
    // Signed in again: a refreshed session of theirs is theirs once more.
    if (signedOutMember === userId) signedOutMember = null;
    // A different member than the one signed in, or than the one whose
    // profile is in hand (an auth link for another account opened on this
    // phone, a session that lapsed without a sign-out): nothing of theirs
    // stays on screen. The member is compared as well as the profile: when
    // their profile never loaded (offline, a failed read) but their plan
    // did, the next member must not be shown that plan. Nor the Kenni nudge
    // armed for the last member's fresh account: this member's own profile
    // decides it again below.
    const otherMember =
      (current.userId !== null && current.userId !== userId) ||
      (current.profile !== null && current.profile.id !== userId);
    set({
      session: session ?? (current.userId === userId ? current.session : null),
      userId,
      ...(otherMember
        ? {
            profile: null,
            profileReadAt: null,
            subscription: null,
            subscriptionLoaded: false,
            healthAccessOverride: null,
            pendingKennitalaPrompt: false,
          }
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

  /**
   * Development only: a fixture member (src/dev/fixtureSession.ts), as iOS
   * `ScreenshotFixtures.apply(to:)` stands one up: signed in, the fixture
   * profile, and no plan, read (a nil plan iOS treats as known). There is no
   * session: the navigator gates on `isAuthenticated` (iOS ContentView does),
   * not on a session object.
   */
  function applyFixture(): boolean {
    if (!__DEV__) return false;
    const state = requestedFixtureState();
    if (!state) return false;
    generation += 1;
    fixtureApplied = true;
    set({
      userId: FIXTURE_PROFILE_ID,
      isAuthenticated: true,
      profile: fixtureProfile(state),
      subscription: null,
      subscriptionLoaded: true,
    });
    return true;
  }

  async function onAuthEvent(event: AuthChangeEvent, session: Session | null): Promise<void> {
    const state = get();
    switch (event) {
      case 'SIGNED_OUT':
        // A real stored session ending is not the fixture member's sign-out
        // (theirs runs `handleSignOut` itself).
        if (fixtureApplied) return;
        // Once per sign-out: `signOut()` may have run it already.
        if (state.isAuthenticated || state.userId !== null) await state.handleSignOut();
        return;
      case 'USER_UPDATED':
        if (session && state.userId === wireId(session.user.id)) set({ session });
        if (state.isAuthenticated) await state.loadProfile();
        return;
      case 'TOKEN_REFRESHED': {
        if (!session) return;
        const refreshed = wireId(session.user.id);
        if (state.userId === refreshed) {
          set({ session });
          return;
        }
        // A refresh that was still retrying when this member signed out has
        // saved their session back (see `signedOutMember`): end it again, on
        // the server too, as the sign-out meant. If another member has signed
        // in since, the session the phone now holds is not theirs either, and
        // the SIGNED_OUT this fires signs them out rather than leave them
        // reading someone else's account. The logout carries the refreshed
        // token (theirs), never the store's (which may be the new member's).
        if (!bootstrapping && refreshed === signedOutMember) await endSession(session.access_token);
        return;
      }
      case 'SIGNED_IN': {
        if (!session || fixtureApplied) return;
        if (bootstrapping) {
          signInDuringLaunch = session;
          return;
        }
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
        // The phone's language may have changed in Settings meanwhile. On
        // Android that recreates the activity but keeps this JS runtime, so
        // nothing else would re-read it (iOS relaunches the app). A member
        // whose profile or cached account language decides is unaffected.
        syncDerived(get());
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
   * Ends the Supabase session in supabase-swift's order: off this phone
   * first (the stored session removed, SIGNED_OUT emitted, handled once),
   * THEN the auth server is told, in the background. Neither a missing or
   * slow network nor a refresh still retrying keeps a member signed in after
   * Log out: supabase-js's own `signOut()` waited behind its session lock and on
   * the server first (10 s offline with an expired token, 20 s with a logout
   * that hung), with the member still on screen the whole time.
   *
   * `accessToken` is the session being ended, for the logout; it is read
   * BEFORE the session goes, from where the SDK stores it (no refresh, no
   * lock). The server's copy of a session already off the phone needs no
   * one to wait for it: offline it is not asked at all, and it expires on
   * its own.
   */
  async function endSession(accessToken: string | null): Promise<void> {
    await endSessionOnPhone();
    if (accessToken) void revokeInBackground(accessToken);
  }

  function revokeInBackground(accessToken: string): Promise<void> {
    const revoke = (async () => {
      if (await deviceDisconnected()) return;
      await revokeSessionOnServer(accessToken, LOGOUT_WAIT_MS);
    })().catch(() => undefined);
    serverLogout = revoke;
    return revoke;
  }

  /** The token of the session on the phone now, read without a refresh; the store's copy otherwise. */
  async function sessionTokenOnPhone(): Promise<string | null> {
    const stored = await readStoredSession(SUPABASE_STORAGE_KEY);
    return stored?.access_token ?? get().session?.access_token ?? null;
  }

  return {
    ...initialState,

    bootstrap() {
      if (bootstrapPromise) return bootstrapPromise;
      bootstrapPromise = (async () => {
        bootstrapping = true;
        set({ isLoading: true });
        try {
          // Every feature's hooks, before the first session decision (they
          // load here, not when this module does: see src/app/signOut.ts).
          loadRegistrations();
          await hydrateCachedAccountLanguage();
          startAuthListener();
          startForegroundWatch();
          // No `return` in here: it would skip the late sign-in below, which
          // matters most when launch found no session at all.
          if (!applyFixture()) {
            const session = await restoreSession();
            if (session) {
              generation += 1;
              await signedIn(session, wireId(session.user.id), true);
            } else {
              set({ isAuthenticated: false });
            }
          }
        } catch (error) {
          track('service_error', { op: 'bootstrap', error: errorDescription(error) });
        } finally {
          bootstrapping = false;
          set({ isLoading: false });
        }
        // Launch decided without it (an auth link that cold-started a
        // signed-out phone, the link's session stored after the read): it is
        // a sign-in like any other. Never over a development fixture.
        const late = signInDuringLaunch;
        signInDuringLaunch = null;
        const state = get();
        if (late && !fixtureApplied && !(state.isAuthenticated && state.userId === wireId(late.user.id))) {
          await state.handleSignIn(late.user.id, { session: late });
        }
      })();
      return bootstrapPromise;
    },

    handleSignIn(rawUserId, options = {}) {
      const userId = wireId(rawUserId);
      // A password-recovery sign-in never shows the nudge, whichever sign-in
      // of this member armed it (the link's own SIGNED_IN may have come first).
      if (options.suppressKennitalaPrompt) set({ pendingKennitalaPrompt: false });
      // The same member's sign-in STILL RUNNING (a screen's call and the
      // SIGNED_IN it produced) is one sign-in. Once it has finished, a new
      // call runs in full, as iOS `handleSignIn` does on every call (an auth
      // link for a member already signed in re-reads the profile and plan).
      if (signInFlight && signInFlight.userId === userId && signInFlight.generation === generation) {
        if (options.suppressKennitalaPrompt) signInFlight.suppressKennitalaPrompt = true;
        if (options.session) set({ session: options.session });
        return signInFlight.promise;
      }
      generation += 1;
      // An explicit sign-in replaces a development fixture.
      fixtureApplied = false;
      const flight: SignInFlight = {
        userId,
        generation,
        suppressKennitalaPrompt: options.suppressKennitalaPrompt === true,
        promise: Promise.resolve(),
      };
      signInFlight = flight;
      flight.promise = signedIn(options.session ?? null, userId, options.restoredSession === true, flight)
        .catch((error: unknown) => {
          track('service_error', { op: 'handleSignIn', error: errorDescription(error) });
        })
        .finally(() => {
          if (signInFlight === flight) signInFlight = null;
        });
      return flight.promise;
    },

    signOut() {
      if (signOutFlight) return signOutFlight;
      const flight = (async () => {
        const state = get();
        const memberId = state.profile?.id ?? state.userId;
        try {
          await runPreSignOutHooks({ memberId });
          // The token while the session still stands, then off the phone at
          // once (iOS: supabase-swift removes the session and emits
          // signedOut, which runs `handleSignOut`, before its logout request).
          await endSession(await sessionTokenOnPhone());
        } catch (error) {
          track('service_error', { op: 'signOut', error: errorDescription(error) });
        }
        // The SIGNED_OUT event runs `handleSignOut` too; whichever comes
        // first does it. Signed out on screen whatever happened above.
        const after = get();
        if (after.isAuthenticated || after.userId !== null) await after.handleSignOut();
      })().finally(() => {
        if (signOutFlight === flight) signOutFlight = null;
      });
      signOutFlight = flight;
      return flight;
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
      fixtureApplied = false;
      if (memberId !== null) signedOutMember = memberId;
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
        // Last, and every time (iOS `await health.reconcile(profile:)`): the
        // profile is where the phone learns that tracking was switched off
        // on the web, or that a Kenni verification made this member a minor,
        // and what the phone still holds is reconciled before anything else
        // reads it. Awaited, so a launch shows nothing before it.
        if (mine !== generation) return;
        await runProfileReadHooks({ memberId: loaded.id, profile: loaded });
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
  signInDuringLaunch = null;
  signInFlight = null;
  signOutFlight = null;
  serverLogout = null;
  fixtureApplied = false;
  activatedFor = null;
  signedOutMember = null;
  kennitalaPromptBlockers.clear();
  useAppStore.setState({ ...initialState, language: deviceLanguage() });
}

/** The logout sent to the auth server after the last session ended, once it has settled (tests). */
export async function serverLogoutSettledForTests(): Promise<void> {
  await serverLogout;
}

/** Reads the cached account language, as a relaunch does before the session (tests). */
export async function hydrateAccountLanguageForTests(): Promise<void> {
  const raw = await AsyncStorage.getItem(ACCOUNT_LANGUAGE_KEY);
  useAppStore.setState({ cachedAccountLanguage: raw ? normaliseLang(raw) : null });
}
