/**
 * Card-less bookings (iOS ClassBookingSheetTests "Card-less class bookings",
 * 2.5.5): the create's 402 consent, then `no_payment_method_on_file`, opens
 * the hosted pay-and-save-card page through F8 (a Custom Tab here), with the
 * class's `eventId` or the slot's times on the session. These assert what
 * the session SENDS, how each way back from the page is settled, and that
 * cancel, refusal, a class that fills while paying, an old server and a
 * double tap all end safely.
 */
import * as WebBrowser from 'expo-web-browser';
import { api, Reply, type StubReply, type StubRequest } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { lookup, setCurrentLanguage } from '../../../i18n';
import { PAYMENT_CANCEL_URL, payOutcomeMessage, payOutcomeTitle, registerPaymentOutcomePresenter } from '../../../payments';
import { freshPaymentsPerTest, signIn, storedRecords } from '../../../payments/__tests__/paymentsHarness';
import { bookingCopy } from '../bookingCopy';
import { bookingInProgress, canConfirmOccurrence, classRefusal, confirmChargeIsk } from '../bookingSession';
import {
  ablerOccurrence,
  ACTIVITY_ID,
  bodyOf,
  bookingPosts,
  classesReply,
  CONFIRMED,
  confirmPosts,
  consent,
  flush,
  FREE_PREVIEW,
  iso,
  klass,
  plus,
  respond,
  sessionPosts,
  slotOccurrence,
  slotsReply,
  START,
  SURCHARGE_PREVIEW,
  testSession,
  type TestSession,
} from './bookingHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const DONE = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;
const CANCEL_LINK = { type: 'success', url: PAYMENT_CANCEL_URL } as WebBrowser.WebBrowserAuthSessionResult;
const PAGE_URL = 'https://pay.kling.is/c/kling_cs_class';

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  signIn();
  setCurrentLanguage('en');
});

const SESSION_REDIRECT = Reply.ok({
  hasCard: false,
  sessionId: '8b2c3d4e-0000-4000-8000-000000000001',
  externalSessionId: 'kling_cs_class',
  url: PAGE_URL,
  amountIsk: 1_990,
});

const FULFILLED = Reply.ok({ status: 'fulfilled', bookingId: '7a1c2b3d-0000-4000-8000-000000000010' });

/**
 * A card-less member's class: the create asks consent (at `offer`), then says
 * there is no card; the session and its confirm answer as given.
 * `bookingReply` answers any create after those two.
 */
function cardlessClassServer(options: {
  preview?: unknown;
  offer?: number;
  offerKind?: string;
  session?: StubReply | ((request: StubRequest) => StubReply);
  confirm?: StubReply | ((request: StubRequest) => StubReply);
  bookingReply?: StubReply;
} = {}): void {
  let creates = 0;
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(options.preview ?? SURCHARGE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions/confirm') {
      const confirm = options.confirm ?? FULFILLED;
      return typeof confirm === 'function' ? confirm(request) : confirm;
    }
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') {
      const session = options.session ?? SESSION_REDIRECT;
      return typeof session === 'function' ? session(request) : session;
    }
    if (request.method === 'POST' && request.path === '/bookings') {
      creates += 1;
      if (creates > 2 && options.bookingReply) return options.bookingReply;
      return bodyOf(request).acceptCharge === true
        ? Reply.problem(402, 'no_payment_method_on_file')
        : consent(options.offer ?? 1_990, options.offerKind ?? 'surcharge');
    }
    return Reply.problem(404, 'not_found');
  });
}

/** Prepare the class, Confirm, accept the consent (the page runs inside). */
async function confirmAndAccept(session: TestSession): Promise<void> {
  await session.store.getState().prepare(ablerOccurrence());
  await session.store.getState().confirmBooking();
  expect(session.store.getState().showChargeConsent).toBe(true);
  await session.store.getState().acceptCharge();
}

/** A page that stays open until `close` is called with how it closed. */
function pageHeldOpen(): { close: (result: WebBrowser.WebBrowserAuthSessionResult) => void } {
  let close: (result: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
  openAuthSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        close = resolve;
      }),
  );
  return { close: (result) => close(result) };
}

const en = (key: string) => lookup(key, 'en');

it('a card-less class opens the payment page for its event, under the booking key, at the consented amount', async () => {
  cardlessClassServer();
  const session = testSession();
  const page = pageHeldOpen();
  await session.store.getState().prepare(ablerOccurrence());
  await session.store.getState().confirmBooking();
  const accepting = session.store.getState().acceptCharge();
  await flush();

  expect(openAuthSession).toHaveBeenCalledWith(PAGE_URL, 'lifepass://payment-', { createTask: false });
  expect(session.store.getState().needsPaymentMethod).toBe(false);
  expect(session.store.getState().error).toBeNull();
  expect(bookingInProgress(session.store.getState())).toBe(true);
  expect(sessionPosts()).toHaveLength(1);
  const body = bodyOf(sessionPosts()[0]);
  expect(Object.keys(body).sort()).toEqual(['acceptedChargeAmountIsk', 'activityId', 'eventId', 'kind']);
  expect(body).toEqual({ kind: 'booking', activityId: ACTIVITY_ID, eventId: 4242, acceptedChargeAmountIsk: 1_990 });
  const key = bookingPosts()[0].headers['idempotency-key'];
  expect(bookingPosts()[1].headers['idempotency-key']).toBe(key);
  expect(sessionPosts()[0].headers['idempotency-key']).toBe(key);

  // While the page is open, Confirm sends nothing.
  await session.store.getState().confirmBooking();
  expect(bookingPosts()).toHaveLength(2);

  page.close(DONE);
  await accepting;
  expect(confirmPosts()).toHaveLength(1);
  expect(bodyOf(confirmPosts()[0]).key).toBe(key);
  expect(session.store.getState().bookingComplete).toBe(true);
  expect(session.store.getState().bookingWasPaid).toBe(true);
  expect(session.store.getState().bookingPendingConfirmation).toBe(false);
  expect(session.store.getState().payOutcome).toBeNull();
  expect(session.store.getState().isBooking).toBe(false);
  expect(bookingInProgress(session.store.getState())).toBe(false);
  // Booked: the reminders for the class, and the plan refreshed.
  expect(session.reminders).toHaveBeenCalledWith({ className: 'Class 4242', startsAt: START, language: 'en' });
  expect(session.refreshCredits).toHaveBeenCalledTimes(1);
  expect(await storedRecords()).toEqual([]);
});

it.each(['provider_booking_failed', 'slot_full', 'slot_unavailable'])(
  'a class that fills while paying (%s) is refunded in the class words, and nothing is booked',
  async (reason) => {
    cardlessClassServer({ confirm: Reply.ok({ status: 'refunded', reason }) });
    openAuthSession.mockResolvedValueOnce(DONE);
    const session = testSession();
    await confirmAndAccept(session);
    const outcome = session.store.getState().payOutcome;
    expect(outcome).toEqual({ kind: 'refunded', reason });
    expect(session.store.getState().bookingComplete).toBe(false);
    for (const language of ['en', 'is'] as const) {
      expect(payOutcomeMessage(outcome!, 'class', language)).toBe(lookup('booking.pay.refunded_class_body', language));
    }
    expect(session.reminders).not.toHaveBeenCalled();
  },
);

it('backing out of the page books nothing: one check, and the same class can be confirmed again', async () => {
  cardlessClassServer({ confirm: Reply.problem(404, 'booking_payment_session_not_found') });
  openAuthSession.mockResolvedValueOnce(CANCEL_LINK);
  const session = testSession();
  await confirmAndAccept(session);
  expect(confirmPosts()).toHaveLength(1);
  const s = session.store.getState();
  expect([s.bookingComplete, s.payOutcome, s.error, bookingInProgress(s)]).toEqual([false, null, null, false]);
  expect(canConfirmOccurrence(s)).toBe(true);
});

it.each([
  ['the cancel link', CANCEL_LINK, 1],
  ['Done', DONE, 2],
])('leaving the page unpaid (%s) says no payment was taken, and trying again is a new attempt', async (_leg, result, polls) => {
  cardlessClassServer({ confirm: Reply.ok({ status: 'processing', awaitingPayment: true }) });
  openAuthSession.mockResolvedValueOnce(result);
  const session = testSession();
  await confirmAndAccept(session);
  const key = sessionPosts()[0].headers['idempotency-key'];

  // The cancel link believes its one answer; Done asks twice.
  expect(confirmPosts()).toHaveLength(polls);
  const outcome = session.store.getState().payOutcome;
  expect(outcome).toEqual({ kind: 'notPaid' });
  expect(session.store.getState().bookingComplete).toBe(false);
  expect(bookingInProgress(session.store.getState())).toBe(false);
  expect(canConfirmOccurrence(session.store.getState())).toBe(true);
  for (const language of ['en', 'is'] as const) {
    expect(payOutcomeTitle(outcome!, language)).toBe(lookup('booking.pay.not_paid_title', language));
    expect(payOutcomeMessage(outcome!, 'class', language)).toBe(lookup('booking.pay.not_paid_body', language));
  }

  // A new attempt: a new key on the booking and on its payment, consent again.
  session.store.getState().dismissPayOutcome();
  const before = bookingPosts().length;
  openAuthSession.mockResolvedValueOnce(DONE);
  await session.store.getState().confirmBooking();
  expect(session.store.getState().showChargeConsent).toBe(true);
  await session.store.getState().acceptCharge();
  expect(sessionPosts()).toHaveLength(2);
  const retryKey = sessionPosts()[1].headers['idempotency-key'];
  expect(retryKey).not.toBe(key);
  expect(bookingPosts()).toHaveLength(before + 2);
  expect(bookingPosts().slice(-2).every((post) => post.headers['idempotency-key'] === retryKey)).toBe(true);
  expect(bodyOf(sessionPosts()[1]).acceptedChargeAmountIsk).toBe(1_990);
});

it('a payment page that never opened ends the attempt with nothing paid, and its OK closes the screen', async () => {
  cardlessClassServer();
  openAuthSession.mockRejectedValueOnce(new Error('no browser'));
  const session = testSession();
  await confirmAndAccept(session);
  const key = sessionPosts()[0].headers['idempotency-key'];
  const s = session.store.getState();
  expect(s.payOutcome).toEqual({ kind: 'notPaid' });
  expect(s.payPageNeverOpened).toBe(true);
  expect([s.isBooking, bookingInProgress(s), s.bookingComplete, s.error]).toEqual([false, false, false, null]);
  expect(confirmPosts()).toHaveLength(0);
  expect(canConfirmOccurrence(s)).toBe(true);

  session.store.getState().dismissPayOutcome();
  openAuthSession.mockResolvedValueOnce(DONE);
  await session.store.getState().confirmBooking();
  expect(session.store.getState().payPageNeverOpened).toBe(false);
  await session.store.getState().acceptCharge();
  expect(sessionPosts()).toHaveLength(2);
  expect(sessionPosts()[1].headers['idempotency-key']).not.toBe(key);
});

it('a payment that shows on the second poll is a booking', async () => {
  let confirms = 0;
  cardlessClassServer({
    confirm: () => {
      confirms += 1;
      return confirms === 1 ? Reply.ok({ status: 'processing', awaitingPayment: true }) : FULFILLED;
    },
  });
  openAuthSession.mockResolvedValueOnce(DONE);
  const session = testSession();
  await confirmAndAccept(session);
  expect(confirmPosts()).toHaveLength(2);
  expect(session.store.getState().bookingComplete).toBe(true);
  expect(session.store.getState().payOutcome).toBeNull();
});

it.each([
  ['Done', DONE, 5],
  ['the cancel link', CANCEL_LINK, 1],
])('a payment still settling (%s) keeps Check again, which asks under the same key', async (_leg, result, polls) => {
  cardlessClassServer({ confirm: Reply.ok({ status: 'processing' }) });
  openAuthSession.mockResolvedValueOnce(result);
  const session = testSession();
  await confirmAndAccept(session);
  expect(confirmPosts()).toHaveLength(polls);
  expect(session.store.getState().payOutcome).toEqual({ kind: 'processing' });
  expect(session.store.getState().heldAttempt).not.toBeNull();
  const key = bodyOf(confirmPosts()[0]).key;

  await session.store.getState().confirmBookingPayment();
  expect(bodyOf(confirmPosts().at(-1)).key).toBe(key);
  expect(session.store.getState().payOutcome).toEqual({ kind: 'processing' });

  // Closing the alert lets the attempt go back to F8's recovery.
  session.store.getState().dismissPayOutcome();
  expect(session.store.getState().heldAttempt).toBeNull();
});

it.each([
  ['expired', { kind: 'expired' }],
  ['needs_attention', { kind: 'needsAttention' }],
])('an %s payment is never a booking', async (status, outcome) => {
  cardlessClassServer({ confirm: Reply.ok({ status }) });
  openAuthSession.mockResolvedValueOnce(DONE);
  const session = testSession();
  await confirmAndAccept(session);
  expect(session.store.getState().payOutcome).toEqual(outcome);
  expect(session.store.getState().bookingComplete).toBe(false);
});

it('a card that turned up books the class directly, with consent, under the same key', async () => {
  cardlessClassServer({ session: Reply.ok({ hasCard: true }), bookingReply: Reply.ok(CONFIRMED) });
  const session = testSession();
  await confirmAndAccept(session);
  expect(bookingPosts()).toHaveLength(3);
  expect(bodyOf(bookingPosts()[2])).toEqual({
    activityId: ACTIVITY_ID,
    eventId: 4242,
    acceptCharge: true,
    acceptedChargeAmountIsk: 1_990,
  });
  const keys = new Set([...bookingPosts(), ...sessionPosts()].map((post) => post.headers['idempotency-key']));
  expect(keys.size).toBe(1);
  expect(openAuthSession).not.toHaveBeenCalled();
  expect(session.store.getState().bookingComplete).toBe(true);
});

it('a class that filled before the page opened is said in place, with Confirm hidden and no page', async () => {
  cardlessClassServer({ session: Reply.problem(409, 'slot_unavailable', { reason: 'class_full' }) });
  const session = testSession();
  await confirmAndAccept(session);
  const s = session.store.getState();
  expect(s.gateRefusal?.messageKey).toBe('booking.class.err_full');
  expect(s.gateRefusal?.messageKey).toBe(classRefusal('slot_unavailable', 'class_full')?.messageKey);
  expect(s.gateRefusal?.cta).toBe('chooseAnotherTime');
  expect(canConfirmOccurrence(s)).toBe(false);
  expect([s.error, s.needsPaymentMethod]).toEqual([null, false]);
  expect(openAuthSession).not.toHaveBeenCalled();
});

it('payments down at the session is an alert with Try again, and keeps Confirm', async () => {
  cardlessClassServer({ session: Reply.problem(502, 'kling_payment_unavailable') });
  const session = testSession();
  await confirmAndAccept(session);
  expect(session.store.getState().error).toBe(en('refusal.payments_down'));
  expect(session.store.getState().errorCta).toBe('tryAgain');
  expect(canConfirmOccurrence(session.store.getState())).toBe(true);
});

it('an old server keeps the add-a-card answer for a class; a slot’s 400 stays a refusal', async () => {
  cardlessClassServer({ session: Reply.problem(400, 'invalid-booking-payment') });
  const session = testSession();
  await confirmAndAccept(session);
  expect(session.store.getState().needsPaymentMethod).toBe(true);
  expect(session.store.getState().error).toBeNull();
  expect(session.store.getState().gateRefusal).toBeNull();
  expect(session.store.getState().isBooking).toBe(false);
  expect(openAuthSession).not.toHaveBeenCalled();

  api.reset();
  respond((request) => {
    if (request.path.endsWith('/availability')) return slotsReply([START]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(SURCHARGE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') {
      return Reply.problem(400, 'invalid-booking-payment');
    }
    if (request.method === 'POST' && request.path === '/bookings') {
      return bodyOf(request).acceptCharge === true ? Reply.problem(402, 'no_payment_method_on_file') : consent(1_990);
    }
    return Reply.problem(404, 'not_found');
  });
  const slot = testSession();
  await slot.store.getState().prepare(slotOccurrence(plus(START, 2700)));
  await slot.store.getState().confirmBooking();
  await slot.store.getState().acceptCharge();
  expect(slot.store.getState().needsPaymentMethod).toBe(false);
  expect(slot.store.getState().error).toBe(en('error.request_invalid'));
});

it("a slot's session carries its own times and the booking's key", async () => {
  respond((request) => {
    if (request.path.endsWith('/availability')) return slotsReply([plus(START, -3600), START, plus(START, 3600)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(SURCHARGE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') {
      return Reply.ok({ hasCard: false, externalSessionId: 'kling_cs_9', url: 'https://pay.kling.is/c/kling_cs_9', amountIsk: 1_990 });
    }
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions/confirm') return FULFILLED;
    if (request.method === 'POST' && request.path === '/bookings') {
      return bodyOf(request).acceptCharge === true ? Reply.problem(402, 'no_payment_method_on_file') : consent(1_990);
    }
    return Reply.problem(404, 'not_found');
  });
  openAuthSession.mockResolvedValueOnce(DONE);
  const session = testSession();
  const end = plus(START, 2700);
  await session.store.getState().prepare(slotOccurrence(end));
  await session.store.getState().confirmBooking();
  await session.store.getState().acceptCharge();
  expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/c/kling_cs_9', 'lifepass://payment-', { createTask: false });
  const body = bodyOf(sessionPosts()[0]);
  expect(body).toEqual({
    kind: 'booking',
    activityId: ACTIVITY_ID,
    startsAt: iso(START),
    endsAt: iso(end),
    acceptedChargeAmountIsk: 1_990,
  });
  expect(sessionPosts()[0].headers['idempotency-key']).toBe(bookingPosts()[0].headers['idempotency-key']);
  expect(session.store.getState().bookingComplete).toBe(true);
});

it('for every kind of member the line is the amount offered, consented to and charged', async () => {
  const rows: { name: string; preview: Record<string, unknown>; amount: number | null; kind?: string; noVisit?: boolean }[] = [
    { name: 'subscriber, visit included', preview: { kind: 'free', priceIsk: null, remainingMonthly: 5, isLastBeforeTopUp: false }, amount: null },
    { name: 'pass holder', preview: { kind: 'pass', priceIsk: null, remainingMonthly: null, isLastBeforeTopUp: false }, amount: null },
    { name: 'premium, visit spent', preview: { kind: 'surcharge', surchargeReason: 'premium_subscriber_visit', priceIsk: 1_500, remainingMonthly: null, isLastBeforeTopUp: false }, amount: 1_500 },
    { name: 'boutique past its allowance', preview: { kind: 'surcharge', surchargeReason: 'boutique_overflow', priceIsk: 990, remainingMonthly: null, isLastBeforeTopUp: false }, amount: 990 },
    { name: 'out of visits this period', preview: { kind: 'topup', topupReason: 'monthly_exhausted', priceIsk: 2_790, remainingMonthly: 0, isLastBeforeTopUp: false }, amount: 2_790, kind: 'topup', noVisit: true },
    { name: 'premium, out of visits', preview: { kind: 'surcharge', surchargeReason: 'premium_out_of_visits', priceIsk: 4_900, remainingMonthly: null, isLastBeforeTopUp: false }, amount: 4_900, noVisit: true },
    { name: 'company-covered premium, no plan visit', preview: { kind: 'surcharge', surchargeReason: 'premium_no_plan', priceIsk: 6_300, remainingMonthly: null, isLastBeforeTopUp: false }, amount: 6_300, noVisit: true },
    { name: 'no plan, boutique', preview: { kind: 'surcharge', surchargeReason: 'boutique_access', priceIsk: 3_500, remainingMonthly: null, isLastBeforeTopUp: false }, amount: 3_500, noVisit: true },
  ];
  for (const row of rows) {
    api.reset();
    if (row.amount != null) {
      cardlessClassServer({ preview: row.preview, offer: row.amount, offerKind: row.kind ?? 'surcharge' });
    } else {
      respond((request) => {
        if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
        if (request.path.endsWith('/booking-preview')) return Reply.ok(row.preview);
        if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
        return Reply.problem(404, 'not_found');
      });
    }
    const session = testSession();
    await session.store.getState().prepare(ablerOccurrence());
    expect(confirmChargeIsk(session.store.getState())).toBe(row.amount);
    openAuthSession.mockResolvedValueOnce(DONE);
    await session.store.getState().confirmBooking();
    if (row.amount == null) {
      expect(session.store.getState().showChargeConsent).toBe(false);
      expect(session.store.getState().bookingComplete).toBe(true);
      expect(sessionPosts()).toHaveLength(0);
      openAuthSession.mockReset();
      continue;
    }
    expect(session.store.getState().pendingOffer?.amountIsk).toBe(row.amount);
    expect(confirmChargeIsk(session.store.getState())).toBe(row.amount);
    if (row.noVisit) {
      const preview = session.store.getState().preview!;
      for (const language of ['en', 'is'] as const) {
        const copy = bookingCopy(language);
        for (const text of [copy.disclosureText(preview), copy.chargeConsentMessage(session.store.getState())]) {
          expect(text.toLowerCase()).not.toContain('surcharge');
          expect(text.toLowerCase()).not.toContain('álag');
          expect(text).toContain(`ISK ${row.amount.toLocaleString('en-US')}`);
        }
      }
    }
    await session.store.getState().acceptCharge();
    expect(bodyOf(sessionPosts()[0]).acceptedChargeAmountIsk).toBe(row.amount);
    expect(bodyOf(sessionPosts()[0]).eventId).toBe(4242);
  }
});

it("the create's offer replaces the preview's figure before paying, and stays after a declined consent", async () => {
  cardlessClassServer({ offer: 2_490 });
  const session = testSession();
  await session.store.getState().prepare(ablerOccurrence());
  expect(confirmChargeIsk(session.store.getState())).toBe(1_990);
  await session.store.getState().confirmBooking();
  expect(confirmChargeIsk(session.store.getState())).toBe(2_490);
  expect(bookingCopy('en').consentButtonLabel(session.store.getState())).toContain('ISK 2,490');
  session.store.getState().declineCharge();
  expect(confirmChargeIsk(session.store.getState())).toBe(2_490);

  openAuthSession.mockResolvedValueOnce(DONE);
  await session.store.getState().confirmBooking();
  await session.store.getState().acceptCharge();
  expect(bodyOf(sessionPosts()[0]).acceptedChargeAmountIsk).toBe(2_490);

  // Reading the price again starts from the server's own figure.
  await session.store.getState().loadPreview();
  expect(confirmChargeIsk(session.store.getState())).toBe(1_990);
});

it('a session re-offer moves the line and asks again; the accepted amount re-enters the rail', async () => {
  let sessions = 0;
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(SURCHARGE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions') {
      sessions += 1;
      return sessions === 1 ? consent(2_290) : SESSION_REDIRECT;
    }
    if (request.method === 'POST' && request.path === '/bookings/payment-sessions/confirm') return FULFILLED;
    if (request.method === 'POST' && request.path === '/bookings') {
      const accepted = bodyOf(request).acceptedChargeAmountIsk;
      if (bodyOf(request).acceptCharge === true && (accepted === 1_990 || accepted === 2_290)) {
        return Reply.problem(402, 'no_payment_method_on_file');
      }
      return consent(1_990);
    }
    return Reply.problem(404, 'not_found');
  });
  const session = testSession();
  await confirmAndAccept(session);
  expect(session.store.getState().showChargeConsent).toBe(true);
  expect(session.store.getState().offerWasReoffered).toBe(true);
  expect(confirmChargeIsk(session.store.getState())).toBe(2_290);
  expect(bookingCopy('en').chargeConsentMessage(session.store.getState())).toMatch(/^The price changed/);
  expect(openAuthSession).not.toHaveBeenCalled();

  openAuthSession.mockResolvedValueOnce(DONE);
  await session.store.getState().acceptCharge();
  expect(sessionPosts()).toHaveLength(2);
  expect(bodyOf(sessionPosts()[1]).acceptedChargeAmountIsk).toBe(2_290);
  expect(openAuthSession).toHaveBeenCalledTimes(1);
});

it('taps while an attempt is in flight send nothing: one create per step, one session', async () => {
  cardlessClassServer();
  const session = testSession();
  await session.store.getState().prepare(ablerOccurrence());
  await Promise.all([session.store.getState().confirmBooking(), session.store.getState().confirmBooking()]);
  expect(bookingPosts()).toHaveLength(1);
  expect(session.store.getState().showChargeConsent).toBe(true);
  await session.store.getState().confirmBooking();
  expect(bookingPosts()).toHaveLength(1);

  const page = pageHeldOpen();
  const first = session.store.getState().acceptCharge();
  const second = session.store.getState().acceptCharge();
  await flush();
  expect(bookingPosts()).toHaveLength(2);
  expect(sessionPosts()).toHaveLength(1);
  expect(session.store.getState().bookingPayOpen).toBe(true);
  await session.store.getState().confirmBooking();
  expect(bookingPosts()).toHaveLength(2);
  page.close(DONE);
  await Promise.all([first, second]);
  expect(new Set([...bookingPosts(), ...sessionPosts()].map((post) => post.headers['idempotency-key'])).size).toBe(1);
  expect(session.store.getState().bookingComplete).toBe(true);
});

it('a booking paid while its screen was gone is not shown on the dead screen (F8 presents it)', async () => {
  cardlessClassServer();
  openAuthSession.mockResolvedValueOnce(DONE);
  const presenter = jest.fn();
  registerPaymentOutcomePresenter('booking', presenter);
  const session = testSession();
  session.store.getState().setScreenAlive(() => false);
  await confirmAndAccept(session);
  // The booking rail's presenter told the member (and scheduled the
  // reminders: ../register.ts) instead.
  expect(presenter).toHaveBeenCalledTimes(1);
  expect(presenter.mock.calls[0][0]).toMatchObject({
    rail: 'booking',
    settlement: { kind: 'fulfilled' },
    record: { booking: { kind: 'class', eventId: 4242, startsAt: iso(START), activityName: 'Hress' } },
  });
  expect(session.store.getState().bookingComplete).toBe(false);
  expect(session.store.getState().bookingWasPaid).toBe(true);
  expect(session.reminders).not.toHaveBeenCalled();
});

it('a free booking with no consent is not called paid', async () => {
  respond((request) => {
    if (request.path.endsWith('/classes')) return classesReply([klass(4242, START)]);
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    if (request.method === 'POST' && request.path === '/bookings') return Reply.ok(CONFIRMED);
    return Reply.problem(404, 'not_found');
  });
  const session = testSession();
  await session.store.getState().prepare(ablerOccurrence());
  await session.store.getState().confirmBooking();
  expect(session.store.getState().bookingComplete).toBe(true);
  expect(session.store.getState().bookingWasPaid).toBe(false);
});
