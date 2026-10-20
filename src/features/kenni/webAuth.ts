/**
 * The eID browser step: opens Kenni's authorization URL in a Chrome Custom Tab
 * and hands back the `lifepass://kenni-callback?...` redirect it ends on. The
 * Android stand-in for iOS `WebAuthController` (ASWebAuthenticationSession,
 * Views/Auth/KenniVerificationView.swift).
 *
 * HOW ANDROID GETS THE REDIRECT. `WebBrowser.openAuthSessionAsync` opens the
 * tab and listens for the app's own `lifepass://kenni-callback` link (the
 * Custom Tab hands a custom-scheme redirect to the app as an intent). It
 * resolves `success` with that URL, or `dismiss` when the app comes back to
 * the front without one: the member closed the tab (the X, back) or returned
 * to LifePass some other way. The deep-link router ignores this URL, so
 * nothing else acts on it.
 *
 * THE TAB OPENS IN THE APP'S OWN TASK (`createTask: false`), as F8's hosted
 * payment pages do (src/payments/hostedPage.ts explains it at length).
 * Verifying with rafræn skilríki means leaving for the Auðkenni app (or
 * answering the SIM prompt) and coming back. With the tab on top of LifePass
 * in one task, coming back through Recents or the launcher icon lands on the
 * tab again, so the check carries on. In a task of its own (the default)
 * coming back that way lands on LifePass underneath, which the polyfill reads
 * as the member closing the tab: a cancel while they were still verifying.
 * The redirect reaches the app's single-task activity, which closes the tab
 * above it, as ASWebAuthenticationSession closes on iOS. (The plan suggested
 * `showInRecents: true`; that only helps a member who picks the right one of
 * two Recents entries, and needs the separate task that causes the problem.)
 *
 * Every way this ends without a redirect is a `KenniWebAuthError` naming the
 * failure the sheet says (iOS `KenniFailure.fromAuthentication`):
 *   - `cancelled`      the tab was closed or the member came back without
 *                      finishing (iOS `canceledLogin`);
 *   - `couldNotStart`  no tab could be opened: no browser that supports
 *                      Custom Tabs, another auth session already up
 *                      (`locked`), or the module refused (iOS: `start()`
 *                      returned false, `KenniError.sessionDidNotStart`).
 *
 * EXACTLY ONE ANSWER. The promise settles once, whichever of the redirect and
 * the return to the app arrives first, and a session already running is
 * reported as `couldNotStart` rather than opening a second tab (iOS
 * `ResumeOnce`: a sheet stuck on its spinner is the gate to a plan checkout
 * stuck for good).
 *
 * A REDIRECT THAT LOSES THE RACE. The polyfill resolves `dismiss` as soon as
 * the app comes back to the foreground, and the redirect's own link event
 * can arrive just after that (F8 met the same race on the hosted pages,
 * src/payments/hostedPage.ts). Read as a cancel, the member who has just
 * approved in the Auðkenni app would be told they cancelled, and the code
 * Kenni sent would go unused. So this step listens for the link itself while
 * the tab is open, and a tab that closed without one waits a moment
 * (`KENNI_LATE_REDIRECT_GRACE_MS`) for a late one before it says cancelled.
 *
 * A redirect this step handed to the sheet is remembered for the process
 * (`wasKenniCallbackConsumed`), so the same link reaching the deep-link
 * router afterwards is never completed a second time (./callbackLink.ts):
 * a state completes once, and a second try would turn "verified" into
 * "couldn't finish".
 *
 * A REDIRECT THAT NEVER COMES AS A LINK EVENT. When Android recreates the
 * Activity while the JS keeps running (memory pressure, "Don't keep
 * activities"), the redirect reaches JS only as the new Activity's launch
 * link (`Linking.getInitialURL`), which neither the polyfill nor the
 * listener here hears. ./callbackLink.ts hands such a link to the open tab
 * (`deliverKenniRedirect`), so the tab's session ends with it instead of
 * saying "cancelled".
 */
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

/** The redirect the native authorization URL ends on (set server side). */
export const KENNI_CALLBACK_PREFIX = 'lifepass://kenni-callback';

export type KenniWebAuthFailure = 'cancelled' | 'couldNotStart';

export class KenniWebAuthError extends Error {
  readonly reason: KenniWebAuthFailure;

  constructor(reason: KenniWebAuthFailure, cause?: unknown) {
    super(`Kenni browser step ended: ${reason}`);
    this.name = 'KenniWebAuthError';
    this.reason = reason;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * The tab's options (see the file comment). A Custom Tab shares the member's
 * browser cookies, as iOS's non-ephemeral session shares Safari's, so an eID
 * login Kenni remembers is remembered here too.
 */
export const KENNI_TAB_OPTIONS: WebBrowser.AuthSessionOpenOptions = Object.freeze({ createTask: false });

/** Opens the authorization URL and resolves with the captured redirect. */
export type Authenticate = (authorizationUrl: string) => Promise<string>;

/**
 * How long a tab that closed without a redirect waits for one that lost the
 * race to the return to the foreground (the same wait F8 gives a hosted page).
 */
export const KENNI_LATE_REDIRECT_GRACE_MS = 300;

let lateRedirectGraceMs = KENNI_LATE_REDIRECT_GRACE_MS;

let inFlight = false;

/** The open tab's session takes a redirect it has not had yet (null when no tab is open). */
let takeRedirect: ((url: string) => boolean) | null = null;

/** Redirects a tab handed to the sheet in this process (each completes once). */
const consumed = new Set<string>();

/**
 * True while a Custom Tab for Kenni is open and waiting for its redirect. A
 * `lifepass://kenni-callback` link that arrives meanwhile belongs to that
 * session (./callbackLink.ts leaves it alone).
 */
export function isKenniWebAuthInFlight(): boolean {
  return inFlight;
}

/** True for a redirect a tab in this process already handed to its sheet. */
export function wasKenniCallbackConsumed(url: string): boolean {
  return consumed.has(url);
}

/**
 * Hands a `lifepass://kenni-callback` link that reached the app some other
 * way (the launch link of a recreated Activity) to the open tab's session.
 * True when a tab is open and took it; false when no tab is open, or it
 * already has its redirect.
 */
export function deliverKenniRedirect(url: string): boolean {
  return takeRedirect?.(url) ?? false;
}

function isOurRedirect(url: unknown): url is string {
  return typeof url === 'string' && url.toLowerCase().startsWith(KENNI_CALLBACK_PREFIX);
}

/** The real browser step. */
export const authenticateWithCustomTab: Authenticate = async (authorizationUrl) => {
  if (inFlight) throw new KenniWebAuthError('couldNotStart');
  inFlight = true;

  // The redirect as the app's own link event delivers it (see "A redirect
  // that loses the race" above); the first one wins.
  let lateRedirect: string | null = null;
  let arrived: (() => void) | null = null;
  // Read through a call: the listener sets it while this function awaits.
  const seenRedirect = (): string | null => lateRedirect;
  const take = (url: string): boolean => {
    if (lateRedirect !== null || !isOurRedirect(url)) return false;
    lateRedirect = url;
    arrived?.();
    return true;
  };
  takeRedirect = take;
  const subscription = Linking.addEventListener('url', (event: { url: string }) => {
    take(event.url);
  });

  const consume = (url: string): string => {
    consumed.add(url);
    return url;
  };

  try {
    let result: WebBrowser.WebBrowserAuthSessionResult;
    try {
      result = await WebBrowser.openAuthSessionAsync(authorizationUrl, KENNI_CALLBACK_PREFIX, KENNI_TAB_OPTIONS);
    } catch (error) {
      throw new KenniWebAuthError('couldNotStart', error);
    }
    switch (result.type) {
      case 'success':
        return consume(result.url);
      case 'locked':
        // Another browser session is already up.
        throw new KenniWebAuthError('couldNotStart');
      default: {
        // `dismiss` (Android: back in the app with no redirect yet) and
        // `cancel` (the member closed it). A redirect may still be on its way.
        if (seenRedirect() === null && lateRedirectGraceMs > 0) {
          await new Promise<void>((resolve) => {
            arrived = resolve;
            setTimeout(resolve, lateRedirectGraceMs);
          });
          arrived = null;
        }
        const late = seenRedirect();
        if (late !== null) return consume(late);
        throw new KenniWebAuthError('cancelled');
      }
    }
  } finally {
    subscription.remove();
    if (takeRedirect === take) takeRedirect = null;
    inFlight = false;
  }
};

/** For tests: forget a session a failed test left marked open, and the redirects seen. */
export function resetKenniWebAuthForTests(): void {
  inFlight = false;
  takeRedirect = null;
  consumed.clear();
  lateRedirectGraceMs = KENNI_LATE_REDIRECT_GRACE_MS;
}

/** For tests: the late-redirect wait (0 says cancelled at once). */
export function setKenniLateRedirectGraceForTests(ms: number): void {
  lateRedirectGraceMs = ms;
}
