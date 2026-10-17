/**
 * The legacy checkout service, kept as a thin shim over the money rails core
 * (F8) for the screens written against it (TopUpScreen, AccountScreen) until
 * PLANS-2 and ACCT-3 replace them. Nothing new should import it:
 *
 *   - plan and pass checkout calls: src/api/planCheckout.ts (PLANS-2's);
 *   - the hosted page, its return and its recovery after process death:
 *     src/payments (`checkoutOnHostedPage`, `copayOnHostedPage`, ...).
 *
 * What changed under the old names: the page waits on the `lifepass://payment-`
 * prefix, so the cancel link comes back too; a tab closed with no link is
 * verified like iOS's Done instead of being read as a cancel; a plan or pass
 * checkout is saved before its page opens and recovered after process death;
 * a pass is confirmed from the profile (the status endpoint can never
 * confirm one).
 */
import { activePasses } from '../../api/profile';
import { isSubscriptionActive } from '../../api/subscriptions';
import {
  confirmCheckout as confirmCheckoutSession,
  confirmCheckoutWithRetries,
  createCheckout as createCheckoutSession,
  pollPaymentStatus as pollStatus,
} from '../../api/planCheckout';
import { checkoutOnHostedPage } from '../../payments/attempts';
import { openHostedPage } from '../../payments/hostedPage';
import { PAYMENT_CANCEL_URL, PAYMENT_SUCCESS_URL } from '../../payments/returnUrls';
import { useAppStore } from '../../stores/appStore';

export { PAYMENT_CANCEL_URL, PAYMENT_SUCCESS_URL };

export type CheckoutSession = { url: string; externalSessionId?: string };

export type CheckoutOutcome = 'fulfilled' | 'pending' | 'canceled';

/** `POST /payments/checkout-sessions` (src/api/planCheckout.ts). */
export async function createCheckout(
  productSlug: string,
  opts?: { saveCard?: boolean; promotionCode?: string },
): Promise<CheckoutSession> {
  const promotionCode = opts?.promotionCode?.trim();
  const session = await createCheckoutSession(productSlug, {
    saveCard: opts?.saveCard,
    promotionCode: promotionCode || null,
  });
  return { url: session.url, externalSessionId: session.externalSessionId ?? undefined };
}

/** `POST /payments/checkout-sessions/confirm`; any failure reads as "not confirmed". */
export async function confirmCheckout(externalSessionId: string): Promise<boolean> {
  try {
    return await confirmCheckoutSession(externalSessionId);
  } catch {
    return false;
  }
}

/** `GET /payments/status?plan=` until fulfilled; a refusal reads as "not yet". */
export async function pollPaymentStatus(plan?: string, maxAttempts = 12): Promise<boolean> {
  try {
    return await pollStatus(plan, maxAttempts);
  } catch {
    return false;
  }
}

/**
 * Creates the checkout, opens it and verifies the purchase on return
 * (src/payments `checkoutOnHostedPage`).
 */
export async function startCheckout(
  productSlug: string,
  opts?: { saveCard?: boolean; promotionCode?: string },
): Promise<CheckoutOutcome> {
  const { url, externalSessionId } = await createCheckout(productSlug, opts);
  const { userId, profile, subscription } = useAppStore.getState();
  const memberId = userId ?? profile?.id;
  if (!memberId) return settleHostedCheckout(url, externalSessionId, productSlug);
  const result = await checkoutOnHostedPage({
    memberId,
    url,
    externalSessionId: externalSessionId ?? null,
    plan: {
      productSlug,
      planName: null,
      prePurchasePassIds: activePasses(profile).map((pass) => pass.id),
      prePurchaseSubSlug: subscription && isSubscriptionActive(subscription) ? subscription.productSlug : null,
    },
  });
  if (result.kind !== 'verified') return 'canceled';
  switch (result.verification.kind) {
    case 'confirmed':
      return 'fulfilled';
    case 'cancelled':
    case 'unverified':
      return 'canceled';
    case 'timeout':
    case 'failed':
      return 'pending';
  }
}

/**
 * Opens a hosted checkout whose URL came from elsewhere (the co-pay
 * activation and retry) and settles it on return: the verified pull, then
 * the status poll when a plan slug is known.
 */
export async function settleHostedCheckout(
  url: string,
  externalSessionId?: string,
  plan?: string,
): Promise<CheckoutOutcome> {
  const page = await openHostedPage(url, 'payment');
  if (page.kind === 'neverOpened') return 'canceled';
  // A plan checkout's cancel link is a deliberate back-out: nothing to verify
  // (iOS `checkoutCancelled`). A co-pay page (no plan) is always confirmed.
  if (plan && page.leg === 'cancel') return 'canceled';
  if (externalSessionId && (await confirmCheckoutWithRetries(externalSessionId))) return 'fulfilled';
  if (plan && (await pollPaymentStatus(plan))) return 'fulfilled';
  return page.leg === 'cancel' ? 'canceled' : 'pending';
}
