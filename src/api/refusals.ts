/* eslint lifepass/no-literal-copy: "error" */
/**
 * What a member reads, and can do next, when the server refuses a booking, a
 * check-in, a payment session, a cancel or a purchase: the Android port of
 * iOS `MemberRefusal` (Services/API/APIError.swift, 2.5.5).
 *
 * The server's stable code is the problem `type` slug, plus a `reason`
 * extension where one applies (`slot_unavailable`). Its `title` and `detail`
 * are English (and some are internal), so the screens that refuse a member
 * show this copy instead and never the server's words. Every row has its own
 * EN and IS copy; anything the table does not know reads as a plain sentence
 * for its status, never as the server's text or the code.
 *
 * The table is a snapshot of the server (iOS took it at monorepo 98fe5d2d; the
 * fixture in __tests__/serverRefusalCodes.ts was regenerated against the 0.34.0
 * contract and is unchanged). A code the server adds later falls to
 * `error.refusal_fallback` (or `error.server` for a 5xx), and
 * __tests__/memberRefusal.test.ts names it the next time the fixture is
 * regenerated (`scripts/gen-refusal-fixture.py`).
 *
 * The copy never says more about money than every server path behind a code
 * can promise: a code raised both before and after a card was charged says
 * what happens if it was.
 *
 * Pure data and functions: no React, no network, no i18n. The words are the
 * generated iOS keys (`messageKey`, `ctaLabelKey`), looked up by the caller.
 */

/**
 * The one next step a refusal offers, when there is one. A refusal never
 * opens the pay rail, so there is no "pay now". Names as iOS
 * `MemberRefusal.CTA`'s cases.
 */
export type RefusalCta =
  | 'seePlans'
  | 'manageMembership'
  | 'resumeMembership'
  | 'cancelDeletion'
  | 'addNationality'
  | 'verifyIdentity'
  | 'chooseAnotherTime'
  | 'myBookings'
  | 'refreshBookings'
  | 'openScanner'
  | 'bookATime'
  | 'editGuests'
  | 'contactSupport'
  | 'tryAgain';

/** Every step, in the iOS declaration order. */
export const REFUSAL_CTAS: readonly RefusalCta[] = [
  'seePlans',
  'manageMembership',
  'resumeMembership',
  'cancelDeletion',
  'addNationality',
  'verifyIdentity',
  'chooseAnotherTime',
  'myBookings',
  'refreshBookings',
  'openScanner',
  'bookATime',
  'editGuests',
  'contactSupport',
  'tryAgain',
];

const CTA_LABEL_KEYS: Record<RefusalCta, string> = {
  seePlans: 'booking.err.view_plans',
  manageMembership: 'refusal.cta.manage_membership',
  resumeMembership: 'refusal.cta.resume_membership',
  cancelDeletion: 'refusal.cta.cancel_deletion',
  addNationality: 'refusal.cta.add_nationality',
  verifyIdentity: 'refusal.cta.verify_identity',
  chooseAnotherTime: 'refusal.cta.another_time',
  myBookings: 'refusal.cta.my_bookings',
  refreshBookings: 'refusal.cta.refresh',
  openScanner: 'refusal.cta.open_scanner',
  bookATime: 'refusal.cta.book_a_time',
  editGuests: 'refusal.cta.edit_guests',
  contactSupport: 'refusal.cta.contact_support',
  tryAgain: 'refusal.cta.try_again',
};

/** The i18n key of a step's button. */
export function ctaLabelKey(cta: RefusalCta): string {
  return CTA_LABEL_KEYS[cta];
}

/**
 * The web profile, for the step the app has no in-app editor for
 * (nationality; identity has the in-app Kenni sheet).
 */
export const REFUSAL_WEB_PROFILE_URL = 'https://www.lifepass.is/profile';
/** The support address every other screen already links. */
export const REFUSAL_SUPPORT_URL = 'mailto:support@lifepass.is';

export interface MemberRefusal {
  /** The i18n key of the sentence the member reads. */
  readonly messageKey: string;
  /** The one next step, or null. */
  readonly cta: RefusalCta | null;
  /**
   * True when the booking preview's answer alone is enough to hide Confirm.
   * Everything else (429, 5xx, an unknown code, a payment or money state)
   * keeps Confirm, and the create call stays the real gate.
   */
  readonly blocksAtPreview: boolean;
}

/**
 * Where the refusal came from, for the few codes that mean something else
 * there: on a cancel, or at the scanner (where "booking" would be the wrong
 * word, the check-in copy stays).
 */
export type RefusalContext = 'general' | 'cancel' | 'checkIn';

/** The code as the table spells it: lowercased, hyphens folded (`rate-limited` is `rate_limited`). */
export function normaliseRefusalCode(code: string): string {
  return code.toLowerCase().replace(/-/g, '_');
}

/**
 * Problem slugs with copy of their own on EVERY screen, in both languages
 * (iOS `APIError.problemKeys`).
 */
export const PROBLEM_KEYS: Readonly<Record<string, string>> = {
  authentication_required: 'error.sign_in',
  booking_time_in_past: 'error.time_in_past',
  // The health rail's 422 for a key already used on another body.
  idempotency_key_reused: 'error.conflict',
  rate_limited: 'error.rate_limited',
  'rate-limited': 'error.rate_limited',
  internal_error: 'error.server',
  // Checkout's 404 for a pass taken off sale.
  product_not_on_sale: 'plans.err.not_on_sale',
};

function row(messageKey: string, cta: RefusalCta | null, blocks = false): MemberRefusal {
  return Object.freeze({ messageKey, cta, blocksAtPreview: blocks });
}

const VENUE_SYSTEM = row('refusal.venue_system', 'tryAgain');

/** Codes in groups that share one sentence (iOS `groups`, same order). */
const GROUPS: readonly (readonly [readonly string[], MemberRefusal])[] = [
  // Plan, pass and trial gates.
  [['no_active_plan_or_pass', 'premium_no_plan'], row('booking.err.no_plan', 'seePlans', true)],
  [['boutique_requires_membership', 'boutique_not_included'], row('booking.err.boutique', 'seePlans', true)],
  [['daily_use_cap_reached'], row('booking.err.daily_cap', null, true)],
  [['concurrent_cap_reached'], row('booking.err.concurrent', 'myBookings', true)],
  [['monthly_cap_reached', 'monthly_exhausted', 'premium_out_of_visits'], row('refusal.monthly_cap', 'seePlans', true)],
  [['trial_venue_not_included'], row('refusal.trial_venue', 'seePlans', true)],
  [['trial_visits_spent'], row('refusal.trial_spent', 'seePlans', true)],
  [['trial_no_longer_available', 'trial_disabled'], row('refusal.trial_gone', 'seePlans')],
  [['subscription_paused'], row('refusal.paused', 'resumeMembership', true)],
  [['booking_blocked'], row('refusal.blocked', 'contactSupport', true)],
  [['account_deletion_scheduled', 'account_pending_deletion'], row('refusal.deletion', 'cancelDeletion', true)],
  [['subscription_already_exists_for_profile'], row('refusal.has_membership', 'manageMembership')],
  [['nationality_required'], row('refusal.nationality', 'addNationality', true)],
  [['kennitala_verification_required', 'kennitala_not_verified'], row('refusal.verify', 'verifyIdentity', true)],
  // Already booked.
  [['slot_already_booked'], row('booking.err.slot_dup', 'myBookings', true)],
  [['venue_already_booked_today'], row('booking.err.venue_today', 'myBookings', true)],
  // Time, window and capacity.
  [['booking_time_in_past', 'invalid_booking_time'], row('error.time_in_past', 'chooseAnotherTime', true)],
  [['booking_window_closed'], row('refusal.window_closed', 'chooseAnotherTime', true)],
  // `activity_resource_conflict`: a court or room this activity shares with
  // another one is taken at that time, so to the member it is full.
  [['slot_full', 'flex_seats_full', 'activity_resource_conflict'], row('refusal.slot_full', 'chooseAnotherTime', true)],
  [['slot_unavailable'], row('refusal.slot_gone', 'chooseAnotherTime', true)],
  // The venue's booking system.
  [
    [
      'mapping_invalid',
      'provider_mapping_metadata_invalid',
      'activity_not_provider_backed',
      'provider_context_unavailable',
      'provider_adapter_unavailable',
    ],
    VENUE_SYSTEM,
  ],
  // Party and guests.
  [['age_band_unavailable', 'guest_age_bands_mismatch', 'age_band_price_unset'], row('refusal.age_band', 'editGuests', true)],
  [['group_booking_not_supported'], row('refusal.solo_only', 'editGuests', true)],
  // The party is over the server's limit of 10 people.
  [['participants_invalid'], row('refusal.party_size', 'editGuests', true)],
  // Prices. The price (or the venue's category) is the VENUE's, not the
  // time's: every time there is refused the same way, so no "Choose another
  // time". The words point at another venue.
  [
    [
      'visit_price_unset',
      'topup_price_unset',
      'surcharge_price_unset',
      'topup_price_invalid',
      'surcharge_price_invalid',
      'venue_category_unset',
    ],
    row('refusal.price_unset', null, true),
  ],
  [['visit_choice_unavailable', 'visit_choice_not_applicable', 'booking_payment_option_conflict'], row('refusal.price_changed', null)],
  // Payment. `surcharge_charge_failed` and `topup_charge_failed` are one 402
  // (the saved card declined), named after the charge's kind. The words hold
  // at a booking and at the door alike, and point at Profile's card.
  [
    [
      'card_declined',
      'charge_declined',
      'charge_rejected',
      'payment_intent_failed',
      'charge_capture_failed',
      'surcharge_charge_failed',
      'topup_charge_failed',
    ],
    row('refusal.payment_failed', 'tryAgain'),
  ],
  [['kling_capture_failed'], row('refusal.capture_unknown', null)],
  [['kling_payment_unavailable', 'booking_payment_session_create_failed'], row('refusal.payments_down', 'tryAgain')],
  // Walk-in only (the session's preview is blocked): the scanner's own words.
  [['booking_payment_blocked'], row('checkin.err.pay_blocked', null)],
  // An earlier payment is still unresolved, so the server will not charge
  // again yet. The booking it belongs to may be one My bookings never lists,
  // so the step is support.
  [['booking_charge_unresolved', 'booking_payment_unresolved'], row('refusal.payment_unresolved', 'contactSupport')],
  // This booking's row exists and is listed (as pending) while it is
  // confirmed with the venue or reconciled.
  [
    [
      'booking_pending_provider_reconciliation',
      'provider_booking_uncertain',
      'provider_confirmation_failed',
      'booking_confirmation_failed',
    ],
    row('refusal.pending_confirm', 'myBookings'),
  ],
  [
    ['booking_create_failed', 'booking_confirm_failed', 'checkin_create_failed', 'daily_use_create_failed'],
    row('refusal.create_failed', 'tryAgain'),
  ],
  [['provider_booking_failed'], row('refusal.venue_refused', 'chooseAnotherTime')],
  [['prepaid_refund_failed'], row('refusal.refund_pending', 'contactSupport')],
  [['prepaid_amount_mismatch'], row('refusal.amount_changed_refunded', 'chooseAnotherTime')],
  [['booking_not_replayable'], row('refusal.replay', 'chooseAnotherTime')],
  // Cancel.
  [['cancellation_window_closed'], row('refusal.cancel_window', 'contactSupport')],
  [['cancel_provider_uncertain'], row('refusal.cancel_uncertain', 'myBookings')],
  [['booking_not_cancellable'], row('refusal.not_cancellable', 'refreshBookings')],
  [['booking_cancel_failed'], row('refusal.cancel_failed', 'tryAgain')],
  // Walk-in and check-in.
  [['walk_ins_not_allowed'], row('refusal.walk_ins_off', 'bookATime', true)],
  [['walk_in_no_activity', 'walk_in_activity_invalid', 'walk_in_provider_unsupported'], row('refusal.walk_in_unavailable', null, true)],
  [['walk_in_guests_not_supported'], row('refusal.walk_in_guests', 'editGuests')],
  [['walk_in_scan_already_used'], row('refusal.scan_again', null)],
  // Two refusals under one code: this scan's key was already used for a
  // payment attempt (scanning again is right), or the second-charge gate
  // (scanning again is not). The words hold for both.
  [['walk_in_capture_unresolved'], row('refusal.earlier_payment', 'contactSupport')],
  [['booking_not_today'], row('refusal.not_today', 'myBookings')],
  [['check_in_voided'], row('refusal.voided', null)],
  [['booking_venue_mismatch'], row('refusal.wrong_venue', 'myBookings')],
  [['booking_not_checkin_eligible', 'attendable_booking_not_found'], row('refusal.no_booking_here', 'bookATime')],
  // Gone, throttled, malformed.
  [
    ['activity_not_found', 'venue_not_found', 'profile_not_found', 'user_not_found', 'booking_not_found', 'booking_access_denied'],
    row('refusal.gone', null),
  ],
  [['rate_limited'], row('refusal.rate_limited', 'tryAgain')],
  [['booking_payment_invalid_input'], row('error.request_invalid', null)],
];

const ROWS: ReadonlyMap<string, MemberRefusal> = (() => {
  const table = new Map<string, MemberRefusal>();
  for (const [codes, refusal] of GROUPS) {
    for (const code of codes) {
      if (table.has(code)) throw new Error(`refusal table: ${code} is in two rows`);
      table.set(code, refusal);
    }
  }
  return table;
})();

/**
 * `slot_unavailable` and its provider `reason`: only a class carries a
 * reason, so these keep the class sheet's own words (a registration window
 * that is not open must never read as "no longer available"). An unknown or
 * missing reason reads as "no longer available".
 *
 * `payable_class_not_supported` is never a code of its own: the provider's
 * refusal of a class it sells for money reaches the app as this 409 with that
 * reason, and another time would be refused the same way, so it says to book
 * with the venue and offers no "Choose another time".
 */
const REASON_ROWS: ReadonlyMap<string, MemberRefusal> = new Map([
  ['slot_unavailable|class_full', row('booking.class.err_full', 'chooseAnotherTime', true)],
  ['slot_unavailable|event_passed', row('booking.class.err_passed', 'chooseAnotherTime', true)],
  ['slot_unavailable|outside_registration_window', row('booking.class.err_not_open', 'chooseAnotherTime', true)],
  ['slot_unavailable|event_not_open', row('booking.class.err_not_open', 'chooseAnotherTime', true)],
  ['slot_unavailable|payable_class_not_supported', row('refusal.class_not_bookable', null, true)],
]);

/** What a code means on a cancel when it means something else there. */
const CANCEL_ROWS: ReadonlyMap<string, MemberRefusal> = new Map([
  ['booking_not_found', row('refusal.not_cancellable', 'refreshBookings')],
  ['booking_access_denied', row('refusal.not_cancellable', 'refreshBookings')],
  // The payment is still being confirmed, so nothing is cancelled yet.
  ['booking_charge_unresolved', row('refusal.cancel_pending', 'contactSupport')],
]);

/**
 * The scanner's own words, where the check-in copy is right at a door ("it
 * resets at midnight", "the QR code may be out of date"). The next step is
 * the table's.
 */
const CHECK_IN_ROWS: ReadonlyMap<string, MemberRefusal> = new Map([
  ['no_active_plan_or_pass', row('checkin.err.no_plan', 'seePlans', true)],
  ['daily_use_cap_reached', row('checkin.err.daily_cap', null, true)],
  ['monthly_cap_reached', row('checkin.err.monthly_cap', 'seePlans', true)],
  ['walk_in_activity_invalid', row('checkin.err.activity_invalid', null)],
  ['venue_not_found', row('checkin.err.venue_not_found', null)],
  ['rate_limited', row('checkin.err.rate_limited', 'tryAgain')],
]);

/** A provider adapter's codes, as the class route passes them through on a 502. */
export const ADAPTER_CODES: ReadonlySet<string> = new Set([
  'auth_failed',
  'validation_failed',
  'rate_limited',
  'timeout',
  'unavailable',
  'non_production_blocked',
  'cancel_failed',
  'cancellation_deadline_passed',
]);

/**
 * The copy for one refusal. Look-up order: the context's own row, the code
 * with its reason, a provider adapter's code on a 5xx, the code's row, then
 * the app's own problem copy (`PROBLEM_KEYS`), then `invalid_*`, then the
 * status (401 asks to sign in, 5xx reads as our side's failure, any other
 * status as the fallback).
 *
 * A 5xx always offers "Try again", whichever of the last three answers it:
 * `internal_error` (any unhandled server error) has problem copy of its own
 * and must not lose the step an unknown 5xx gets.
 */
export function resolveRefusal(
  code: string,
  reason: string | null | undefined,
  status: number,
  context: RefusalContext = 'general',
): MemberRefusal {
  const specific = specificRefusal(code, reason, status, context);
  if (specific) return specific;
  const normalised = normaliseRefusalCode(code);
  const key = PROBLEM_KEYS[normalised] ?? PROBLEM_KEYS[code];
  if (key) {
    const ourFailure = status >= 500 || key === 'error.server';
    return row(key, ourFailure ? 'tryAgain' : null);
  }
  if (isRequestShape(normalised)) return row('error.request_invalid', null);
  if (status === 401) return row('error.sign_in', null);
  if (status >= 500) return row('error.server', 'tryAgain');
  return row('error.refusal_fallback', null);
}

/** The row a code (with its reason) has of its own, or null when only the buckets apply. */
export function specificRefusal(
  code: string,
  reason: string | null | undefined,
  status: number,
  context: RefusalContext = 'general',
): MemberRefusal | null {
  const normalised = normaliseRefusalCode(code);
  if (context === 'cancel') {
    const contextRow = CANCEL_ROWS.get(normalised);
    if (contextRow) return contextRow;
  }
  if (context === 'checkIn') {
    const contextRow = CHECK_IN_ROWS.get(normalised);
    if (contextRow) return contextRow;
  }
  if (reason) {
    const reasonRow = REASON_ROWS.get(`${normalised}|${normaliseRefusalCode(reason)}`);
    if (reasonRow) return reasonRow;
  }
  // A provider adapter's own code, which the class route sends as a 502:
  // the venue's system, not ours.
  if (status >= 500 && ADAPTER_CODES.has(normalised)) return VENUE_SYSTEM;
  return ROWS.get(normalised) ?? null;
}

/** The request's own shape was refused (`invalid_*`, every route's 400 for a body or query it could not read). */
export function isRequestShape(code: string): boolean {
  return normaliseRefusalCode(code).startsWith('invalid_');
}

/** True when `code` has copy of its own anywhere in the table. */
export function isKnownRefusal(code: string): boolean {
  const normalised = normaliseRefusalCode(code);
  if (ROWS.has(normalised) || CANCEL_ROWS.has(normalised) || CHECK_IN_ROWS.has(normalised)) return true;
  for (const key of REASON_ROWS.keys()) {
    if (key.startsWith(`${normalised}|`)) return true;
  }
  return false;
}

/** Every code with a row of its own (the reason rows' code included), sorted. */
export function knownRefusalCodes(): string[] {
  return [...new Set([...ROWS.keys(), ...CANCEL_ROWS.keys(), ...CHECK_IN_ROWS.keys()])].sort();
}

/** Every row in every context, with an id, for the tests that hold each one to the copy rules. */
export function allRefusalRows(): { id: string; refusal: MemberRefusal }[] {
  const all: { id: string; refusal: MemberRefusal }[] = [];
  for (const [code, refusal] of ROWS) all.push({ id: code, refusal });
  for (const [code, refusal] of REASON_ROWS) all.push({ id: code, refusal });
  for (const [code, refusal] of CANCEL_ROWS) all.push({ id: `${code} [cancel]`, refusal });
  for (const [code, refusal] of CHECK_IN_ROWS) all.push({ id: `${code} [checkIn]`, refusal });
  all.push({ id: 'adapter_5xx', refusal: VENUE_SYSTEM });
  return all;
}

/**
 * Codes a flow answers rather than a refusal: the consent step, the pay rail
 * and its outcomes, and the discount-code box under Plans (the server only
 * raises these for a code the member typed).
 */
export const HANDLED_BY_FLOW: readonly string[] = [
  'charge_consent_required',
  'no_payment_method_on_file',
  'card_not_saved',
  'no_card',
  'booking_payment_already_completed',
  'booking_payment_not_required',
  'discount_code_invalid',
  'discount_code_expired',
  'discount_code_not_valid_for_product',
  'discount_code_not_valid_for_memberships',
];

/**
 * Codes that keep the fallback on purpose: only staff, an operator or an
 * internal state reaches them, and a member who somehow does is better served
 * by "try again or contact support" than by copy written for a case they
 * cannot be in. A `*` matches any run of characters.
 *
 * `booking_slot_not_started` and `booking_charge_not_settled` are raised only
 * on the operator's mark-attended route; `cancel_tx_unsupported_for_provider`
 * is a programming guard (a 500); `booking_charge_voided` and
 * `booking_charge_unsettled` are the operator's reconciliation attach.
 */
export const FALLBACK_ON_PURPOSE: readonly string[] = [
  'venue_admin_required',
  'staff_walk_in_forbidden',
  'attendance_note_required',
  'check_in_void_*',
  'check_in_not_found',
  'charge_intent_*',
  'charge_not_found',
  'charge_not_pending',
  'charge_not_settleable',
  'charge_attestation_invalid',
  'charge_create_failed',
  'charge_settle_capture_failed',
  'kling_session_livemode_mismatch',
  'kling_payment_intent_*',
  'provider_seat_exists_attach_ref_first',
  'provider_dispatch_mismatch',
  'provider_booking_reference_required',
  'provider_venue_timezone_missing',
  'provider_account_*',
  'provider_activity_not_found',
  'provider_charge_not_collected',
  'duplicate_fulfillment',
  'captured_amount_mismatch',
  'booking_*_not_settleable',
  'provider_booking_not_sent_not_settleable',
  'walk_in_result_incomplete',
  'walk_in_charge_not_settleable',
  'customer_required',
  'copay_*',
  'trial_product_not_directly_purchasable',
  'checkout_product_not_found',
  'booking_payment_session_not_found',
  'booking_payment_reference_required',
  'booking_not_pending',
  'booking_not_provider_backed',
  'activity_venue_mismatch',
  'booking_slot_not_started',
  'booking_charge_not_settled',
  'cancel_tx_unsupported_for_provider',
  'booking_charge_voided',
  'booking_charge_unsettled',
];

/**
 * Codes from the same server files that only screens outside the refusal call
 * sites reach (the membership pause screen in Account). They keep that
 * screen's behaviour.
 */
export const OUTSIDE_SCOPE: readonly string[] = [
  'subscription_not_active',
  'subscription_already_paused',
  'subscription_not_found',
  'subscription_not_paused',
  'subscription_pause_unsupported',
  'pause_days_limit_reached',
  'pause_period_limit_reached',
  'invalid_pause_window',
];

/**
 * Codes the refusal routes can answer with that are not a decision about this
 * booking, check-in, payment, cancel or purchase, so they keep the fallback,
 * or "something went wrong on our side" with "Try again" for a 5xx: the
 * plumbing every route shares (signing in, the idempotency key, the request's
 * size and origin, the payment provider's API) and the purchase gate's order
 * and subscription bookkeeping.
 *
 * The last group is in the routes' import closure only: a file they import
 * for one helper raises them from functions these routes never call, or the
 * route catches them on the way. They are listed so the tests can name every
 * code that closure raises.
 */
export const INFRA_FALLBACK: readonly string[] = [
  // Sign-in and access.
  'ambiguous_credentials',
  'customer_profile_required',
  'staff_authentication_required',
  'forbidden',
  // The request itself (the app never sends one these refuse).
  'idempotency_key_required',
  'request_body_too_large',
  'request_origin_not_allowed',
  'classes_range_too_wide',
  'availability_range_too_wide',
  'trial_disclosure_required',
  'gift_not_supported_for_product',
  'unsupported_checkout_product',
  // A booking provider the slot timetable has no reader for (a 501: our
  // set-up, not the member's request).
  'availability_not_implemented_for_provider',
  // The payment provider's API, and our set-up of it.
  'kling_checkout_*',
  'kling_customer_*',
  'kling_product_*',
  'kling_products_*',
  'kling_session_*',
  'kling_subscription_*',
  'kennitala_missing',
  // The purchase gate's order and subscription bookkeeping.
  'order_create_failed',
  'order_not_found',
  'order_not_paid',
  'order_reference_required',
  'checkout_discount_mismatch',
  'checkout_gift_mismatch',
  'checkout_order_missing',
  'checkout_session_conflict',
  'checkout_session_id_required',
  'checkout_session_missing_url',
  'checkout_session_not_found',
  'checkout_status_reference_required',
  'external_subscription_required',
  'product_not_active',
  'subscription_already_exists',
  'subscription_create_failed',
  'subscription_external_id_missing',
  'subscription_period_create_failed',
  'subscription_period_invalid',
  'trial_cancel_not_terminated',
  'trial_window_invalid',
  'duplicate_subscription_cancel_failed',
  // Records kept on the side.
  'audit_event_insert_failed',
  'consent_ledger_insert_failed',
  'marketing_consent_profile_missing',
  'strike_not_found',
  // In the closure only: an imported file's other functions, or caught.
  'pass_gift_*',
  'pass_grant_failed',
  'pass_grant_invalid',
  'pass_metadata_invalid',
  'pass_mint_failed',
  'pass_not_found',
  'pass_not_redeemable',
  'retention_hold_*',
  'lagoon_duo_sold_out',
];

/** True when `code` is one of `patterns` (`*` matches any run of characters). */
export function matchesCodePattern(code: string, patterns: readonly string[]): boolean {
  const normalised = normaliseRefusalCode(code);
  return patterns.some((pattern) => {
    if (!pattern.includes('*')) return pattern === normalised;
    const parts = pattern.split('*');
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (!normalised.startsWith(first) || normalised.length < first.length + last.length) return false;
    let rest = normalised.slice(first.length);
    for (const part of parts.slice(1, -1)) {
      if (!part) continue;
      const at = rest.indexOf(part);
      if (at < 0) return false;
      rest = rest.slice(at + part.length);
    }
    return rest.endsWith(last);
  });
}

/**
 * The table under the iOS names, for code ported from Swift:
 * `MemberRefusal.resolve(code, reason, status, context)` and so on. A value
 * beside the `MemberRefusal` row type, as Swift has both under one name.
 */
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const MemberRefusal = {
  resolve: resolveRefusal,
  specific: specificRefusal,
  isKnown: isKnownRefusal,
  isRequestShape,
  normalise: normaliseRefusalCode,
  matches: matchesCodePattern,
  knownCodes: knownRefusalCodes,
  allRows: allRefusalRows,
  ctaLabelKey,
  adapterCodes: ADAPTER_CODES,
  handledByFlow: HANDLED_BY_FLOW,
  fallbackOnPurpose: FALLBACK_ON_PURPOSE,
  outsideScope: OUTSIDE_SCOPE,
  infraFallback: INFRA_FALLBACK,
  webProfileUrl: REFUSAL_WEB_PROFILE_URL,
  supportUrl: REFUSAL_SUPPORT_URL,
} as const;
