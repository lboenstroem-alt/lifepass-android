/**
 * The pay-and-save-card session on the wire and its confirm loop: the F8
 * ports of iOS ContractFixtureTests (`testWalkInPaymentSessionBody`,
 * `testPaymentSessionConfirmReadsEveryStatus`), ClassBookingSheetTests'
 * session and confirm-leg cases, WalkInMoneyPathTests' confirm-leg cases and
 * MemberRefusalTests' refund table. The view-model halves (consent, the
 * sheet's state) are BOOK-1's, CLASS-2's and CHECKIN-2's.
 */
import { requestBodyKeys } from '@test/contract';
import { api, Reply, type StubReply } from '@test/server';

import { isProblem, TransportError } from '../../api';
import { expectSentToMatchContract, stubApiClientPerTest } from '../../api/testing';
import { lookup } from '../../i18n';
import {
  classifySessionCreateError,
  confirmPaymentSession,
  createPaymentSession,
  keyDisposition,
  paymentSessionBody,
  resetPaymentSessionsForTests,
  settlePaymentSession,
  type PaymentSessionInput,
  type PaySettlement,
} from '../bookingPaymentSession';
import { payOutcomeMessage, payOutcomeTitle, refundBodyKey, refundBodyKeys } from '../payOutcomeCopy';
import { NO_WAITS, setPaymentTimingForTests } from '../timing';

stubApiClientPerTest();

const activityId = '7A1C2B3D-0000-4000-8000-0000000000AA';
const venueId = '3F2B8C1E-7D4A-4B6E-9C2F-1A2B3C4D5E6F';
const start = new Date('2026-10-20T10:00:00.000Z');

const sessionRedirect = Reply.ok(
  {
    hasCard: false,
    sessionId: '8b2c3d4e-0000-4000-8000-000000000001',
    externalSessionId: '8b2c3d4e-0000-4000-8000-0000000000e1',
    url: 'https://pay.kling.is/c/kling_cs_class',
    amountIsk: 1_990,
  },
  201,
);

beforeEach(() => {
  setPaymentTimingForTests(NO_WAITS);
  resetPaymentSessionsForTests();
});

afterEach(() => {
  setPaymentTimingForTests(null);
});

const confirms = () => api.sentAll('/bookings/payment-sessions/confirm', 'POST');
const sessions = () => api.sentAll('/bookings/payment-sessions', 'POST');

function confirmReplies(...replies: StubReply[]): void {
  let n = 0;
  api.on('POST', '/bookings/payment-sessions/confirm', () => replies[Math.min(n++, replies.length - 1)]);
}

describe('the session body', () => {
  it('is the class shape or the slot shape (testTheSessionBodyIsTheClassShapeOrTheSlotShape)', async () => {
    api.on('POST', '/bookings/payment-sessions', sessionRedirect);

    // A caller that hands a class every other key too: only the class shape goes.
    const sloppyClass = {
      kind: 'class',
      activityId,
      eventId: 4242,
      acceptedChargeAmountIsk: 1_990,
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      participants: 2,
      guestAgeBands: ['child'],
      visitChoice: 'keep_visit',
      bookingAction: 'walk_in',
    } as unknown as PaymentSessionInput;
    await createPaymentSession(sloppyClass, 'k-class-0001');
    const classBody = expectSentToMatchContract('POST', '/bookings/payment-sessions').body as Record<string, unknown>;
    expect(Object.keys(classBody).sort()).toEqual(['acceptedChargeAmountIsk', 'activityId', 'eventId', 'kind']);
    expect(classBody).toEqual({
      kind: 'booking',
      activityId: activityId.toLowerCase(),
      eventId: 4242,
      acceptedChargeAmountIsk: 1_990,
    });

    await createPaymentSession(
      {
        kind: 'slot',
        activityId,
        startsAt: start,
        endsAt: new Date(start.getTime() + 2_700_000),
        acceptedChargeAmountIsk: 1_990,
        visitChoice: 'keep_visit',
      },
      'k-slot-0001',
    );
    const slotBody = expectSentToMatchContract('POST', '/bookings/payment-sessions').body as Record<string, unknown>;
    expect(Object.keys(slotBody).sort()).toEqual(
      ['acceptedChargeAmountIsk', 'activityId', 'endsAt', 'kind', 'startsAt', 'visitChoice'].sort(),
    );
    expect(slotBody.eventId).toBeUndefined();
    // ISO-8601 with no fraction, as the iOS encoder sends it.
    expect(slotBody.startsAt).toBe('2026-10-20T10:00:00Z');
    expect(slotBody.endsAt).toBe('2026-10-20T10:45:00Z');
  });

  it('a group slot carries its party, bands and rung, which fulfilment replays', () => {
    const body = paymentSessionBody({
      kind: 'slot',
      activityId,
      startsAt: start,
      endsAt: start,
      acceptedChargeAmountIsk: 9_900,
      participants: 3,
      guestAgeBands: ['adult', 'child'],
      visitChoice: 'spend_visit',
    });
    expect(body.participants).toBe(3);
    expect(body.guestAgeBands).toEqual(['adult', 'child']);
    expect(body.visitChoice).toBe('spend_visit');
    // An empty band list is left out, never sent as [].
    expect(
      paymentSessionBody({ kind: 'slot', activityId, startsAt: start, endsAt: start, acceptedChargeAmountIsk: 1, guestAgeBands: [] }),
    ).not.toHaveProperty('guestAgeBands');
  });

  it('a walk-in sends its venue, a null activity and the guests with an explicit walk-in (testWalkInPaymentSessionBody)', async () => {
    api.on('POST', '/bookings/payment-sessions', Reply.ok({ hasCard: true }, 201));
    await createPaymentSession(
      {
        kind: 'walk_in',
        activityId: null,
        venueId,
        acceptedChargeAmountIsk: 2_700,
        guestAgeBands: ['child', 'child'],
        bookingAction: 'walk_in',
      },
      'walkin-key-1',
    );
    const sent = expectSentToMatchContract('POST', '/bookings/payment-sessions');
    const body = sent.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['acceptedChargeAmountIsk', 'activityId', 'bookingAction', 'guestAgeBands', 'kind', 'venueId'].sort(),
    );
    expect(body).toHaveProperty('activityId', null);
    expect(sent.rawBody).toContain('"activityId":null');
    expect(body.kind).toBe('walk_in');
    expect(body.venueId).toBe('3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
    expect(sent.headers['idempotency-key']).toBe('walkin-key-1');
  });

  it('guest bands ride only with an explicit walk-in, whatever the attendance choice said', () => {
    const withGuests = paymentSessionBody({
      kind: 'walk_in',
      activityId,
      venueId,
      acceptedChargeAmountIsk: 2_700,
      guestAgeBands: ['adult'],
      bookingAction: 'attend',
    });
    expect(withGuests.bookingAction).toBe('walk_in');
    const solo = paymentSessionBody({ kind: 'walk_in', activityId, venueId, acceptedChargeAmountIsk: 1_500, bookingAction: 'attend' });
    expect(solo.bookingAction).toBe('attend');
    expect(solo).not.toHaveProperty('guestAgeBands');
    const plain = paymentSessionBody({ kind: 'walk_in', activityId, venueId, acceptedChargeAmountIsk: 1_500 });
    expect(plain).not.toHaveProperty('bookingAction');
    expect(plain.activityId).toBe(activityId.toLowerCase());
  });

  it('every key any shape sends is one the contract declares', () => {
    const declared = new Set(requestBodyKeys('POST', '/bookings/payment-sessions').properties);
    const shapes: PaymentSessionInput[] = [
      { kind: 'class', activityId, eventId: 1, acceptedChargeAmountIsk: 1 },
      {
        kind: 'slot',
        activityId,
        startsAt: start,
        endsAt: start,
        acceptedChargeAmountIsk: 1,
        participants: 2,
        guestAgeBands: ['child'],
        visitChoice: 'keep_visit',
      },
      { kind: 'walk_in', activityId: null, venueId, acceptedChargeAmountIsk: 1, guestAgeBands: ['infant'] },
    ];
    for (const shape of shapes) {
      for (const key of Object.keys(paymentSessionBody(shape))) expect(declared).toContain(key);
    }
  });
});

describe('creating the session', () => {
  it('answers the page to open, with the amount the server priced', async () => {
    api.on('POST', '/bookings/payment-sessions', sessionRedirect);
    const creation = await createPaymentSession(
      { kind: 'class', activityId, eventId: 4242, acceptedChargeAmountIsk: 1_990 },
      'booking-key-0001',
    );
    expect(creation).toEqual({
      kind: 'redirect',
      url: 'https://pay.kling.is/c/kling_cs_class',
      externalSessionId: '8b2c3d4e-0000-4000-8000-0000000000e1',
      amountIsk: 1_990,
    });
    expect(api.sent('/bookings/payment-sessions').headers['idempotency-key']).toBe('booking-key-0001');
  });

  it('a card that turned up is hasCard: the caller books directly under the same key', async () => {
    api.on('POST', '/bookings/payment-sessions', Reply.ok({ hasCard: true }, 201));
    await expect(
      createPaymentSession({ kind: 'class', activityId, eventId: 1, acceptedChargeAmountIsk: 1_990 }, 'booking-key-0002'),
    ).resolves.toEqual({ kind: 'hasCard' });
  });

  it('no card and no page is a retryable failure, never a silent no-op', async () => {
    api.on('POST', '/bookings/payment-sessions', Reply.ok({ hasCard: false }, 201));
    const error = await createPaymentSession(
      { kind: 'class', activityId, eventId: 1, acceptedChargeAmountIsk: 1_990 },
      'booking-key-0003',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
  });

  it('a double tap makes one session (testADoubleTapMakesOneSession)', async () => {
    api.on('POST', '/bookings/payment-sessions', Reply.delayed(20, sessionRedirect));
    const input: PaymentSessionInput = { kind: 'class', activityId, eventId: 4242, acceptedChargeAmountIsk: 1_990 };
    const [first, second] = await Promise.all([
      createPaymentSession(input, 'booking-key-0004'),
      createPaymentSession(input, 'booking-key-0004'),
    ]);
    expect(first).toEqual(second);
    expect(sessions()).toHaveLength(1);
  });

  it('reads each refusal the way the flows answer it', async () => {
    const cases: [StubReply, PaymentSessionInput['kind'], string][] = [
      [Reply.problem(402, 'charge_consent_required', { offer: { kind: 'surcharge', amountIsk: 2_300 } }), 'class', 'reoffer'],
      [Reply.problem(409, 'booking_payment_already_completed'), 'slot', 'alreadyCompleted'],
      [Reply.problem(409, 'booking_payment_not_required'), 'walk_in', 'notRequired'],
      [Reply.problem(409, 'booking_payment_unresolved'), 'slot', 'unresolved'],
      [Reply.problem(409, 'booking_payment_blocked'), 'walk_in', 'blocked'],
      // Only the door has the blocked dead end; a booking reads it through the table.
      [Reply.problem(409, 'booking_payment_blocked'), 'slot', 'refusal'],
      // An old server refusing the class shape: the add-a-card answer (testAnOldServerKeepsTheAddACardAnswerForAClass).
      [Reply.problem(400, 'invalid-booking-payment'), 'class', 'classNotSupported'],
      // A slot's 400 is unchanged.
      [Reply.problem(400, 'invalid-booking-payment'), 'slot', 'refusal'],
      [Reply.problem(502, 'kling_payment_unavailable'), 'class', 'refusal'],
      [Reply.problem(409, 'slot_unavailable', { reason: 'class_full' }), 'class', 'refusal'],
    ];
    for (const [reply, kind, expected] of cases) {
      api.on('POST', '/bookings/payment-sessions', reply);
      const input: PaymentSessionInput =
        kind === 'class'
          ? { kind, activityId, eventId: 1, acceptedChargeAmountIsk: 1_990 }
          : kind === 'slot'
            ? { kind, activityId, startsAt: start, endsAt: start, acceptedChargeAmountIsk: 1_990 }
            : { kind, activityId: null, venueId, acceptedChargeAmountIsk: 1_990 };
      const error = await createPaymentSession(input, `refusal-key-${expected}-${kind}`).catch((e: unknown) => e);
      const refusal = classifySessionCreateError(error, input);
      expect(refusal.kind).toBe(expected);
      if (refusal.kind === 'reoffer') expect(refusal.offer.amountIsk).toBe(2_300);
    }
  });
});

describe('the confirm', () => {
  it('reads every status, and an unknown one as processing (testPaymentSessionConfirmReadsEveryStatus)', async () => {
    const statuses: [string, string][] = [
      ['fulfilled', 'fulfilled'],
      ['needs_attention', 'needs_attention'],
      ['refunded', 'refunded'],
      ['expired', 'expired'],
      ['something_new', 'processing'],
    ];
    for (const [wire, expected] of statuses) {
      api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: wire, reason: null }));
      const confirmation = await confirmPaymentSession('k-confirm-1');
      expect(confirmation.status).toBe(expected);
      expect(confirmation.awaitingPayment).toBe(false);
    }
    // An open page with nothing paid on it (web 2026-10-15).
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'processing', awaitingPayment: true }));
    const unpaid = await confirmPaymentSession('k-confirm-1');
    expect(unpaid.status).toBe('processing');
    expect(unpaid.awaitingPayment).toBe(true);
  });

  it('resolves the session by the action key, and sends nothing else', async () => {
    api.on(
      'POST',
      '/bookings/payment-sessions/confirm',
      Reply.ok({ status: 'fulfilled', bookingId: '7A1C2B3D-0000-4000-8000-000000000010' }),
    );
    const confirmation = await confirmPaymentSession('booking-key-0001');
    const sent = expectSentToMatchContract('POST', '/bookings/payment-sessions/confirm');
    expect(sent.body).toEqual({ key: 'booking-key-0001' });
    expect(confirmation.bookingId).toBe('7a1c2b3d-0000-4000-8000-000000000010');
  });
});

describe('settling after the page', () => {
  const unpaid = Reply.ok({ status: 'processing', awaitingPayment: true });

  it('a paid class is booked on the first answer (testAPaidClassIsBookedOnceWhenThePageReturns)', async () => {
    confirmReplies(Reply.ok({ status: 'fulfilled', bookingId: '7a1c2b3d-0000-4000-8000-000000000010' }));
    const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
    expect(settlement.kind).toBe('fulfilled');
    expect(confirms()).toHaveLength(1);
    expect(confirms()[0].body).toEqual({ key: 'booking-key-0001' });
    expect(keyDisposition(settlement)).toBe('retire');
  });

  it.each([
    ['cancel', 1],
    ['done', 2],
  ] as const)(
    'leaving the page unpaid says no payment was taken after the %s leg asks %i time(s) (testLeavingThePageUnpaidSaysNoPaymentWasTaken)',
    async (leg, asked) => {
      confirmReplies(unpaid);
      const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg });
      expect(confirms()).toHaveLength(asked);
      expect(settlement).toEqual({ kind: 'outcome', outcome: { kind: 'notPaid' } });
      // The attempt is over: the next Confirm is a new key.
      expect(keyDisposition(settlement)).toBe('retire');
      for (const lang of ['en', 'is'] as const) {
        const outcome = { kind: 'notPaid' } as const;
        expect(payOutcomeTitle(outcome, lang)).toBe(lookup('booking.pay.not_paid_title', lang));
        expect(payOutcomeMessage(outcome, 'class', lang)).toBe(lookup('booking.pay.not_paid_body', lang));
        expect(payOutcomeMessage(outcome, 'class', lang)).not.toBe(lookup('booking.pay.processing_body', lang));
      }
    },
  );

  it('the not-paid words are iOS 2.5.5 in both languages', () => {
    expect(lookup('booking.pay.not_paid_body', 'en')).toBe('No payment was taken. You can try again.');
    expect(lookup('booking.pay.not_paid_body', 'is')).toBe('Engin greiðsla var tekin. Þú getur reynt aftur.');
  });

  it('a payment that shows on the second poll is a booking (testAPaymentThatShowsOnTheSecondPollIsABooking)', async () => {
    confirmReplies(unpaid, Reply.ok({ status: 'fulfilled', bookingId: '7a1c2b3d-0000-4000-8000-000000000010' }));
    const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
    expect(confirms()).toHaveLength(2);
    expect(settlement.kind).toBe('fulfilled');
  });

  it('one unpaid answer between two settling ones does not count twice', async () => {
    const settling = Reply.ok({ status: 'processing' });
    confirmReplies(unpaid, settling, unpaid, settling, settling);
    const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
    expect(confirms()).toHaveLength(5);
    expect(settlement).toEqual({ kind: 'outcome', outcome: { kind: 'processing' } });
  });

  it.each([
    ['done', 5],
    ['cancel', 1],
  ] as const)(
    'a payment still settling keeps Check again under the same key (%s leg asks %i) (testAPaymentStillSettlingKeepsCheckAgain)',
    async (leg, asked) => {
      confirmReplies(Reply.ok({ status: 'processing' }));
      const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg });
      expect(confirms()).toHaveLength(asked);
      expect(settlement).toEqual({ kind: 'outcome', outcome: { kind: 'processing' } });
      expect(keyDisposition(settlement)).toBe('reuse');
      expect(payOutcomeMessage({ kind: 'processing' }, 'class', 'en')).toBe(lookup('booking.pay.processing_body', 'en'));
      // Check again: the same key.
      await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
      expect(confirms().every((request) => (request.body as { key: string }).key === 'booking-key-0001')).toBe(true);
    },
  );

  it('the last Done answer unpaid after settling ones is still no payment taken', async () => {
    const settling = Reply.ok({ status: 'processing' });
    confirmReplies(settling, settling, settling, settling, unpaid);
    const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
    expect(settlement).toEqual({ kind: 'outcome', outcome: { kind: 'notPaid' } });
  });

  it('a class that fills while paying is refunded in the class words (testAClassThatFillsWhilePayingIsRefundedInTheClasssWords)', async () => {
    for (const reason of ['provider_booking_failed', 'slot_full', 'slot_unavailable']) {
      api.reset();
      confirmReplies(Reply.ok({ status: 'refunded', reason }));
      const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
      expect(settlement).toEqual({ kind: 'outcome', outcome: { kind: 'refunded', reason } });
      expect(keyDisposition(settlement)).toBe('retire');
      for (const lang of ['en', 'is'] as const) {
        const outcome = (settlement as Extract<PaySettlement, { kind: 'outcome' }>).outcome;
        expect(payOutcomeMessage(outcome, 'class', lang)).toBe(lookup('booking.pay.refunded_class_body', lang));
      }
    }
    expect(lookup('booking.pay.refunded_class_body', 'en')).toBe(
      "We couldn't get you a place in this class, so your payment was refunded in full.",
    );
    // A slot keeps its own sentence, the door its own.
    expect(payOutcomeMessage({ kind: 'refunded', reason: 'slot_full' }, 'slot', 'en')).toBe(
      lookup('booking.pay.refunded_slot_body', 'en'),
    );
    expect(payOutcomeMessage({ kind: 'refunded', reason: 'slot_full' }, 'walkIn', 'en')).toBe(
      lookup('checkin.pay.refunded_slot_body', 'en'),
    );
  });

  it('an expired or parked payment is never a booking (testAnExpiredOrParkedPaymentIsNeverABooking)', async () => {
    for (const [status, kind] of [
      ['expired', 'expired'],
      ['needs_attention', 'needsAttention'],
    ] as const) {
      api.reset();
      confirmReplies(Reply.ok({ status }));
      const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
      expect(settlement).toEqual({ kind: 'outcome', outcome: { kind } });
      // Parked for operations: the key is never reused for a rebook.
      expect(keyDisposition(settlement)).toBe('retire');
    }
    expect(payOutcomeMessage({ kind: 'needsAttention' }, 'walkIn', 'en')).toBe(
      lookup('checkin.pay.needs_attention_body', 'en'),
    );
    expect(payOutcomeMessage({ kind: 'needsAttention' }, 'slot', 'en')).toBe(
      lookup('booking.pay.needs_attention_body', 'en'),
    );
  });

  it('no session ever made ends quietly (testBackingOutOfThePageBooksNothing)', async () => {
    confirmReplies(Reply.problem(404, 'booking_payment_session_not_found'));
    const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'cancel' });
    expect(confirms()).toHaveLength(1);
    expect(settlement).toEqual({ kind: 'sessionNotFound' });
    expect(keyDisposition(settlement)).toBe('retire');
  });

  it('a confirm that is refused is said once, with the key kept', async () => {
    confirmReplies(Reply.problem(503, 'internal_error'));
    const settlement = await settlePaymentSession({ key: 'booking-key-0001', leg: 'done' });
    expect(confirms()).toHaveLength(1);
    expect(settlement.kind).toBe('failed');
    expect(isProblem((settlement as { error: unknown }).error, 'internal_error')).toBe(true);
    expect(keyDisposition(settlement)).toBe('reuse');
  });

  it('a walk-in party paid on the page settles as a check-in (testAPartyPaidOnTheHostedPageIsOnTheProof)', async () => {
    confirmReplies(Reply.ok({ status: 'fulfilled', checkInId: '9D7C1B2A-0000-4000-8000-000000000001' }));
    const settlement = await settlePaymentSession({ key: 'walkin-key-1', leg: 'done' });
    expect(settlement.kind).toBe('fulfilled');
    if (settlement.kind === 'fulfilled') expect(settlement.confirmation.checkInId).toBe('9d7c1b2a-0000-4000-8000-000000000001');
  });
});

describe('the refund words (MemberRefusalTests)', () => {
  it('say why only when the table can say it truthfully (testARefundSaysWhyOnlyWhenTheTableCanSayItTruthfully)', () => {
    const slot = 'booking.pay.refunded_slot_body';
    expect(refundBodyKeys('card_not_saved', slot)).toEqual(['booking.pay.refunded_card_body']);
    expect(refundBodyKeys('card_ref_unresolvable', slot)).toEqual(['booking.pay.refunded_card_body']);
    for (const reason of ['provider_booking_failed', 'slot_full', 'slot_unavailable', 'booking_payment_slot_lost_refunded']) {
      expect(refundBodyKeys(reason, slot)).toEqual([slot]);
    }
    expect(refundBodyKeys('flex_seats_full', slot)).toEqual([slot]);
    expect(refundBodyKeys('slot_already_booked', slot)).toEqual([slot]);
    expect(refundBodyKeys('prepaid_amount_mismatch', slot)).toEqual(['refusal.amount_changed_refunded']);
    expect(refundBodyKeys('trial_visits_spent', slot)).toEqual(['refusal.trial_spent', 'booking.pay.refunded_generic_body']);
    for (const reason of [
      'duplicate_fulfillment',
      'captured_amount_mismatch',
      'kling_capture_failed',
      'booking_create_failed',
      'brand_new_refusal',
    ]) {
      expect(refundBodyKeys(reason, slot)).toEqual(['booking.pay.refunded_generic_body']);
    }
    expect(refundBodyKeys(null, slot)).toEqual(['booking.pay.refunded_generic_body']);
    expect(refundBodyKey('card_not_saved', slot)).toBe('booking.pay.refunded_card_body');
  });

  it('a gate met after paying reads its reason, then that the money came back', () => {
    expect(payOutcomeMessage({ kind: 'refunded', reason: 'trial_visits_spent' }, 'slot', 'en')).toBe(
      `${lookup('refusal.trial_spent', 'en')} ${lookup('booking.pay.refunded_generic_body', 'en')}`,
    );
  });
});
