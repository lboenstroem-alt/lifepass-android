/**
 * What an Android-only choice asks of the walk-in: the flow is ONE store per
 * app that outlives the Scan screen and the session (iOS's view model dies
 * with its view). So an answer that lands after sign-out, or after a new scan
 * or link started another attempt, must write nothing; a payment proof must
 * come from the payment that settled, not from whatever the screen holds by
 * then; every close acts once; and a consented payment that cannot open its
 * page says so.
 */
import { api, Reply, type StubReply } from '@test/server';

import { translate } from '../../../../i18n';
import {
  EARLIER_STILL_CONFIRMING,
  type AttemptRef,
  type HostedPayResult,
  type PayOnHostedPageRequest,
  type PaySettlement,
  type WalkInAttemptContext,
} from '../../../../payments';
import { INITIAL_WALK_IN_STATE, isWalkInIdle } from '../store';

import {
  bodyOf,
  checkInJSON,
  keyOf,
  posts,
  previewJSON,
  SKY_LAGOON_ID,
  SWIM_ID,
  walkInStoreForTest,
  walkInTestEnvironment,
  WORLD_CLASS_ID,
  YOGA_ID,
} from './walkInHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

walkInTestEnvironment();

const walkIns = () => posts('/check-ins/walk-in');
const sessions = () => posts('/bookings/payment-sessions');

/** Something the test lets happen later. */
function gate<T = void>() {
  let open: (value: T) => void = () => undefined;
  const opened = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** A server answer held until `held.open()`. */
function heldReply(held: { opened: Promise<void> }, reply: StubReply) {
  return () => held.opened.then(() => reply);
}

/** Lets the stub server answer and the flow's continuations run. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const FULFILLED: PaySettlement = {
  kind: 'fulfilled',
  confirmation: {
    status: 'fulfilled',
    bookingId: null,
    checkInId: null,
    reason: null,
    awaitingPayment: false,
    ratingPrompt: null,
    lifetimeCheckIns: null,
  },
};

function settled(settlement: PaySettlement, extra: Partial<Extract<HostedPayResult, { kind: 'settled' }>> = {}): HostedPayResult {
  return {
    kind: 'settled',
    page: 'returned',
    leg: 'done',
    settlement,
    key: settlement.kind === 'fulfilled' ? 'retire' : 'reuse',
    presented: false,
    attempt: null,
    ...extra,
  };
}

const STILL_PROCESSING: PaySettlement = { kind: 'outcome', outcome: { kind: 'processing' } };
const THIS_PAGE: AttemptRef = { attemptId: 'attempt-this-page', memberId: 'member' };
const EARLIER: AttemptRef = { attemptId: 'attempt-earlier', memberId: 'member' };

/** A venue with a surcharge and no card on file: the consent leads to the pay rail. */
function payRail(previewOptions: Parameters<typeof previewJSON>[0] = {}) {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 }, ...previewOptions })));
  api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
  api.on('POST', '/bookings/payment-sessions', Reply.ok({
    hasCard: false,
    externalSessionId: 'kling_cs_9',
    url: 'https://pay.kling.is/c/kling_cs_9',
    amountIsk: 1500,
  }));
}

describe('sign-out stops what is in flight', () => {
  it('during the preview: no walk-in is sent after it', async () => {
    const held = gate();
    api.on('GET', '/check-ins/walk-in/preview', heldReply(held, Reply.ok(previewJSON())));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();

    const starting = store.getState().startWalkIn(SKY_LAGOON_ID);
    await flush();
    store.getState().reset();
    held.open();
    await starting;
    await flush();

    expect(walkIns()).toHaveLength(0);
    expect(store.getState()).toMatchObject(INITIAL_WALK_IN_STATE);
  });

  it("during the check-in: the answer draws no proof for the next member, and refreshes nobody's balance", async () => {
    const held = gate();
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', heldReply(held, Reply.ok(checkInJSON({ memberShortName: 'Lucas B.' }), 201)));
    const refreshCredits = jest.fn(async () => undefined);
    const store = walkInStoreForTest({ refreshCredits });

    const starting = store.getState().startWalkIn(SKY_LAGOON_ID);
    await flush();
    expect(walkIns()).toHaveLength(1);
    store.getState().reset();
    held.open();
    await starting;
    await flush();

    expect(store.getState().showSuccess).toBe(false);
    expect(store.getState().successMemberShortName).toBeNull();
    expect(store.getState()).toMatchObject(INITIAL_WALK_IN_STATE);
    expect(refreshCredits).not.toHaveBeenCalled();
  });

  it('during a refused check-in: no stale alert greets the next member', async () => {
    const held = gate();
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', heldReply(held, Reply.problem(429, 'rate_limited')));
    const store = walkInStoreForTest();

    const starting = store.getState().startWalkIn(SKY_LAGOON_ID);
    await flush();
    store.getState().reset();
    held.open();
    await starting;
    await flush();

    expect(store.getState().error).toBeNull();
    expect(isWalkInIdle(store.getState())).toBe(true);
  });

  it('while the hosted page is open: the screen counts as gone, and the payment writes nothing', async () => {
    payRail();
    const page = gate<HostedPayResult>();
    let request: PayOnHostedPageRequest | null = null;
    const store = walkInStoreForTest({
      payOnPage: (sent) => {
        request = sent;
        return page.opened;
      },
    });
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    const accepting = store.getState().acceptWalkInCharge();
    await flush();
    expect(store.getState().payPageOpen).toBe(true);
    expect(request!.isScreenAlive?.()).toBe(true);

    store.getState().reset();
    // F8 tells the same member itself, or keeps the payment for the recovery.
    expect(request!.isScreenAlive?.()).toBe(false);
    page.open(settled(FULFILLED));
    await accepting;

    expect(store.getState()).toMatchObject(INITIAL_WALK_IN_STATE);
  });

  it('a payment still settling is let go, back to the recovery', async () => {
    payRail();
    const leaveAttempt = jest.fn(async () => undefined);
    const store = walkInStoreForTest({
      payOnPage: async () => settled(STILL_PROCESSING, { attempt: THIS_PAGE }),
      leaveAttempt,
    });
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().payOutcome).toEqual({ kind: 'processing' });

    store.getState().reset();
    expect(leaveAttempt).toHaveBeenCalledWith(THIS_PAGE);
    expect(store.getState().payOutcome).toBeNull();
  });
});

describe('a new scan or link starts a new attempt', () => {
  it("an earlier check-in's answer stays out of it", async () => {
    const held = gate();
    api.on('GET', '/check-ins/walk-in/preview', (request) =>
      request.query.venueId === WORLD_CLASS_ID
        ? Reply.ok(previewJSON({ venueId: WORLD_CLASS_ID, slug: 'world-class', name: 'World Class' }))
        : Reply.ok(previewJSON()),
    );
    api.on('POST', '/check-ins/walk-in', heldReply(held, Reply.ok(checkInJSON({ memberShortName: 'Lucas B.' }), 201)));
    const refreshCredits = jest.fn(async () => undefined);
    const store = walkInStoreForTest({ refreshCredits });

    const first = store.getState().startWalkIn(SKY_LAGOON_ID);
    await flush();
    expect(walkIns()).toHaveLength(1);
    // A link to another venue arrives while the first check-in is out.
    await store.getState().startWalkIn(WORLD_CLASS_ID, { fromLink: true });
    expect(store.getState().showLinkConfirm).toBe(true);

    held.open();
    await first;
    await flush();

    expect(store.getState().showSuccess).toBe(false);
    expect(store.getState().successVenueName).toBeNull();
    expect(store.getState().showLinkConfirm).toBe(true);
    expect(store.getState().preview?.venue.name).toBe('World Class');
    expect(store.getState().isProcessing).toBe(false);
    // The same member was checked in at the first venue: their balance moved.
    expect(refreshCredits).toHaveBeenCalledTimes(1);
  });

  it('a payment the last attempt held goes back to the recovery; Check again never settles it here', async () => {
    payRail();
    const leaveAttempt = jest.fn(async () => undefined);
    const checkAgain = jest.fn(async () => settled(FULFILLED));
    const store = walkInStoreForTest({
      payOnPage: async () => settled(STILL_PROCESSING, { attempt: THIS_PAGE }),
      leaveAttempt,
      checkAgain,
    });
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().payOutcome).toEqual({ kind: 'processing' });

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(leaveAttempt).toHaveBeenCalledWith(THIS_PAGE);
    expect(store.getState().payOutcome).toBeNull();
    expect(store.getState().showChargeConsent).toBe(true);

    await store.getState().checkPaymentAgain();
    expect(checkAgain).not.toHaveBeenCalled();
    expect(store.getState().showSuccess).toBe(false);
  });
});

describe("the proof after a payment is that payment's", () => {
  it('an earlier attempt handed over is proven with its own party and activity', async () => {
    payRail();
    const earlier: WalkInAttemptContext = {
      venueId: SKY_LAGOON_ID,
      venueName: 'Sky Lagoon',
      venueSlug: 'sky-lagoon',
      activityId: SWIM_ID,
      activityName: 'Swim',
      party: { adults: 2, children: 0, infants: 0, guestChargeIsk: 5400 },
    };
    const attemptContext = jest.fn(async () => earlier);
    const checkAgain = jest.fn(async () => settled(FULFILLED));
    const store = walkInStoreForTest({
      payOnPage: async () => ({ kind: 'unresolved', attempt: EARLIER, settlement: EARLIER_STILL_CONFIRMING }),
      attemptContext,
      checkAgain,
    });
    // The member rescans alone, after an earlier attempt for a party was lost.
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(attemptContext).toHaveBeenCalledWith(EARLIER);
    expect(store.getState().payOutcome).toEqual({ kind: 'processing' });

    await store.getState().checkPaymentAgain();
    expect(checkAgain).toHaveBeenCalledWith(EARLIER, expect.any(Function));
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().successParty).toEqual(earlier.party);
    expect(store.getState().successActivityName).toBe('Swim');
    expect(store.getState().successVenueName).toBe('Sky Lagoon');
    expect(store.getState().successMemberShortName).toBeNull();
  });

  it("this attempt's own page is proven with what it was opened for", async () => {
    payRail({ activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }] });
    const store = walkInStoreForTest({
      payOnPage: async () => settled(STILL_PROCESSING, { attempt: THIS_PAGE }),
      checkAgain: async () => settled(FULFILLED),
    });
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().selectActivity({ id: SWIM_ID, name: 'Swim' });
    await store.getState().acceptWalkInCharge();
    // Whatever the screen holds by the time it settles:
    store.setState({ pickerActivities: [], guestCounts: { adult: 3 } });

    await store.getState().checkPaymentAgain();
    expect(store.getState().successActivityName).toBe('Swim');
    expect(store.getState().successParty).toBeNull();
  });

  it('a payment for this venue settled a moment ago names no activity', async () => {
    payRail({ activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }] });
    const store = walkInStoreForTest({ payOnPage: async () => settled(FULFILLED, { page: 'earlier', leg: null }) });
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().selectActivity({ id: SWIM_ID, name: 'Swim' });
    await store.getState().acceptWalkInCharge();
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().successActivityName).toBeNull();
    expect(store.getState().successVenueName).toBe('Sky Lagoon');
  });
});

it("a consented payment that cannot open its page says so, and the next attempt has a new key", async () => {
  payRail();
  const store = walkInStoreForTest({ payOnPage: async () => ({ kind: 'busy' }) });
  await store.getState().startWalkIn(SKY_LAGOON_ID);
  await store.getState().acceptWalkInCharge();

  expect(store.getState().error).toBe(translate('checkin.err.unavailable', 'en'));
  expect(store.getState().errorCTA).toBeNull();
  expect(isWalkInIdle(store.getState())).toBe(false);
  store.getState().dismissError();
  expect(isWalkInIdle(store.getState())).toBe(true);

  await store.getState().startWalkIn(SKY_LAGOON_ID);
  await store.getState().acceptWalkInCharge();
  expect(sessions()).toHaveLength(2);
  expect(keyOf(sessions()[1])).not.toBe(keyOf(sessions()[0]));
});

describe('every close acts once', () => {
  it('a close tapped after "Check in, no charge" keeps the check-in whole', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      activities: [{ id: YOGA_ID, name: 'Yoga' }],
      guestBands: [{ band: 'adult', unitIsk: 2650 }],
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(store.getState().showOwnVisitConfirm).toBe(true);

    const checkingIn = store.getState().checkInOwnVisit();
    store.getState().declineOwnVisit();
    expect(store.getState().isProcessing).toBe(true);
    await checkingIn;

    expect(walkIns()).toHaveLength(1);
    expect(bodyOf(walkIns()[0]).activityId).toBe(YOGA_ID);
    expect(store.getState().showSuccess).toBe(true);
  });

  it('a Cancel tapped after the consent keeps the charged check-in and its key', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({ hasCard: true }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    const accepting = store.getState().acceptWalkInCharge();
    store.getState().declineWalkInCharge();
    expect(isWalkInIdle(store.getState())).toBe(false);
    await accepting;

    expect(store.getState().error).toBeNull();
    expect(keyOf(sessions()[0])).toBe(keyOf(walkIns()[0]));
    expect(bodyOf(walkIns()[1]).acceptCharge).toBe(true);
    expect(store.getState().showSuccess).toBe(true);
  });

  it('a Cancel tapped after "Check in" on a link keeps the check-in', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID, { fromLink: true });

    const confirming = store.getState().confirmLinkedWalkIn();
    store.getState().declineLinkedWalkIn();
    expect(isWalkInIdle(store.getState())).toBe(false);
    await confirming;

    expect(walkIns()).toHaveLength(1);
    expect(store.getState().showSuccess).toBe(true);
  });
});
