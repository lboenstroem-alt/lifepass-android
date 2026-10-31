/**
 * The pay-and-save-card rail for a charged booking, class or walk-in when the
 * member has NO saved card: the Android port of iOS `BookingPaymentService`
 * (Services/BookingPaymentService.swift) and of the confirm loop both iOS
 * flows run (`BookingViewModel.confirmBookingPayment`,
 * `CheckInViewModel.confirmWalkInPayment`), so BOOK-1, CLASS-2 and
 * CHECKIN-2 share one copy of the money rules.
 *
 * A charge-bearing booking or walk-in answers `402 no_payment_method_on_file`
 * when no card is vaulted. That 402 is the trigger: the app creates an
 * amount-only Kling hosted session (`POST /bookings/payment-sessions`, which
 * captures the charge AND vaults the card), opens the hosted page, and on
 * return calls `POST /bookings/payment-sessions/confirm`: a verified pull
 * that vaults the card and then runs the booking or check-in with the money
 * already captured.
 *
 * IDEMPOTENCY. The create MUST send the SAME Idempotency-Key the direct
 * booking or walk-in used for this action, so paying through the session and
 * booking directly can never both happen. The confirm resolves the session
 * by that same key (Kling does not put its session id in the return link).
 *
 * THE AMOUNT is always the create's own 402 offer, the one the member just
 * consented to, never the preview's figure: the server re-prices the session
 * and refuses any other amount with a new offer before a page exists.
 */
import {
  API_TIMEOUTS,
  apiPost,
  isProblem,
  ProblemError,
  TransportError,
  type ChargeConsentOffer,
} from '../api';
import { toWireDate, wireId } from '../api/wire';

import { paymentTiming, sleep } from './timing';

// ---------------------------------------------------------------------------
// The session's body

/** A guest seat's band on the wire. */
export type GuestAgeBand = 'adult' | 'child' | 'infant';

/** A slot booking's session: the slot's own times, and the party and rung it is priced at. */
export interface SlotPaymentSession {
  readonly kind: 'slot';
  readonly activityId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** The 402 offer's amount, the one consented to. */
  readonly acceptedChargeAmountIsk: number;
  /**
   * People on a group booking, the member included (only above 1). The
   * captured amount is the GROUP total and fulfilment replays the same size;
   * dropping it would misprice the booking and refund it.
   */
  readonly participants?: number | null;
  /** One band per guest seat (the member is never in it). */
  readonly guestAgeBands?: readonly string[] | null;
  /** The premium rung the session is priced at (`spend_visit` | `keep_visit`); fulfilment replays it. */
  readonly visitChoice?: string | null;
}

/**
 * An Abler class's session, by its event (2.5.5; the server accepts it since
 * web 906f07f8, openapi 0.27.0). The server derives the class's times and
 * refuses a time, a group, a rung, age bands and a walk-in action beside an
 * `eventId` (400), so the class shape is exactly these keys.
 */
export interface ClassPaymentSession {
  readonly kind: 'class';
  readonly activityId: string;
  readonly eventId: number;
  readonly acceptedChargeAmountIsk: number;
}

/** A walk-in's session at the door. */
export interface WalkInPaymentSession {
  readonly kind: 'walk_in';
  /** The picked activity, or null for a venue-level walk-in (the key is sent either way). */
  readonly activityId: string | null;
  readonly venueId: string;
  readonly acceptedChargeAmountIsk: number;
  /** One band per guest seat. */
  readonly guestAgeBands?: readonly string[] | null;
  /**
   * The attendance choice (`attend` | `walk_in`). With guests it is always
   * `walk_in` (see `paymentSessionBody`).
   */
  readonly bookingAction?: string | null;
}

export type PaymentSessionInput = SlotPaymentSession | ClassPaymentSession | WalkInPaymentSession;

/** The session's body as the server reads it (`POST /bookings/payment-sessions`). */
export type PaymentSessionBody = Readonly<Record<string, string | number | null | readonly string[]>>;

/**
 * The exact body for `input`, keys in the order iOS encodes them.
 *
 * - A class is the class shape only: `kind`, `activityId`, `eventId`,
 *   `acceptedChargeAmountIsk`, whatever else the caller's object carries.
 * - `activityId` is always present (JSON null for a venue-level walk-in): the
 *   server's schema requires the key.
 * - `guestAgeBands` is left out when empty: the walk-in branch refuses the key
 *   outright, and the bands are what fulfilment reserves (adult tickets for
 *   children paid at a child price otherwise).
 * - A walk-in with guests always says `bookingAction: "walk_in"`: the
 *   mint-side guard refuses guest bands without an explicit walk-in (an
 *   adoptable booking would otherwise be charged and then refunded).
 * - Ids go out lower case, times as ISO-8601 UTC with no fraction (the server
 *   refuses a bare date).
 */
export function paymentSessionBody(input: PaymentSessionInput): PaymentSessionBody {
  const amount = input.acceptedChargeAmountIsk;
  switch (input.kind) {
    case 'class':
      return {
        kind: 'booking',
        activityId: wireId(input.activityId),
        eventId: input.eventId,
        acceptedChargeAmountIsk: amount,
      };
    case 'slot': {
      const body: Record<string, string | number | null | readonly string[]> = {
        kind: 'booking',
        activityId: wireId(input.activityId),
        startsAt: toWireDate(input.startsAt),
        endsAt: toWireDate(input.endsAt),
        acceptedChargeAmountIsk: amount,
      };
      if (input.participants != null) body.participants = input.participants;
      const bands = nonEmpty(input.guestAgeBands);
      if (bands) body.guestAgeBands = bands;
      if (input.visitChoice != null) body.visitChoice = input.visitChoice;
      return body;
    }
    case 'walk_in': {
      const body: Record<string, string | number | null | readonly string[]> = {
        kind: 'walk_in',
        activityId: input.activityId === null ? null : wireId(input.activityId),
        venueId: wireId(input.venueId),
        acceptedChargeAmountIsk: amount,
      };
      const bands = nonEmpty(input.guestAgeBands);
      if (bands) body.guestAgeBands = bands;
      const action = bands ? 'walk_in' : input.bookingAction;
      if (action != null) body.bookingAction = action;
      return body;
    }
  }
}

function nonEmpty(bands: readonly string[] | null | undefined): readonly string[] | null {
  return bands && bands.length > 0 ? [...bands] : null;
}

// ---------------------------------------------------------------------------
// Create

/**
 * The create's answer: `hasCard` means a card exists after all (a race
 * vaulted one), so the caller books or checks in directly, with consent,
 * under the same key; `redirect` carries the hosted page to open.
 */
export type PaymentSessionCreation =
  | { readonly kind: 'hasCard' }
  | { readonly kind: 'redirect'; readonly url: string; readonly externalSessionId: string; readonly amountIsk: number };

function decodeCreation(data: unknown, acceptedAmount: number): PaymentSessionCreation {
  const json = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  if (json.hasCard === true) return { kind: 'hasCard' };
  const url = typeof json.url === 'string' ? json.url : null;
  const externalSessionId = typeof json.externalSessionId === 'string' ? json.externalSessionId : null;
  if (!url || !/^https?:\/\//i.test(url) || !externalSessionId) {
    // A contract violation (no card and no page): a retryable failure, never
    // a silent no-op that leaves the member waiting on nothing.
    throw new TransportError('network');
  }
  const amountIsk =
    typeof json.amountIsk === 'number' && Number.isInteger(json.amountIsk) ? json.amountIsk : acceptedAmount;
  return { kind: 'redirect', url, externalSessionId, amountIsk };
}

/** Creates in flight, by key: a second tap with the same key joins the first request. */
const creating = new Map<string, Promise<PaymentSessionCreation>>();

/**
 * `POST /bookings/payment-sessions` under the action's own key. A call while
 * one with the same key is in flight returns that one's answer, so a double
 * tap makes one session. Refusals are thrown as the client's `ApiError`s;
 * `classifySessionCreateError` reads them.
 */
export function createPaymentSession(
  input: PaymentSessionInput,
  idempotencyKey: string,
): Promise<PaymentSessionCreation> {
  const running = creating.get(idempotencyKey);
  if (running) return running;
  const request = apiPost('/bookings/payment-sessions', paymentSessionBody(input), {
    idempotencyKey,
    decode: (data) => data,
  })
    .then((data) => decodeCreation(data, input.acceptedChargeAmountIsk))
    .finally(() => {
      creating.delete(idempotencyKey);
    });
  creating.set(idempotencyKey, request);
  return request;
}

/** What a refused create means for the flow (iOS's catch ladder, in its order). */
export type SessionCreateRefusal =
  /**
   * `402 charge_consent_required` on the session: the price moved. Re-ask
   * consent with the new amount (and the price-changed note); the accepted
   * attempt comes back to this rail under the same key.
   */
  | { readonly kind: 'reoffer'; readonly offer: ChargeConsentOffer }
  /** `booking_payment_already_completed`: an earlier session already booked or checked this in. Success, paid. */
  | { readonly kind: 'alreadyCompleted' }
  /** `booking_payment_not_required`: no charge applies now. Book or check in directly, without consent, same key. */
  | { readonly kind: 'notRequired' }
  /** `booking_payment_unresolved`: an earlier payment is still resolving. The needs-attention outcome. */
  | { readonly kind: 'unresolved' }
  /**
   * `booking_payment_blocked` (walk-in only): walk-ins are off or the drop-in
   * price is unset. A dead end: `checkin.err.pay_blocked`, and the next scan
   * starts fresh.
   */
  | { readonly kind: 'blocked' }
  /**
   * A class refused with `400 invalid-booking-payment`: a server older than
   * web 906f07f8 does not know `eventId` on the session, and nothing was
   * charged. 2.5.4's "add a payment method" answer, not "check your details".
   */
  | { readonly kind: 'classNotSupported' }
  /** Anything else: the refusal table's words and step (`refusalMessage`). */
  | { readonly kind: 'refusal'; readonly error: unknown };

/** Reads a refused `createPaymentSession` for the flow that made it. */
export function classifySessionCreateError(
  error: unknown,
  input: Pick<PaymentSessionInput, 'kind'>,
): SessionCreateRefusal {
  if (error instanceof ProblemError && error.offer) return { kind: 'reoffer', offer: error.offer };
  if (isProblem(error, 'booking_payment_already_completed')) return { kind: 'alreadyCompleted' };
  if (isProblem(error, 'booking_payment_not_required')) return { kind: 'notRequired' };
  if (isProblem(error, 'booking_payment_unresolved')) return { kind: 'unresolved' };
  if (input.kind === 'walk_in' && isProblem(error, 'booking_payment_blocked')) return { kind: 'blocked' };
  if (input.kind === 'class' && isProblem(error, 'invalid-booking-payment')) return { kind: 'classNotSupported' };
  return { kind: 'refusal', error };
}

// ---------------------------------------------------------------------------
// Confirm

/**
 * The verified pull's status. `processing` is not terminal (capture can lag
 * the redirect); `needs_attention` means money was captured but the booking
 * is uncertain and parked for operations.
 */
export type PaymentSessionStatus = 'fulfilled' | 'processing' | 'refunded' | 'expired' | 'needs_attention';

const STATUSES: ReadonlySet<string> = new Set(['fulfilled', 'processing', 'refunded', 'expired', 'needs_attention']);

export interface PaymentConfirmation {
  /** An unknown status reads as `processing`, so a state the app never modelled is never read as success. */
  readonly status: PaymentSessionStatus;
  /** The booking made (a fulfilled booking). */
  readonly bookingId: string | null;
  /** The check-in made (a fulfilled walk-in). */
  readonly checkInId: string | null;
  /** On `refunded`: the refusing code (`card_not_saved`, `provider_booking_failed`, ...). */
  readonly reason: string | null;
  /**
   * On `processing`: the page is still open and nothing has been paid on it
   * (web 2026-10-15). False on every other `processing` (money in flight,
   * another confirmer booking it) and from a server that predates the field,
   * which keep "still confirming".
   */
  readonly awaitingPayment: boolean;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Reads the confirm's answer (lenient on the status, strict on its presence). */
export function decodePaymentConfirmation(data: unknown): PaymentConfirmation {
  if (typeof data !== 'object' || data === null || typeof (data as { status?: unknown }).status !== 'string') {
    throw new Error('payment confirmation without a status');
  }
  const json = data as Record<string, unknown>;
  const wire = json.status as string;
  const bookingId = optionalString(json.bookingId);
  const checkInId = optionalString(json.checkInId);
  return {
    status: STATUSES.has(wire) ? (wire as PaymentSessionStatus) : 'processing',
    bookingId: bookingId ? wireId(bookingId) : null,
    checkInId: checkInId ? wireId(checkInId) : null,
    reason: optionalString(json.reason),
    awaitingPayment: json.awaitingPayment === true,
  };
}

/**
 * `POST /bookings/payment-sessions/confirm` by the action's key: the verified
 * pull, the card vault, then the booking or check-in. Idempotent, so safe to
 * call again (a manual Check again). Waits as long as a booking create does
 * (120 s): fulfilment runs the venue's leg after the capture.
 */
export function confirmPaymentSession(key: string): Promise<PaymentConfirmation> {
  return apiPost('/bookings/payment-sessions/confirm', { key }, {
    timeoutMs: API_TIMEOUTS.bookingCreate,
    decode: decodePaymentConfirmation,
  });
}

// ---------------------------------------------------------------------------
// Settle: the confirm loop after the page

/**
 * The outcomes a flow shows as an alert (a fulfilled booking or check-in goes
 * through the flow's own success instead). iOS `BookingPayOutcome`.
 */
export type BookingPayOutcome =
  /** Money may be moving: "Confirming your payment", with Check again under the same key. */
  | { readonly kind: 'processing' }
  /**
   * The page is still open and Kling holds no payment for it (the member
   * backed out, or left after a declined card): "No payment was taken", OK
   * only. The attempt is over.
   */
  | { readonly kind: 'notPaid' }
  /** Refunded in full, with the refusing code when the server named it. */
  | { readonly kind: 'refunded'; readonly reason: string | null }
  /** The session expired; nothing was charged. */
  | { readonly kind: 'expired' }
  /** Captured, but the booking or check-in is uncertain and parked for operations. */
  | { readonly kind: 'needsAttention' };

/** Where the confirm loop ended. */
export type PaySettlement =
  /** Booked or checked in, paid. */
  | { readonly kind: 'fulfilled'; readonly confirmation: PaymentConfirmation }
  | { readonly kind: 'outcome'; readonly outcome: BookingPayOutcome }
  /** `booking_payment_session_not_found`: no session ever existed (an early back-out). Nothing charged; end quietly. */
  | { readonly kind: 'sessionNotFound' }
  /**
   * The confirm itself was refused or did not answer: the refusal's words
   * (`refusalMessage`), with no step that could start a second payment. The
   * money is the server's to settle; the key is kept.
   */
  | { readonly kind: 'failed'; readonly error: unknown };

/** How many times each leg asks: Done (or the success link) five times, the cancel link once. */
export const CONFIRM_ATTEMPTS: Readonly<Record<'done' | 'cancel', number>> = { done: 5, cancel: 1 };

export interface SettleOptions {
  /** The action's key, the one the session was created under. */
  readonly key: string;
  /** `cancel` after the cancel link; `done` after the success link, a tab closed with no link, or a manual Check again. */
  readonly leg: 'done' | 'cancel';
  /** Stops between polls (a screen that went away for good); the last answer read is returned as `processing`. */
  readonly signal?: AbortSignal;
}

/**
 * Verifies the payment after the page. Capture can lag the redirect, so the
 * Done leg polls (up to five answers, `payConfirmPollMs` apart); the cancel
 * leg checks once. Idempotent, so a manual Check again is safe.
 *
 * NOTHING PAID (2.5.5): `processing` with `awaitingPayment` is "no payment
 * was taken", never "still being confirmed". The cancel leg believes its one
 * answer; Done needs two in a row, so a payment sent just before Done has a
 * poll to show up. The flag alone decides it, not the leg: the return page
 * fires the cancel link for a refund or a parked payment too, and a plain
 * `processing` there may be money in flight.
 */
export async function settlePaymentSession({ key, leg, signal }: SettleOptions): Promise<PaySettlement> {
  const maxAttempts = CONFIRM_ATTEMPTS[leg];
  let unpaidAnswers = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(paymentTiming().payConfirmPollMs);
      if (signal?.aborted) return { kind: 'outcome', outcome: { kind: 'processing' } };
    }
    let result: PaymentConfirmation;
    try {
      result = await confirmPaymentSession(key);
    } catch (error) {
      if (isProblem(error, 'booking_payment_session_not_found')) return { kind: 'sessionNotFound' };
      return { kind: 'failed', error };
    }
    const lastAttempt = attempt === maxAttempts - 1;
    switch (result.status) {
      case 'fulfilled':
        return { kind: 'fulfilled', confirmation: result };
      case 'processing':
        unpaidAnswers = result.awaitingPayment ? unpaidAnswers + 1 : 0;
        if (result.awaitingPayment && (unpaidAnswers >= 2 || lastAttempt)) {
          return { kind: 'outcome', outcome: { kind: 'notPaid' } };
        }
        if (!lastAttempt) continue;
        return { kind: 'outcome', outcome: { kind: 'processing' } };
      case 'refunded':
        return { kind: 'outcome', outcome: { kind: 'refunded', reason: result.reason } };
      case 'expired':
        return { kind: 'outcome', outcome: { kind: 'expired' } };
      case 'needs_attention':
        return { kind: 'outcome', outcome: { kind: 'needsAttention' } };
    }
  }
  // Unreachable: the last attempt always returns.
  return { kind: 'outcome', outcome: { kind: 'processing' } };
}

/**
 * Whether the attempt's key may be used again after `settlement`.
 *
 * - `reuse`: money may still be moving (`processing`), or the confirm did not
 *   answer (`failed`). Check again, and any retry of the same action, go
 *   under the SAME key, so they can only ever resolve this one payment.
 * - `retire`: the attempt is over. Booked; nothing paid; refunded; expired;
 *   no session; or parked for operations (`needsAttention`: a same-slot
 *   rebook under that key would book with no captured funds). The next
 *   Confirm is a new attempt under a new key, priced afresh.
 */
export function keyDisposition(settlement: PaySettlement): 'reuse' | 'retire' {
  if (settlement.kind === 'failed') return 'reuse';
  if (settlement.kind === 'outcome' && settlement.outcome.kind === 'processing') return 'reuse';
  return 'retire';
}

/** The pay outcome for a page that never opened: nothing can have been paid on it. */
export const PAGE_NEVER_OPENED: PaySettlement = Object.freeze({
  kind: 'outcome',
  outcome: Object.freeze({ kind: 'notPaid' }),
}) as PaySettlement;

/** Tests only: forget creates in flight. */
export function resetPaymentSessionsForTests(): void {
  creating.clear();
}
