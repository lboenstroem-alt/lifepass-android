/**
 * The live side of every hosted-page rail: save the attempt, open the page,
 * settle it, and hand the screen the result. The rails' screens and stores
 * (BOOK-1, CLASS-2, CHECKIN-2, PLANS-2, ACCT-2, ACCT-3) call these instead of
 * opening a page themselves, so every page is saved before it opens and
 * settled by one owner.
 *
 *   const result = await payOnHostedPage({ memberId, rail: 'booking', url, key, amountIsk, booking, isScreenAlive });
 *   // result.settlement: fulfilled | outcome | sessionNotFound | failed (./bookingPaymentSession)
 *   // result.attempt: hold it while the outcome is `processing` (Check again), then
 *   //   checkPaymentAgain(result.attempt) or leaveAttempt(result.attempt).
 *
 * THE SCREEN THAT WENT AWAY. With "Don't keep activities" (or a low-memory
 * phone that keeps the process but not the activity) the screen that opened
 * the page can be gone when it closes, while this code still runs. Pass
 * `isScreenAlive`: when it says no, the outcome is shown through the rail's
 * presenter (./presenters) instead of a screen nobody sees.
 */
import { useAppStore } from '../stores/appStore';

import {
  keyDisposition,
  PAGE_NEVER_OPENED,
  type PaySettlement,
} from './bookingPaymentSession';
import { startCardSetup, type ConfirmedCard } from './cardSetup';
import { checkRecordAgain, forgetPendingReturn, recoverPayments, recoveryIdle } from './coldStartRecovery';
import { openHostedPage, isHostedPageOpen, type HostedPageLeg } from './hostedPage';
import {
  claimAttempt,
  clearInflight,
  hasLiveAttempt,
  holdAttempt,
  isAttemptLive,
  railFamily,
  readInflight,
  releaseAttempt,
  resumeAttempt,
  saveInflight,
  updateInflight,
  type BookingAttemptContext,
  type InflightRecord,
  type NewInflightRecord,
  type PlanAttemptContext,
  type WalkInAttemptContext,
} from './inflight';
import { profileConfirmsPurchase, type PlanVerification } from './planVerification';
import { presentResolution, shouldPresent } from './presenters';
import { settleRecord, type Settled } from './resolve';

/** A screen's attempt, while it still holds it (a payment still settling). */
export interface AttemptRef {
  readonly attemptId: string;
  readonly memberId: string;
}

/** Live records, by attempt id, while their screen holds them. */
const held = new Map<string, InflightRecord>();

function stillSignedIn(memberId: string): boolean {
  const { isAuthenticated, userId, profile } = useAppStore.getState();
  return isAuthenticated && (userId ?? profile?.id ?? '').toLowerCase() === memberId.toLowerCase();
}

/**
 * Before a new charged attempt: any earlier attempt of the member's left
 * unresolved (a cold start, a screen that went away) is settled first, and
 * its outcome shown, so a new attempt never starts under a new key while an
 * old payment is still unknown on the phone. Call it before the attempt's
 * first create (the booking, the walk-in, the checkout); the page openers
 * below call it too, as a backstop.
 */
export async function settleUnresolvedPayments(memberId: string): Promise<void> {
  await recoveryIdle(memberId);
  const records = await readInflight(memberId);
  if (records.some((record) => !isAttemptLive(record.attemptId))) {
    await recoverPayments(memberId, 'launch');
  }
}

/** Page families a flow is opening right now (between the tap and the claim). */
const opening = new Set<'payment' | 'cardSetup'>();

/**
 * Saves the attempt, claims it, and opens its page. Null when a page is
 * already open, or another payment of this kind is being opened or settled
 * by a flow here (a second tap). The family is reserved before the first
 * wait, so two taps together can never both open a page.
 *
 * `url` may be a function that makes the page (the card setup session), run
 * inside the reservation; if it throws, nothing is saved and the error
 * propagates.
 */
async function begin(record: NewInflightRecord, url: string | (() => Promise<string>)) {
  const family = railFamily(record.rail);
  if (opening.has(family) || isHostedPageOpen() || hasLiveAttempt(family, 'flow')) return null;
  opening.add(family);
  let saved: InflightRecord;
  let pageUrl: string;
  try {
    await settleUnresolvedPayments(record.memberId);
    if (isHostedPageOpen() || hasLiveAttempt(family, 'flow')) return null;
    pageUrl = typeof url === 'string' ? url : await url();
    saved = await saveInflight(record);
    claimAttempt(saved.attemptId, family, 'flow');
  } finally {
    opening.delete(family);
  }
  // No link that arrived before this page opened can be this page's.
  forgetPendingReturn();
  const page = await openHostedPage(pageUrl, family);
  return { saved, page };
}

/**
 * Settles an attempt this flow holds. The settling is written never to throw;
 * should it ever, the claim is let go before the error goes on, so one bad
 * answer cannot leave every later page of its kind "busy" until the app
 * restarts. The record stays saved: a later return to the app settles it.
 */
async function settleClaimed(saved: InflightRecord, leg: 'done' | 'cancel'): Promise<Settled> {
  try {
    return await settleRecord(saved, leg);
  } catch (error) {
    held.delete(saved.attemptId);
    releaseAttempt(saved.attemptId);
    throw error;
  }
}

/** Ends a live attempt: its record per `settled`, its claim, and the outcome if the screen is gone. */
async function finish(
  saved: InflightRecord,
  settled: Settled,
  isScreenAlive: (() => boolean) | undefined,
): Promise<{ presented: boolean; attempt: AttemptRef | null }> {
  if (settled.record === 'clear') await clearInflight(saved.memberId, saved.attemptId);
  const screenGone = isScreenAlive !== undefined && !isScreenAlive();
  let presented = false;
  if (screenGone && shouldPresent(settled.resolution) && stillSignedIn(saved.memberId)) {
    presentResolution(settled.resolution, { checkAgain: () => void checkRecordAgain(saved) });
    presented = true;
  }
  if (settled.record === 'keep' && !screenGone) {
    // Still settling: the screen holds it (Check again) until it lets go.
    held.set(saved.attemptId, saved);
    holdAttempt(saved.attemptId);
    return { presented, attempt: { attemptId: saved.attemptId, memberId: saved.memberId } };
  }
  if (settled.record === 'keep' && presented) {
    await updateInflight(saved.memberId, saved.attemptId, (record) => ({ ...record, presentedProcessing: true }));
  }
  releaseAttempt(saved.attemptId);
  return { presented, attempt: null };
}

// ---------------------------------------------------------------------------
// Bookings, classes and walk-ins: the pay-and-save-card page

export interface PayOnHostedPageInput {
  readonly memberId: string;
  /** The page Kling's session answered with (`PaymentSessionCreation.redirect.url`). */
  readonly url: string;
  /** The action's Idempotency-Key, the session's and the confirm's. */
  readonly key: string;
  /** The amount consented to (the 402 offer's). */
  readonly amountIsk: number;
  /** False once the screen that started this is gone (see the file comment). */
  readonly isScreenAlive?: () => boolean;
  /** The page closed and the confirm starts (a spinner over the sheet). */
  readonly onConfirming?: (leg: HostedPageLeg) => void;
}

export type PayOnHostedPageRequest = PayOnHostedPageInput &
  (
    | { readonly rail: 'booking'; readonly booking: BookingAttemptContext }
    | { readonly rail: 'walk_in'; readonly walkIn: WalkInAttemptContext }
  );

export type HostedPayResult =
  /** Another hosted page is open, or a payment is being settled: nothing happened (a second tap). */
  | { readonly kind: 'busy' }
  | {
      readonly kind: 'settled';
      /** `neverOpened`: the page never came up; the settlement is `notPaid` and nothing was asked. */
      readonly page: 'returned' | 'neverOpened';
      readonly leg: HostedPageLeg | null;
      readonly settlement: PaySettlement;
      /** `reuse`: keep the key for Check again; `retire`: the next attempt is a new key. */
      readonly key: 'reuse' | 'retire';
      /** F8 showed the outcome itself (the screen was gone). */
      readonly presented: boolean;
      /** Held while the payment is still settling: pass to `checkPaymentAgain` or `leaveAttempt`. */
      readonly attempt: AttemptRef | null;
    };

/**
 * Opens the pay-and-save-card page for a booking, class or walk-in and
 * settles it: always asks the server after a page that opened (the link says
 * nothing about the money), five times on the Done leg and once after the
 * cancel link. A page that never opened ends as `notPaid` without asking.
 */
export async function payOnHostedPage(request: PayOnHostedPageRequest): Promise<HostedPayResult> {
  const base = { memberId: request.memberId, key: request.key, amountIsk: request.amountIsk };
  const record: NewInflightRecord =
    request.rail === 'booking'
      ? { ...base, rail: 'booking', booking: request.booking }
      : { ...base, rail: 'walk_in', walkIn: request.walkIn };
  const started = await begin(record, request.url);
  if (!started) return { kind: 'busy' };
  const { saved, page } = started;
  if (page.kind === 'neverOpened') {
    await clearInflight(saved.memberId, saved.attemptId);
    releaseAttempt(saved.attemptId);
    return {
      kind: 'settled',
      page: 'neverOpened',
      leg: null,
      settlement: PAGE_NEVER_OPENED,
      key: 'retire',
      presented: false,
      attempt: null,
    };
  }
  request.onConfirming?.(page.leg);
  const settled = await settleClaimed(saved, page.leg);
  const settlement = paySettlementOf(settled);
  const { presented, attempt } = await finish(saved, settled, request.isScreenAlive);
  return { kind: 'settled', page: 'returned', leg: page.leg, settlement, key: keyDisposition(settlement), presented, attempt };
}

function paySettlementOf(settled: Settled): PaySettlement {
  const { resolution } = settled;
  if (resolution.rail === 'booking' || resolution.rail === 'walk_in') return resolution.settlement;
  throw new Error('not a pay-and-save-card attempt');
}

/**
 * Check again for an attempt still settling: the same key, the Done leg (five
 * answers). The screen keeps holding the attempt while it is still settling.
 */
export async function checkPaymentAgain(
  attempt: AttemptRef,
  isScreenAlive?: () => boolean,
): Promise<HostedPayResult> {
  const saved = held.get(attempt.attemptId);
  if (!saved || !isAttemptLive(attempt.attemptId)) return { kind: 'busy' };
  held.delete(attempt.attemptId);
  resumeAttempt(attempt.attemptId);
  const settled = await settleClaimed(saved, 'done');
  const settlement = paySettlementOf(settled);
  const finished = await finish(saved, settled, isScreenAlive);
  return {
    kind: 'settled',
    page: 'returned',
    leg: 'done',
    settlement,
    key: keyDisposition(settlement),
    presented: finished.presented,
    attempt: finished.attempt,
  };
}

/**
 * The screen let go of an attempt still settling (the member closed the
 * "Confirming your payment" alert, or the sheet). Its record stays: a later
 * return to the app checks again quietly and speaks when it settles.
 */
export async function leaveAttempt(attempt: AttemptRef): Promise<void> {
  if (!held.delete(attempt.attemptId)) return;
  await updateInflight(attempt.memberId, attempt.attemptId, (record) => ({ ...record, presentedProcessing: true }));
  releaseAttempt(attempt.attemptId);
}

// ---------------------------------------------------------------------------
// Plans and passes: the hosted checkout

export interface CheckoutOnHostedPageInput {
  readonly memberId: string;
  /** The checkout page (`createCheckout`), or the web-first fallback's plans page. */
  readonly url: string;
  /** Kling's session for the verified pull; null on the web-first fallback. */
  readonly externalSessionId: string | null;
  readonly plan: PlanAttemptContext;
  readonly isScreenAlive?: () => boolean;
  /** The page closed and the verification starts ("Confirming your payment…" with Cancel). */
  readonly onVerifying?: () => void;
}

export type CheckoutResult =
  | { readonly kind: 'busy' }
  | { readonly kind: 'neverOpened' }
  | { readonly kind: 'verified'; readonly verification: PlanVerification; readonly presented: boolean };

/**
 * Opens a plan or pass checkout and verifies it on return (iOS
 * `handleCheckoutReturn`): nothing after the cancel link, else the verified
 * pull and the polls (./planVerification).
 */
export async function checkoutOnHostedPage(input: CheckoutOnHostedPageInput): Promise<CheckoutResult> {
  const started = await begin(
    { rail: 'plan', memberId: input.memberId, externalSessionId: input.externalSessionId, plan: input.plan },
    input.url,
  );
  if (!started) return { kind: 'busy' };
  const { saved, page } = started;
  if (page.kind === 'neverOpened') {
    await clearInflight(saved.memberId, saved.attemptId);
    releaseAttempt(saved.attemptId);
    return { kind: 'neverOpened' };
  }
  if (page.leg !== 'cancel') input.onVerifying?.();
  const settled = await settleClaimed(saved, page.leg);
  const { presented } = await finish(saved, settled, input.isScreenAlive);
  const verification =
    settled.resolution.rail === 'plan' ? settled.resolution.verification : ({ kind: 'timeout' } as const);
  return { kind: 'verified', verification, presented };
}

/**
 * The "Completed your purchase? Tap to check" chip (iOS `recheckPurchase`):
 * two profile reads, a short check the member asked for. Confirmed, or still
 * unverified (the chip stays).
 */
export async function recheckPlanPurchase(plan: PlanAttemptContext): Promise<PlanVerification> {
  return (await profileConfirmsPurchase(plan, 2)) ? { kind: 'confirmed' } : { kind: 'unverified' };
}

// ---------------------------------------------------------------------------
// Card setup (Account's add or replace card)

export type CardSetupResult =
  | { readonly kind: 'busy' }
  /** The setup session could not be made, or its page never opened: `account.card_add_failed`. */
  | { readonly kind: 'notOpened'; readonly error: unknown }
  /** The page closed; the verified pull ran. `card` is undefined when the pull itself failed. Re-read billing either way. */
  | { readonly kind: 'confirmed'; readonly card: ConfirmedCard | null | undefined };

/**
 * Account's Add card / Replace card: creates the setup session, opens it,
 * and ALWAYS runs the verified confirm after the page, whichever link (or
 * none) closed it.
 */
export async function cardSetupOnHostedPage(input: {
  readonly memberId: string;
  readonly isScreenAlive?: () => boolean;
}): Promise<CardSetupResult> {
  let started: Awaited<ReturnType<typeof begin>>;
  try {
    started = await begin({ rail: 'card_setup', memberId: input.memberId }, startCardSetup);
  } catch (error) {
    return { kind: 'notOpened', error };
  }
  if (!started) return { kind: 'busy' };
  const { saved, page } = started;
  if (page.kind === 'neverOpened') {
    await clearInflight(saved.memberId, saved.attemptId);
    releaseAttempt(saved.attemptId);
    return { kind: 'notOpened', error: page.error };
  }
  const settled = await settleClaimed(saved, page.leg);
  await finish(saved, settled, input.isScreenAlive);
  const card = settled.resolution.rail === 'card_setup' ? settled.resolution.card : undefined;
  return { kind: 'confirmed', card };
}

// ---------------------------------------------------------------------------
// Company co-pay checkouts

export type CopayResult =
  | { readonly kind: 'busy' }
  | { readonly kind: 'neverOpened' }
  /** `settled`: the membership shows the result (a plan, or no longer past due). */
  | { readonly kind: 'returned'; readonly settled: boolean };

/**
 * A co-pay checkout (`POST /company-plans/activate`'s or `/retry-payment`'s
 * page): after it closes, however it closed, the verified pull and the
 * membership re-reads (iOS `settleActivationReturn` / `settleRetryReturn`).
 */
export async function copayOnHostedPage(input: {
  readonly memberId: string;
  readonly purpose: 'activate' | 'retry';
  readonly url: string;
  readonly externalSessionId: string | null;
  readonly isScreenAlive?: () => boolean;
}): Promise<CopayResult> {
  const started = await begin(
    { rail: 'copay', memberId: input.memberId, purpose: input.purpose, externalSessionId: input.externalSessionId },
    input.url,
  );
  if (!started) return { kind: 'busy' };
  const { saved, page } = started;
  if (page.kind === 'neverOpened') {
    await clearInflight(saved.memberId, saved.attemptId);
    releaseAttempt(saved.attemptId);
    return { kind: 'neverOpened' };
  }
  // A co-pay page returns to the website, not the app, so the leg says
  // nothing: settle it the same way after any close.
  const settled = await settleClaimed(saved, 'done');
  await finish(saved, settled, input.isScreenAlive);
  return { kind: 'returned', settled: settled.resolution.rail === 'copay' && settled.resolution.settled };
}

/** Tests only: forget held attempts. */
export function resetAttemptsForTests(): void {
  held.clear();
  opening.clear();
}
