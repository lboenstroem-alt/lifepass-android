/**
 * What covers the member's own walk-in (`coveredBy`, API 0.25.0), from the
 * wire to the screen: the flow half of iOS LifePassTests/WalkInCoverageTests
 * (the decode half is src/api/__tests__/walkInPreview.test.ts, the words
 * src/copy/__tests__/passCopy.test.ts).
 *
 * On 10 Oct 2026 a member with an Adventurer pass scanned a World Class gym
 * code; the only money on the scan card was "Adult guest, 2,650 kr per
 * person", he read it as his own fee and left. These pin the flow that
 * replaced it: when the member's own visit costs nothing, the first thing on
 * screen says what covers it, the button says it is free, and guest prices
 * wait behind "Bringing a guest?". A visit that costs money keeps its old
 * order, with the member's price and the guests' named apart.
 */
import { api, Reply } from '@test/server';

import { balanceAfter, coverageLine } from '../../../../copy/passCopy';
import { translate } from '../../../../i18n';
import { decodeWalkInResult } from '../service';
import { consentContext, isWalkInIdle } from '../store';
import {
  consentGuestAmountIsk,
  consentOwnAmountIsk,
  walkInConsentButtonLabel,
  walkInConsentMessage,
  walkInConsentTitle,
} from '../consentCopy';

import {
  ADULT_GUEST,
  ADVENTURER,
  bodyOf,
  PLUS,
  posts,
  previewJSON,
  walkInStoreForTest,
  walkInTestEnvironment,
  WORLD_CLASS_ID,
  type PreviewOptions,
} from './walkInHarness';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

walkInTestEnvironment();

/** A World Class gym as the preview describes it. */
function gym(options: PreviewOptions = {}) {
  return previewJSON({
    venueId: WORLD_CLASS_ID,
    slug: 'world-class-vatnsmyri',
    name: 'World Class Vatnsmýri',
    guestBands: ADULT_GUEST,
    ...options,
  });
}

function checkIn(coveredBy?: unknown) {
  const json: Record<string, unknown> = {
    checkInId: '9d7c1b2a-0000-4000-8000-000000000002',
    bookingId: '9d7c1b2a-0000-4000-8000-000000000003',
    source: 'walk_in',
    countedAgainst: 'pass',
    checkedInAt: '2026-10-10T14:16:30.000Z',
    venue: { id: WORLD_CLASS_ID, name: 'World Class Vatnsmýri' },
    activity: null,
    memberShortName: 'Jón S.',
  };
  if (coveredBy !== undefined) json.coveredBy = coveredBy;
  return json;
}

function serve(preview: Record<string, unknown>, answer: Record<string, unknown> = checkIn()) {
  api.on('GET', '/check-ins/walk-in/preview', Reply.ok(preview));
  api.on('POST', '/check-ins/walk-in', Reply.ok(answer, 201));
}

const walkInPosts = () => posts('/check-ins/walk-in');

describe('the check-in answer', () => {
  it('carries the balance and survives a bad one', () => {
    const read = decodeWalkInResult(checkIn(ADVENTURER));
    expect(read.coveredBy).toMatchObject({ kind: 'pass', visitsLeftAfter: 5 });

    const garbled = decodeWalkInResult(checkIn({ kind: 'pass', visitsTotal: 'six' }));
    expect(garbled.coveredBy).toBeNull();
    expect(garbled.memberShortName).toBe('Jón S.'); // the rest of the receipt is untouched
    expect(decodeWalkInResult(checkIn()).coveredBy).toBeNull(); // an older server
  });
});

describe('a covered visit comes first', () => {
  it('a pass holder at a gym sees his pass, not a guest price', async () => {
    serve(gym({ coveredBy: ADVENTURER }), checkIn({ ...ADVENTURER, visitsUsed: 1 }));
    const store = walkInStoreForTest();

    await store.getState().startWalkIn(WORLD_CLASS_ID);

    const state = store.getState();
    expect(state.showOwnVisitConfirm).toBe(true); // the member's own visit comes first
    expect(state.showGuestPicker).toBe(false); // the guest sheet is not opened unprompted
    expect(state.showChargeConsent).toBe(false);
    expect(isWalkInIdle(state)).toBe(false);
    expect(walkInPosts()).toHaveLength(0); // nothing is recorded before the tap
    expect(coverageLine(state.preview?.coveredBy, 'en')).toBe(
      'Covered by your Adventurer pass: uses 1 of 6 visits (5 left after)',
    );
    expect(coverageLine(state.preview?.coveredBy, 'is')).toBe(
      'Innifalið í Adventurer-passanum þínum: notar 1 af 6 heimsóknum (5 eftir)',
    );

    await store.getState().checkInOwnVisit();

    expect(walkInPosts()).toHaveLength(1);
    const body = bodyOf(walkInPosts()[0]);
    expect(body.acceptCharge).toBeUndefined(); // a free visit is never sent as a charge
    expect(body.guestAgeBands).toBeUndefined(); // a solo check-in
    expect(store.getState().showChargeConsent).toBe(false);
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().showOwnVisitConfirm).toBe(false);
    expect(store.getState().successMemberShortName).toBe('Jón S.');
    expect(balanceAfter(store.getState().successCoverage, 'en')).toBe('5 of 6 visits left on your Adventurer pass');
    expect(balanceAfter(store.getState().successCoverage, 'is')).toBe(
      '5 af 6 heimsóknum eftir á Adventurer-passanum þínum',
    );

    store.getState().resetSuccess();
    expect(store.getState().successCoverage).toBeNull(); // the next proof starts clean
    expect(isWalkInIdle(store.getState())).toBe(true);
  });

  it('a member covered by their membership sees it the same way', async () => {
    serve(gym({ coveredBy: PLUS }), checkIn(PLUS));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);

    expect(store.getState().showOwnVisitConfirm).toBe(true);
    expect(store.getState().showGuestPicker).toBe(false);
    expect(coverageLine(store.getState().preview?.coveredBy, 'en')).toBe(
      'Included in your Plus membership: uses 1 of your monthly visits (7 left after)',
    );

    await store.getState().checkInOwnVisit();
    expect(store.getState().showSuccess).toBe(true);
    expect(balanceAfter(store.getState().successCoverage, 'en')).toBe('7 gym & studio visits left this period');
  });

  it('with an older server a free visit still leads with the member\'s own visit', async () => {
    serve(gym());
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);

    expect(store.getState().showOwnVisitConfirm).toBe(true);
    expect(store.getState().showGuestPicker).toBe(false);
    expect(coverageLine(store.getState().preview?.coveredBy, 'en')).toBeNull(); // the step falls back to checkin.cover.free
    expect(translate('checkin.cover.free', 'en')).toBe('Your visit has no charge.');

    await store.getState().checkInOwnVisit();
    expect(walkInPosts()).toHaveLength(1);
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().successCoverage).toBeNull();
    expect(balanceAfter(store.getState().successCoverage, 'en')).toBeNull();
  });

  it('"Bringing a guest?" opens the guest sheet, and only the guest is charged', async () => {
    serve(gym({ coveredBy: ADVENTURER }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);

    await store.getState().openGuestsFromOwnVisit();
    expect(store.getState().showOwnVisitConfirm).toBe(false);
    expect(store.getState().showGuestPicker).toBe(true);
    expect(store.getState().guestBandOffers.map((offer) => offer.band)).toEqual(['adult']);
    expect(walkInPosts()).toHaveLength(0);

    store.getState().addGuest('adult');
    await store.getState().confirmGuestSelection();

    const context = consentContext(store.getState());
    expect(store.getState().showChargeConsent).toBe(true); // a guest is never charged un-shown
    expect(store.getState().pendingOffer?.amountIsk).toBe(2650);
    expect(consentGuestAmountIsk(context)).toBe(2650);
    expect(consentOwnAmountIsk(context)).toBe(0); // the member's own visit is not part of it
    expect(walkInPosts()).toHaveLength(0);
    // Before 2.5.3 this read "This is a premium venue: a ISK 2,650 surcharge applies", at a gym, for a guest.
    expect(walkInConsentMessage(context, 'en')).toBe(
      'Your own visit has no charge. ISK 2,650 is for your guests, charged when you confirm.',
    );
    expect(walkInConsentMessage(context, 'is')).toBe(
      'Þín eigin heimsókn kostar ekkert. ISK 2,650 er fyrir gestina þína og er gjaldfært þegar þú staðfestir.',
    );
    expect(walkInConsentTitle(context, 'en')).toBe('Confirm charge');
    expect(walkInConsentButtonLabel(context, 'en')).toBe('Confirm and pay ISK 2,650');

    await store.getState().acceptWalkInCharge();
    const body = bodyOf(walkInPosts()[0]);
    expect(body.guestAgeBands).toEqual(['adult']);
    expect(body.acceptedChargeAmountIsk).toBe(2650);
    expect(store.getState().showSuccess).toBe(true);
  });

  it('closing the step sends nothing', async () => {
    serve(gym({ coveredBy: ADVENTURER }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);
    store.getState().declineOwnVisit();

    expect(store.getState().showOwnVisitConfirm).toBe(false);
    expect(walkInPosts()).toHaveLength(0);
    expect(isWalkInIdle(store.getState())).toBe(true);
    expect(store.getState().scannedVenueId).toBeNull();
  });

  it('a link stops on the step, and its tap is the confirmation', async () => {
    serve(gym({ coveredBy: ADVENTURER }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID, { fromLink: true });

    expect(store.getState().showOwnVisitConfirm).toBe(true);
    expect(store.getState().linkedAttempt).toBe(true); // the step shows the link note
    expect(store.getState().showLinkConfirm).toBe(false);
    expect(walkInPosts()).toHaveLength(0);

    await store.getState().checkInOwnVisit();
    expect(store.getState().showLinkConfirm).toBe(false); // not asked twice
    expect(walkInPosts()).toHaveLength(1);
    expect(store.getState().showSuccess).toBe(true);
  });

  /**
   * The own-visit sheet stays on screen while it closes. A second tap on
   * "Check in, no charge", or on "Bringing a guest?", in that beat does
   * nothing: one check-in, one proof, no guest sheet over it.
   */
  it('a second tap while the step closes does nothing', async () => {
    serve(gym({ coveredBy: ADVENTURER }));
    const store = walkInStoreForTest({ dismissBeatMs: 20 });
    await store.getState().startWalkIn(WORLD_CLASS_ID);
    expect(store.getState().showOwnVisitConfirm).toBe(true);

    const first = store.getState().checkInOwnVisit();
    expect(store.getState().showOwnVisitConfirm).toBe(false); // the first tap is under way

    await store.getState().checkInOwnVisit();
    await store.getState().openGuestsFromOwnVisit();
    await first;

    expect(walkInPosts()).toHaveLength(1); // one check-in for one step
    expect(store.getState().showSuccess).toBe(true);
    expect(store.getState().showGuestPicker).toBe(false);
  });

  /**
   * The guest sheet the same way: a second Continue, or a Just me while the
   * first Continue closes the sheet, neither sends the party twice nor drops
   * the guest the first tap is pricing.
   */
  it('a second tap while the guest sheet closes does nothing', async () => {
    serve(gym({ coveredBy: { kind: 'money' }, charge: { kind: 'topup', amountIsk: 1990, reason: 'monthly_exhausted' } }));
    const store = walkInStoreForTest({ dismissBeatMs: 20 });
    await store.getState().startWalkIn(WORLD_CLASS_ID);
    expect(store.getState().showGuestPicker).toBe(true);
    store.setState({ guestCounts: { adult: 1 } });

    const first = store.getState().confirmGuestSelection();
    expect(store.getState().showGuestPicker).toBe(false); // the first tap is under way

    await store.getState().skipGuests();
    await store.getState().confirmGuestSelection();
    await first;

    expect(store.getState().guestCounts).toEqual({ adult: 1 }); // the guest is still in the party
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(1990 + 2650);
    expect(walkInPosts()).toHaveLength(0); // nothing is sent before the consent
  });

  it('with no guest seats a camera read still checks in straight away', async () => {
    serve(gym({ coveredBy: ADVENTURER, guestBands: null }), checkIn(ADVENTURER));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);

    expect(store.getState().showOwnVisitConfirm).toBe(false);
    expect(walkInPosts()).toHaveLength(1);
    expect(store.getState().showSuccess).toBe(true);
    expect(balanceAfter(store.getState().successCoverage, 'en')).toBe('5 of 6 visits left on your Adventurer pass');
  });
});

describe('a visit that costs money is unchanged', () => {
  /**
   * Out of monthly visits: the drop-in is the member's own price. The guest
   * sheet still comes first, so the consent covers the party, and the
   * own-visit step never shows (its button would say "no charge").
   */
  it('a charged visit keeps the guest sheet first and names the own price apart', async () => {
    serve(gym({ coveredBy: { kind: 'money' }, charge: { kind: 'topup', amountIsk: 1990, reason: 'monthly_exhausted' } }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);

    expect(store.getState().showGuestPicker).toBe(true);
    expect(store.getState().showOwnVisitConfirm).toBe(false);

    store.setState({ guestCounts: { adult: 1 } });
    await store.getState().confirmGuestSelection();

    const context = consentContext(store.getState());
    expect(store.getState().showChargeConsent).toBe(true);
    expect(store.getState().pendingOffer?.amountIsk).toBe(1990 + 2650);
    expect(consentOwnAmountIsk(context)).toBe(1990);
    expect(consentGuestAmountIsk(context)).toBe(2650);
    expect(walkInPosts()).toHaveLength(0);
    expect(walkInConsentMessage(context, 'en')).toBe(
      'You can still check in at World Class Vatnsmýri by buying a one-time drop-in for ISK 1,990. ' +
        "It's charged when you confirm.\n\n" +
        'Your guests add ISK 2,650. ISK 4,640 in all, charged when you confirm.',
    );
    expect(
      walkInConsentMessage(context, 'is').endsWith(
        'Gestirnir þínir bæta við ISK 2,650. Samtals ISK 4,640, gjaldfært þegar þú staðfestir.',
      ),
    ).toBe(true);
    expect(walkInConsentTitle(context, 'en')).toBe("You're out of check-ins this month");
    expect(walkInConsentButtonLabel(context, 'en')).toBe('Pay ISK 4,640 for drop-in and guests');
    expect(walkInConsentButtonLabel(context, 'is')).toBe('Greiða ISK 4,640 fyrir staka heimsókn og gesti');
    expect(walkInConsentButtonLabel(context, 'en')).not.toContain('Buy drop-in');
  });

  it('a solo drop-in keeps its button', async () => {
    serve(gym({ coveredBy: { kind: 'money' }, charge: { kind: 'topup', amountIsk: 1990, reason: 'monthly_exhausted' } }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);
    await store.getState().skipGuests();

    const context = consentContext(store.getState());
    expect(store.getState().showChargeConsent).toBe(true);
    expect(consentGuestAmountIsk(context)).toBe(0);
    expect(walkInConsentTitle(context, 'en')).toBe("You're out of check-ins this month");
    expect(walkInConsentButtonLabel(context, 'en')).toBe(
      translate('consent.dropin_button', 'en', { price: 'ISK 1,990' }),
    );
    expect(walkInConsentButtonLabel(context, 'is')).toBe(
      translate('consent.dropin_button', 'is', { price: 'ISK 1,990' }),
    );
  });

  /** A premium pass visit spends a pass visit AND costs money: the money order applies. */
  it('a premium pass visit is a charged visit', async () => {
    serve(gym({ coveredBy: ADVENTURER, charge: { kind: 'surcharge', amountIsk: 1500 } }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);

    expect(store.getState().showGuestPicker).toBe(true);
    expect(store.getState().showOwnVisitConfirm).toBe(false);
    await store.getState().skipGuests();
    const context = consentContext(store.getState());
    expect(store.getState().showChargeConsent).toBe(true);
    expect(consentOwnAmountIsk(context)).toBe(1500);
    expect(consentGuestAmountIsk(context)).toBe(0);
    // With no guests the alert reads exactly as it did before 2.5.3.
    expect(walkInConsentMessage(context, 'en')).toBe(translate('consent.surcharge', 'en', { price: 'ISK 1,500' }));
  });

  it('a re-offered party is split the server\'s way', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(gym({ coveredBy: ADVENTURER })));
    api.on('POST', '/check-ins/walk-in', Reply.ok(checkIn(), 201));
    api.once('POST', '/check-ins/walk-in', Reply.problem(402, 'charge_consent_required', {
      offer: {
        kind: 'surcharge',
        amountIsk: 2800,
        reason: 'guest_party',
        party: { ownAmountIsk: 0, guests: [{ band: 'adult', count: 1, unitIsk: 2800 }] },
      },
    }));
    const store = walkInStoreForTest();
    await store.getState().startWalkIn(WORLD_CLASS_ID);
    await store.getState().openGuestsFromOwnVisit();
    store.setState({ guestCounts: { adult: 1 } });
    await store.getState().confirmGuestSelection();
    await store.getState().acceptWalkInCharge();

    const context = consentContext(store.getState());
    expect(store.getState().showChargeConsent).toBe(true); // the moved guest price is shown before it is charged
    expect(store.getState().offerWasReoffered).toBe(true);
    expect(consentGuestAmountIsk(context)).toBe(2800);
    expect(consentOwnAmountIsk(context)).toBe(0);
  });
});
