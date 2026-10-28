/**
 * The upcoming card's data: `GET /bookings?range=upcoming&limit=100`, the
 * soonest first whatever order the server sends, a strict read, and the
 * `bookingWhen` line ("Today · 18:00", "Tomorrow · 09:30", "Sat 7 Jun · 14:00")
 * on Reykjavík's clock, whatever zone the phone is in.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { translate } from '../../../i18n';
import { bookingWhen, decodeUpcomingPage, fetchUpcomingBookings, sortedUpcoming } from '../upcoming';

stubApiClientPerTest();

const en = (key: string) => translate(key, 'en');
const is = (key: string) => translate(key, 'is');

function row(id: string, startsAt: string, venue = 'Laugardalslaug') {
  return {
    id,
    status: 'confirmed',
    startsAt,
    endsAt: startsAt,
    venue: { id: '00000000-0000-4000-8000-000000000001', slug: 'laugardalslaug', name: venue },
    activity: null,
    externalTitle: null,
    location: null,
    venueReference: null,
  };
}

const page = (rows: unknown[]) => Reply.ok({ data: rows, pagination: { nextCursor: null, hasMore: false, limit: 100 } });

describe('fetchUpcomingBookings', () => {
  it('asks for the upcoming range, a hundred at most, as iOS does', async () => {
    api.on('GET', '/bookings', page([]));
    await fetchUpcomingBookings();
    expect(api.sent('/bookings').query).toEqual({ range: 'upcoming', limit: '100' });
  });

  it('the soonest booking wins when the API returns them unsorted', async () => {
    api.on(
      'GET',
      '/bookings',
      page([
        row('b-late', '2026-10-20T18:00:00Z', 'Late'),
        row('b-soon', '2026-10-18T09:30:00.000Z', 'Soon'),
        row('b-mid', '2026-10-19T12:00:00+00:00', 'Mid'),
      ]),
    );
    const list = await fetchUpcomingBookings();
    expect(list.map((b) => b.id)).toEqual(['b-soon', 'b-mid', 'b-late']);
    expect(list[0]).toEqual({ id: 'b-soon', venueName: 'Soon', startsAt: new Date('2026-10-18T09:30:00Z') });
  });

  it('fails the read on a row it cannot show (strict, as iOS decodes)', async () => {
    api.on('GET', '/bookings', page([row('b-1', 'not a date')]));
    await expect(fetchUpcomingBookings()).rejects.toThrow();
  });

  it('a server error is a failure, not an empty list', async () => {
    api.on('GET', '/bookings', Reply.problem(503, 'service_unavailable'));
    await expect(fetchUpcomingBookings()).rejects.toThrow();
  });
});

describe('decodeUpcomingPage and sortedUpcoming', () => {
  it('reads id, start and venue name only', () => {
    expect(decodeUpcomingPage({ data: [row('b-1', '2026-10-18T09:30:00Z', 'Sky Lagoon')], pagination: {} })).toEqual([
      { id: 'b-1', venueName: 'Sky Lagoon', startsAt: new Date('2026-10-18T09:30:00Z') },
    ]);
  });

  it('refuses a page without data, a row without a venue name or an id', () => {
    expect(() => decodeUpcomingPage({})).toThrow();
    expect(() => decodeUpcomingPage({ data: [{ ...row('b-1', '2026-10-18T09:30:00Z'), venue: {} }] })).toThrow();
    expect(() => decodeUpcomingPage({ data: [{ ...row('', '2026-10-18T09:30:00Z') }] })).toThrow();
  });

  it('keeps the server order for two bookings at the same time', () => {
    const a = { id: 'a', venueName: 'A', startsAt: new Date('2026-10-18T09:30:00Z') };
    const b = { id: 'b', venueName: 'B', startsAt: new Date('2026-10-18T09:30:00Z') };
    expect(sortedUpcoming([a, b]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('bookingWhen', () => {
  const now = new Date('2026-10-17T10:00:00Z'); // Saturday 17 October, Reykjavík

  it('today, tomorrow and a later date', () => {
    expect(bookingWhen(new Date('2026-10-17T18:00:00Z'), en, now)).toBe('Today · 18:00');
    expect(bookingWhen(new Date('2026-10-18T09:30:00Z'), en, now)).toBe('Tomorrow · 09:30');
    expect(bookingWhen(new Date('2026-10-24T14:00:00Z'), en, now)).toBe('Sat 24 Oct · 14:00');
  });

  it('says Today and Tomorrow in Icelandic; a later day stays in English, as iOS writes it', () => {
    expect(bookingWhen(new Date('2026-10-17T18:00:00Z'), is, now)).toBe('Í dag · 18:00');
    expect(bookingWhen(new Date('2026-10-18T09:30:00Z'), is, now)).toBe('Á morgun · 09:30');
    expect(bookingWhen(new Date('2026-06-07T14:00:00Z'), is, now)).toBe('Sun 7 Jun · 14:00');
  });

  it('reads the day on Reykjavík’s calendar, so 23:30 is still today and 00:15 is tomorrow', () => {
    expect(bookingWhen(new Date('2026-10-17T23:30:00Z'), en, now)).toBe('Today · 23:30');
    expect(bookingWhen(new Date('2026-10-18T00:15:00Z'), en, now)).toBe('Tomorrow · 00:15');
    expect(bookingWhen(new Date('2026-10-19T00:00:00Z'), en, new Date('2026-10-17T23:59:00Z'))).toBe('Mon 19 Oct · 00:00');
  });

  it('is empty for a date that holds no instant', () => {
    expect(bookingWhen(new Date('nope'), en, now)).toBe('');
  });
});
