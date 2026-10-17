/**
 * Settling one in-flight attempt: the confirm its rail needs, what that means
 * for the saved record, and the money side effects. Shared by the live flows
 * (./attempts) and the recovery after process death (./coldStartRecovery), so
 * an attempt is settled by the same rules whoever settles it.
 */
import { useAppStore } from '../stores/appStore';

import { keyDisposition, settlePaymentSession } from './bookingPaymentSession';
import { confirmCardSetup } from './cardSetup';
import type { InflightRecord } from './inflight';
import { settleCopayCheckout, verifyPlanCheckout } from './planVerification';
import type { PaymentResolution } from './presenters';

export interface Settled {
  readonly resolution: PaymentResolution;
  /**
   * `keep`: the money may still be moving (a booking or walk-in still
   * `processing`), or the server did not answer (a confirm, or a plan's
   * status check, that was refused or offline): the record stays, so a later
   * return to the app can still ask, and tell the member. `clear`: the
   * server has answered for good.
   */
  readonly record: 'keep' | 'clear';
}

/**
 * True when the server said the payment is still settling (a booking or
 * walk-in `processing`): a screen may hold it for Check again. A confirm
 * that did not answer is kept too, but is not this: iOS offers no Check
 * again after one, so the attempt goes back to the recovery, which asks
 * again quietly at the next return to the app.
 */
export function stillSettling(resolution: PaymentResolution): boolean {
  return (
    (resolution.rail === 'booking' || resolution.rail === 'walk_in') &&
    resolution.settlement.kind === 'outcome' &&
    resolution.settlement.outcome.kind === 'processing'
  );
}

/** True when the server did not answer (the refusal is said after the page, and asked again quietly later). */
export function unanswered(resolution: PaymentResolution): boolean {
  if (resolution.rail === 'booking' || resolution.rail === 'walk_in') return resolution.settlement.kind === 'failed';
  return resolution.rail === 'plan' && resolution.verification.kind === 'failed';
}

/** The member's credits and passes after money moved (iOS `refreshCredits`). Never throws. */
function refreshCredits(): void {
  void useAppStore
    .getState()
    .refreshCredits()
    .catch(() => undefined);
}

/**
 * Runs `record`'s confirm. `leg` is how the page closed (`cancel` after the
 * cancel link), or `done` when nothing says otherwise (a tab closed, a launch
 * with no link, a manual Check again).
 */
export async function settleRecord(record: InflightRecord, leg: 'done' | 'cancel'): Promise<Settled> {
  switch (record.rail) {
    case 'booking':
    case 'walk_in': {
      const settlement = await settlePaymentSession({ key: record.key, leg });
      if (settlement.kind === 'fulfilled') refreshCredits();
      const resolution: PaymentResolution =
        record.rail === 'booking' ? { rail: 'booking', record, settlement } : { rail: 'walk_in', record, settlement };
      return { resolution, record: keyDisposition(settlement) === 'reuse' ? 'keep' : 'clear' };
    }
    case 'plan': {
      // A refused status check (offline after a cold start, a gateway page)
      // proves nothing either way: keep the record so a later return asks
      // again, as the booking and walk-in rails do. Everything else is the
      // last word: confirmed; a timeout, which only support can settle (iOS
      // names the support address); the cancel link; a quiet web-first check.
      const verification = await verifyPlanCheckout(record.externalSessionId, record.plan, leg);
      return { resolution: { rail: 'plan', record, verification }, record: verification.kind === 'failed' ? 'keep' : 'clear' };
    }
    case 'card_setup': {
      // Whatever closed the page, the verified pull decides (iOS runs it on
      // every dismiss and ignores its failure: Account re-reads the summary).
      let card: Awaited<ReturnType<typeof confirmCardSetup>> | undefined;
      try {
        card = await confirmCardSetup();
      } catch {
        card = undefined;
      }
      return { resolution: { rail: 'card_setup', record, card }, record: 'clear' };
    }
    case 'copay': {
      const settled = await settleCopayCheckout(record.externalSessionId, record.purpose);
      return { resolution: { rail: 'copay', record, settled }, record: 'clear' };
    }
  }
}
