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
 *   (`restoredSession`). The Coach claims its saved chats here, so a chat
 *   saved by someone else on this phone is gone before the Coach can list it.
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
 * - ACTIVATION HOOKS run once a member's profile has loaded for the first
 *   time this session, and again every time the app comes back to the
 *   foreground with a member signed in: the workout and meal outboxes flush
 *   here (iOS flushes on every activation, "safe to duplicate": each queued
 *   item carries its own Idempotency-Key).
 *
 * Where to register: each feature in its own `src/features/<area>/register.ts`
 * (pre-created, imported by ./registrations.ts at startup). A foundation
 * package with no feature folder (navigation intents, the health store, the
 * payment in-flight records) registers from its own module, which the app
 * imports at startup anyway.
 *
 * Never registered: the installation id (it identifies the phone, not the
 * member, and survives sign-out on purpose).
 */

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

export type SignInHook = (context: SignInContext) => void | Promise<void>;
export type ActivationHook = (context: ActivationContext) => void | Promise<void>;
export type PreSignOutHook = (context: SignOutContext) => void | Promise<void>;
export type SignOutCleaner = (context: SignOutContext) => void | Promise<void>;

/** The most the pre-sign-out hooks may hold up a sign-out, together. */
export const PRE_SIGN_OUT_BUDGET_MS = 3_000;

const signInHooks = new Map<string, SignInHook>();
const preSignOutHooks = new Map<string, PreSignOutHook>();
const signOutCleaners = new Map<string, SignOutCleaner>();
const activationHooks = new Map<string, ActivationHook>();
const signedOutListeners = new Set<(context: SignOutContext) => void>();

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
} {
  return {
    signIn: [...signInHooks.keys()].sort(),
    preSignOut: [...preSignOutHooks.keys()].sort(),
    signOut: [...signOutCleaners.keys()].sort(),
    activation: [...activationHooks.keys()].sort(),
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

/**
 * Every sign-in hook, together; one that fails does not stop the others or
 * the sign-in.
 */
export async function runSignInHooks(context: SignInContext): Promise<void> {
  await Promise.all([...signInHooks].map(([id, hook]) => settle('sign-in hook', id, hook, context)));
}

/**
 * Every pre-sign-out hook, together, for at most `budgetMs`: the sign-out
 * goes ahead after that whatever they are still doing.
 */
export async function runPreSignOutHooks(context: SignOutContext, budgetMs = PRE_SIGN_OUT_BUDGET_MS): Promise<void> {
  if (preSignOutHooks.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  const all = Promise.all([...preSignOutHooks].map(([id, hook]) => settle('pre-sign-out hook', id, hook, context)));
  try {
    await Promise.race([all, budget]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Every cleaner, together, then the signed-out listeners. One that fails
 * does not stop the others: a wipe that stops halfway is the leak it exists
 * to prevent.
 */
export async function runSignOutCleaners(context: SignOutContext): Promise<void> {
  await Promise.all([...signOutCleaners].map(([id, cleaner]) => settle('sign-out cleaner', id, cleaner, context)));
  for (const listener of [...signedOutListeners]) {
    try {
      listener(context);
    } catch (error) {
      report('signed-out listener', 'listener', error);
    }
  }
}

/** Every activation hook, together; one that fails does not stop the others. */
export async function runActivationHooks(context: ActivationContext): Promise<void> {
  await Promise.all([...activationHooks].map(([id, hook]) => settle('activation hook', id, hook, context)));
}
