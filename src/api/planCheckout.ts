/**
 * Plan and pass checkout through Kling's hosted page: the Android port of iOS
 * `PaymentService` (Services/PaymentService.swift), split out of the legacy
 * src/supabase/services/payments.ts by F8 and owned by PLANS-2, whose payment
 * sheet creates the checkout through it (src/features/plans/checkout). The
 * return from the page, and its recovery after Android closed the app behind
 * it, are in src/payments, which confirm through the pull and the status poll
 * below.
 *
 * The hosted page owns the price: the app never computes or shows an ISK
 * figure at checkout. A partner discount code (already normalised by the
 * caller) rides membership AND pass checkouts; the server refuses one it
 * cannot honour with a 400 (`discount_code_*`), thrown as a `ProblemError`.
 */
import { MerchantInfo } from '../config/merchantInfo';
import { translate, currentLanguage } from '../i18n';
import { PAYMENT_CANCEL_URL, PAYMENT_SUCCESS_URL } from '../payments/returnUrls';
import { paymentTiming, sleep } from '../payments/timing';

import { apiGet, apiPost } from './client';
import { HttpStatusError, LocalizedError, ProblemError } from './errors';
import { newIdempotencyKey } from './idempotency';
import { toWireDate } from './wire';

/** A created checkout: the hosted page to open, and the Kling session the return confirms. */
export interface CheckoutSession {
  readonly url: string;
  /** Needed for the verified pull on return; absent only from a server that predates it. */
  readonly externalSessionId: string | null;
}

export interface CheckoutOptions {
  /**
   * The card-on-file consent for a PASS: `false` lets the buyer decline
   * vaulting their card. Omitted is true on the server; a subscription
   * always vaults (the renewal needs a card), whatever this says.
   */
  readonly saveCard?: boolean | null;
  /** A partner discount code, already normalised; empty or null sends nothing. */
  readonly promotionCode?: string | null;
}

/** The checkout's body (`POST /payments/checkout-sessions`), for the contract test. */
export function checkoutBody(productSlug: string, options: CheckoutOptions = {}, acceptedAt: Date = new Date()) {
  return {
    productSlug,
    successUrl: PAYMENT_SUCCESS_URL,
    cancelUrl: PAYMENT_CANCEL_URL,
    ...(options.saveCard != null ? { saveCard: options.saveCard } : {}),
    ...(options.promotionCode ? { promotionCode: options.promotionCode } : {}),
    // Dispute evidence: the documents this purchase is agreed under
    // (src/config/merchantInfo.ts).
    terms: {
      acceptedAt: toWireDate(acceptedAt),
      privacyVersion: MerchantInfo.privacyVersion,
      termsVersion: MerchantInfo.termsVersion,
    },
  };
}

/**
 * `POST /payments/checkout-sessions` → the hosted page for `productSlug`
 * (`plan-*` or `pass-*`), returning to the app's payment links. A fresh
 * Idempotency-Key per checkout, so a network retry cannot open a second
 * order.
 */
export async function createCheckout(productSlug: string, options: CheckoutOptions = {}): Promise<CheckoutSession> {
  const session = await apiPost<{ checkoutUrl?: unknown; url?: unknown; externalSessionId?: unknown }>(
    '/payments/checkout-sessions',
    checkoutBody(productSlug, options),
    { idempotencyKey: newIdempotencyKey(), decode: (data) => (typeof data === 'object' && data ? data : {}) },
  );
  const url = [session.checkoutUrl, session.url].find(
    (value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value),
  );
  if (!url) throw new LocalizedError(translate('payment.err.checkout', currentLanguage()));
  const externalSessionId =
    typeof session.externalSessionId === 'string' && session.externalSessionId ? session.externalSessionId : null;
  return { url, externalSessionId };
}

/** The confirm statuses that are an explicit "paid": anything else falls back to the polls. */
const CONFIRMED_STATUSES: ReadonlySet<string> = new Set(['fulfilled', 'completed', 'paid', 'already_fulfilled']);

function routeMissing(error: unknown): boolean {
  if (error instanceof ProblemError) return error.status === 404 || error.status === 405;
  if (error instanceof HttpStatusError) return error.httpStatus === 404 || error.httpStatus === 405;
  return false;
}

/**
 * `POST /payments/checkout-sessions/confirm`: asks the server to run the
 * verified Kling pull for this session. Kling sends no "checkout completed"
 * webhook, and on the web fulfilment happens when /payment-success renders,
 * which a return to the app bypasses, so the app must trigger it.
 *
 * True only on an EXPLICIT fulfilled status; an ambiguous or missing one
 * falls back to the status and profile polls (the verified path), never to
 * success. A 404 or 405 (a server rolled back past the route) is false too,
 * so the purchase degrades to the polls instead of failing. Any other
 * failure is thrown; callers retrying it treat a throw as false.
 */
export async function confirmCheckout(externalSessionId: string): Promise<boolean> {
  try {
    const result = await apiPost<{ status?: unknown }>(
      '/payments/checkout-sessions/confirm',
      { externalSessionId },
      { idempotencyKey: newIdempotencyKey(), decode: (data) => (typeof data === 'object' && data ? data : {}) },
    );
    return typeof result.status === 'string' && CONFIRMED_STATUSES.has(result.status.toLowerCase());
  } catch (error) {
    if (routeMissing(error)) return false;
    throw error;
  }
}

/**
 * `confirmCheckout` up to three times, `checkoutConfirmGapMs` apart, as iOS
 * `handleCheckoutReturn` runs it (best-effort: a throw counts as not yet).
 */
export async function confirmCheckoutWithRetries(externalSessionId: string, attempts = 3): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(paymentTiming().checkoutConfirmGapMs);
    try {
      if (await confirmCheckout(externalSessionId)) return true;
    } catch {
      // Best effort: the polls that follow are the verified path.
    }
  }
  return false;
}

/**
 * `GET /payments/status?plan=`: polls until the server's fulfilment lands.
 * The server only ever says `pending` or `fulfilled`, and only for a
 * subscription fulfilled in the last 15 minutes or so (a pass mints no row it
 * can find, so a pass is confirmed from the profile instead). Attempt n waits
 * min(n + 1, 5) seconds before the next. A refusal is thrown (the caller
 * shows it in the member's words, never a status code).
 */
export async function pollPaymentStatus(plan?: string | null, maxAttempts = 12): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await apiGet<{ status?: unknown }>(
      '/payments/status',
      { plan: plan ?? undefined },
      { decode: (data) => (typeof data === 'object' && data ? data : {}) },
    );
    if (result.status === 'fulfilled') return true;
    if (attempt < maxAttempts) await sleep(Math.min(attempt + 1, 5) * paymentTiming().statusBackoffUnitMs);
  }
  return false;
}
