// A `lifepass://kenni-callback` link that reached the app through the
// deep-link router rather than the open Custom Tab. Android only: iOS's
// ASWebAuthenticationSession cannot outlive the app.
//
// WHY IT HAPPENS. Verifying means leaving LifePass for the Auðkenni app. A
// phone short of memory may stop LifePass meanwhile; Kenni's redirect then
// starts it again with the code and state in the launch link, and the tab's
// session that would have caught it died with the old process. The state is
// still good on the server for about ten minutes and is bound to this
// member's profile, so the sheet opens and completes it (`resume`), instead
// of the member finding nothing happened and starting over. A link for
// someone else's state is refused by the server (403), and the sheet says it
// could not finish.
//
// While a tab is open in this process, its own session takes the redirect,
// so the link is left to it, and so is a redirect a tab already handed to
// its sheet (the router can hear the same link just after the tab closed):
// a state completes once, and a second completion would be refused and turn
// "verified" into "couldn't finish".
import { useAppStore } from '../../stores/appStore';

import { presentRequest } from './sheetRequests';
import { isKenniWebAuthInFlight, KENNI_CALLBACK_PREFIX, wasKenniCallbackConsumed } from './webAuth';

/** True for `lifepass://kenni-callback` (with or without a query). */
export function isKenniCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower === KENNI_CALLBACK_PREFIX || lower.startsWith(`${KENNI_CALLBACK_PREFIX}?`) || lower.startsWith(`${KENNI_CALLBACK_PREFIX}/`);
}

/**
 * For the deep-link router: true when the link is a Kenni redirect (handled
 * here, or left to the open tab), false for any other link. Acts only for a
 * signed-in member; the router calls it once the tabs are up, as it does
 * for a check-in link.
 */
export function handleKenniCallbackLink(url: string): boolean {
  if (!isKenniCallbackUrl(url)) return false;
  if (isKenniWebAuthInFlight() || wasKenniCallbackConsumed(url)) return true;
  if (!useAppStore.getState().isAuthenticated) return true;
  presentRequest({ bodyKey: 'kenni.body', onClose: () => undefined, resumeUrl: url });
  return true;
}
