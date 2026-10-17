/**
 * The walk-in flow (CHECKIN-2), used by the Scan tab (CHECKIN-1).
 *
 * `useWalkInFlow()` starts a walk-in for a venue: from a live camera read
 * (`fromLink: false`, a free walk-in confirms straight away) or from a
 * check-in link (`fromLink: true`, it always stops on "Check in at <venue>?"
 * first, or on the own-visit step whose tap is then the confirmation: a link
 * never records a visit by itself, iOS 2.5.0). `isIdle` is false while
 * anything of a walk-in is in hand (a request, a sheet, an alert, the hosted
 * page, the proof): the person button disables, and "Scan another code"
 * waits until it is true. `WalkInFlowHost` draws the flow; the Scan screen
 * mounts it (see its file comment for where).
 *
 * The flow itself is ./store (a port of iOS CheckInViewModel's walk-in half);
 * the calls are ./service; the consent words ./consentCopy; the refusals
 * ./refusals. src/features/checkin/register.ts should call
 * `registerWalkInHooks()` from ./register at startup (the host also does when
 * it mounts).
 */
import { useMemo } from 'react';

import { isWalkInIdle, walkInStore } from './store';
import { useWalkIn } from './useWalkIn';

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

function startWalkIn(venueId: string, options: StartWalkInOptions): Promise<void> {
  return walkInStore.getState().startWalkIn(venueId, options);
}

export function useWalkInFlow(): WalkInFlow {
  const isIdle = useWalkIn(isWalkInIdle);
  return useMemo(() => ({ startWalkIn, isIdle }), [isIdle]);
}
