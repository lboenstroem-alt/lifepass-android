/**
 * The walk-in's money paths, end to end against the stub server: what the
 * phone sends at each step, under which Idempotency-Key, and what the member
 * is shown afterwards. Port of iOS LifePassTests/WalkInMoneyPathTests.swift,
 * same cases and vectors.
 *
 * The rules pinned here decide what a member is charged: nothing is POSTed
 * before a disclosed charge is consented to, a consent re-POST and the
 * pay-and-save-card session reuse the attempt's ONE key, a changed price is
 * re-offered, and a party paid for on the hosted page is still on the proof.
 *
 * Android runs the hosted page inside the accept (F8's `payOnHostedPage`
 * opens the Custom Tab and settles it), so where iOS stops on `bookingPayURL`
 * and calls `handleWalkInPayReturn`, these tests say how the tab closed
 * (`openAuthSessionAsync`'s answer) before the accept.
 */
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';

import { iskPrefix, translate } from '../../../../i18n';
import { confirmedParty } from '../store';

import {
  bodyOf,
  keyOf,
  posts,
  previewJSON,
  checkInJSON,
  SKY_LAGOON_ID,
  walkInStoreForTest,
  walkInTestEnvironment,
} from './walkInHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const PAID_LINK = { type: 'success', url: 'lifepass://payment-success' } as WebBrowser.WebBrowserAuthSessionResult;
const CANCEL_LINK = { type: 'success', url: 'lifepass://payment-canceled' } as WebBrowser.WebBrowserAuthSessionResult;

walkInTestEnvironment();

describe('charge consent', () => {
  it('a disclosed charge is consented to before anything is sent', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'surcharge', amountIsk: 1500, reason: 'boutique_overflow' },
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(1500);
    expect(posts('/check-ins/walk-in')).toHaveLength(0); // never charged un-shown

    await store.getState().acceptWalkInCharge();

    const post = posts('/check-ins/walk-in')[0];
    expect(bodyOf(post).acceptCharge).toBe(true);
    expect(bodyOf(post).acceptedChargeAmountIsk).toBe(1500);
    expect(keyOf(post)).toBeTruthy();
    expect(store.getState().showSuccess).toBe(true);
  });

  it('a moved price is re-offered and the re-POST keeps the key', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'charge_consent_required', {
      offer: { kind: 'surcharge', amountIsk: 1800 },
    }));
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();

    expect(store.getState().showChargeConsent).toBe(true); // the new price is shown before it is charged
    expect(store.getState().offerWasReoffered).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(1800);

    await store.getState().acceptWalkInCharge();

    const sent = posts('/check-ins/walk-in');
    expect(sent).toHaveLength(2);
    expect(bodyOf(sent[1]).acceptedChargeAmountIsk).toBe(1800);
    expect(keyOf(sent[0])).toBe(keyOf(sent[1])); // consenting never double-checks-in
    expect(store.getState().showSuccess).toBe(true);
  });

  it('declining sends nothing, and the next scan is a fresh attempt', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'topup', amountIsk: 2500, reason: 'monthly_exhausted' },
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    store.getState().declineWalkInCharge();
    expect(posts('/check-ins/walk-in')).toHaveLength(0);
    expect(store.getState().showChargeConsent).toBe(false);
    expect(store.getState().pendingOffer).toBeNull();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(posts('/check-ins/walk-in')).toHaveLength(1);
  });

  it('a declined attempt and the next one never share a key', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'charge_consent_required', {
      offer: { kind: 'surcharge', amountIsk: 1800 },
    }));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge(); // 402: re-offered
    store.getState().declineWalkInCharge();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();

    const sent = posts('/check-ins/walk-in');
    expect(sent).toHaveLength(2);
    expect(keyOf(sent[0])).not.toBe(keyOf(sent[1]));
  });
});

describe('guests on the pay-and-save-card rail', () => {
  function servePayRail(confirm: Parameters<typeof api.on>[2]) {
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({
      hasCard: false,
      externalSessionId: 'kling_cs_1',
      url: 'https://pay.kling.is/c/kling_cs_1',
      amountIsk: 2700,
    }));
    api.on('POST', '/bookings/payment-sessions/confirm', confirm);
  }

  it('a party paid on the hosted page is on the proof', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      guestBands: [
        { band: 'adult', unitIsk: 2700 },
        { band: 'child', rangeLabel: '6–15', unitIsk: 1350 },
      ],
    })));
    servePayRail(Reply.ok({ status: 'fulfilled', checkInId: '9d7c1b2a-0000-4000-8000-000000000001' }));
    openAuthSession.mockResolvedValue(PAID_LINK);
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    // The member's own visit is free here, so it comes first (2.5.3) and the
    // guest sheet waits behind "Bringing a guest?".
    expect(store.getState().showOwnVisitConfirm).toBe(true);
    expect(store.getState().showGuestPicker).toBe(false);
    await store.getState().openGuestsFromOwnVisit();
    expect(store.getState().showGuestPicker).toBe(true);
    store.setState({ guestCounts: { child: 2 } });
    await store.getState().confirmGuestSelection();
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(2700);

    await store.getState().acceptWalkInCharge();

    expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/c/kling_cs_1', 'lifepass://payment-', {
      createTask: false,
    });
    const session = posts('/bookings/payment-sessions')[0];
    expect(bodyOf(session).kind).toBe('walk_in');
    expect(bodyOf(session).guestAgeBands).toEqual(['child', 'child']);
    expect(bodyOf(session).bookingAction).toBe('walk_in'); // guest bands ride only with an explicit walk-in
    expect(bodyOf(session).acceptedChargeAmountIsk).toBe(2700);
    expect(bodyOf(session).activityId).toBeNull(); // a venue-level walk-in still sends the key

    expect(store.getState().showSuccess).toBe(true);
    const party = store.getState().successParty; // reception sees the party that was paid for
    expect(party).toEqual({ adults: 0, children: 2, infants: 0, guestChargeIsk: 2700 });
    expect(store.getState().successMemberShortName).toBeNull();
    expect(store.getState().successCoverage).toBeNull();
    expect(store.getState().successVenueName).toBe('Sky Lagoon');

    // One key for the whole attempt: walk-in, session, confirm.
    const key = keyOf(posts('/check-ins/walk-in')[0]);
    expect(key).toBeTruthy();
    expect(keyOf(session)).toBe(key);
    expect(bodyOf(posts('/bookings/payment-sessions/confirm')[0]).key).toBe(key);
  });

  it.each([
    ['Done (or the success link)', PAID_LINK, 2],
    ['the cancel link', CANCEL_LINK, 1],
  ])('leaving the page unpaid says no payment was taken: %s', async (_leg, link, confirms) => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({
      hasCard: false,
      externalSessionId: 'kling_cs_2',
      url: 'https://pay.kling.is/c/kling_cs_2',
      amountIsk: 1500,
    }));
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'processing', awaitingPayment: true }));
    openAuthSession.mockResolvedValue(link);
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    const key = keyOf(posts('/bookings/payment-sessions')[0]);

    expect(posts('/bookings/payment-sessions/confirm')).toHaveLength(confirms);
    expect(store.getState().payOutcome).toEqual({ kind: 'notPaid' });
    expect(store.getState().showSuccess).toBe(false);
    expect(store.getState().error).toBeNull();

    store.getState().dismissPayOutcome();
    await store.getState().acceptWalkInCharge();
    const retryKey = keyOf(posts('/bookings/payment-sessions').at(-1));
    expect(posts('/bookings/payment-sessions')).toHaveLength(2);
    expect(key).toBeTruthy();
    expect(retryKey).not.toBe(key); // a new attempt
  });

  it('a party already paid by an earlier session is on the proof too', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ guestBands: [{ band: 'adult', unitIsk: 2700 }] })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.problem(409, 'booking_payment_already_completed'));
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().openGuestsFromOwnVisit();
    store.setState({ guestCounts: { adult: 1 } });
    await store.getState().confirmGuestSelection();
    await store.getState().acceptWalkInCharge();

    expect(openAuthSession).not.toHaveBeenCalled();
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().successParty?.adults).toBe(1);
    expect(store.getState().successParty?.guestChargeIsk).toBe(2700);
  });

  it('a solo walk-in has no party', () => {
    expect(confirmedParty({ guestBandOffers: [], guestCounts: {} })).toBeNull();
  });
});

/** The consent alert says "ISK 5,400"; the receipt a few seconds later must not say "5.400 kr.". */
it('guest charges read in the consent alert\'s format', () => {
  expect(translate('checkin.party.charged', 'en').replace('%@', iskPrefix(5400))).toBe(
    'Guests: ISK 5,400 charged to your card',
  );
  expect(translate('checkin.party.charged.compact', 'is').replace('%@', iskPrefix(5400))).toBe(
    'ISK 5,400 gjaldfært á kortið þitt',
  );
});
