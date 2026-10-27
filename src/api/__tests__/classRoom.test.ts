/**
 * The class room (API 0.44.0) as each payload carries it: the venue
 * timetable, the Classes feed, My bookings and a booking's answer. Always
 * optional (an absent key is null: the feed is shared-cached), kept exactly
 * as sent, and never taken from the raw `location` / `locationText` prose.
 */
import { api, Reply } from '@test/server';

import { classJSON } from '../../features/classes/__tests__/feedFixtures';
import { createBooking, decodeActivityClass, decodeCreateBookingResult, fetchClasses } from '../bookings';
import { decodeMemberBooking, fetchBookings } from '../bookingsList';
import { decodeClassFeedItem } from '../classFeed';
import { expectSentToMatchContract, stubApiClientPerTest } from '../testing';
import { readRoom } from '../wire';

stubApiClientPerTest();

const ACTIVITY = '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34';
const VENUE = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

/** An Abler class as `GET /activities/{id}/classes` lists it (the live World Class Laugar shape). */
const ablerClass = (extra: Record<string, unknown> = {}) => ({
  eventId: 136379,
  name: 'Hot Yoga',
  description: null,
  start: '2030-03-14T10:00:00Z',
  end: '2030-03-14T11:00:00Z',
  location: { details: 'Salur  4', address: 'World Class, Reykjavík, Laugardalur, Iceland' },
  coaches: [],
  attendance: { current: 3, limit: 12 },
  full: false,
  canBook: true,
  canBookReason: null,
  registrationOpensAt: null,
  ...extra,
});

/** A My bookings row (`GET /bookings`). */
const bookingRow = (extra: Record<string, unknown> = {}) => ({
  id: '7a1c2b3d-0000-4000-8000-0000000000aa',
  status: 'confirmed',
  startsAt: '2030-03-14T10:00:00Z',
  endsAt: '2030-03-14T11:00:00Z',
  cancelledAt: null,
  cancellationReason: null,
  venue: { id: VENUE, slug: 'world-class-laugar', name: 'World Class Laugar & Pool' },
  activity: null,
  externalTitle: 'Hot Yoga',
  location: 'Salur  4',
  venueReference: null,
  ...extra,
});

describe('readRoom', () => {
  it('keeps a room exactly as sent', () => {
    expect(readRoom('Salur 4')).toBe('Salur 4');
    expect(readRoom('Salur 1 - 1. hæð')).toBe('Salur 1 - 1. hæð');
    expect(readRoom('Salur 1 & 2')).toBe('Salur 1 & 2');
  });

  it('reads absent, null, blank and the wrong type as no room', () => {
    expect(readRoom(undefined)).toBeNull();
    expect(readRoom(null)).toBeNull();
    expect(readRoom('')).toBeNull();
    expect(readRoom('   ')).toBeNull();
    expect(readRoom(4)).toBeNull();
    expect(readRoom({ details: 'Salur 4' })).toBeNull();
  });
});

describe('the venue timetable (GET /activities/{id}/classes)', () => {
  it('reads the room the server decided, never location.details', async () => {
    api.on(
      'GET',
      `/activities/${ACTIVITY}/classes`,
      Reply.ok({
        activityId: ACTIVITY,
        provider: 'abler',
        classes: [ablerClass({ room: 'Salur 4' }), ablerClass({ eventId: 136380, room: null }), ablerClass({ eventId: 136381 })],
        fetchedAt: '2030-03-13T09:00:00Z',
      }),
    );
    const [withRoom, noRoom, absent] = await fetchClasses(ACTIVITY, '2030-03-14', '2030-03-14');
    expectSentToMatchContract('GET', `/activities/${ACTIVITY}/classes`);
    expect(withRoom.room).toBe('Salur 4');
    expect(noRoom.room).toBeNull();
    expect(absent.room).toBeNull();
  });

  it('a malformed room costs the class nothing', () => {
    expect(decodeActivityClass(ablerClass({ room: 7 })).room).toBeNull();
    expect(decodeActivityClass(ablerClass({ room: 'Salur 2 Heitur' })).room).toBe('Salur 2 Heitur');
  });
});

describe('the Classes feed (GET /classes)', () => {
  const startsAt = new Date('2026-10-27T16:15:00.000Z');

  it('reads the room after the venue; a page cached from before 0.44.0 has none', () => {
    const withRoom = decodeClassFeedItem(
      classJSON({ startsAt, extra: { room: 'Salur 3', locationText: 'Salur 3 · World Class, Austurberg, Reykjavík' } }),
    );
    expect(withRoom.room).toBe('Salur 3');
    // A null room with location prose: the prose is never the room.
    const nullRoom = decodeClassFeedItem(classJSON({ startsAt, extra: { room: null, locationText: 'CF550 · Borgarflöt 5' } }));
    expect(nullRoom.room).toBeNull();
    expect(decodeClassFeedItem(classJSON({ startsAt })).room).toBeNull();
  });
});

describe('My bookings (GET /bookings)', () => {
  it('reads the room the list has now; the raw location is never the room', async () => {
    api.on(
      'GET',
      '/bookings',
      Reply.ok({
        data: [bookingRow({ room: 'Salur 4' }), bookingRow({ id: '7a1c2b3d-0000-4000-8000-0000000000ab', room: null })],
        pagination: { nextCursor: null, hasMore: false, limit: 100 },
      }),
    );
    const [moved, none] = await fetchBookings('upcoming');
    expect(moved.room).toBe('Salur 4');
    expect(none.room).toBeNull();
    expect(none.location).toBe('Salur  4');
  });

  it('a row from an older server has no room, and a malformed one is none', () => {
    expect(decodeMemberBooking(bookingRow()).room).toBeNull();
    expect(decodeMemberBooking(bookingRow({ room: false })).room).toBeNull();
  });
});

describe("a booking's answer (POST /bookings)", () => {
  const result = {
    bookingId: '7a1c2b3d-0000-4000-8000-000000000009',
    status: 'confirmed',
    provider: 'abler',
    profileId: '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22',
    venueId: VENUE,
    startsAt: '2030-03-14T10:00:00Z',
    endsAt: '2030-03-14T11:00:00Z',
    venueReference: null,
  };

  it('reads the room the class was booked with; a slot booking has none', async () => {
    api.on('POST', '/bookings', Reply.ok({ ...result, room: 'Salur 4' }, 201));
    const booked = await createBooking({ kind: 'class', activityId: ACTIVITY, eventId: 136379 }, 'key-1');
    expect(booked.room).toBe('Salur 4');
    expect(decodeCreateBookingResult({ ...result, room: null }).room).toBeNull();
    expect(decodeCreateBookingResult(result).room).toBeNull();
  });
});
