// @f4-stub (plan 3.0.3): the open-sheet request behind `openKenniSheet`, filled by AUTH-3.
//
// An open request is forgotten at sign-out, without calling its `onClose`:
// the host unmounts with the tabs, and a request left in the store would
// show the sheet unprompted to the next member, and call the previous
// member's screen when it closed (iOS `handleSignOut` clears what it
// presents). AUTH-3: keep that cleaner when replacing this file.
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
  /** The sheet closed, verified or not. */
  readonly onClose: () => void;
}

interface RequestState {
  readonly request: KenniSheetOptions | null;
}

const useRequests = create<RequestState>()(() => ({ request: null }));

/** Opens the verification sheet over whatever is showing. */
export function openKenniSheet(options: KenniSheetOptions): void {
  useRequests.setState({ request: options });
}

/** The open request (the host shows it). */
export function useKenniSheetRequest(): KenniSheetOptions | null {
  return useRequests((state) => state.request);
}

// Not `closeKenniSheetRequest`: the screen that opened it is gone with the member.
registerSignOutCleaner('kenni.sheetRequest', () => useRequests.setState({ request: null }));

/** The host closed the requested sheet: tells its opener. */
export function closeKenniSheetRequest(): void {
  const request = useRequests.getState().request;
  if (!request) return;
  useRequests.setState({ request: null });
  request.onClose();
}
