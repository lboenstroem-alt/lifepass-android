/**
 * Verifying a plan or pass purchase after the hosted checkout, and a co-pay
 * checkout after its page: the return halves of iOS
 * `PlansViewModel.handleCheckoutReturn` / `profileConfirmsPurchase` and
 * `AccountView.settleActivationReturn` / `settleRetryReturn`. The live
 * checkout (PLANS-2, ACCT-3) and the in-flight recovery both run them, so a
 * purchase is confirmed the same way whether or not Android kept the app
 * alive behind the page.
 */
import { activePasses } from '../api/profile';
import { isSubscriptionActive, isSubscriptionPastDue } from '../api/subscriptions';
import { confirmCheckoutWithRetries, pollPaymentStatus } from '../api/planCheckout';
import { useAppStore } from '../stores/appStore';

import type { PlanAttemptContext } from './inflight';
import { paymentTiming, sleep } from './timing';

/** What the return from a plan or pass checkout found. */
export type PlanVerification =
  /** The purchase is on the profile: the welcome ("Welcome to LifePass"). */
  | { readonly kind: 'confirmed' }
  /**
   * The confirm, the status poll and the profile all failed to show it. Never
   * claimed to resolve itself: only support can say whether the payment went
   * through (`plans.confirm_timeout`, naming the support address).
   */
  | { readonly kind: 'timeout' }
  /** The status poll was refused: the refusal in the member's words, no next step (it may have gone through). */
  | { readonly kind: 'failed'; readonly error: unknown }
  /** The cancel link: a deliberate back-out, nothing verified, nothing said. */
  | { readonly kind: 'cancelled' }
  /**
   * The web-first fallback found nothing on a short check: usually a price
   * check, not a purchase. The quiet "Completed your purchase? Tap to check".
   */
  | { readonly kind: 'unverified' };

function isPass(slug: string): boolean {
  return slug.startsWith('pass-');
}

/**
 * Confirms the purchase from the PROFILE itself (the source of truth, with no
 * status-endpoint time cliff): a new pass id for `pass-*`, or the active
 * membership switching to the purchased slug for `plan-*`. Each try re-reads
 * the profile and the membership (`refreshCredits`).
 */
export async function profileConfirmsPurchase(plan: PlanAttemptContext, attempts: number): Promise<boolean> {
  const delays = paymentTiming().profilePollDelaysMs.slice(0, Math.max(1, attempts));
  const before = new Set(plan.prePurchasePassIds.map((id) => id.toLowerCase()));
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    await useAppStore.getState().refreshCredits();
    const { profile, subscription } = useAppStore.getState();
    if (isPass(plan.productSlug)) {
      if (activePasses(profile).some((pass) => !before.has(pass.id.toLowerCase()))) return true;
    } else if (
      subscription &&
      isSubscriptionActive(subscription) &&
      subscription.productSlug === plan.productSlug &&
      plan.prePurchaseSubSlug !== plan.productSlug
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The verification after a checkout page closed (iOS `handleCheckoutReturn`):
 *
 * - the cancel link: nothing to verify;
 * - no Kling session (the web-first fallback): a short, quiet profile check;
 * - otherwise the verified pull (`POST /payments/checkout-sessions/confirm`,
 *   three tries), then: a PASS from the profile (six reads; the status
 *   endpoint can never confirm a pass); a MEMBERSHIP confirmed by the pull,
 *   else by `GET /payments/status`, else by two profile reads.
 */
export async function verifyPlanCheckout(
  externalSessionId: string | null,
  plan: PlanAttemptContext,
  leg: 'done' | 'cancel',
): Promise<PlanVerification> {
  if (leg === 'cancel') return { kind: 'cancelled' };
  if (!externalSessionId) {
    return (await profileConfirmsPurchase(plan, 3)) ? { kind: 'confirmed' } : { kind: 'unverified' };
  }
  try {
    const confirmed = await confirmCheckoutWithRetries(externalSessionId);
    let success: boolean;
    if (isPass(plan.productSlug)) {
      success = await profileConfirmsPurchase(plan, 6);
    } else if (confirmed) {
      success = true;
      await useAppStore.getState().refreshCredits();
    } else {
      success = await pollPaymentStatus(plan.productSlug);
      if (success) await useAppStore.getState().refreshCredits();
      else success = await profileConfirmsPurchase(plan, 2);
    }
    return success ? { kind: 'confirmed' } : { kind: 'timeout' };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

/**
 * After a company co-pay checkout (accepting the plan, or paying a past-due
 * share): the verified pull first (the web's /payment-success page never runs
 * in the app's browser, and the confirm is safe on an unpaid session), then
 * the membership re-read until it shows the result (up to four reads), then
 * the profile. True when it did: a plan for `activate`, no longer past due
 * for `retry`. Quiet either way, as on iOS: the Account screen re-renders
 * from what it reads.
 */
export async function settleCopayCheckout(
  externalSessionId: string | null,
  purpose: 'activate' | 'retry',
): Promise<boolean> {
  if (externalSessionId) await confirmCheckoutWithRetries(externalSessionId);
  const store = useAppStore.getState;
  const settled = (): boolean => {
    const subscription = store().subscription;
    return purpose === 'activate' ? subscription !== null : subscription !== null && !isSubscriptionPastDue(subscription);
  };
  for (const delay of paymentTiming().copayPollDelaysMs) {
    if (delay > 0) await sleep(delay);
    await store().loadSubscription();
    if (settled()) break;
  }
  const done = settled();
  await store().refreshCredits();
  return done;
}
