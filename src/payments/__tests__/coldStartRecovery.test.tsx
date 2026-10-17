/**
 * A hosted payment survives Android closing the app behind the page (plan
 * F8 acceptance; critic-hosted-payment-process-death): the attempt is saved
 * before the page opens, and a return cold-starts the app, runs the right
 * confirm, shows the outcome and clears the record, exactly once. The
 * ClassBookingSheetTests and WalkInMoneyPathTests confirm-leg cases (one
 * answer on the cancel link, two on Done, a payment on the second poll) on
 * the cold-start path, and the presenters' words, read off the dialog the
 * member sees.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { runActivationHooks, runSignOutCleaners } from '../../app/signOut';
import { DialogHost } from '../../components/ui/Dialog';
import { MerchantInfo } from '../../config/merchantInfo';
import { lookup, setCurrentLanguage, translate } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { checkPaymentAgain, leaveAttempt, payOnHostedPage } from '../attempts';
import { handlePaymentReturnUrl } from '../coldStartRecovery';
import { readInflight, saveInflight, type BookingAttemptContext, type NewInflightRecord } from '../inflight';
import { confirmedBody } from '../payOutcomeCopy';
import { registerPaymentOutcomePresenter, type PaymentResolution } from '../presenters';

import {
  flush,
  freshPaymentsPerTest,
  killProcess,
  launchedWith,
  MEMBER_A,
  MEMBER_B,
  signIn,
  storedRecords,
  usageJSON,
} from './paymentsHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
/** The tab closed with no link (the mock module has no enum to name it with). */
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

stubApiClientPerTest();
freshPaymentsPerTest();

const KEY = 'booking-key-0001';
const PAGE = 'https://pay.kling.is/c/kling_cs_class';
const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';

const hotYoga: BookingAttemptContext = {
  kind: 'class',
  activityId: '7a1c2b3d-0000-4000-8000-0000000000aa',
  eventId: 4242,
  className: 'Hot yoga',
  venueName: 'Laugar Spa',
  startsAt: '2026-10-20T10:00:00Z',
};

const classAttempt = (memberId = MEMBER_A, key = KEY): NewInflightRecord => ({
  rail: 'booking',
  memberId,
  key,
  amountIsk: 1_990,
  booking: hotYoga,
});

const walkInAttempt = (memberId = MEMBER_A): NewInflightRecord => ({
  rail: 'walk_in',
  memberId,
  key: 'walkin-key-1',
  amountIsk: 2_700,
  walkIn: {
    venueId: '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f',
    venueName: 'Sky Lagoon',
    activityId: null,
    party: { adults: 0, children: 2, infants: 0, guestChargeIsk: 2_700 },
  },
});

const fulfilledBooking = Reply.ok({ status: 'fulfilled', bookingId: '7a1c2b3d-0000-4000-8000-000000000010' });
const unpaid = Reply.ok({ status: 'processing', awaitingPayment: true });
const settling = Reply.ok({ status: 'processing' });

const confirms = () => api.sentAll('/bookings/payment-sessions/confirm', 'POST');

function confirmReplies(...replies: StubReply[]): void {
  let n = 0;
  api.on('POST', '/bookings/payment-sessions/confirm', () => replies[Math.min(n++, replies.length - 1)]);
}

beforeEach(() => {
  // What refreshCredits reads after money moved.
  api.on('GET', '/profile', Reply.ok({ id: MEMBER_A, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false, locale: 'en' }));
  api.on('GET', '/subscriptions', Reply.ok(null));
});

/** The first profile of a launch has loaded (F3 runs the activation hooks). */
async function launch(memberId = MEMBER_A): Promise<void> {
  // Signed in after the restart (killProcess forgot the store); keep a profile already set up.
  if (useAppStore.getState().userId !== memberId) signIn(memberId);
  await act(async () => {
    await runActivationHooks({ memberId, trigger: 'profile' });
  });
  await act(flush);
}

async function foreground(memberId = MEMBER_A): Promise<void> {
  await act(async () => {
    await runActivationHooks({ memberId, trigger: 'foreground' });
  });
  await act(flush);
}

describe('a payment the app lost behind the page', () => {
  it('is saved before the page opens, and a return after process death settles it exactly once', async () => {
    signIn();
    let savedWhenOpened: unknown[] = [];
    openAuthSession.mockImplementation(async () => {
      savedWhenOpened = await storedRecords();
      // The member pays; Android kills the app behind the tab.
      return new Promise<never>(() => undefined);
    });
    void payOnHostedPage({
      rail: 'booking',
      memberId: MEMBER_A,
      url: PAGE,
      key: KEY,
      amountIsk: 1_990,
      booking: hotYoga,
    });
    await act(flush);
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    expect(savedWhenOpened).toHaveLength(1);
    expect(savedWhenOpened[0]).toMatchObject({ rail: 'booking', key: KEY, amountIsk: 1_990, memberId: MEMBER_A });

    killProcess();
    // `lifepass://payment-success` cold-starts the app.
    launchedWith('lifepass://payment-success');
    confirmReplies(fulfilledBooking);
    await render(<DialogHost />);
    await launch();

    expect(confirms()).toHaveLength(1);
    expect(confirms()[0].body).toEqual({ key: KEY });
    expect(screen.getByText(lookup('booking.confirmed_title', 'en'))).toBeTruthy();
    expect(screen.getByText(confirmedBody(true, true, 'en'))).toBeTruthy();
    expect(await storedRecords()).toEqual([]);
    // Credits re-read after the paid booking.
    expect(api.sentAll('/profile', 'GET').length).toBeGreaterThan(0);

    // Every later trigger finds nothing: the link again, a foreground, a relaunch.
    await fireEvent.press(screen.getByText(lookup('common.done', 'en')));
    await act(() => {
      handlePaymentReturnUrl('lifepass://payment-success');
    });
    await foreground();
    await launch();
    expect(confirms()).toHaveLength(1);
    expect(screen.queryByText(lookup('booking.confirmed_title', 'en'))).toBeNull();
  });

  it('a cold start on the cancel link asks once: no payment was taken', async () => {
    signIn();
    await saveInflight(walkInAttempt());
    killProcess();
    launchedWith('lifepass://payment-canceled');
    confirmReplies(unpaid);
    await render(<DialogHost />);
    await launch();

    expect(confirms()).toHaveLength(1);
    expect(confirms()[0].body).toEqual({ key: 'walkin-key-1' });
    expect(screen.getByText(lookup('booking.pay.not_paid_title', 'en'))).toBeTruthy();
    expect(screen.getByText('No payment was taken. You can try again.')).toBeTruthy();
    expect(screen.queryByText(lookup('booking.pay.check_again', 'en'))).toBeNull();
    expect(await readInflight(MEMBER_A)).toEqual([]);
  });

  it('a launch with no link (the app icon) asks like Done: two unpaid answers', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    confirmReplies(unpaid);
    await render(<DialogHost />);
    await launch();
    expect(confirms()).toHaveLength(2);
    expect(screen.getByText(lookup('booking.pay.not_paid_title', 'en'))).toBeTruthy();
  });

  it('a payment that shows on the second poll is a booking', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    launchedWith('lifepass://payment-success');
    confirmReplies(unpaid, fulfilledBooking);
    await render(<DialogHost />);
    await launch();
    expect(confirms()).toHaveLength(2);
    expect(screen.getByText(lookup('booking.confirmed_title', 'en'))).toBeTruthy();
  });

  it('a link that arrives before the member is known waits for them', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    confirmReplies(unpaid);
    await render(<DialogHost />);
    // F4's router hands the launch link over before the session is restored.
    expect(handlePaymentReturnUrl('lifepass://payment-canceled')).toBe(true);
    await act(flush);
    expect(confirms()).toHaveLength(0);
    await launch();
    expect(confirms()).toHaveLength(1);
    expect(screen.getByText(lookup('booking.pay.not_paid_title', 'en'))).toBeTruthy();
  });

  it('a refund says why, in the class words', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    launchedWith('lifepass://payment-canceled');
    confirmReplies(Reply.ok({ status: 'refunded', reason: 'slot_full' }));
    await render(<DialogHost />);
    await launch();
    expect(screen.getByText(lookup('booking.pay.refunded_title', 'en'))).toBeTruthy();
    expect(screen.getByText(lookup('booking.pay.refunded_class_body', 'en'))).toBeTruthy();
  });

  it('a walk-in paid on the page says where the proof is, in Icelandic too', async () => {
    // The account speaks Icelandic (the re-read after the payment says so too).
    api.on('GET', '/profile', Reply.ok({ id: MEMBER_A, email: 'member@example.com', kennitalaVerified: false, marketingConsent: false, locale: 'is' }));
    signIn();
    await saveInflight(walkInAttempt());
    killProcess();
    signIn(MEMBER_A, { locale: 'is' });
    await act(() => setCurrentLanguage('is'));
    launchedWith('lifepass://payment-success');
    confirmReplies(Reply.ok({ status: 'fulfilled', checkInId: '9d7c1b2a-0000-4000-8000-000000000001' }));
    await render(<DialogHost />);
    await launch();
    expect(screen.getByText(lookup('checkin.proof.banner_title', 'is'))).toBeTruthy();
    expect(
      screen.getByText(translate('payments.recovered.checked_in_venue', 'is', { venue: 'Sky Lagoon' })),
    ).toBeTruthy();
  });

  it('a record older than a day is dropped without a request', async () => {
    signIn();
    await saveInflight(classAttempt(), Date.now() - 25 * 60 * 60 * 1000);
    killProcess();
    launchedWith('lifepass://payment-success');
    await render(<DialogHost />);
    await launch();
    expect(confirms()).toHaveLength(0);
    expect(await storedRecords()).toEqual([]);
  });

  it('sign-out forgets the attempt and the waiting link', async () => {
    signIn();
    await saveInflight(classAttempt());
    // The link lands while the session is still being restored: it waits.
    useAppStore.setState({ isLoading: true });
    await act(() => {
      handlePaymentReturnUrl('lifepass://payment-canceled');
    });
    expect(confirms()).toHaveLength(0);
    await runSignOutCleaners({ memberId: MEMBER_A });
    killProcess();
    await launch();
    expect(confirms()).toHaveLength(0);
    expect(await storedRecords()).toEqual([]);
  });

  it('another member signing in never resolves or sees it', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    confirmReplies(fulfilledBooking);
    await render(<DialogHost />);
    await launch(MEMBER_B);
    expect(confirms()).toHaveLength(0);
    expect(screen.queryByText(lookup('booking.confirmed_title', 'en'))).toBeNull();
    expect(await storedRecords(MEMBER_A)).toHaveLength(1);
  });

  it('"Confirming your payment" is said once; later returns check quietly and speak when it settles', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    launchedWith('lifepass://payment-success');
    confirmReplies(settling);
    await render(<DialogHost />);
    await launch();
    expect(confirms()).toHaveLength(5);
    expect(screen.getByText(lookup('booking.pay.processing_title', 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByText(lookup('common.cancel', 'en')));
    expect(await storedRecords()).toHaveLength(1);

    await foreground();
    expect(confirms()).toHaveLength(10);
    expect(screen.queryByText(lookup('booking.pay.processing_title', 'en'))).toBeNull();

    confirmReplies(fulfilledBooking);
    await foreground();
    expect(screen.getByText(lookup('booking.confirmed_title', 'en'))).toBeTruthy();
    expect(await storedRecords()).toEqual([]);
  });

  it('Check again in the dialog asks again under the same key', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    launchedWith('lifepass://payment-canceled');
    confirmReplies(settling, fulfilledBooking);
    await render(<DialogHost />);
    await launch();
    expect(confirms()).toHaveLength(1);
    await fireEvent.press(screen.getByText(lookup('booking.pay.check_again', 'en')));
    await act(flush);
    expect(confirms()).toHaveLength(2);
    expect(confirms().map((r) => (r.body as { key: string }).key)).toEqual([KEY, KEY]);
    expect(screen.getByText(lookup('booking.confirmed_title', 'en'))).toBeTruthy();
  });

  it('a confirm that does not answer is said after the link, and retried quietly later', async () => {
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    launchedWith('lifepass://payment-success');
    confirmReplies(Reply.problem(503, 'internal_error'));
    await render(<DialogHost />);
    await launch();
    expect(screen.getByText(lookup('error.server', 'en'))).toBeTruthy();
    await fireEvent.press(screen.getByText(lookup('common.ok', 'en')));
    expect(await storedRecords()).toHaveLength(1);

    await foreground();
    expect(confirms()).toHaveLength(2);
    expect(screen.queryByText(lookup('error.server', 'en'))).toBeNull();
  });

  it('a rail’s own presenter replaces the default (BOOK-1 schedules the reminders there)', async () => {
    const seen: PaymentResolution[] = [];
    registerPaymentOutcomePresenter('booking', (resolution) => {
      seen.push(resolution);
    });
    signIn();
    await saveInflight(classAttempt());
    killProcess();
    launchedWith('lifepass://payment-success');
    confirmReplies(fulfilledBooking);
    await render(<DialogHost />);
    await launch();
    expect(seen).toHaveLength(1);
    const [resolution] = seen;
    expect(resolution.rail).toBe('booking');
    if (resolution.rail === 'booking') {
      expect(resolution.settlement.kind).toBe('fulfilled');
      expect(resolution.record.booking).toMatchObject({ className: 'Hot yoga', startsAt: '2026-10-20T10:00:00Z' });
    }
    expect(screen.queryByText(lookup('booking.confirmed_title', 'en'))).toBeNull();
  });
});

describe('plans, cards and co-pay after process death', () => {
  const planRecord = (prePurchasePassIds: string[] = ['11111111-1111-4111-8111-111111111111']): NewInflightRecord => ({
    rail: 'plan',
    memberId: MEMBER_A,
    externalSessionId: SESSION,
    plan: { productSlug: 'pass-day', planName: 'Day Pass', prePurchasePassIds, prePurchaseSubSlug: null },
  });

  it('a pass bought behind the page is confirmed from the profile and welcomed', async () => {
    signIn();
    await saveInflight(planRecord());
    killProcess();
    launchedWith('lifepass://payment-success');
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    api.on(
      'GET',
      '/profile',
      Reply.ok({
        id: MEMBER_A,
        email: 'member@example.com',
        kennitalaVerified: false,
        marketingConsent: false,
        locale: 'en',
        usage: usageJSON([{ id: '11111111-1111-4111-8111-111111111111' }, { id: '22222222-2222-4222-8222-222222222222' }]),
      }),
    );
    await render(<DialogHost />);
    await launch();
    expect(api.sent('/payments/checkout-sessions/confirm').body).toEqual({ externalSessionId: SESSION });
    // A pass is never confirmed by the status endpoint.
    expect(api.sentAll('/payments/status')).toHaveLength(0);
    expect(screen.getByText(lookup('plans.welcome_title', 'en'))).toBeTruthy();
    expect(screen.getByText(translate('plans.success.pass', 'en', { name: 'Day Pass' }))).toBeTruthy();
    expect(await storedRecords()).toEqual([]);
  });

  it('a checkout left on the cancel link verifies nothing and says nothing', async () => {
    signIn();
    await saveInflight(planRecord());
    killProcess();
    launchedWith('lifepass://payment-canceled');
    await render(<DialogHost />);
    await launch();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(0);
    expect(screen.queryByText(lookup('plans.welcome_title', 'en'))).toBeNull();
    expect(await storedRecords()).toEqual([]);
  });

  it('a purchase nothing can confirm names the support address, never a status code', async () => {
    signIn();
    await saveInflight({
      rail: 'plan',
      memberId: MEMBER_A,
      externalSessionId: SESSION,
      plan: { productSlug: 'plan-plus', planName: 'Plus', prePurchasePassIds: [], prePurchaseSubSlug: null },
    });
    killProcess();
    launchedWith('lifepass://payment-success');
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'processing' }));
    api.on('GET', '/payments/status', Reply.ok({ status: 'pending' }));
    await render(<DialogHost />);
    await launch();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(3);
    expect(api.sentAll('/payments/status')).toHaveLength(12);
    expect(screen.getByText(lookup('plans.payment_issue', 'en'))).toBeTruthy();
    expect(screen.getByText(translate('plans.confirm_timeout', 'en', { email: MerchantInfo.email }))).toBeTruthy();
  });

  it('a card setup page is always confirmed, quietly', async () => {
    signIn();
    await saveInflight({ rail: 'card_setup', memberId: MEMBER_A });
    killProcess();
    launchedWith('lifepass://card-setup-canceled');
    api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: { brand: 'visa', last4: '4242' } }));
    const seen: PaymentResolution[] = [];
    registerPaymentOutcomePresenter('card_setup', (resolution) => {
      seen.push(resolution);
    });
    await launch();
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(1);
    expect(await storedRecords()).toEqual([]);
    // Quiet by default; a presenter Account registers is told, to re-read billing.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ rail: 'card_setup', card: { brand: 'visa', last4: '4242' } });
  });

  it('a co-pay share paid behind the page is pulled and the plan re-read', async () => {
    signIn();
    await saveInflight({ rail: 'copay', memberId: MEMBER_A, purpose: 'retry', externalSessionId: SESSION });
    killProcess();
    api.on('POST', '/payments/checkout-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    await launch();
    expect(api.sentAll('/payments/checkout-sessions/confirm')).toHaveLength(1);
    expect(api.sentAll('/subscriptions', 'GET').length).toBeGreaterThan(0);
    expect(await storedRecords()).toEqual([]);
  });
});

describe('the live flow', () => {
  const live = (overrides: Partial<Parameters<typeof payOnHostedPage>[0]> = {}) =>
    payOnHostedPage({
      rail: 'booking',
      memberId: MEMBER_A,
      url: PAGE,
      key: KEY,
      amountIsk: 1_990,
      booking: { kind: 'class', activityId: '7a1c2b3d-0000-4000-8000-0000000000aa', eventId: 4242 },
      ...overrides,
    } as Parameters<typeof payOnHostedPage>[0]);

  it('a payment the flow is still settling is left to it, and confirmed once', async () => {
    signIn();
    let close!: (value: WebBrowser.WebBrowserAuthSessionResult) => void;
    openAuthSession.mockImplementation(() => new Promise((resolve) => (close = resolve)));
    confirmReplies(fulfilledBooking);
    await render(<DialogHost />);
    const result = live({ isScreenAlive: () => true });
    await act(flush);
    // The tab is up; the app comes back to the foreground for a moment.
    await foreground();
    await act(() => {
      handlePaymentReturnUrl('lifepass://payment-success');
    });
    expect(confirms()).toHaveLength(0);
    close({ type: 'success', url: 'lifepass://payment-success' });
    const settled = await result;
    expect(settled).toMatchObject({ kind: 'settled', page: 'returned', leg: 'done', key: 'retire', presented: false });
    expect(confirms()).toHaveLength(1);
    // The screen shows it; nothing else does.
    expect(screen.queryByText(lookup('booking.confirmed_title', 'en'))).toBeNull();
    expect(await storedRecords()).toEqual([]);
  });

  it('a page that never opened ends unpaid without asking, and its record goes', async () => {
    signIn();
    openAuthSession.mockRejectedValue(new Error('no browser'));
    const result = await live();
    expect(result).toMatchObject({
      kind: 'settled',
      page: 'neverOpened',
      settlement: { kind: 'outcome', outcome: { kind: 'notPaid' } },
      key: 'retire',
    });
    expect(confirms()).toHaveLength(0);
    expect(await storedRecords()).toEqual([]);
  });

  it('the screen that went away: the outcome is shown for it', async () => {
    signIn();
    openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-canceled' });
    confirmReplies(Reply.ok({ status: 'refunded', reason: 'slot_full' }));
    await render(<DialogHost />);
    let result: Awaited<ReturnType<typeof live>> | undefined;
    await act(async () => {
      result = await live({ isScreenAlive: () => false });
    });
    expect(result).toMatchObject({ kind: 'settled', leg: 'cancel', presented: true });
    expect(confirms()).toHaveLength(1);
    expect(screen.getByText(lookup('booking.pay.refunded_class_body', 'en'))).toBeTruthy();
  });

  it('a second tap while the page is open opens nothing', async () => {
    signIn();
    let close!: (value: WebBrowser.WebBrowserAuthSessionResult) => void;
    openAuthSession.mockImplementation(() => new Promise((resolve) => (close = resolve)));
    confirmReplies(fulfilledBooking);
    const first = live();
    await act(flush);
    await expect(live()).resolves.toEqual({ kind: 'busy' });
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    close(DISMISSED);
    await first;
    expect(await storedRecords()).toEqual([]);
  });

  it('two taps together open one page; the second is busy, never "not paid"', async () => {
    signIn();
    openAuthSession.mockResolvedValue(DISMISSED);
    confirmReplies(fulfilledBooking);
    const [first, second] = await Promise.all([live(), live()]);
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ kind: 'settled', settlement: { kind: 'fulfilled' } });
    expect(second).toEqual({ kind: 'busy' });
    expect(confirms()).toHaveLength(1);
  });

  it('still settling: the screen holds it for Check again, then lets go and the record waits quietly', async () => {
    signIn();
    openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-success' });
    confirmReplies(settling);
    await render(<DialogHost />);
    const result = await live({ isScreenAlive: () => true });
    expect(result).toMatchObject({ kind: 'settled', key: 'reuse', presented: false });
    const attempt = result.kind === 'settled' ? result.attempt : null;
    expect(attempt).not.toBeNull();
    expect(confirms()).toHaveLength(5);

    // Held by the screen: a foreground leaves it alone.
    await foreground();
    expect(confirms()).toHaveLength(5);

    // Check again: the same key, the Done leg.
    const again = await checkPaymentAgain(attempt!);
    expect(confirms()).toHaveLength(10);
    expect(confirms().every((r) => (r.body as { key: string }).key === KEY)).toBe(true);
    const held = again.kind === 'settled' ? again.attempt : null;

    // The member closes the alert: the record stays, and later returns are quiet until it settles.
    await leaveAttempt(held!);
    expect((await storedRecords())[0]).toMatchObject({ key: KEY, presentedProcessing: true });
    await foreground();
    expect(confirms()).toHaveLength(15);
    expect(screen.queryByText(lookup('booking.pay.processing_title', 'en'))).toBeNull();
  });

  it('an old payment left unresolved is settled before a new one starts', async () => {
    signIn();
    await saveInflight(classAttempt(MEMBER_A, 'old-key-00001'));
    killProcess();
    signIn();
    const order: string[] = [];
    api.on('POST', '/bookings/payment-sessions/confirm', (request) => {
      order.push(`confirm ${(request.body as { key: string }).key}`);
      return fulfilledBooking;
    });
    openAuthSession.mockImplementation(async () => {
      order.push('page');
      return DISMISSED;
    });
    await render(<DialogHost />);
    await act(async () => {
      await live();
    });
    expect(order).toEqual(['confirm old-key-00001', 'page', `confirm ${KEY}`]);
  });

  it('never shows one member’s outcome to the next', async () => {
    signIn();
    openAuthSession.mockImplementation(async () => {
      // Signed out (and someone else in) while the page was up.
      useAppStore.setState({ userId: MEMBER_B, profile: null });
      return DISMISSED;
    });
    confirmReplies(fulfilledBooking);
    await render(<DialogHost />);
    await act(async () => {
      await live({ isScreenAlive: () => false });
    });
    expect(screen.queryByText(lookup('booking.confirmed_title', 'en'))).toBeNull();
  });
});
