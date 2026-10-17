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
   * `processing`, or a confirm that did not answer): the record stays, so a
   * later return to the app can still tell the member. `clear`: the server
   * has answered for good.
   */
  readonly record: 'keep' | 'clear';
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
      const verification = await verifyPlanCheckout(record.externalSessionId, record.plan, leg);
      return { resolution: { rail: 'plan', record, verification }, record: 'clear' };
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
