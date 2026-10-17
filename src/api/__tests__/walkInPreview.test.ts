/**
 * `GET /check-ins/walk-in/preview` on the wire: the "wire" cases of iOS
 * WalkInCoverageTests.swift (what covers the member's own visit, fail-soft),
 * the slot-bookable filter of VenueDetailViewModel, and the money fields,
 * which are strict.
 */
import { sampleResponse } from '@test/contract';
import { api, Reply } from '@test/server';

import { DecodingError } from '../errors';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';
import {
  bookingProvider,
  decodeWalkInPreview,
  fetchWalkInPreview,
  isEntitlement,
  isSlotBookable,
  ownVisitIsFree,
  readCoverage,
  usesClasses,
} from '../walkInPreview';

const venueId = '6a1d2f4e-8b3c-4d5e-9f60-718293a4b5c6';

const adventurer = {
  kind: 'pass',
  passId: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d',
  passType: 'adventurer',
  passName: 'Adventurer',
  visitsTotal: 6,
  visitsUsed: 0,
  visitsLeftAfter: 5,
  expiresAt: '2026-12-07T23:35:00.000Z',
};

const plus = { kind: 'subscription', tierName: 'Plus', lane: 'network', visitsLeftAfter: 7 };

const adultGuest = [{ band: 'adult', rangeLabel: null, unitIsk: 2650 }];

/** A World Class gym as the preview describes it. */
function preview({
  coveredBy,
  charge = null,
  guestBands = adultGuest,
  ...extra
}: {
  coveredBy?: unknown;
  charge?: unknown;
  guestBands?: unknown;
  [key: string]: unknown;
} = {}): Record<string, unknown> {
  const json: Record<string, unknown> = {
    venue: { id: venueId, slug: 'world-class-vatnsmyri', name: 'World Class Vatnsmýri' },
    walkInsAllowed: true,
    activities: [],
    slotActivities: [],
    allowed: true,
    blockingReason: null,
    charge,
    attendableBooking: null,
    ...extra,
  };
  if (guestBands !== undefined) json.guestBands = guestBands;
  if (coveredBy !== undefined) json.coveredBy = coveredBy;
  return json;
}

describe('what covers the visit (WalkInCoverageTests)', () => {
  it('a pass coverage decodes with its balance', () => {
    const pv = decodeWalkInPreview(preview({ coveredBy: adventurer }));
    expect(pv.coveredBy).toEqual({
      kind: 'pass',
      passType: 'adventurer',
      passName: 'Adventurer',
      visitsTotal: 6,
      visitsUsed: 0,
      visitsLeftAfter: 5,
      expiresAt: new Date('2026-12-07T23:35:00.000Z'),
    });
    expect(ownVisitIsFree(pv)).toBe(true);
    expect(pv.coveredBy && isEntitlement(pv.coveredBy)).toBe(true);
  });

  it('a subscription and money decode', () => {
    const sub = decodeWalkInPreview(preview({ coveredBy: plus }));
    expect(sub.coveredBy).toEqual({ kind: 'subscription', tierName: 'Plus', lane: 'network', visitsLeftAfter: 7 });

    const unknownBalance = decodeWalkInPreview(
      preview({ coveredBy: { kind: 'subscription', tierName: null, lane: 'pool', visitsLeftAfter: null } }),
    );
    expect(unknownBalance.coveredBy).toEqual({ kind: 'subscription', tierName: null, lane: 'pool', visitsLeftAfter: null });

    const money = decodeWalkInPreview(
      preview({ coveredBy: { kind: 'money' }, charge: { kind: 'topup', amountIsk: 2650, reason: 'monthly_exhausted' } }),
    );
    expect(money.coveredBy).toEqual({ kind: 'money' });
    expect(ownVisitIsFree(money)).toBe(false);
    expect(money.coveredBy && isEntitlement(money.coveredBy)).toBe(false);
  });

  /** The production server before 0.25.0 sends no `coveredBy` at all; a blocked preview sends null. */
  it('an older server and a blocked preview decode as no coverage', () => {
    expect(decodeWalkInPreview(preview()).coveredBy).toBeNull();
    expect(decodeWalkInPreview(preview({ coveredBy: null })).coveredBy).toBeNull();
  });

  /** A kind this build does not know, or a pass missing its counts, must not fail the preview. */
  it('a shape this build cannot read is no coverage, not an error', () => {
    expect(decodeWalkInPreview(preview({ coveredBy: { kind: 'voucher', code: 'X' } })).coveredBy).toBeNull();
    const { visitsTotal, ...broken } = adventurer;
    expect(visitsTotal).toBe(6);
    expect(decodeWalkInPreview(preview({ coveredBy: broken })).coveredBy).toBeNull();
    expect(decodeWalkInPreview(preview({ coveredBy: 'pass' })).coveredBy).toBeNull();
    expect(decodeWalkInPreview(preview({ coveredBy: { ...adventurer, expiresAt: 'soon' } })).coveredBy).toBeNull();
  });

  /** The check-in response arrives AFTER the visit is recorded: an unreadable balance never turns it into an error. */
  it('the same fail-soft read serves the check-in response', () => {
    expect(readCoverage(adventurer)).toMatchObject({ kind: 'pass', visitsLeftAfter: 5 });
    expect(readCoverage({ kind: 'pass', visitsTotal: 'six' })).toBeNull();
    expect(readCoverage(undefined)).toBeNull();
  });
});

describe('the money fields are strict', () => {
  it('a charge is read with its kind, amount and reason', () => {
    const pv = decodeWalkInPreview(
      preview({ charge: { kind: 'surcharge', amountIsk: 4990, reason: 'premium_pass_visit' }, coveredBy: adventurer }),
    );
    expect(pv.charge).toEqual({ kind: 'surcharge', amountIsk: 4990, reason: 'premium_pass_visit' });
    // A pass AND a charge: an entitlement spent and money as well.
    expect(ownVisitIsFree(pv)).toBe(false);
    expect(decodeWalkInPreview(preview({ charge: { kind: 'surcharge', amountIsk: 0 } })).charge?.reason).toBeNull();
  });

  it('a zero charge is a free visit; guest prices are not part of it', () => {
    expect(ownVisitIsFree({ charge: null })).toBe(true);
    expect(ownVisitIsFree({ charge: { kind: 'surcharge', amountIsk: 0, reason: null } })).toBe(true);
    expect(ownVisitIsFree({ charge: { kind: 'topup', amountIsk: 1, reason: null } })).toBe(false);
  });

  /** "Free" by mistake is the one outcome a broken charge must never have. */
  it('a charge the app cannot read fails the preview', () => {
    expect(() => decodeWalkInPreview(preview({ charge: { kind: 'surcharge', amountIsk: '4990' } }))).toThrow();
    expect(() => decodeWalkInPreview(preview({ charge: { kind: 'surcharge' } }))).toThrow();
    expect(() => decodeWalkInPreview(preview({ charge: { amountIsk: 4990 } }))).toThrow();
    expect(() => decodeWalkInPreview(preview({ charge: 4990 }))).toThrow();
  });

  it('guest bands, an attendable booking and the eligibility are strict too', () => {
    expect(() => decodeWalkInPreview(preview({ guestBands: [{ band: 'adult', unitIsk: '2650' }] }))).toThrow();
    expect(() => decodeWalkInPreview(preview({ attendableBooking: { bookingId: 'x', startsAt: 'now' } }))).toThrow();
    expect(() => decodeWalkInPreview(preview({ allowed: 'yes' }))).toThrow();
    expect(() => decodeWalkInPreview({ ...preview(), allowed: undefined })).toThrow();
    expect(() => decodeWalkInPreview({ ...preview(), slotActivities: undefined })).toThrow();
    expect(() => decodeWalkInPreview({ ...preview(), venue: undefined })).toThrow();
  });

  it('reads guest bands, an attendable booking and a block', () => {
    const pv = decodeWalkInPreview(
      preview({
        allowed: false,
        blockingReason: 'daily_use_cap_reached',
        guestBands: [
          { band: 'adult', rangeLabel: null, unitIsk: 2650 },
          { band: 'child', rangeLabel: '6–15', unitIsk: 900 },
          { band: 'infant', rangeLabel: '0–5', unitIsk: 0 },
        ],
        attendableBooking: {
          bookingId: '9D7C1B2A-0000-4000-8000-000000000003',
          activityName: 'Spinning',
          startsAt: '2026-10-10T14:00:00Z',
          withinWindow: true,
        },
      }),
    );
    expect(pv.allowed).toBe(false);
    expect(pv.blockingReason).toBe('daily_use_cap_reached');
    expect(pv.guestBands).toEqual([
      { band: 'adult', rangeLabel: null, unitIsk: 2650 },
      { band: 'child', rangeLabel: '6–15', unitIsk: 900 },
      { band: 'infant', rangeLabel: '0–5', unitIsk: 0 },
    ]);
    expect(pv.attendableBooking).toEqual({
      bookingId: '9d7c1b2a-0000-4000-8000-000000000003',
      activityName: 'Spinning',
      startsAt: new Date('2026-10-10T14:00:00Z'),
      withinWindow: true,
    });
    // An older server sends no guest bands: no guest UI.
    const older = preview();
    delete older.guestBands;
    expect(decodeWalkInPreview(older).guestBands).toBeNull();
  });
});

describe('activities', () => {
  /** Kling has no timetable and an unknown provider cannot be booked: neither reaches the venue page. */
  it('slot activities are filtered to the slot-bookable providers', () => {
    const slot = (n: number, provider: string) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      name: `Activity ${n}`,
      provider,
    });
    const pv = decodeWalkInPreview(
      preview({
        activities: [{ id: '00000000-0000-4000-8000-000000000009', name: 'General' }],
        slotActivities: [slot(1, 'abler'), slot(2, 'kling'), slot(3, 'bokun'), slot(4, 'teleport'), slot(5, 'internal')],
      }),
    );
    expect(pv.slotActivities.map((a) => [a.name, a.provider])).toEqual([
      ['Activity 1', 'abler'],
      ['Activity 3', 'bokun'],
      ['Activity 5', 'internal'],
    ]);
    expect(pv.activities).toEqual([{ id: '00000000-0000-4000-8000-000000000009', name: 'General' }]);
  });

  it('providers: Abler books classes, Kling and unknown ones cannot be booked', () => {
    expect(bookingProvider('noona')).toBe('noona');
    expect(bookingProvider('teleport')).toBe('unknown');
    expect(usesClasses('abler')).toBe(true);
    expect(usesClasses('bokun')).toBe(false);
    for (const provider of ['internal', 'bokun', 'noona', 'acuity', 'simplybook', 'abler'] as const) {
      expect(isSlotBookable(provider)).toBe(true);
    }
    expect(isSlotBookable('kling')).toBe(false);
    expect(isSlotBookable('unknown')).toBe(false);
  });
});

it("decodes the contract's own samples", () => {
  for (const mode of ['minimal', 'full'] as const) {
    const pv = decodeWalkInPreview(sampleResponse('GET', '/check-ins/walk-in/preview', 200, mode));
    expect(pv.venue.slug).toBe('sample');
    expect(pv.coveredBy?.kind).toBe('pass');
  }
});

describe('the read', () => {
  stubApiClientPerTest();

  it('sends the venue (and an activity) lower-case, signed in', async () => {
    api.on('GET', '/check-ins/walk-in/preview', replyFromContract('GET', '/check-ins/walk-in/preview', 200, 'full'));
    await fetchWalkInPreview(venueId.toUpperCase());
    let sent = expectSentToMatchContract('GET', '/check-ins/walk-in/preview');
    expect(sent.query).toEqual({ venueId });
    expect(sent.headers.authorization).toBe('Bearer test-token');

    await fetchWalkInPreview(venueId, '9D7C1B2A-0000-4000-8000-000000000003');
    sent = expectSentToMatchContract('GET', '/check-ins/walk-in/preview');
    expect(sent.query).toEqual({ venueId, activityId: '9d7c1b2a-0000-4000-8000-000000000003' });
  });

  it('an answer the app cannot read is a decoding error', async () => {
    api.on('GET', '/check-ins/walk-in/preview', Reply.ok(preview({ charge: { kind: 'surcharge', amountIsk: 'lots' } })));
    await expect(fetchWalkInPreview(venueId)).rejects.toBeInstanceOf(DecodingError);
  });
});
