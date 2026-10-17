// @f4-stub (plan 3.0.3): the open-sheet request behind `openKenniSheet`, filled by AUTH-3.
import { create } from 'zustand';

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

/** The host closed the requested sheet: tells its opener. */
export function closeKenniSheetRequest(): void {
  const request = useRequests.getState().request;
  if (!request) return;
  useRequests.setState({ request: null });
  request.onClose();
}
