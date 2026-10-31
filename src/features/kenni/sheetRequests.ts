// The open-sheet request behind `openKenniSheet` (plan 3.0.3, the contract
// PLANS-1, ACCT-1, ACCT-3, BOOK-1 and F4's refusal steps call).
//
// One request at a time, shown by the host the tabs shell mounts
// (./KenniNudgeHost.tsx), the way iOS presents one `.sheet`. A screen asks
// for the sheet with its body copy and what to do once it has gone, and
// reads the outcome where iOS's `onDismiss` reads it: from the profile
// (`kennitalaVerified`), which the sheet re-reads after a verification.
//
// A second request while one is up REPLACES it, and the first opener hears
// its sheet closed (unverified, which it is at that moment), so no screen is
// left waiting for an `onClose` that never comes.
//
// An open request is forgotten at sign-out, WITHOUT calling its `onClose`:
// the host unmounts with the tabs, and a request left in the store would
// show the sheet unprompted to the next member, and call the previous
// member's screen when it closed (iOS `handleSignOut` clears what it
// presents).
import { create } from 'zustand';

import { registerSignOutCleaner } from '../../app/signOut';

export interface KenniSheetOptions {
  /**
   * The body copy's key: `kenni.body` (the membership gate, the default on
   * iOS) or `kenni.onboarding_body` (the sign-up nudge and a refusal's
   * "Verify identity").
   */
  readonly bodyKey: string;
  /** Plans only: "See visitor passes" closes the sheet and shows the passes (they need no eID). */
  readonly onSeePasses?: () => void;
  /**
   * The sheet closed, verified or not, and has left the screen. Read
   * `kennitalaVerified` from the app store to know which (closing unverified
   * must never resume a purchase).
   */
  readonly onClose: () => void;
}

/** A request as the host holds it. */
export interface KenniSheetRequest extends KenniSheetOptions {
  /** A `lifepass://kenni-callback` to complete at once (./callbackLink.ts). */
  readonly resumeUrl?: string;
}

interface RequestState {
  readonly request: KenniSheetRequest | null;
}

const useRequests = create<RequestState>()(() => ({ request: null }));

/** Asks for the sheet, from any screen: the host shows it over whatever is showing. */
export function openKenniSheet(options: KenniSheetOptions): void {
  presentRequest({ bodyKey: options.bodyKey, onSeePasses: options.onSeePasses, onClose: options.onClose });
}

/** Internal: a request with Android-only extras (a resume link). */
export function presentRequest(request: KenniSheetRequest): void {
  const earlier = useRequests.getState().request;
  useRequests.setState({ request });
  if (earlier && earlier !== request) earlier.onClose();
}

/** The open request (the host shows it). */
export function useKenniSheetRequest(): KenniSheetRequest | null {
  return useRequests((state) => state.request);
}

/** Whether a request is open (a second tap on an entry point can wait for it). */
export function isKenniSheetRequested(): boolean {
  return useRequests.getState().request !== null;
}

// Not `closeKenniSheetRequest`: the screen that opened it is gone with the member.
registerSignOutCleaner('kenni.sheetRequest', () => useRequests.setState({ request: null }));

/**
 * The host closed the requested sheet: tells its opener, once. With
 * `expected`, only when that request is still the open one (a newer request
 * replaced it, and the replacement already told it).
 */
export function closeKenniSheetRequest(expected?: KenniSheetRequest): void {
  const request = useRequests.getState().request;
  if (!request || (expected && request !== expected)) return;
  useRequests.setState({ request: null });
  request.onClose();
}

/** For tests. */
export function resetKenniSheetRequestsForTests(): void {
  useRequests.setState({ request: null });
}
