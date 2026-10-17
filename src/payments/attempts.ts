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
 * ONE KEY, ONE ATTEMPT. A retry under the same Idempotency-Key (iOS keeps the
 * key after `processing` and after a confirm that did not answer, and the
 * next Confirm reuses it) is the SAME payment: the server resumes the same
 * session. Its saved record is replaced by the new one (./inflight), never
 * settled beside it, so the member hears one outcome. And when that payment
 * was settled a moment ago by someone else (the recovery after a cold
 * start), the page is not opened again: the result is that settlement.
 *
 * NO NEW KEY WHILE AN EARLIER ATTEMPT IS UNKNOWN (critic-hosted-payment-
 * process-death, step 4). A new attempt at the same action (the same class or
 * slot, a walk-in at the same venue, the same plan or pass) under a different
 * key, while an earlier attempt's record is unresolved, opens nothing: the
 * result is `unresolved`, with the earlier attempt handed to the screen to
 * show as "Confirming your payment" with Check again under ITS key. When the
 * earlier attempt settles as paid while the new one waits for it, the result
 * is that settlement. Unrelated records are left to the recovery (launch and
 * return to the app): a tap is never kept waiting on someone else's payment.
 *
 * THE SCREEN THAT WENT AWAY. With "Don't keep activities" (or a low-memory
 * phone that keeps the process but not the activity) the screen that opened
 * the page can be gone when it closes, while this code still runs. Pass
 * `isScreenAlive`: when it says no, the outcome is shown through the rail's
 * presenter (./presenters) instead of a screen nobody sees, and an attempt it
 * held for Check again goes back to the recovery.
 */
import { useAppStore } from '../stores/appStore';

import {
  keyDisposition,
  PAGE_NEVER_OPENED,
  type PaySettlement,
} from './bookingPaymentSession';
import { startCardSetup, type ConfirmedCard } from './cardSetup';
import { checkRecordAgain, forgetPendingReturn, recoveryIdle } from './coldStartRecovery';
import {
  noteResolved,
  recentResolutions,
  resolutionMark,
  takeRecentResolution,
  type RecentResolution,
} from './earlier';
import { openHostedPage, isHostedPageOpen, type HostedPageLeg, type HostedPageResult } from './hostedPage';
import {
  attemptAction,
  attemptIdentity,
  attemptState,
  claimAttempt,
  clearInflight,
  hasLiveAttempt,
  heldRecord,
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
import { holdPresentations, presentResolution, shouldPresent, type PaymentResolution } from './presenters';
import { settleRecord, stillSettling, type Settled } from './resolve';

/** A screen's attempt, while it still holds it (a payment still settling). */
export interface AttemptRef {
  readonly attemptId: string;
  readonly memberId: string;
}

function stillSignedIn(memberId: string): boolean {
  const { isAuthenticated, userId, profile } = useAppStore.getState();
  return isAuthenticated && (userId ?? profile?.id ?? '').toLowerCase() === memberId.toLowerCase();
}

/** What the phone knows about the member's earlier payments (`unresolvedPayments`). */
export interface UnresolvedPayments {
  /** Paid or parked answers found in the last couple of minutes by the recovery or a presenter. */
  readonly resolved: readonly RecentResolution[];
  /** Saved attempts still unresolved that no screen here is settling. */
  readonly unresolved: readonly InflightRecord[];
}

/**
 * Waits for whatever the recovery is settling for the member, then says what
 * is known: payments just settled as paid, and attempts still unresolved. It
 * asks the server nothing itself. The page openers below apply it to the
 * attempt they open (see the file comment); a flow may also call it before
 * its first create, to avoid making a session it will not open.
 */
export async function unresolvedPayments(memberId: string): Promise<UnresolvedPayments> {
  await recoveryIdle(memberId);
  const records = await readInflight(memberId);
  return {
    resolved: recentResolutions(memberId),
    unresolved: records.filter((record) => !isAttemptLive(record.attemptId)),
  };
}

/** Page families a flow is opening right now (between the tap and the claim). */
const opening = new Set<'payment' | 'cardSetup'>();

/** An earlier attempt that decides the new one instead of a new page. */
type Earlier =
  /** Paid (or parked) a moment ago: the result is that, and no page opens. */
  | { readonly kind: 'resolved'; readonly resolution: PaymentResolution; readonly presented: boolean }
  /** Still unresolved under another key: handed to the screen (`attempt`), no page opens. */
  | { readonly kind: 'unresolved'; readonly record: InflightRecord; readonly attempt: AttemptRef };

type Begun =
  | { readonly kind: 'busy' }
  | { readonly kind: 'earlier'; readonly earlier: Earlier }
  | { readonly kind: 'opened'; readonly saved: InflightRecord; readonly page: HostedPageResult };

const BUSY = Object.freeze({ kind: 'busy' } as const);

/**
 * What the earlier attempts of `next`'s payment and action say before its page
 * opens (see the file comment). Waits for the recovery only when a record of
 * this payment or action is saved (it may be settling it: a record goes only
 * after its answer is noted), never for anyone else's; never asks the
 * server. `busy` when such an attempt is being settled by a flow right now.
 */
async function earlierAttempt(
  next: NewInflightRecord,
  isScreenAlive: (() => boolean) | undefined,
): Promise<Earlier | 'busy' | null> {
  const identity = attemptIdentity(next);
  const action = attemptAction(next);
  if (identity === null && action === null) return null;
  const memberId = next.memberId.toLowerCase();
  const mark = resolutionMark();
  const related = (records: readonly InflightRecord[]) =>
    records.filter(
      (record) =>
        (identity !== null && attemptIdentity(record) === identity) || (action !== null && attemptAction(record) === action),
    );
  let saved = related(await readInflight(memberId));
  if (saved.length > 0) {
    await recoveryIdle(memberId);
    saved = related(await readInflight(memberId));
  }

  const recent = takeRecentResolution(next, mark);
  if (recent) return { kind: 'resolved', resolution: recent.resolution, presented: recent.presented };

  for (const record of saved) {
    if (attemptState(record.attemptId)?.phase === 'active') return 'busy';
  }
  const other = saved.find((record) => identity === null || attemptIdentity(record) !== identity);
  if (other) {
    // Taken over from any screen that held it: this one shows it now.
    releaseAttempt(other.attemptId);
    claimAttempt(other.attemptId, railFamily(other.rail), 'flow');
    holdAttempt(other.attemptId, { record: other, isScreenAlive });
    return { kind: 'unresolved', record: other, attempt: { attemptId: other.attemptId, memberId: other.memberId } };
  }
  // The same payment again (a retry under its key): the screen that held it
  // lets go, and the new record replaces it.
  for (const record of saved) releaseAttempt(record.attemptId);
  return null;
}

/**
 * Saves the attempt, claims it, and opens its page; or says why not. `busy`
 * when a page is already open, or another payment of this kind is being
 * opened or settled by a flow here (a second tap). The family is reserved
 * before the first wait, so two taps together can never both open a page.
 *
 * `url` may be a function that makes the page (the card setup session); it
 * runs first, inside the reservation, so the member's tap is answered as
 * soon as the server answers. If it throws, nothing is saved and the error
 * propagates.
 */
async function begin(
  record: NewInflightRecord,
  url: string | (() => Promise<string>),
  isScreenAlive: (() => boolean) | undefined,
): Promise<Begun> {
  const family = railFamily(record.rail);
  if (opening.has(family) || isHostedPageOpen() || hasLiveAttempt(family, 'flow')) return BUSY;
  opening.add(family);
  let saved: InflightRecord;
  let pageUrl: string;
  try {
    pageUrl = typeof url === 'string' ? url : await url();
    const earlier = await earlierAttempt(record, isScreenAlive);
    if (earlier === 'busy') return BUSY;
    if (earlier) return { kind: 'earlier', earlier };
    if (isHostedPageOpen() || hasLiveAttempt(family, 'flow')) return BUSY;
    saved = await saveInflight(record);
    claimAttempt(saved.attemptId, family, 'flow');
  } finally {
    opening.delete(family);
  }
  // No link that arrived before this page opened can be this page's.
  forgetPendingReturn();
  const page = await openHostedPage(pageUrl, family);
  return { kind: 'opened', saved, page };
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
    releaseAttempt(saved.attemptId);
    throw error;
  }
}

/**
 * Ends a live attempt: its record per `settled`, its claim, and the outcome if
 * the screen is gone. Only a payment the server says is still settling is
 * held for the screen's Check again; a confirm that did not answer goes back
 * to the recovery (iOS offers no Check again after one; the next return to
 * the app asks again quietly, and a retry under the same key replaces it).
 */
async function finish(
  saved: InflightRecord,
  settled: Settled,
  isScreenAlive: (() => boolean) | undefined,
): Promise<{ presented: boolean; attempt: AttemptRef | null }> {
  const screenGone = isScreenAlive !== undefined && !isScreenAlive();
  const presented = screenGone && shouldPresent(settled.resolution) && stillSignedIn(saved.memberId);
  if (settled.record === 'clear') {
    // What the member was told, for a retry from another screen (./earlier).
    if (presented) noteResolved(saved, settled.resolution, true);
    await clearInflight(saved.memberId, saved.attemptId);
  }
  if (presented) presentResolution(settled.resolution, { checkAgain: () => void checkRecordAgain(saved) });
  if (settled.record === 'clear') {
    releaseAttempt(saved.attemptId);
    return { presented, attempt: null };
  }
  const settling = stillSettling(settled.resolution);
  if (settling && !screenGone) {
    // Still settling: the screen holds it (Check again) until it lets go.
    holdAttempt(saved.attemptId, { record: saved, isScreenAlive });
    return { presented, attempt: { attemptId: saved.attemptId, memberId: saved.memberId } };
  }
  if (settling && presented) {
    await updateInflight(saved.memberId, saved.attemptId, (record) => ({ ...record, presentedProcessing: true }));
  }
  releaseAttempt(saved.attemptId);
  return { presented, attempt: null };
}

/** Ends a page that never came up: nothing can have been paid on it, so its record goes. */
async function endNeverOpened(saved: InflightRecord): Promise<void> {
  await clearInflight(saved.memberId, saved.attemptId);
  releaseAttempt(saved.attemptId);
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

/** What a screen shows for an earlier attempt still unresolved: "Confirming your payment" with Check again. */
export const EARLIER_STILL_CONFIRMING: PaySettlement = Object.freeze({
  kind: 'outcome',
  outcome: Object.freeze({ kind: 'processing' }),
}) as PaySettlement;

export type HostedPayResult =
  /** Another hosted page is open, or a payment is being settled: nothing happened (a second tap). */
  | { readonly kind: 'busy' }
  | {
      readonly kind: 'settled';
      /**
       * `neverOpened`: the page never came up; the settlement is `notPaid` and
       * nothing was asked. `earlier`: no page opened, because this payment (or
       * this action under another key) was settled as paid a moment ago,
       * while the member waited; `presented` says whether they were told.
       */
      readonly page: 'returned' | 'neverOpened' | 'earlier';
      readonly leg: HostedPageLeg | null;
      readonly settlement: PaySettlement;
      /** `reuse`: keep the key for Check again; `retire`: the next attempt is a new key. */
      readonly key: 'reuse' | 'retire';
      /** F8 showed the outcome itself (the screen was gone, or the recovery said it). */
      readonly presented: boolean;
      /** Held while the payment is still settling: pass to `checkPaymentAgain` or `leaveAttempt`. */
      readonly attempt: AttemptRef | null;
    }
  /**
   * An earlier attempt at this same action, under another key, is still
   * unresolved: no page opened. Show `settlement` ("Confirming your
   * payment", Check again) for `attempt`, which this screen now holds:
   * `checkPaymentAgain(attempt)` asks under the earlier key, `leaveAttempt`
   * lets it go. Nothing was paid under this attempt's own key.
   */
  | { readonly kind: 'unresolved'; readonly attempt: AttemptRef; readonly settlement: PaySettlement };

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
  const release = holdPresentations();
  try {
    const started = await begin(record, request.url, request.isScreenAlive);
    if (started.kind === 'busy') return BUSY;
    if (started.kind === 'earlier') return payResultOfEarlier(started.earlier);
    const { saved, page } = started;
    if (page.kind === 'neverOpened') {
      await endNeverOpened(saved);
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
    const settlement = paySettlementOf(settled.resolution);
    const { presented, attempt } = await finish(saved, settled, request.isScreenAlive);
    return { kind: 'settled', page: 'returned', leg: page.leg, settlement, key: keyDisposition(settlement), presented, attempt };
  } finally {
    release();
  }
}

function payResultOfEarlier(earlier: Earlier): HostedPayResult {
  if (earlier.kind === 'unresolved') {
    return { kind: 'unresolved', attempt: earlier.attempt, settlement: EARLIER_STILL_CONFIRMING };
  }
  const settlement = paySettlementOf(earlier.resolution);
  return {
    kind: 'settled',
    page: 'earlier',
    leg: null,
    settlement,
    key: keyDisposition(settlement),
    presented: earlier.presented,
    attempt: null,
  };
}

function paySettlementOf(resolution: PaymentResolution): PaySettlement {
  if (resolution.rail === 'booking' || resolution.rail === 'walk_in') return resolution.settlement;
  throw new Error('not a pay-and-save-card attempt');
}

/** Takes back an attempt this screen holds (null when it no longer holds it). */
function takeHeld(attempt: AttemptRef): InflightRecord | null {
  const record = heldRecord(attempt.attemptId);
  if (!record) return null;
  resumeAttempt(attempt.attemptId);
  return record;
}

/**
 * Check again for an attempt still settling: the same key, the Done leg (five
 * answers). The screen keeps holding the attempt while it is still settling.
 */
export async function checkPaymentAgain(
  attempt: AttemptRef,
  isScreenAlive?: () => boolean,
): Promise<HostedPayResult> {
  const saved = takeHeld(attempt);
  if (!saved || (saved.rail !== 'booking' && saved.rail !== 'walk_in')) return BUSY;
  const release = holdPresentations();
  try {
    const settled = await settleClaimed(saved, 'done');
    const settlement = paySettlementOf(settled.resolution);
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
  } finally {
    release();
  }
}

/**
 * The screen let go of an attempt it held (the member closed the "Confirming
 * your payment" alert, or the sheet). Its record stays: a later return to
 * the app checks again quietly and speaks when it settles.
 */
export async function leaveAttempt(attempt: AttemptRef): Promise<void> {
  if (!heldRecord(attempt.attemptId)) return;
  releaseAttempt(attempt.attemptId);
  await updateInflight(attempt.memberId, attempt.attemptId, (record) => ({ ...record, presentedProcessing: true }));
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
  /**
   * The page closed and the purchase was verified; or (`presented` from the
   * recovery) the same plan or pass was confirmed a moment ago while the
   * member waited, and no second checkout opened.
   */
  | { readonly kind: 'verified'; readonly verification: PlanVerification; readonly presented: boolean }
  /**
   * An earlier checkout of this plan or pass is still unverified (its status
   * check did not answer): no page opened. Show "Confirming your payment…"
   * and `checkCheckoutAgain(attempt)`, or `leaveAttempt(attempt)`.
   */
  | { readonly kind: 'unresolved'; readonly attempt: AttemptRef };

function checkoutResultOfEarlier(earlier: Earlier): CheckoutResult {
  if (earlier.kind === 'unresolved') return { kind: 'unresolved', attempt: earlier.attempt };
  const verification =
    earlier.resolution.rail === 'plan' ? earlier.resolution.verification : ({ kind: 'timeout' } as const);
  return { kind: 'verified', verification, presented: earlier.presented };
}

/**
 * Opens a plan or pass checkout and verifies it on return (iOS
 * `handleCheckoutReturn`): nothing after the cancel link, else the verified
 * pull and the polls (./planVerification).
 */
export async function checkoutOnHostedPage(input: CheckoutOnHostedPageInput): Promise<CheckoutResult> {
  const release = holdPresentations();
  try {
    const started = await begin(
      { rail: 'plan', memberId: input.memberId, externalSessionId: input.externalSessionId, plan: input.plan },
      input.url,
      input.isScreenAlive,
    );
    if (started.kind === 'busy') return BUSY;
    if (started.kind === 'earlier') return checkoutResultOfEarlier(started.earlier);
    const { saved, page } = started;
    if (page.kind === 'neverOpened') {
      await endNeverOpened(saved);
      return { kind: 'neverOpened' };
    }
    if (page.leg !== 'cancel') input.onVerifying?.();
    const settled = await settleClaimed(saved, page.leg);
    const { presented } = await finish(saved, settled, input.isScreenAlive);
    return { kind: 'verified', verification: planVerificationOf(settled.resolution), presented };
  } finally {
    release();
  }
}

function planVerificationOf(resolution: PaymentResolution): PlanVerification {
  return resolution.rail === 'plan' ? resolution.verification : { kind: 'timeout' };
}

/**
 * Verifies again an earlier checkout handed to the screen as `unresolved`
 * (the verified pull and the polls, the Done leg).
 */
export async function checkCheckoutAgain(attempt: AttemptRef, isScreenAlive?: () => boolean): Promise<CheckoutResult> {
  const saved = takeHeld(attempt);
  if (!saved || saved.rail !== 'plan') return BUSY;
  const release = holdPresentations();
  try {
    const settled = await settleClaimed(saved, 'done');
    const { presented } = await finish(saved, settled, isScreenAlive);
    return { kind: 'verified', verification: planVerificationOf(settled.resolution), presented };
  } finally {
    release();
  }
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
 * Account's Add card / Replace card: creates the setup session first (the
 * page opens as soon as the server answers, as iOS's does), opens it, and
 * ALWAYS runs the verified confirm after the page, whichever link (or none)
 * closed it.
 */
export async function cardSetupOnHostedPage(input: {
  readonly memberId: string;
  readonly isScreenAlive?: () => boolean;
}): Promise<CardSetupResult> {
  const release = holdPresentations();
  try {
    let started: Begun;
    try {
      started = await begin({ rail: 'card_setup', memberId: input.memberId }, startCardSetup, input.isScreenAlive);
    } catch (error) {
      return { kind: 'notOpened', error };
    }
    if (started.kind !== 'opened') return BUSY;
    const { saved, page } = started;
    if (page.kind === 'neverOpened') {
      await endNeverOpened(saved);
      return { kind: 'notOpened', error: page.error };
    }
    const settled = await settleClaimed(saved, page.leg);
    await finish(saved, settled, input.isScreenAlive);
    const card = settled.resolution.rail === 'card_setup' ? settled.resolution.card : undefined;
    return { kind: 'confirmed', card };
  } finally {
    release();
  }
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
  const release = holdPresentations();
  try {
    const started = await begin(
      { rail: 'copay', memberId: input.memberId, purpose: input.purpose, externalSessionId: input.externalSessionId },
      input.url,
      input.isScreenAlive,
    );
    if (started.kind !== 'opened') return BUSY;
    const { saved, page } = started;
    if (page.kind === 'neverOpened') {
      await endNeverOpened(saved);
      return { kind: 'neverOpened' };
    }
    // A co-pay page returns to the website, not the app, so the leg says
    // nothing: settle it the same way after any close.
    const settled = await settleClaimed(saved, 'done');
    await finish(saved, settled, input.isScreenAlive);
    return { kind: 'returned', settled: settled.resolution.rail === 'copay' && settled.resolution.settled };
  } finally {
    release();
  }
}

/** Tests only: forget pages being opened. */
export function resetAttemptsForTests(): void {
  opening.clear();
}
