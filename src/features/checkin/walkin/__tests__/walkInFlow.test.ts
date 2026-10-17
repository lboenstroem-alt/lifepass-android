/**
 * The walk-in's decision machine against the stub server: the activity
 * picker and its per-activity re-preview, the booked-class attendance
 * choice, the link confirm, blocked previews, refused confirms with their
 * steps, and the pay rail's create-time answers. What the phone sends is
 * checked against the API contract (0.34.0).
 */
import * as WebBrowser from 'expo-web-browser';
import { api, Reply } from '@test/server';
import { sampleResponse } from '@test/contract';

import { expectSentToMatchContract } from '../../../../api/testing';
import { translate } from '../../../../i18n';
import { payOutcomeMessage } from '../../../../payments';
import { decodeWalkInResult, walkInBody } from '../service';
import { guestAgeBandsPayload, isWalkInIdle, MAX_GUESTS } from '../store';

import {
  BOOKING_ID,
  bodyOf,
  checkInJSON,
  keyOf,
  posts,
  previewJSON,
  SKY_LAGOON_ID,
  SWIM_ID,
  walkInStoreForTest,
  walkInTestEnvironment,
  YOGA_ID,
} from './walkInHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const PAID_LINK = { type: 'success', url: 'lifepass://payment-success' } as WebBrowser.WebBrowserAuthSessionResult;

walkInTestEnvironment();

const previews = () => api.sentAll('/check-ins/walk-in/preview', 'GET');
const walkIns = () => posts('/check-ins/walk-in');

describe('the body', () => {
  it('sends only what the attempt chose, ids lower case, in iOS order', () => {
    expect(walkInBody({ venueId: SKY_LAGOON_ID.toUpperCase(), activityId: null })).toEqual({ venueId: SKY_LAGOON_ID });
    expect(
      Object.keys(
        walkInBody({
          venueId: SKY_LAGOON_ID,
          activityId: YOGA_ID.toUpperCase(),
          acceptCharge: true,
          acceptedChargeAmountIsk: 1500,
          bookingAction: 'walk_in',
          guestAgeBands: ['adult'],
        }),
      ),
    ).toEqual(['venueId', 'activityId', 'acceptCharge', 'acceptedChargeAmountIsk', 'bookingAction', 'guestAgeBands']);
    // An empty party is left out (the server refuses an empty list); no consent, no amount.
    expect(
      walkInBody({ venueId: SKY_LAGOON_ID, activityId: null, acceptCharge: false, acceptedChargeAmountIsk: 1500, guestAgeBands: [] }),
    ).toEqual({ venueId: SKY_LAGOON_ID });
  });

  it('one band per guest, in band order; none is no list at all', () => {
    expect(guestAgeBandsPayload({ child: 2, adult: 1, infant: 0 })).toEqual(['adult', 'child', 'child']);
    expect(guestAgeBandsPayload({ adult: 0 })).toBeNull();
    expect(guestAgeBandsPayload({})).toBeNull();
  });

  it("decodes the contract's own check-in answer", () => {
    const sample = sampleResponse('POST', '/check-ins/walk-in', 201, 'full') as Record<string, unknown>;
    const result = decodeWalkInResult(sample);
    expect(result.checkInId).toBe(String(sample.checkInId).toLowerCase());
  });

  it('reads a blank or unreadable short name as no name, never a placeholder', () => {
    for (const memberShortName of ['  ', 42, null, undefined]) {
      expect(decodeWalkInResult(checkInJSON({ memberShortName })).memberShortName).toBeNull();
    }
    expect(decodeWalkInResult(checkInJSON({ memberShortName: 'Lucas B.', memberName: 'Lucas Bönström' })).memberShortName).toBe(
      'Lucas B.',
    );
  });

  it('a free walk-in and a consented, guest-carrying one match the contract', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID.toUpperCase());
    const free = expectSentToMatchContract('POST', '/check-ins/walk-in');
    expect(Object.keys(bodyOf(free))).toEqual(['venueId']);
    expect(bodyOf(free).venueId).toBe(SKY_LAGOON_ID);
    expect(previews()[0].query).toEqual({ venueId: SKY_LAGOON_ID });

    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      activities: [{ id: YOGA_ID, name: 'Yoga' }],
      charge: { kind: 'surcharge', amountIsk: 1500 },
      guestBands: [{ band: 'child', rangeLabel: '6–15', unitIsk: 1350 }],
    })));
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    store.getState().addGuest('child');
    await store.getState().confirmGuestSelection();
    await store.getState().acceptWalkInCharge();
    const charged = expectSentToMatchContract('POST', '/check-ins/walk-in');
    expect(bodyOf(charged)).toEqual({
      venueId: SKY_LAGOON_ID,
      activityId: YOGA_ID,
      acceptCharge: true,
      acceptedChargeAmountIsk: 1500 + 1350,
      guestAgeBands: ['child'],
    });
  });
});

describe('activities', () => {
  it('a single activity is re-previewed with its id and confirmed with it', async () => {
    api.on('GET', '/check-ins/walk-in/preview', (request) =>
      Reply.ok(previewJSON({
        activities: [{ id: YOGA_ID, name: 'Yoga' }],
        // The activity overrides the venue's price.
        charge: request.query.activityId ? { kind: 'surcharge', amountIsk: 2200 } : { kind: 'surcharge', amountIsk: 1500 },
      })),
    );
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(previews().map((request) => request.query.activityId)).toEqual([undefined, YOGA_ID]);
    expect(store.getState().pendingOffer?.amountIsk).toBe(2200); // the activity's own price is disclosed
    await store.getState().acceptWalkInCharge();
    expect(bodyOf(walkIns()[0]).activityId).toBe(YOGA_ID);
    expect(bodyOf(walkIns()[0]).acceptedChargeAmountIsk).toBe(2200);
  });

  it('several activities show the picker; a pick re-previews and confirms with it', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }],
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON({ activity: { id: SWIM_ID, name: 'Swim' } }), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(store.getState().showActivityPicker).toBe(true);
    expect(store.getState().pickerActivities.map((activity) => activity.name)).toEqual(['Yoga', 'Swim']);
    expect(walkIns()).toHaveLength(0);
    expect(isWalkInIdle(store.getState())).toBe(false);

    await store.getState().selectActivity(store.getState().pickerActivities[1]);
    expect(previews().at(-1)?.query.activityId).toBe(SWIM_ID);
    expect(bodyOf(walkIns()[0]).activityId).toBe(SWIM_ID);
    expect(store.getState().successActivityName).toBe('Swim');
  });

  it('cancelling the picker sends nothing', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }],
    })));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    store.getState().cancelActivityPicker();
    expect(walkIns()).toHaveLength(0);
    expect(isWalkInIdle(store.getState())).toBe(true);
  });

  it('an activity gone invalid re-previews once and offers the picker again, then says so', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }],
    })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(409, 'walk_in_activity_invalid'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().selectActivity(store.getState().pickerActivities[0]);

    expect(store.getState().showActivityPicker).toBe(true);
    expect(store.getState().error).toBeNull();
    const firstKey = keyOf(walkIns()[0]);

    await store.getState().selectActivity(store.getState().pickerActivities[0]);
    expect(store.getState().showActivityPicker).toBe(false);
    expect(store.getState().error).toBe(translate('checkin.err.activity_invalid', 'en'));
    expect(store.getState().error).not.toContain('Server detail');
    expect(keyOf(walkIns()[1])).not.toBe(firstKey); // the re-preview is a new attempt
  });

  it('an invalid activity with nothing left to pick says it is not available any more', async () => {
    // The preview and its per-activity re-preview list Yoga; the refetch, nothing.
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ activities: [] })));
    api.once('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ activities: [{ id: YOGA_ID, name: 'Yoga' }] })));
    api.once('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ activities: [{ id: YOGA_ID, name: 'Yoga' }] })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(409, 'walk_in_activity_invalid'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(previews()).toHaveLength(3);
    expect(store.getState().showActivityPicker).toBe(false);
    expect(store.getState().error).toBe(translate('checkin.err.activity_invalid', 'en'));
    expect(store.getState().isProcessing).toBe(false);
  });
});

describe('a booked class here', () => {
  function attendable(withinWindow: boolean, extra: Parameters<typeof previewJSON>[0] = {}) {
    return previewJSON({
      attendableBooking: {
        bookingId: BOOKING_ID,
        activityName: 'Spinning',
        startsAt: '2026-10-17T18:00:00.000Z',
        withinWindow,
      },
      ...extra,
    });
  }

  it('stops on the choice; "Mark me as present" is free, with no picker, consent or guests', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(true, {
      activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }],
      charge: { kind: 'surcharge', amountIsk: 1500 },
      guestBands: [{ band: 'adult', unitIsk: 2650 }],
    })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON({ activity: { id: YOGA_ID, name: 'Spinning' } }), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(store.getState().showAttendChoice).toBe(true);
    expect(store.getState().attendableBooking?.activityName).toBe('Spinning');
    expect(walkIns()).toHaveLength(0);

    await store.getState().attendBookedClass();
    const sent = expectSentToMatchContract('POST', '/check-ins/walk-in');
    expect(bodyOf(sent)).toEqual({ venueId: SKY_LAGOON_ID, bookingAction: 'attend' });
    expect(store.getState().showChargeConsent).toBe(false);
    expect(store.getState().showGuestPicker).toBe(false);
    expect(store.getState().showActivityPicker).toBe(false);
    expect(store.getState().showSuccess).toBe(true);
  });

  it('works at a venue where walk-ins are blocked', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(true, { allowed: false, blockingReason: 'walk_ins_not_allowed' })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(store.getState().showAttendChoice).toBe(true);
    expect(store.getState().error).toBeNull();
    await store.getState().attendBookedClass();
    expect(store.getState().showSuccess).toBe(true);
  });

  it('a regular visit instead sends walk_in on the consent re-POST and on the pay session', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(false, { charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'charge_consent_required', {
      offer: { kind: 'surcharge', amountIsk: 1500 },
    }));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({
      hasCard: false,
      externalSessionId: 'kling_cs_9',
      url: 'https://pay.kling.is/c/kling_cs_9',
      amountIsk: 1500,
    }));
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'fulfilled', checkInId: '9d7c1b2a-0000-4000-8000-000000000009' }));
    openAuthSession.mockResolvedValue(PAID_LINK);
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().walkInInsteadOfClass();

    expect(store.getState().showChargeConsent).toBe(true);
    expect(walkIns()).toHaveLength(0);
    await store.getState().acceptWalkInCharge(); // a 402 re-offer at the same price
    expect(store.getState().offerWasReoffered).toBe(false);
    await store.getState().acceptWalkInCharge();

    for (const sent of walkIns()) expect(bodyOf(sent).bookingAction).toBe('walk_in');
    const session = expectSentToMatchContract('POST', '/bookings/payment-sessions');
    expect(bodyOf(session)).toEqual({
      kind: 'walk_in',
      activityId: null,
      venueId: SKY_LAGOON_ID,
      acceptedChargeAmountIsk: 1500,
      bookingAction: 'walk_in',
    });
    expect(store.getState().showSuccess).toBe(true);
  });

  it('a regular visit instead at a blocked venue reads the blocking reason', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(false, {
      allowed: false,
      blockingReason: 'daily_use_cap_reached',
    })));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().walkInInsteadOfClass();
    expect(store.getState().error).toBe(translate('checkin.err.daily_cap', 'en'));
    expect(walkIns()).toHaveLength(0);
  });

  it('a booking that went away resets the attempt and says so', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(true)));
    api.on('POST', '/check-ins/walk-in', Reply.problem(409, 'attendable_booking_not_found'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().attendBookedClass();

    expect(store.getState().error).toBe(translate('checkin.attend.gone', 'en'));
    expect(store.getState().errorCTA).toBeNull();
    expect(store.getState().attendableBooking).toBeNull();

    store.getState().dismissError();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().attendBookedClass();
    expect(keyOf(walkIns()[1])).not.toBe(keyOf(walkIns()[0]));
  });

  it('a double tap marks the class once', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(true)));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await Promise.all([store.getState().attendBookedClass(), store.getState().attendBookedClass()]);
    expect(walkIns()).toHaveLength(1);
  });

  it('closing the choice sends nothing', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(attendable(true)));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    store.getState().dismissAttendChoice();
    expect(walkIns()).toHaveLength(0);
    expect(isWalkInIdle(store.getState())).toBe(true);
  });
});

describe('a check-in link', () => {
  it('never checks in by itself: it stops on "Check in at <venue>?"', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID, { fromLink: true });

    expect(store.getState().showLinkConfirm).toBe(true);
    expect(walkIns()).toHaveLength(0);

    await store.getState().confirmLinkedWalkIn();
    expect(walkIns()).toHaveLength(1);
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().linkedAttempt).toBe(false);
  });

  it('declined sends nothing and leaves the flow idle', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID, { fromLink: true });
    store.getState().declineLinkedWalkIn();
    expect(walkIns()).toHaveLength(0);
    expect(isWalkInIdle(store.getState())).toBe(true);
  });

  it('a camera read of a free venue checks in straight away', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(store.getState().showLinkConfirm).toBe(false);
    expect(walkIns()).toHaveLength(1);
  });

  it('a charged link asks for consent, which is the confirmation', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID, { fromLink: true });
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().showLinkConfirm).toBe(false);
  });
});

describe('refusals', () => {
  it('a blocked preview shows its reason and step, and sends no POST', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ allowed: false, blockingReason: 'no_active_plan_or_pass' })));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(store.getState().error).toBe(translate('checkin.err.no_plan', 'en'));
    expect(store.getState().errorCTA).toBe('seePlans');
    expect(store.getState().refusalVenueId).toBe(SKY_LAGOON_ID);
    expect(store.getState().refusalVenueSlug).toBe('sky-lagoon');
    expect(walkIns()).toHaveLength(0);
    expect(isWalkInIdle(store.getState())).toBe(false);
    store.getState().dismissError();
    expect(isWalkInIdle(store.getState())).toBe(true);
  });

  it("a venue whose price is unset at a boutique the plan leaves out reads the membership words", async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'topup', amountIsk: 2500, reason: 'boutique_not_included' },
    })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(409, 'topup_price_unset'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().error).toBe(translate('booking.err.boutique', 'en'));
    expect(store.getState().errorCTA).toBe('seePlans');
  });

  it('a throttle of an unknown code offers Try again, which is a new attempt at the same venue', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(429, 'too_many_scans_brand_new'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);

    expect(store.getState().error).toBe(translate('checkin.err.rate_limited', 'en'));
    expect(store.getState().errorCTA).toBe('tryAgain');

    store.getState().dismissError();
    await store.getState().retryAfterRefusal();
    expect(previews()).toHaveLength(2);
    expect(walkIns()).toHaveLength(2);
    expect(keyOf(walkIns()[1])).not.toBe(keyOf(walkIns()[0]));
    expect(store.getState().showSuccess).toBe(true);
  });

  it('Try again on a link attempt still stops on the link question', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.once('GET', '/check-ins/walk-in/preview', Reply.problem(503, 'internal_error'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID, { fromLink: true });
    expect(store.getState().error).toBe(translate('error.server', 'en'));
    expect(store.getState().errorCTA).toBe('tryAgain');

    store.getState().dismissError();
    await store.getState().retryAfterRefusal();
    expect(store.getState().showLinkConfirm).toBe(true);
    expect(walkIns()).toHaveLength(0);
  });

  it("a gateway's 504 page reads as our failure with no step, and the key is dropped", async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.raw(504, '<html>504 Gateway Time-out</html>'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(store.getState().error).toBe(translate('error.server', 'en'));
    expect(store.getState().errorCTA).toBeNull();
    expect(store.getState().error).not.toContain('504');
  });

  it("the server's own words never reach the member", async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON()));
    api.on('POST', '/check-ins/walk-in', Reply.problem(409, 'walk_in_capture_unresolved'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(store.getState().error).toBe(translate('refusal.earlier_payment', 'en'));
    expect(store.getState().error).not.toContain('Server detail');
    expect(store.getState().errorCTA).toBe('contactSupport');
  });

  it('a preview refused for an unknown venue reads in its own words', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.problem(404, 'venue_not_found'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    expect(store.getState().error).toBe(translate('checkin.err.venue_not_found', 'en'));
    expect(store.getState().isProcessing).toBe(false);
  });
});

describe('the pay rail, before the page', () => {
  function chargedVenue() {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
  }

  it('no charge any more: the free check-in under the same key', async () => {
    chargedVenue();
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.problem(409, 'booking_payment_not_required'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();

    const sent = walkIns();
    expect(sent).toHaveLength(2);
    expect(bodyOf(sent[1]).acceptCharge).toBeUndefined();
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
    expect(store.getState().showSuccess).toBe(true);
  });

  it('a card saved meanwhile: the walk-in with consent, same key', async () => {
    chargedVenue();
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkInJSON(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({ hasCard: true }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();

    const sent = walkIns();
    expect(bodyOf(sent[1]).acceptCharge).toBe(true);
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
    expect(openAuthSession).not.toHaveBeenCalled();
    expect(store.getState().showSuccess).toBe(true);
  });

  it('walk-ins off meanwhile: a dead end, and the next scan starts fresh', async () => {
    chargedVenue();
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.problem(409, 'booking_payment_blocked'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().error).toBe(translate('checkin.err.pay_blocked', 'en'));
    expect(store.getState().pendingOffer).toBeNull();
  });

  it('an earlier payment still resolving: the needs-attention outcome', async () => {
    chargedVenue();
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.problem(409, 'booking_payment_unresolved'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().payOutcome).toEqual({ kind: 'needsAttention' });
    expect(payOutcomeMessage({ kind: 'needsAttention' }, 'walkIn', 'en')).toBe(
      translate('checkin.pay.needs_attention_body', 'en'),
    );
  });

  it('a price moved on the session: consent again, with the note', async () => {
    chargedVenue();
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.problem(402, 'charge_consent_required', {
      offer: { kind: 'surcharge', amountIsk: 1700 },
    }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().offerWasReoffered).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(1700);
    expect(openAuthSession).not.toHaveBeenCalled();
  });
});

describe('the pay rail, after the page', () => {
  function payRail() {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({
      hasCard: false,
      externalSessionId: 'kling_cs_3',
      url: 'https://pay.kling.is/c/kling_cs_3',
      amountIsk: 1500,
    }));
    openAuthSession.mockResolvedValue(PAID_LINK);
  }

  it('still processing: Confirming your payment, then Check again under the same key', async () => {
    payRail();
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'processing' }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();

    expect(posts('/bookings/payment-sessions/confirm')).toHaveLength(5);
    expect(store.getState().payOutcome).toEqual({ kind: 'processing' });
    expect(isWalkInIdle(store.getState())).toBe(false);

    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'fulfilled', checkInId: '9d7c1b2a-0000-4000-8000-000000000003' }));
    await store.getState().checkPaymentAgain();
    const keys = posts('/bookings/payment-sessions/confirm').map((request) => bodyOf(request).key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(keyOf(walkIns()[0]));
    expect(store.getState().payOutcome).toBeNull();
    expect(store.getState().showSuccess).toBe(true);
  });

  it('refunded: why, then refunded in full', async () => {
    payRail();
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'refunded', reason: 'provider_booking_failed' }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    const outcome = store.getState().payOutcome;
    expect(outcome).toEqual({ kind: 'refunded', reason: 'provider_booking_failed' });
    expect(payOutcomeMessage(outcome!, 'walkIn', 'en')).toBe(translate('checkin.pay.refunded_slot_body', 'en'));
  });

  it('expired and needs attention are outcomes; a session that never existed ends quietly', async () => {
    payRail();
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'expired' }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().payOutcome).toEqual({ kind: 'expired' });
    store.getState().dismissPayOutcome();

    api.on('POST', '/bookings/payment-sessions/confirm', Reply.problem(404, 'booking_payment_session_not_found'));
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().payOutcome).toBeNull();
    expect(store.getState().error).toBeNull();
    expect(isWalkInIdle(store.getState())).toBe(true);
  });

  it('a confirm that fails reads the refusal, with no step that could pay twice', async () => {
    payRail();
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.problem(503, 'internal_error'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(store.getState().error).toBe(translate('error.server', 'en'));
    expect(store.getState().errorCTA).toBeNull();
  });

  it('a page that never opened takes nothing and asks nothing', async () => {
    payRail();
    openAuthSession.mockRejectedValue(new Error('no browser'));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().acceptWalkInCharge();
    expect(posts('/bookings/payment-sessions/confirm')).toHaveLength(0);
    expect(store.getState().payOutcome).toEqual({ kind: 'notPaid' });
  });

  it("the proof after the page names the picked activity; an earlier session's payment names none", async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'surcharge', amountIsk: 1500 },
      activities: [{ id: YOGA_ID, name: 'Yoga' }, { id: SWIM_ID, name: 'Swim' }],
    })));
    api.on('POST', '/check-ins/walk-in', Reply.problem(402, 'no_payment_method_on_file'));
    api.on('POST', '/bookings/payment-sessions', Reply.ok({
      hasCard: false,
      externalSessionId: 'kling_cs_4',
      url: 'https://pay.kling.is/c/kling_cs_4',
      amountIsk: 1500,
    }));
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    openAuthSession.mockResolvedValue(PAID_LINK);
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().selectActivity({ id: SWIM_ID, name: 'Swim' });
    await store.getState().acceptWalkInCharge();
    expect(bodyOf(posts('/bookings/payment-sessions')[0]).activityId).toBe(SWIM_ID);
    expect(store.getState().successActivityName).toBe('Swim');
    store.getState().resetSuccess();

    // iOS's already-completed leg sets no activity on the proof.
    api.on('POST', '/bookings/payment-sessions', Reply.problem(409, 'booking_payment_already_completed'));
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    await store.getState().selectActivity({ id: SWIM_ID, name: 'Swim' });
    await store.getState().acceptWalkInCharge();
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().successActivityName).toBeNull();
    expect(store.getState().successVenueName).toBe('Sky Lagoon');
  });

  it('the page is not idle while it is open', async () => {
    payRail();
    let close: (value: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
    openAuthSession.mockImplementation(() => new Promise((resolve) => (close = resolve)));
    api.on('POST', '/bookings/payment-sessions/confirm', Reply.ok({ status: 'fulfilled' }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    const accepting = store.getState().acceptWalkInCharge();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getState().payPageOpen).toBe(true);
    expect(isWalkInIdle(store.getState())).toBe(false);
    close(PAID_LINK);
    await accepting;
    expect(store.getState().payPageOpen).toBe(false);
    expect(store.getState().showSuccess).toBe(true);
  });
});

describe('guests', () => {
  it('the party is capped at nine guests', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'surcharge', amountIsk: 1500 },
      guestBands: [{ band: 'adult', unitIsk: 2650 }, { band: 'infant', unitIsk: 0 }],
    })));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    for (let i = 0; i < 12; i += 1) store.getState().addGuest(i % 2 ? 'adult' : 'infant');
    const counts = store.getState().guestCounts;
    expect((counts.adult ?? 0) + (counts.infant ?? 0)).toBe(MAX_GUESTS);
    store.getState().removeGuest('adult');
    store.getState().removeGuest('adult');
    expect(store.getState().guestCounts.adult).toBe(Math.max(0, (counts.adult ?? 0) - 2));
  });

  it('back on the guest sheet ends the attempt with nothing sent', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({
      charge: { kind: 'surcharge', amountIsk: 1500 },
      guestBands: [{ band: 'adult', unitIsk: 2650 }],
    })));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(SKY_LAGOON_ID);
    store.getState().addGuest('adult');
    store.getState().cancelGuests();
    expect(walkIns()).toHaveLength(0);
    expect(store.getState().guestCounts).toEqual({});
    expect(isWalkInIdle(store.getState())).toBe(true);
  });
});

it('sign-out forgets the walk-in in hand', async () => {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(previewJSON({ charge: { kind: 'surcharge', amountIsk: 1500 } })));
  const store = walkInStoreForTest();
  await store.getState().startWalkIn(SKY_LAGOON_ID);
  expect(store.getState().showChargeConsent).toBe(true);
  store.getState().reset();
  expect(store.getState().showChargeConsent).toBe(false);
  expect(store.getState().preview).toBeNull();
  expect(isWalkInIdle(store.getState())).toBe(true);
});
