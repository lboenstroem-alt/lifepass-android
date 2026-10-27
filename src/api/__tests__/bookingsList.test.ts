/**
 * My bookings' calls (iOS BookingService `fetchBookings`, `cancelBooking`):
 * what goes on the wire and how the feed is read (iOS `Booking`, strictly).
 */
import { api, Reply } from '@test/server';

import { DecodingError } from '..';
import {
  bookingActivityName,
  BOOKINGS_LIST_LIMIT,
  cancelBooking,
  decodeBookingsPage,
  decodeMemberBooking,
  fetchBookings,
  isCancellable,
} from '../bookingsList';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const ID = '7A1C2B3D-0000-4000-8000-0000000000AA';
const VENUE = '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  status: 'pending',
  startsAt: '2030-03-14T10:00:00.000Z',
  endsAt: '2030-03-14T11:00:00Z',
  cancelledAt: null,
  cancellationReason: null,
  venue: { id: VENUE, slug: 'world-class-vatnsmyri', name: 'World Class Vatnsmýri' },
  activity: null,
  externalTitle: 'Yoga Flow',
  location: null,
  venueReference: null,
  ...overrides,
});

const page = (rows: unknown[]) => ({ data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } });

describe('GET /bookings', () => {
  it('asks for one range at the iOS page size and reads the contract sample, every key', async () => {
    api.on('GET', '/bookings', replyFromContract('GET', '/bookings', 200, 'full'));
    const bookings = await fetchBookings('upcoming');
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings[0].startsAt).toBeInstanceOf(Date);
    const sent = expectSentToMatchContract('GET', '/bookings');
    expect(sent.query).toEqual({ range: 'upcoming', limit: String(BOOKINGS_LIST_LIMIT) });
  });

  it('reads the minimal contract sample (required keys only)', async () => {
    api.on('GET', '/bookings', replyFromContract('GET', '/bookings', 200, 'minimal'));
    await expect(fetchBookings('past')).resolves.toEqual(expect.any(Array));
    expect(api.sent('/bookings').query.range).toBe('past');
  });

  it('keeps the raw status, so pending is never read as confirmed', async () => {
    api.on('GET', '/bookings', Reply.ok(page([row(), row({ id: VENUE, status: 'checked_in' })])));
    const [pending, checkedIn] = await fetchBookings('upcoming');
    expect(pending.status).toBe('pending');
    expect(checkedIn.status).toBe('checked_in');
  });

  it('keeps ids in lower case and reads every field', () => {
    const [booking] = decodeBookingsPage(
      page([row({ activity: { id: VENUE.toUpperCase(), name: 'Gym' }, location: 'Salur 2', cancellationReason: 'x' })]),
    );
    expect(booking).toEqual({
      id: ID.toLowerCase(),
      status: 'pending',
      startsAt: new Date('2030-03-14T10:00:00Z'),
      endsAt: new Date('2030-03-14T11:00:00Z'),
      cancelledAt: null,
      cancellationReason: 'x',
      venue: { id: VENUE, slug: 'world-class-vatnsmyri', name: 'World Class Vatnsmýri' },
      activity: { id: VENUE, name: 'Gym' },
      externalTitle: 'Yoga Flow',
      location: 'Salur 2',
      // No `room` on this row: the raw `location` is never taken for it.
      room: null,
    });
  });

  it('reads missing optional fields as absent, as decodeIfPresent does', () => {
    const minimal = row();
    delete (minimal as Record<string, unknown>).cancelledAt;
    delete (minimal as Record<string, unknown>).activity;
    delete (minimal as Record<string, unknown>).externalTitle;
    const booking = decodeMemberBooking(minimal);
    expect(booking.activity).toBeNull();
    expect(booking.externalTitle).toBeNull();
    expect(booking.cancelledAt).toBeNull();
  });

  it.each([
    ['a row with no venue', { venue: undefined }],
    ['a venue with no slug', { venue: { id: VENUE, name: 'X' } }],
    ['an id that is not a UUID', { id: 'abc' }],
    ['an unreadable start', { startsAt: 'tomorrow' }],
    ['a status that is not a string', { status: 3 }],
    ['an activity with no name', { activity: { id: VENUE } }],
    ['a title of the wrong type', { externalTitle: 7 }],
  ])('fails the whole page on %s (never half a list)', async (_name, overrides) => {
    api.on('GET', '/bookings', Reply.ok(page([row(), row(overrides)])));
    await expect(fetchBookings('upcoming')).rejects.toBeInstanceOf(DecodingError);
  });

  it('needs the pagination block, as iOS Paginated does', () => {
    expect(() => decodeBookingsPage({ data: [] })).toThrow();
    expect(() => decodeBookingsPage({ data: [], pagination: { hasMore: 'no' } })).toThrow();
    expect(decodeBookingsPage({ data: [], pagination: { hasMore: true } })).toEqual([]);
  });
});

describe('POST /bookings/{id}/cancel', () => {
  it('sends the caller key and no reason (Swift leaves a nil reason out)', async () => {
    api.on('POST', '/bookings/:id/cancel', replyFromContract('POST', '/bookings/{bookingId}/cancel', 200));
    await cancelBooking(ID, 'key-0001-abcd');
    const sent = expectSentToMatchContract('POST', `/bookings/${ID.toLowerCase()}/cancel`);
    expect(sent.headers['idempotency-key']).toBe('key-0001-abcd');
    expect(sent.body).toEqual({});
  });

  it('throws the refusal as a problem', async () => {
    api.on('POST', '/bookings/:id/cancel', Reply.problem(409, 'cancellation_window_closed'));
    await expect(cancelBooking(ID, 'key-0001-abcd')).rejects.toMatchObject({ kind: 'problem', slug: 'cancellation_window_closed' });
  });
});

describe('the model', () => {
  const now = new Date('2030-03-14T09:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('cancels only a confirmed or pending booking that has not started (iOS isCancellable)', () => {
    expect(isCancellable({ status: 'confirmed', startsAt: at('2030-03-14T10:00:00Z') }, now)).toBe(true);
    expect(isCancellable({ status: 'pending', startsAt: at('2030-03-14T10:00:00Z') }, now)).toBe(true);
    expect(isCancellable({ status: 'checked_in', startsAt: at('2030-03-14T10:00:00Z') }, now)).toBe(false);
    expect(isCancellable({ status: 'cancelled', startsAt: at('2030-03-14T10:00:00Z') }, now)).toBe(false);
    expect(isCancellable({ status: 'confirmed', startsAt: at('2030-03-14T09:00:00Z') }, now)).toBe(false);
    expect(isCancellable({ status: 'confirmed', startsAt: at('2030-03-14T08:59:00Z') }, now)).toBe(false);
  });

  it('names the class by its snapshotted title, else the activity, else nothing', () => {
    expect(bookingActivityName({ externalTitle: 'Hot Yoga', activity: { id: VENUE, name: 'Yoga' } })).toBe('Hot Yoga');
    expect(bookingActivityName({ externalTitle: null, activity: { id: VENUE, name: 'Yoga' } })).toBe('Yoga');
    expect(bookingActivityName({ externalTitle: null, activity: null })).toBeNull();
  });
});
