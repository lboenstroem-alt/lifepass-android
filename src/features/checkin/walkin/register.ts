/**
 * The walk-in's session hooks: what sign-out must forget, and who shows a
 * walk-in paid on the hosted page when the screen that started it is gone.
 *
 * `registerWalkInHooks()` is idempotent. The walk-in host calls it when it
 * mounts, so the hooks are in place before the flow can hold anything; the
 * check-in feature's register file (src/features/checkin/register.ts, owned
 * by CHECKIN-1) should call it at startup too, so a walk-in recovered after
 * a cold start shows its proof even before the Scan tab has been opened.
 *
 * SIGN-OUT. The flow is one per app and outlives the Scan screen: a consent
 * or a proof left up by a member who was signed out (a refused session ends
 * it at any moment) must never greet the next one.
 *
 * THE PROOF AFTER PROCESS DEATH (Android only: iOS's hosted page is a cover
 * inside the app, which iOS never kills behind it). When F8 confirms a
 * walk-in the screen could not show, and the Scan tab is mounted with no
 * walk-in in hand, the proof opens there, as it would have; otherwise F8's
 * own words say where to find it (Home re-offers the proof).
 */
import { registerSignOutCleaner } from '../../../app/signOut';
import {
  defaultPresenter,
  registerPaymentOutcomePresenter,
  type PaymentOutcomePresenter,
} from '../../../payments';

import { isWalkInHostMounted, isWalkInIdle, walkInStore } from './store';

let registered = false;

/** The walk-in rail's outcome presenter (see the file comment). */
export const walkInPaymentPresenter: PaymentOutcomePresenter = (resolution, actions) => {
  if (
    resolution.rail === 'walk_in' &&
    resolution.settlement.kind === 'fulfilled' &&
    isWalkInHostMounted() &&
    isWalkInIdle(walkInStore.getState())
  ) {
    walkInStore.getState().showRecoveredProof(resolution.record.walkIn);
    return;
  }
  defaultPresenter(resolution, actions);
};

export function registerWalkInHooks(): void {
  if (registered) return;
  registered = true;
  registerSignOutCleaner('checkin.walkin', () => walkInStore.getState().reset());
  registerPaymentOutcomePresenter('walk_in', walkInPaymentPresenter);
}

/** Tests only: register again on the next call. */
export function resetWalkInHooksForTests(): void {
  registered = false;
}
