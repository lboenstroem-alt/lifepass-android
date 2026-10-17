/**
 * What the phone does around a sign-in, a sign-out and a return to the
 * foreground, as one registry every
 * package adds to and none of them edits: the Android form of what iOS
 * `AppState.handleSignIn` / `handleSignOut` call by name (the Coach's saved
 * chats, the health wipe, the feedback store, the pending routes).
 *
 * Three kinds of hook, each registered under a stable id (registering the
 * same id again replaces it):
 *
 * - SIGN-IN HOOKS run before the app shows the member anything: at a fresh
 *   sign-in and when a stored session is restored at launch
 *   (`restoredSession`), all of them within `SIGN_IN_HOOK_BUDGET_MS`
 *   together. The Coach claims its saved chats here, so a chat saved by
 *   someone else on this phone is gone before the Coach can list it.
 * - PRE-SIGN-OUT HOOKS run while the session still stands, all of them within
 *   `PRE_SIGN_OUT_BUDGET_MS` together (iOS gives a safety food-off the phone
 *   could not send yet one short try). Then the session is ended whatever
 *   they did.
 * - SIGN-OUT CLEANERS run after the session is gone and the app state is
 *   cleared, with `memberId`: the member who just left, captured BEFORE
 *   anything was cleared (the profile's id, else the session's user id, which
 *   is the same id: `profiles.id` is the auth user id). It is often set
 *   although the profile never loaded (an offline cold start), which is
 *   exactly when a wipe keyed on the profile used to leave a member's data
 *   behind. With no id at all, cleaners still run and remove whatever they
 *   can without one.
 *
 * - PROFILE-READ HOOKS run after EVERY successful `GET /profile`, with the
 *   profile, before the app store's read is done (iOS `AppState.loadProfile`
 *   ends with `await health.reconcile(profile:)`): the profile is where the
 *   phone learns that tracking was switched off on the web, or that a Kenni
 *   verification made the member a minor, and what the phone holds is
 *   reconciled here. Awaited (the launch screen waits for them, up to
 *   `PROFILE_READ_HOOK_BUDGET_MS` together), so they do local work only;
 *   network work goes in the background.
 * - ACTIVATION HOOKS run once a member's profile has loaded for the first
 *   time this session, and again every time the app comes back to the
 *   foreground with a member signed in: the workout and meal outboxes flush
 *   here (iOS flushes on every activation, "safe to duplicate": each queued
 *   item carries its own Idempotency-Key).
 *
 * Where to register: each feature in its own `src/features/<area>/register.ts`
 * (pre-created, listed in ./registrations.ts). A foundation package with no
 * feature folder (navigation intents, the health store, the payment
 * in-flight records) registers from its own module, which the app imports
 * at startup anyway.
 *
 * BUDGETS. Every awaited kind has a ceiling, so no package's hook that never
 * settles (a native call that never answers, a stuck file operation) can
 * keep the launch screen up, a member on the sign-in screen, or a sign-out
 * from finishing (a sign-out still waiting is the one the next member's
 * Sign out would join). After the budget the app goes on and the hook keeps
 * running; a hook whose feature must not show anything before it finishes
 * gates that feature on its own completion. iOS awaits only its own local
 * work at these points, so it needs no ceiling.
 *
 * WHEN THE REGISTER FILES LOAD. Not when the app store loads: a register
 * file (or anything it imports, such as src/health) that touched the store
 * at load would find it half-built and crash the app at startup. They load
 * the first time anything here runs (`loadRegistrations`; the store's
 * launch calls it first thing), when every module has finished loading, so
 * a register file may use the store, subscribe to it, or register a Kenni
 * blocker while it loads.
 *
 * Never registered: the installation id (it identifies the phone, not the
 * member, and survives sign-out on purpose).
 */
import type { Profile } from '../api/profile';
import { errorDescription, track } from '../lib/analytics';

export interface SignInContext {
  /** The member's id (lower case). */
  readonly userId: string;
  /**
   * A session restored at launch rather than a sign-in just made. The Coach
   * keeps chats saved before chats had owners only for a restored session.
   */
  readonly restoredSession: boolean;
}

export interface SignOutContext {
  /** Who just signed out, or null when nothing named them. */
  readonly memberId: string | null;
}

export interface ActivationContext {
  /** The signed-in member (lower case). */
  readonly memberId: string;
  /** `profile`: the first profile read of this sign-in; `foreground`: the app came back. */
  readonly trigger: 'profile' | 'foreground';
}

export interface ProfileReadContext {
  /** The member the profile is (lower case; `profiles.id` is the auth user id). */
  readonly memberId: string;
  /** The profile just read, as the app store now holds it. */
  readonly profile: Profile;
}

export type SignInHook = (context: SignInContext) => void | Promise<void>;
export type ActivationHook = (context: ActivationContext) => void | Promise<void>;
export type ProfileReadHook = (context: ProfileReadContext) => void | Promise<void>;
export type PreSignOutHook = (context: SignOutContext) => void | Promise<void>;
export type SignOutCleaner = (context: SignOutContext) => void | Promise<void>;

/** The most the pre-sign-out hooks may hold up a sign-out, together. */
export const PRE_SIGN_OUT_BUDGET_MS = 3_000;

/** The most the sign-in hooks may hold up a sign-in or a launch, together. */
export const SIGN_IN_HOOK_BUDGET_MS = 5_000;

/** The most the profile-read hooks may hold up a profile read (and so the launch screen), together. */
export const PROFILE_READ_HOOK_BUDGET_MS = 5_000;

/**
 * The most a sign-out waits for its cleaners before it is done (the app
 * state is already cleared by then); the cleaners keep running after it.
 */
export const SIGN_OUT_CLEANER_BUDGET_MS = 10_000;

const signInHooks = new Map<string, SignInHook>();
const preSignOutHooks = new Map<string, PreSignOutHook>();
const signOutCleaners = new Map<string, SignOutCleaner>();
const activationHooks = new Map<string, ActivationHook>();
const profileReadHooks = new Map<string, ProfileReadHook>();
const signedOutListeners = new Set<(context: SignOutContext) => void>();

let registrationsLoaded = false;

/**
 * Loads ./registrations.ts (every feature's register file), once. Called by
 * everything below that runs or lists hooks, and by the app store's launch:
 * by then every module has finished loading (see the file comment).
 */
export function loadRegistrations(): void {
  if (registrationsLoaded) return;
  registrationsLoaded = true;
  // A require at first use, not an import: an import would load the register
  // files while their importers (the app store among them) are still loading.
  // ./registrations loads each register file in its own try, so one broken
  // feature file costs only its own hooks; this catch is for the list itself.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./registrations');
  } catch (error) {
    // Never stops launch or a sign-out. Loud in development, a breadcrumb in a release build.
    if (__DEV__ && process.env.NODE_ENV !== 'test') console.error('[signOut] loading the register files failed', error);
    try {
      track('service_error', { op: 'loadRegistrations', error: errorDescription(error) });
    } catch {
      // Nothing more to do.
    }
  }
}

function register<T>(registry: Map<string, T>, id: string, hook: T): () => void {
  registry.set(id, hook);
  return () => {
    if (registry.get(id) === hook) registry.delete(id);
  };
}

/** Runs before the app shows a member who just signed in or was restored. Returns an unregister. */
export function registerSignInHook(id: string, hook: SignInHook): () => void {
  return register(signInHooks, id, hook);
}

/** Runs while the session still stands, within `PRE_SIGN_OUT_BUDGET_MS`. Returns an unregister. */
export function registerPreSignOutHook(id: string, hook: PreSignOutHook): () => void {
  return register(preSignOutHooks, id, hook);
}

/** Runs once the member has signed out, with the id captured first. Returns an unregister. */
export function registerSignOutCleaner(id: string, cleaner: SignOutCleaner): () => void {
  return register(signOutCleaners, id, cleaner);
}

/**
 * Runs after a member's first profile read and on each return to the
 * foreground while signed in (background work: never presents anything).
 * Returns an unregister.
 */
export function registerActivationHook(id: string, hook: ActivationHook): () => void {
  return register(activationHooks, id, hook);
}

/**
 * Runs after every successful profile read, with the profile (local work
 * only: the launch screen waits for it). Returns an unregister.
 */
export function registerProfileReadHook(id: string, hook: ProfileReadHook): () => void {
  return register(profileReadHooks, id, hook);
}

/**
 * Tells a mounted screen the member has signed out (iOS posts
 * `coachSessionsForgotten` for an open Coach screen), after the cleaners ran.
 * Returns an unsubscribe.
 */
export function onSignedOut(listener: (context: SignOutContext) => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

/** The ids registered so far, for tests and for REL-1's "every package registered" check. */
export function registeredHookIds(): {
  signIn: string[];
  preSignOut: string[];
  signOut: string[];
  activation: string[];
  profileRead: string[];
} {
  loadRegistrations();
  return {
    signIn: [...signInHooks.keys()].sort(),
    preSignOut: [...preSignOutHooks.keys()].sort(),
    signOut: [...signOutCleaners.keys()].sort(),
    activation: [...activationHooks.keys()].sort(),
    profileRead: [...profileReadHooks.keys()].sort(),
  };
}

function report(kind: string, id: string, error: unknown): void {
  if (__DEV__ && process.env.NODE_ENV !== 'test') {
    console.warn(`[signOut] ${kind} "${id}" failed`, error);
  }
}

/** Calls `hook` and turns a throw or a rejection into a settled promise. */
function settle<C>(kind: string, id: string, hook: (context: C) => void | Promise<void>, context: C): Promise<void> {
  try {
    return Promise.resolve(hook(context)).catch((error: unknown) => report(kind, id, error));
  } catch (error) {
    report(kind, id, error);
    return Promise.resolve();
  }
}

type Hook<C> = (context: C) => void | Promise<void>;

/**
 * Every hook in `registry`, together, for at most `budgetMs`: after that the
 * caller goes on, the hooks still running keep running, and a development
 * build names them.
 */
async function runAll<C>(kind: string, registry: ReadonlyMap<string, Hook<C>>, context: C, budgetMs: number): Promise<void> {
  if (registry.size === 0) return;
  const running = new Set<string>();
  const all = Promise.all(
    [...registry].map(([id, hook]) => {
      running.add(id);
      return settle(kind, id, hook, context).then(() => {
        running.delete(id);
      });
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overran = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), budgetMs);
  });
  try {
    if (await Promise.race([all.then(() => false), overran])) {
      for (const id of running) report(kind, id, new Error(`still running after ${budgetMs} ms; going on without it`));
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Every sign-in hook, together, for at most `budgetMs`; one that fails does
 * not stop the others or the sign-in.
 */
export async function runSignInHooks(context: SignInContext, budgetMs = SIGN_IN_HOOK_BUDGET_MS): Promise<void> {
  loadRegistrations();
  await runAll('sign-in hook', signInHooks, context, budgetMs);
}

/**
 * Every pre-sign-out hook, together, for at most `budgetMs`: the sign-out
 * goes ahead after that whatever they are still doing.
 */
export async function runPreSignOutHooks(context: SignOutContext, budgetMs = PRE_SIGN_OUT_BUDGET_MS): Promise<void> {
  loadRegistrations();
  await runAll('pre-sign-out hook', preSignOutHooks, context, budgetMs);
}

/**
 * Every cleaner, together (for at most `budgetMs`; one still running goes
 * on), then the signed-out listeners. One that fails does not stop the
 * others: a wipe that stops halfway is the leak it exists to prevent.
 */
export async function runSignOutCleaners(context: SignOutContext, budgetMs = SIGN_OUT_CLEANER_BUDGET_MS): Promise<void> {
  loadRegistrations();
  await runAll('sign-out cleaner', signOutCleaners, context, budgetMs);
  for (const listener of [...signedOutListeners]) {
    try {
      listener(context);
    } catch (error) {
      report('signed-out listener', 'listener', error);
    }
  }
}

/** Every activation hook, together; one that fails does not stop the others. Nothing waits on them. */
export async function runActivationHooks(context: ActivationContext): Promise<void> {
  loadRegistrations();
  await Promise.all([...activationHooks].map(([id, hook]) => settle('activation hook', id, hook, context)));
}

/**
 * Every profile-read hook, together, for at most `budgetMs`; one that fails
 * does not stop the others or the read.
 */
export async function runProfileReadHooks(
  context: ProfileReadContext,
  budgetMs = PROFILE_READ_HOOK_BUDGET_MS,
): Promise<void> {
  loadRegistrations();
  await runAll('profile-read hook', profileReadHooks, context, budgetMs);
}
