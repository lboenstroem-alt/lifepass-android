// @f4-stub (plan 3.0.3): the walk-in flow, filled by CHECKIN-2; used by CHECKIN-1 (the Scan tab).
//
// `useWalkInFlow()` starts a walk-in for a venue: from a live camera read
// (`fromLink: false`, a free walk-in confirms straight away) or from a
// check-in link (`fromLink: true`, it always stops on "Check in at <venue>?"
// first: a link never records a visit by itself, iOS 2.5.0). `isIdle` is
// false while a walk-in is in flight (the person button disables, a second
// scan waits). `WalkInFlowHost` draws the flow's sheets; the Scan screen
// mounts it.
//
// Keep these exports and signatures; replace the bodies (and this marker).
// Until CHECKIN-2 lands nothing starts.
export { default as WalkInFlowHost } from './WalkInFlowHost';

export interface StartWalkInOptions {
  /** The venue came from a link, not the camera: ask before checking in. */
  readonly fromLink: boolean;
}

export interface WalkInFlow {
  /** Starts the flow for `venueId` (a venue UUID). */
  startWalkIn(venueId: string, options: StartWalkInOptions): Promise<void>;
  /** Nothing is in flight: no preview, no sheet, no post. */
  readonly isIdle: boolean;
}

export function useWalkInFlow(): WalkInFlow {
  return {
    startWalkIn: async () => undefined,
    isIdle: true,
  };
}
