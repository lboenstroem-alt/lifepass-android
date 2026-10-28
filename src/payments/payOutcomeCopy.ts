/**
 * The words for a pay-and-save-card outcome, shared by the booking sheet, the
 * class sheet, the door, and the in-flight recovery that shows an outcome
 * after Android closed the app behind the page. Ported from iOS
 * `BookingCopy.payOutcomeTitle/payOutcomeMessage`
 * (Views/Booking/BookingConfirmComponents.swift), `CheckInView`'s
 * `payOutcomeTitle/payOutcomeMessage` and
 * `BookingPaymentService.refundBodyKeys`.
 */
import { MemberRefusal, ProblemError, refusalMessage } from '../api';
import { currentLanguage, translate, type Lang } from '../i18n';

import type { BookingPayOutcome } from './bookingPaymentSession';

/** Which screen's words: a slot booking, a class, or a walk-in at the door. */
export type PayCopyContext = 'slot' | 'class' | 'walkIn';

/**
 * The sentence for a time that went away while the member paid. A class has
 * its own ("We couldn't get you a place in this class"): the confirm's
 * `reason` is the bare code, and a class that filled up comes back as
 * `slot_unavailable`, `slot_full` or `provider_booking_failed` with no
 * `class_full` to tell it apart. The door says the walk-in is gone.
 */
export const REFUND_SLOT_KEYS: Readonly<Record<PayCopyContext, string>> = {
  slot: 'booking.pay.refunded_slot_body',
  class: 'booking.pay.refunded_class_body',
  walkIn: 'checkin.pay.refunded_slot_body',
};

const REFUNDED_GENERIC = 'booking.pay.refunded_generic_body';

/** Codes meaning the time (or the door) went away while the member paid. */
const SLOT_GONE_CODES: ReadonlySet<string> = new Set([
  'provider_booking_failed',
  'slot_already_booked',
  'slot_unavailable',
  'booking_payment_slot_lost_refunded',
  'slot_full',
  'flex_seats_full',
]);

/**
 * The sentences, as keys in reading order, for a `refunded` outcome by the
 * confirm's `reason`.
 *
 * The server refunds a hosted payment whenever fulfilment is refused after
 * the money was taken, and `reason` is the refusing code itself, so it can be
 * any refusal: why, from the refusal table, then "refunded in full".
 * `card_*` means the card couldn't be vaulted; a time that went away keeps
 * the screen's own sentence (`slotKey`); a price that moved has a sentence
 * that already says it was refunded. Anything the table can't say truthfully
 * as a cause (an internal reason such as `duplicate_fulfillment`, a money
 * state, an unknown code) is only the neutral "refunded in full", so a wrong
 * cause is never asserted.
 */
export function refundBodyKeys(reason: string | null | undefined, slotKey: string): string[] {
  if (!reason) return [REFUNDED_GENERIC];
  const code = MemberRefusal.normalise(reason);
  if (code === 'card_not_saved' || code === 'card_ref_unresolvable') return ['booking.pay.refunded_card_body'];
  if (SLOT_GONE_CODES.has(code)) return [slotKey];
  if (code === 'prepaid_amount_mismatch') return ['refusal.amount_changed_refunded'];
  // A gate the attempt met after paying (a cap, a trial, a pause): the row
  // says why, the next sentence that the money came back.
  if (MemberRefusal.isKnown(reason)) {
    const row = MemberRefusal.specific(reason, null, 409);
    if (row?.blocksAtPreview) return [row.messageKey, REFUNDED_GENERIC];
  }
  return [REFUNDED_GENERIC];
}

/** The first sentence of `refundBodyKeys` (2.5.4's single key). */
export function refundBodyKey(reason: string | null | undefined, slotKey: string): string {
  return refundBodyKeys(reason, slotKey)[0];
}

/** The outcome alert's title key. */
export function payOutcomeTitleKey(outcome: BookingPayOutcome): string {
  switch (outcome.kind) {
    case 'processing':
      return 'booking.pay.processing_title';
    case 'notPaid':
      return 'booking.pay.not_paid_title';
    case 'refunded':
      return 'booking.pay.refunded_title';
    case 'expired':
      return 'booking.pay.expired_title';
    case 'needsAttention':
      return 'booking.pay.needs_attention_title';
  }
}

/** The outcome alert's message keys, in reading order (joined with a space). */
export function payOutcomeMessageKeys(outcome: BookingPayOutcome, context: PayCopyContext): string[] {
  switch (outcome.kind) {
    case 'processing':
      return ['booking.pay.processing_body'];
    case 'notPaid':
      return ['booking.pay.not_paid_body'];
    case 'refunded':
      return refundBodyKeys(outcome.reason, REFUND_SLOT_KEYS[context]);
    case 'expired':
      return ['booking.pay.expired_body'];
    case 'needsAttention':
      // The door's sentence says check-in, the booking's says booking.
      return [context === 'walkIn' ? 'checkin.pay.needs_attention_body' : 'booking.pay.needs_attention_body'];
  }
}

/** The outcome alert's title, in `lang` (the language on screen by default). */
export function payOutcomeTitle(outcome: BookingPayOutcome, lang: Lang = currentLanguage()): string {
  return translate(payOutcomeTitleKey(outcome), lang);
}

/** The outcome alert's message, in `lang` (the language on screen by default). */
export function payOutcomeMessage(
  outcome: BookingPayOutcome,
  context: PayCopyContext,
  lang: Lang = currentLanguage(),
): string {
  return payOutcomeMessageKeys(outcome, context)
    .map((key) => translate(key, lang))
    .join(' ');
}

/**
 * "Booking confirmed"'s message: the check-in sentence, then the reminder
 * line. After a paid booking the line says it is paid, not that check-in is
 * free, which read oddly right after a payment (iOS `BookingCopy.confirmedBody`).
 */
export function confirmedBody(paid: boolean, classBooking: boolean, lang: Lang = currentLanguage()): string {
  const line = paid
    ? translate(classBooking ? 'booking.reminder.inline_paid' : 'booking.reminder.inline_paid_booking', lang)
    : translate('booking.reminder.inline', lang);
  return `${translate('booking.confirmed_body', lang)}\n\n${line}`;
}

/** A venue with no usable drop-in price (iOS `confirmRefusal`'s first case). */
const DROP_IN_PRICE_CODES: ReadonlySet<string> = new Set([
  'topup_price_unset',
  'topup_price_invalid',
  'topup_price_below_payout',
]);

/**
 * The door's words for a walk-in confirm the server refused (iOS
 * `CheckInViewModel.confirmRefusal`), which differ from the refusal table in
 * two places:
 *
 * - a venue with no usable drop-in price, reached through a race past the
 *   preview: a member at a boutique the plan does not include
 *   (`chargeReason` `boutique_not_included`) never used anything up, so the
 *   truthful words are the membership ones; anyone else is out of check-ins;
 * - a 429 with a code the table does not know is "checking in too quickly".
 *
 * Everything else is the table's, in the check-in context. The step (See
 * plans, Try again) is the door's own to offer (CHECKIN-2).
 */
export function walkInConfirmRefusalMessage(error: unknown, chargeReason?: string | null): string {
  if (error instanceof ProblemError) {
    if (DROP_IN_PRICE_CODES.has(MemberRefusal.normalise(error.code))) {
      return translate(
        chargeReason === 'boutique_not_included' ? 'booking.err.boutique' : 'checkin.err.monthly_cap',
        currentLanguage(),
      );
    }
    if (error.status === 429 && !MemberRefusal.isKnown(error.code)) {
      return translate('checkin.err.rate_limited', currentLanguage());
    }
  }
  return refusalMessage(error, 'checkIn');
}
