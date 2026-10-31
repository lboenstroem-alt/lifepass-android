/**
 * The co-pay flows' state (./copayFlows.ts): the busy flags the buttons
 * read, the sign-out generation a flow checks before it touches them, and
 * the "end the dunning episode once idle" mark. With `forgetCopayFlows`, the
 * sign-out cleaner's part.
 *
 * Kept apart from the flows so the co-pay session hooks (./register.ts, which
 * Account's register file loads at startup) reach no screen: the flows
 * import the Kenni sheet opener through the Kenni barrel, which carries the
 * sheet and its icon set, and the UI kit's dialog. This file imports only
 * the store library.
 */
import { create } from 'zustand';

export interface CopayBusyState {
  /** An activation is running (iOS `isActivating`): the CTA reads "Processing…". */
  readonly activating: boolean;
  /** A past-due payment is running (iOS `isRetryingPayment`): "Fix payment" reads "Processing…". */
  readonly retrying: boolean;
}

const idle: CopayBusyState = { activating: false, retrying: false };

/**
 * In a store, not the button: a second tap (or the slot drawn again) while a
 * flow runs must find it running. Unlike iOS, the flag stays up until the
 * page has closed and the payment is confirmed, not only for the request:
 * Android cannot open a second page while F8 settles the first, so the
 * button says what is happening instead of answering a tap with nothing.
 */
export const useCopayBusy = create<CopayBusyState>()(() => idle);

/**
 * Bumped at every sign-out (`forgetCopayFlows`). A flow started before it
 * may still be settling for the member who left; whatever it does when it
 * ends (clearing a busy flag, ending an episode) must not touch the next
 * member's buttons. A flow notes it when it starts and compares at the end.
 */
let session = 0;

/** The sign-out generation now (see `session`). */
export function copayFlowSession(): number {
  return session;
}

/** The last visit went while its payment was still running: end the episode when it finishes. */
let endEpisodeWhenIdle = false;

/** Marks the dunning episode to end once the running payment is done. */
export function endEpisodeOnceIdle(): void {
  endEpisodeWhenIdle = true;
}

/** Whether the episode was marked to end once idle; clears the mark. */
export function takeEndEpisodeWhenIdle(): boolean {
  const marked = endEpisodeWhenIdle;
  endEpisodeWhenIdle = false;
  return marked;
}

/**
 * The sign-out cleaner's part (./register.ts): the buttons are the next
 * member's at once, idle, whatever a flow of the last member is still
 * settling (it no longer touches them when it ends).
 */
export function forgetCopayFlows(): void {
  session += 1;
  endEpisodeWhenIdle = false;
  useCopayBusy.setState(idle, true);
}

/** Tests only. */
export function resetCopayBusyForTests(): void {
  useCopayBusy.setState(idle, true);
  endEpisodeWhenIdle = false;
}
