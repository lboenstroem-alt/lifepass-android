/**
 * The booking API (iOS BookingService): what each call SENDS, checked
 * against the 0.34.0 contract, and how strictly each answer is read.
 */
import { api, Reply } from '@test/server';

import {
  coachNames,
  createBooking,
  createBookingBody,
  decodeActivityClass,
  decodeBookingPreview,
  fetchAvailability,
  fetchBookingPreview,
  fetchClasses,
  isClassBookable,
  withConsent,
  type CreateBookingInput,
} from '../bookings';
import { DecodingError } from '../errors';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const ACTIVITY = '0B7D4A62-3C9E-4F1A-A2D5-6E8F9C1B2A34';
const activity = ACTIVITY.toLowerCase();
const START = new Date('2030-03-14T10:00:00Z');
const END = new Date('2030-03-14T10:45:00Z');

const CONFIRMED = {
  bookingId: '7a1c2b3d-0000-4000-8000-000000000009',
  status: 'confirmed',
  provider: 'internal',
  profileId: '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22',
  venueId: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1',
  startsAt: '2030-03-14T10:00:00Z',
  endsAt: '2030-03-14T10:45:00Z',
  venueReference: null,
};

describe('the create', () => {
  it('a slot sends its times, lower-case id, under the key, and matches the contract', async () => {
    api.on('POST', '/bookings', Reply.ok(CONFIRMED, 201));
    const result = await createBooking({ kind: 'slot', activityId: ACTIVITY, startsAt: START, endsAt: END }, 'key-00000001');
    expect(result.status).toBe('confirmed');
    const sent = expectSentToMatchContract('POST', '/bookings');
    expect(sent.rawBody).toBe(`{"activityId":"${activity}","startsAt":"2030-03-14T10:00:00Z","endsAt":"2030-03-14T10:45:00Z"}`);
    expect(sent.headers['idempotency-key']).toBe('key-00000001');
  });

  it('a class sends its event only, never a time; consent rides on the same shape', async () => {
    api.on('POST', '/bookings', Reply.ok(CONFIRMED, 201));
    const input: CreateBookingInput = { kind: 'class', activityId: ACTIVITY, eventId: 4242 };
    await createBooking(withConsent(input, 1_990), 'key-00000002');
    const sent = expectSentToMatchContract('POST', '/bookings');
    expect(sent.body).toEqual({ activityId: activity, eventId: 4242, acceptCharge: true, acceptedChargeAmountIsk: 1_990 });
  });

  it("a group slot carries its party, bands and rung, in iOS's key order; an empty band list is left out", () => {
    const body = createBookingBody({
      kind: 'slot',
      activityId: ACTIVITY,
      startsAt: START,
      endsAt: END,
      participants: 3,
      guestAgeBands: ['adult', 'child'],
      visitChoice: 'keep_visit',
      acceptCharge: true,
      acceptedChargeAmountIsk: 12_800,
    });
    expect(Object.keys(body)).toEqual([
      'activityId',
      'startsAt',
      'endsAt',
      'acceptCharge',
      'acceptedChargeAmountIsk',
      'participants',
      'guestAgeBands',
      'visitChoice',
    ]);
    expect(createBookingBody({ kind: 'slot', activityId: ACTIVITY, startsAt: START, endsAt: END, guestAgeBands: [] })).not.toHaveProperty(
      'guestAgeBands',
    );
  });

  it('a pending answer reads as pending; a malformed one is a decoding error, never a booking', async () => {
    api.on('POST', '/bookings', Reply.ok({ ...CONFIRMED, status: 'pending' }, 201));
    await expect(createBooking({ kind: 'class', activityId: ACTIVITY, eventId: 1 }, 'key-00000003')).resolves.toMatchObject({
      status: 'pending',
    });
    api.on('POST', '/bookings', Reply.ok({ status: 'confirmed' }, 201));
    await expect(createBooking({ kind: 'class', activityId: ACTIVITY, eventId: 1 }, 'key-00000004')).rejects.toBeInstanceOf(DecodingError);
  });
});

describe('the timetables', () => {
  it('availability asks one venue day for the party, and reads slots, extras and bands', async () => {
    api.on(
      'GET',
      `/activities/${activity}/availability`,
      Reply.ok({
        activityId: activity,
        provider: 'bokun',
        slots: [
          { startsAt: '2030-03-14T10:00:00Z', endsAt: '2030-03-14T12:00:00Z', available: true, remainingCapacity: 6, title: 'Ritual', instructor: 'Anna' },
          { startsAt: '2030-03-14T12:00:00Z', endsAt: '2030-03-14T14:00:00Z', available: false, remainingCapacity: null },
        ],
        ageBands: [{ band: 'adult', rangeLabel: '16+', priceIsk: null }, { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 }],
        fetchedAt: '2030-03-13T09:00:00Z',
      }),
    );
    const result = await fetchAvailability(ACTIVITY, '2030-03-14', '2030-03-14', 1);
    const sent = expectSentToMatchContract('GET', `/activities/${activity}/availability`);
    expect(sent.query).toEqual({ start: '2030-03-14', end: '2030-03-14', participants: '1' });
    expect(result.slots.map((slot) => [slot.startTime.toISOString(), slot.isAvailable, slot.remainingCapacity, slot.title, slot.instructor])).toEqual([
      ['2030-03-14T10:00:00.000Z', true, 6, 'Ritual', 'Anna'],
      ['2030-03-14T12:00:00.000Z', false, null, null, null],
    ]);
    expect(result.slots[0].id).not.toBe(result.slots[1].id);
    expect(result.ageBands).toEqual([
      { band: 'adult', rangeLabel: '16+', priceIsk: null },
      { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 },
    ]);
  });

  it('classes ask the venue days and read the registration window', async () => {
    api.on(
      'GET',
      `/activities/${activity}/classes`,
      Reply.ok({
        activityId: activity,
        provider: 'abler',
        classes: [
          {
            eventId: 4242,
            name: null,
            description: null,
            start: '2030-03-14T10:00:00Z',
            end: '2030-03-14T11:00:00Z',
            location: null,
            coaches: [{ firstName: 'Sigrún', lastName: 'Jónsdóttir', picture: null }, { firstName: 'Jón', lastName: null, picture: null }],
            attendance: { current: 3, limit: 12 },
            full: false,
            canBook: false,
            canBookReason: 'event_not_open',
            registrationOpensAt: '2030-03-10T12:00:00Z',
          },
        ],
        fetchedAt: '2030-03-13T09:00:00Z',
      }),
    );
    const [klass] = await fetchClasses(ACTIVITY, '2030-03-14', '2030-03-28');
    const sent = expectSentToMatchContract('GET', `/activities/${activity}/classes`);
    expect(sent.query).toEqual({ start: '2030-03-14', end: '2030-03-28' });
    expect(klass.registrationOpensAt?.toISOString()).toBe('2030-03-10T12:00:00.000Z');
    expect(coachNames(klass)).toBe('Sigrún Jónsdóttir, Jón');
    expect(isClassBookable(klass)).toBe(false);
  });

  it('isBookable prefers the server, else derives from full and capacity (0 none, -1 unlimited)', () => {
    expect(isClassBookable({ canBook: null, full: false, attendance: { current: 0, limit: -1 } })).toBe(true);
    expect(isClassBookable({ canBook: null, full: false, attendance: { current: 0, limit: 0 } })).toBe(false);
    expect(isClassBookable({ canBook: null, full: true, attendance: { current: 9, limit: 9 } })).toBe(false);
    expect(isClassBookable({ canBook: true, full: true, attendance: { current: 9, limit: 9 } })).toBe(true);
  });

  it('a class with a broken time fails the read rather than show a wrong one', () => {
    expect(() =>
      decodeActivityClass({ eventId: 1, start: 'tomorrow', end: '2030-03-14T11:00:00Z', attendance: { current: 0, limit: 1 }, full: false }),
    ).toThrow();
  });
});

describe('the preview', () => {
  it('asks at the start as an ISO instant, with the party, bands and rung only when they apply', async () => {
    api.on('GET', `/activities/${activity}/booking-preview`, Reply.ok({ kind: 'free', priceIsk: null, remainingMonthly: 4, isLastBeforeTopUp: false }));
    await fetchBookingPreview(ACTIVITY, START);
    expect(expectSentToMatchContract('GET', `/activities/${activity}/booking-preview`).query).toEqual({
      startsAt: '2030-03-14T10:00:00Z',
    });
    await fetchBookingPreview(ACTIVITY, START, { participants: 3, guestAgeBands: ['adult', 'child'], visitChoice: 'keep_visit' });
    expect(expectSentToMatchContract('GET', `/activities/${activity}/booking-preview`).query).toEqual({
      startsAt: '2030-03-14T10:00:00Z',
      visitChoice: 'keep_visit',
      participants: '3',
      guestAgeBands: 'adult,child',
    });
  });

  it('reads the rungs and the breakdown; a wrong price type fails the read', () => {
    const preview = decodeBookingPreview({
      kind: 'surcharge',
      surchargeReason: 'premium_subscriber_visit',
      priceIsk: 1_500,
      remainingMonthly: 4,
      isLastBeforeTopUp: false,
      breakdown: { participants: 2, ownAmountIsk: 1_500, guestUnitIsk: 4_900, guestCount: 1 },
      visitChoice: {
        selected: 'spend_visit',
        options: [
          { choice: 'spend_visit', priceIsk: 1_500, consumesVisit: true, surchargeReason: 'premium_subscriber_visit' },
          { choice: 'keep_visit', priceIsk: 4_900, consumesVisit: false, surchargeReason: 'premium_visit_kept' },
        ],
      },
    });
    expect(preview.visitChoice?.options.map((option) => option.priceIsk)).toEqual([1_500, 4_900]);
    expect(preview.breakdown?.guests).toBeNull();
    expect(() => decodeBookingPreview({ kind: 'surcharge', priceIsk: '1500', isLastBeforeTopUp: false })).toThrow();
  });
});
