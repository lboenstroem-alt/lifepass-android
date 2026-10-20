/**
 * The interim checkout behind the Plans screen's Continue, until PLANS-2's
 * payment sheet replaces it (./index.ts; the seam is ./contract.ts).
 *
 * It runs the purchase on the first build's rail
 * (src/supabase/services/payments `startCheckout`, which F8 kept for this
 * screen): create the session, open the hosted page, verify on return, iOS's
 * "Payment issue" when nothing could confirm it. It says what PLANS-1's
 * features need it to say, in iOS's words:
 *
 * - `kennitala_verification_required` (the local verified flag can be stale)
 *   hands the SUBMITTED plan back to the screen, which opens the Kenni sheet
 *   and resumes once verified; never a dead-end alert;
 * - `product_not_on_sale` (a card drawn before the pass went off sale) is the
 *   payment alert "This pass isn't on sale right now...", and the catalogue
 *   is read again so its card goes; a typed code is not blamed;
 * - any other refusal is the plain refusal sentence, never the server's
 *   English or an HTTP status;
 * - a purchase confirmed is iOS's welcome, whose button closes Plans.
 *
 * `busy` covers the whole attempt (the session, the hosted page, the
 * verification), and the screen cannot be closed while it is busy, so the
 * member cannot leave Plans with the page still to open over whatever is
 * underneath.
 *
 * What it does NOT have yet (PLANS-2): the mandate sheet and save-card switch
 * (the server's default, keep the card, applies), the discount code box
 * (the code handed in is carried across Kenni but not sent), the "Confirming
 * your payment" overlay and the "check again" chip, and the refusals' next
 * step buttons.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage, isCancellation, isProblem, refusalMessage } from '../../../api';
import { showDialog } from '../../../components/ui';
import { currentLanguage, t } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { useAppStore } from '../../../stores/appStore';
import { startCheckout } from '../../../supabase/services/payments';

import { loadPlanCatalog } from '../catalogStore';
import { displayName, isSubscription, type Plan } from '../plans';
import type { PlanCheckout, PlanCheckoutEvents } from './contract';

/** How one interim checkout attempt ended. */
export type CheckoutAttempt =
  /** Paid and confirmed: the welcome. */
  | { readonly kind: 'purchased' }
  /** The server wants Kenni first. */
  | { readonly kind: 'kennitalaRequired' }
  /** iOS's payment alert. `catalogRefresh` is the catalogue re-read after `product_not_on_sale`. */
  | { readonly kind: 'issue'; readonly message: string; readonly catalogRefresh: Promise<void> | null }
  /** Nothing to say: the member backed out, or the rail already said how it ended. */
  | { readonly kind: 'closed' };

/** One checkout on the interim rail (see the file comment). Never throws. */
export async function attemptPlanCheckout(plan: Plan): Promise<CheckoutAttempt> {
  track('begin_checkout', { plan_id: plan.id, mode: plan.mode });
  try {
    const outcome = await startCheckout(plan.id);
    return outcome === 'fulfilled' ? { kind: 'purchased' } : { kind: 'closed' };
  } catch (error) {
    if (isProblem(error, 'kennitala_verification_required')) return { kind: 'kennitalaRequired' };
    if (isProblem(error, 'product_not_on_sale')) {
      // The pass was taken off sale after the cards were drawn (the catalogue
      // caches for up to five minutes, or this screen was left open): say so
      // in the member's language, and re-read the catalogue so its card goes.
      return { kind: 'issue', message: errorMessage(error), catalogRefresh: loadPlanCatalog() };
    }
    if (isCancellation(error)) return { kind: 'closed' };
    // A purchase gate in the member's words; any other refusal is the plain
    // fallback, never the server's English (2.5.5).
    return { kind: 'issue', message: refusalMessage(error), catalogRefresh: null };
  }
}

/** The purchase's welcome (iOS PlansView's `purchaseComplete` alert). */
function showWelcome(plan: Plan, onDone: () => void): void {
  const name = displayName(plan, currentLanguage());
  showDialog({
    title: t('plans.welcome_title'),
    message: t(isSubscription(plan) ? 'plans.success.subscription' : 'plans.success.pass', { name }),
    buttons: [
      {
        label: t('plans.welcome_cta'),
        onPress: () => {
          void useAppStore.getState().loadSubscription();
          onDone();
        },
      },
    ],
  });
}

/** iOS PlansView's "Payment issue" alert. */
function showPaymentIssue(message: string): void {
  showDialog({ title: t('plans.payment_issue'), message, buttons: [{ label: t('common.ok'), role: 'cancel' }] });
}

/** The checkout behind the Plans screen's Continue (interim; see the file comment). */
export function usePlanCheckout(events: PlanCheckoutEvents): PlanCheckout {
  const [busy, setBusy] = useState(false);
  // Taken synchronously in `begin`, before any await: a quick second tap
  // lands before the first attempt has set `busy`, and would open a second
  // checkout session.
  const inFlight = useRef(false);
  const latestEvents = useRef(events);
  const mounted = useRef(true);

  useEffect(() => {
    latestEvents.current = events;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const begin = useCallback((plan: Plan, discountCode: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void attemptPlanCheckout(plan).then((attempt) => {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      switch (attempt.kind) {
        case 'purchased':
          showWelcome(plan, () => latestEvents.current.onFinished());
          return;
        case 'kennitalaRequired':
          latestEvents.current.onKennitalaRequired(plan, discountCode);
          return;
        case 'issue':
          showPaymentIssue(attempt.message);
          return;
        case 'closed':
          return;
      }
    });
  }, []);

  return { busy, verifying: false, chip: null, element: null, begin };
}
