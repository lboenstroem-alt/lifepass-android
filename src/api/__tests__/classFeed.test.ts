/**
 * The class feed on the wire: what `GET /classes` asks (checked against the
 * contract), how a page decodes (iOS `ClassFeedItem` / `BookingRef`), and the
 * look-ahead's paging (the `firstMatch` cases of iOS ClassesNextMatchTests).
 */
import { api, Reply } from '@test/server';

import {
  classJSON,
  day,
  HRESS,
  NEARBY,
  page,
  REYKJAVIK,
} from '../../features/classes/__tests__/feedFixtures';
import { passesClientFilters } from '../../features/classes/feed/clientFilters';
import {
  decodeClassFeedItem,
  decodeClassFeedPage,
  fetchClassFeedPage,
  firstMatch,
} from '../classFeed';
import { DecodingError, TransportError } from '../errors';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const ACTIVITY = '6c7b6f2e-1d1f-4c5e-9a55-0d1f7d1b2a33';

describe('GET /classes', () => {
  it('always asks for a page of 100 and leaves empty filters out', async () => {
    api.on('GET', '/classes', page([]));
    await fetchClassFeedPage();
    const sent = expectSentToMatchContract('GET', '/classes');
    expect(sent.query).toEqual({ limit: '100' });
  });

  it('sends the search, the category, one day as start and end, and the cursor', async () => {
    api.on('GET', '/classes', page([]));
    await fetchClassFeedPage({ query: 'morning flow', category: 'pilates', start: '2026-10-02', end: '2026-10-02', cursor: 'abc' });
    const sent = expectSentToMatchContract('GET', '/classes');
    expect(sent.query).toEqual({
      limit: '100',
      q: 'morning flow',
      category: 'pilates',
      start: '2026-10-02',
      end: '2026-10-02',
      cursor: 'abc',
    });
  });

  it('an empty search is left out, not sent as q=', async () => {
    api.on('GET', '/classes', page([]));
    await fetchClassFeedPage({ query: '', category: null, cursor: '' });
    expect(api.sent('/classes').query).toEqual({ limit: '100' });
  });

  it("decodes the contract's own sample page", async () => {
    api.on('GET', '/classes', replyFromContract('GET', '/classes', 200, 'full'));
    const result = await fetchClassFeedPage();
    expect(Array.isArray(result.classes)).toBe(true);
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('a page with one malformed class fails as a whole (a decoding error)', async () => {
    const good = classJSON({ startsAt: day(1, 9) });
    const bad = { ...classJSON({ startsAt: day(1, 10) }), full: 'no' };
    api.on('GET', '/classes', page([good, bad]));
    await expect(fetchClassFeedPage()).rejects.toBeInstanceOf(DecodingError);
  });
});

describe('decoding (iOS ClassFeedItem)', () => {
  const start = new Date('2026-10-05T06:00:00.000Z');

  it('an Abler class books by its event', () => {
    const item = decodeClassFeedItem(classJSON({ startsAt: start, booking: { kind: 'class', activityId: ACTIVITY, eventId: 4242 } }));
    expect(item.booking).toEqual({ kind: 'class', activityId: ACTIVITY, eventId: 4242 });
    expect(item.startsAt.toISOString()).toBe('2026-10-05T06:00:00.000Z');
    expect(item.endsAt.toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });

  it('a first-party slot books by its own times', () => {
    const item = decodeClassFeedItem(
      classJSON({
        startsAt: start,
        booking: { kind: 'slot', activityId: ACTIVITY, startsAt: '2026-10-05T06:00:00Z', endsAt: '2026-10-05T06:45:00Z' },
      }),
    );
    expect(item.booking.kind).toBe('slot');
    if (item.booking.kind !== 'slot') return;
    expect(item.booking.endsAt.toISOString()).toBe('2026-10-05T06:45:00.000Z');
  });

  it('a kind this build does not know still decodes, as unsupported', () => {
    const item = decodeClassFeedItem(classJSON({ startsAt: start, booking: { kind: 'waitlist', activityId: ACTIVITY } }));
    expect(item.booking).toEqual({ kind: 'unsupported', activityId: ACTIVITY });
  });

  it('optional fields may be missing or null; a venue may have no coordinates', () => {
    const json = classJSON({ startsAt: start });
    delete json.instructor;
    delete json.attendance;
    json.canBook = null;
    json.surchargeFromIsk = 1990;
    json.registrationOpensAt = '2026-10-01T12:00:00Z';
    (json.venue as Record<string, unknown>).coordinates = null;
    const item = decodeClassFeedItem(json);
    expect(item.instructor).toBeNull();
    expect(item.attendance).toBeNull();
    expect(item.canBook).toBeNull();
    expect(item.surchargeFromIsk).toBe(1990);
    expect(item.registrationOpensAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(item.venue.coordinates).toBeNull();
  });

  it.each([
    ['a venue id that is not a UUID', (json: Record<string, unknown>) => ((json.venue as Record<string, unknown>).id = 'hress')],
    ['an activity id that is not a UUID', (json: Record<string, unknown>) => (json.booking = { kind: 'class', activityId: 'x', eventId: 1 })],
    ['a class without its event id', (json: Record<string, unknown>) => (json.booking = { kind: 'class', activityId: ACTIVITY })],
    ['a start that is not a date', (json: Record<string, unknown>) => (json.startsAt = 'tomorrow')],
    ['a category list with a number', (json: Record<string, unknown>) => (json.categorySlugs = ['yoga', 3])],
    ['attendance without its limit', (json: Record<string, unknown>) => (json.attendance = { current: 1 })],
  ])('%s fails the decode', (_name, spoil) => {
    const json = classJSON({ startsAt: start });
    spoil(json);
    expect(() => decodeClassFeedItem(json)).toThrow();
  });

  it('a page carries its cursor (or none) and when it was read', () => {
    const decoded = decodeClassFeedPage({ classes: [], nextCursor: null, fetchedAt: '2026-10-02T12:00:00.000Z' });
    expect(decoded.nextCursor).toBeNull();
    expect(decoded.fetchedAt.toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });
});

describe('the look-ahead (iOS ClassFeedService.firstMatch)', () => {
  /** "Near me" is client-side: a page can hold only classes beyond the radius, and the next one is read. */
  it('pages past classes beyond the radius', async () => {
    const far = day(2, 6);
    const near = day(4, 17);
    api.on('GET', '/classes', (request) =>
      request.query.cursor === 'p2'
        ? page([classJSON({ venue: NEARBY, startsAt: near })])
        : page([classJSON({ venue: HRESS, startsAt: far })], 'p2'),
    );
    const now = new Date();
    const outcome = await firstMatch({
      query: null,
      category: 'pilates',
      start: '2026-10-03',
      end: '2026-10-16',
      accept: (item) => passesClientFilters(item, now, REYKJAVIK, 1),
    });
    expect(outcome.kind).toBe('found');
    if (outcome.kind !== 'found') return;
    expect(outcome.item.venue.name).toBe('Nearby Studio');
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1]!.query.cursor).toBe('p2');
    expect(api.requests[1]!.query.start).toBe('2026-10-03');
    expect(api.requests[1]!.query.end).toBe('2026-10-16');
  });

  it('takes the earliest accepted class on a page', async () => {
    api.on('GET', '/classes', page([classJSON({ name: 'B', startsAt: day(6, 9) }), classJSON({ name: 'A', startsAt: day(4, 9) })]));
    const outcome = await firstMatch({ query: null, category: null, start: '2026-10-03', end: '2026-10-16', accept: () => true });
    expect(outcome.kind === 'found' && outcome.item.name).toBe('A');
  });

  it('gives up rather than guess', async () => {
    api.on('GET', '/classes', page([classJSON({ venue: HRESS, startsAt: day(3, 6) })], 'more'));
    const outcome = await firstMatch({
      query: null,
      category: null,
      start: '2026-10-03',
      end: '2026-10-16',
      maxPages: 3,
      accept: () => false,
    });
    expect(outcome).toEqual({ kind: 'gaveUp' });
    expect(api.requests).toHaveLength(3);
  });

  it('a window read to its end with nothing accepted is exhausted', async () => {
    api.on('GET', '/classes', page([classJSON({ startsAt: day(3, 6) })]));
    const outcome = await firstMatch({ query: null, category: null, start: '2026-10-03', end: '2026-10-16', accept: () => false });
    expect(outcome).toEqual({ kind: 'exhausted' });
  });

  it('a cancelled look-ahead asks nothing more', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      firstMatch({ query: null, category: null, start: '2026-10-03', end: '2026-10-16', accept: () => true, signal: controller.signal }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(api.requests).toHaveLength(0);
  });

  it('a failed page fails the look-ahead', async () => {
    api.on('GET', '/classes', Reply.raw(502, '<html>Bad gateway</html>'));
    await expect(
      firstMatch({ query: null, category: null, start: '2026-10-03', end: '2026-10-16', accept: () => true }),
    ).rejects.toBeTruthy();
  });
});
