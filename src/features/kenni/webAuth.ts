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
 */
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

let inFlight = false;

/**
 * True while a Custom Tab for Kenni is open and waiting for its redirect. A
 * `lifepass://kenni-callback` link that arrives meanwhile belongs to that
 * session (./callbackLink.ts leaves it alone).
 */
export function isKenniWebAuthInFlight(): boolean {
  return inFlight;
}

/** The real browser step. */
export const authenticateWithCustomTab: Authenticate = async (authorizationUrl) => {
  if (inFlight) throw new KenniWebAuthError('couldNotStart');
  inFlight = true;
  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authorizationUrl, KENNI_CALLBACK_PREFIX, KENNI_TAB_OPTIONS);
  } catch (error) {
    throw new KenniWebAuthError('couldNotStart', error);
  } finally {
    inFlight = false;
  }
  switch (result.type) {
    case 'success':
      return result.url;
    case 'locked':
      // Another browser session is already up.
      throw new KenniWebAuthError('couldNotStart');
    default:
      // `dismiss` (Android) and `cancel` (the member closed it).
      throw new KenniWebAuthError('cancelled');
  }
};

/** For tests: forget a session a failed test left marked open. */
export function resetKenniWebAuthForTests(): void {
  inFlight = false;
}
