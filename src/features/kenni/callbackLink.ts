// A `lifepass://kenni-callback` link that reached the app without the open
// Custom Tab taking it. Android only: iOS's ASWebAuthenticationSession
// cannot outlive the app.
//
// WHY IT HAPPENS. Verifying means leaving LifePass for the Auðkenni app, and
// coming back can go three ways the tab's own session never hears:
//   - a phone short of memory stopped LifePass meanwhile; the redirect starts
//     it again with the code and state in the launch link;
//   - Android recreated the Activity while the JS kept running; the redirect
//     is the new Activity's launch link, never a link event;
//   - the redirect came after the tab had already said "cancelled" (later
//     than its grace, ./webAuth.ts).
// The state is still good on the server for about ten minutes and is bound
// to this member's profile, so the sheet completes it (`resume`) instead of
// the member finding nothing happened, or being told they cancelled.
//
// WHERE LINKS COME FROM. The host the tabs shell mounts (./KenniNudgeHost.tsx)
// reads the launch link each time it mounts and listens for link events
// while it is up, and calls `handleKenniCallbackLink`. (F4's router ignores
// these links; it may call the same function too, which is harmless.) The
// host mounts only once the session is restored and the member signed in,
// so a cold start's link is never judged while `isAuthenticated` is still
// false.
//
// WHAT HAPPENS TO ONE:
//   1. A tab is open: it goes to that tab's session (`deliverKenniRedirect`).
//   2. A tab already handed it to its sheet: nothing (a state completes once).
//   3. Otherwise it is PARKED, whatever the auth state, and the host claims
//      it (`claimParkedKenniResume`) once it is up. The claim completes it
//      only when this phone started a round trip for this member that is
//      not spent and is recent (./roundTrip.ts), and the profile does not
//      already say verified, so a link replayed from Recents, a stale one,
//      or one for another member on this phone is dropped. The host gives
//      it to the sheet on screen (it keeps its opener's body, "See visitor
//      passes" and `onClose`), or opens one with the membership body.
//
// Sign-out forgets a parked link (the state is the member's).
import { create } from 'zustand';

import { registerSignOutCleaner } from '../../app/signOut';
import { useAppStore } from '../../stores/appStore';

import { kenniRoundTrip, readKenniRoundTrip, roundTripAllowsResume } from './roundTrip';
import { deliverKenniRedirect, isKenniWebAuthInFlight, KENNI_CALLBACK_PREFIX, wasKenniCallbackConsumed } from './webAuth';

/** True for `lifepass://kenni-callback` (with or without a query). */
export function isKenniCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower === KENNI_CALLBACK_PREFIX || lower.startsWith(`${KENNI_CALLBACK_PREFIX}?`) || lower.startsWith(`${KENNI_CALLBACK_PREFIX}/`);
}

interface ParkedState {
  /** The last redirect waiting for the host (a newer one replaces it). */
  readonly url: string | null;
}

const useParked = create<ParkedState>()(() => ({ url: null }));

/** Links claimed (or dropped) in this process: each is judged once. */
const judged = new Set<string>();

/**
 * Keeps a redirect that came without its tab for the host to claim. Also
 * where a sheet that is no longer on screen hands the redirect its tab
 * caught (./model.ts `detach`).
 */
export function parkKenniResume(url: string): void {
  if (judged.has(url)) return;
  useParked.setState({ url });
}

/** The parked redirect (the host claims it). */
export function useParkedKenniResume(): string | null {
  return useParked((state) => state.url);
}

/**
 * For the deep-link entry points: true when the link is a Kenni redirect
 * (taken by the open tab, already completed, or parked for the host), false
 * for any other link. Never throws.
 */
export function handleKenniCallbackLink(url: string): boolean {
  if (!isKenniCallbackUrl(url)) return false;
  if (isKenniWebAuthInFlight()) {
    deliverKenniRedirect(url);
    return true;
  }
  if (wasKenniCallbackConsumed(url)) return true;
  parkKenniResume(url);
  return true;
}

/**
 * The host claims the parked `url`: true when the sheet should complete it
 * now. Un-parks it either way, and judges each link once per process.
 */
export async function claimParkedKenniResume(url: string): Promise<boolean> {
  if (useParked.getState().url === url) useParked.setState({ url: null });
  // (Not `wasKenniCallbackConsumed`: a link that reached the router was
  // checked before it was parked, and a sheet no longer on screen parks the
  // very redirect its tab consumed, for the sheet that is.)
  if (judged.has(url)) return false;
  judged.add(url);

  const record = await readKenniRoundTrip();
  const app = useAppStore.getState();
  if (!app.isAuthenticated || !roundTripAllowsResume(record, app.userId)) return false;
  if (app.profile?.kennitalaVerified) {
    // Already done (the tab's own session finished it, or the web did):
    // nothing to complete, and the record has nothing left to allow.
    await kenniRoundTrip.spend();
    return false;
  }
  return true;
}

/**
 * The host claimed `url` but went before it could show it (its views were
 * rebuilt): park it again for the host that comes next, which claims it
 * afresh (the record still decides).
 */
export function reparkKenniResume(url: string): void {
  judged.delete(url);
  parkKenniResume(url);
}

registerSignOutCleaner('kenni.parkedResume', () => useParked.setState({ url: null }));

/** For tests: a fresh process. */
export function resetKenniCallbackLinksForTests(): void {
  useParked.setState({ url: null });
  judged.clear();
}
