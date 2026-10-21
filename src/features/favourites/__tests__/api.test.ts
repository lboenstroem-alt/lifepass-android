/**
 * The favourites calls (iOS FavouritesService): what goes on the wire and how
 * the answer is read.
 */
import { sampleResponse, withValue } from '@test/contract';
import { api, Reply } from '@test/server';

import { DecodingError } from '../../../api';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../../../api/testing';
import {
  addFavouriteActivity,
  addFavouriteVenue,
  decodeFavourites,
  fetchFavourites,
  isPremiumFavourite,
  removeFavouriteActivity,
  removeFavouriteVenue,
} from '../api';

stubApiClientPerTest();

const VENUE = '3F2B8C1E-7D4A-4B6E-9C2F-1A2B3C4D5E6F';
const ACTIVITY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const venueRow = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  venueId: VENUE,
  slug: 'laugar',
  name: 'Laugar Spa',
  description: 'Spa',
  city: 'Reykjavík',
  address: 'Sundlaugavegur 30',
  inBundle: true,
  imageUrl: null,
  categories: ['spa'],
  createdAt: '2026-10-02T14:00:00.000Z',
  ...overrides,
});

describe('GET /favourites', () => {
  it('reads both lists from the contract sample, every key', async () => {
    api.on('GET', '/favourites', replyFromContract('GET', '/favourites', 200, 'full'));
    const payload = await fetchFavourites();
    expect(payload.venues.length).toBeGreaterThan(0);
    expect(payload.activities.length).toBeGreaterThan(0);
    const [venue] = payload.venues;
    expect(venue.slug).toEqual(expect.any(String));
    expect(venue.createdAt).toBeInstanceOf(Date);
    expect(payload.activities[0].venueSlug).toEqual(expect.any(String));
    expectSentToMatchContract('GET', '/favourites');
  });

  it('keeps ids in lower case, as iOS compares UUIDs whatever their case', () => {
    const payload = decodeFavourites({ venues: [venueRow()], activities: [] });
    expect(payload.venues[0].venueId).toBe(VENUE.toLowerCase());
  });

  it('reads missing optional fields as absent, as decodeIfPresent does', () => {
    const payload = decodeFavourites({
      venues: [{ id: VENUE, venueId: VENUE, slug: 's', name: 'N' }],
      activities: [
        { id: ACTIVITY, activityId: ACTIVITY, name: 'Yoga', venueId: VENUE, venueSlug: 's', venueName: 'N' },
      ],
    });
    expect(payload.venues[0]).toMatchObject({ city: null, inBundle: null, categories: null, createdAt: null });
    expect(payload.activities[0]).toMatchObject({ durationMinutes: null, description: null });
  });

  it('fails the read on a wrong type or a missing list, as JSONDecoder does', async () => {
    expect(() => decodeFavourites({ venues: [venueRow({ inBundle: 'yes' })], activities: [] })).toThrow();
    expect(() => decodeFavourites({ venues: [] })).toThrow();
    expect(() => decodeFavourites({ venues: [venueRow({ venueId: 'not-a-uuid' })], activities: [] })).toThrow();
    const sample = sampleResponse('GET', '/favourites', 200, 'full') as Record<string, unknown>;
    api.on('GET', '/favourites', Reply.ok(withValue(sample, 'venues', 'nope')));
    await expect(fetchFavourites()).rejects.toBeInstanceOf(DecodingError);
  });

  it('marks a row premium only when it says it is not in the bundle (iOS FavouriteVenue.isPremium)', () => {
    expect(isPremiumFavourite({ inBundle: false })).toBe(true);
    expect(isPremiumFavourite({ inBundle: true })).toBe(false);
    expect(isPremiumFavourite({ inBundle: null })).toBe(false);
  });
});

describe('the writes', () => {
  it('adds a venue with { venueId } and no Idempotency-Key (a preference write)', async () => {
    api.on('POST', '/favourites', replyFromContract('POST', '/favourites'));
    await addFavouriteVenue(VENUE);
    const sent = expectSentToMatchContract('POST', '/favourites');
    expect(sent.body).toEqual({ venueId: VENUE.toLowerCase() });
    expect(sent.headers['idempotency-key']).toBeUndefined();
  });

  it('adds a class with { activityId }', async () => {
    api.on('POST', '/favourites', replyFromContract('POST', '/favourites'));
    await addFavouriteActivity(ACTIVITY);
    expect(expectSentToMatchContract('POST', '/favourites').body).toEqual({ activityId: ACTIVITY });
  });

  it('removes by ?venueId= and by ?activityId=', async () => {
    api.on('DELETE', '/favourites', replyFromContract('DELETE', '/favourites'));
    await removeFavouriteVenue(VENUE);
    expect(expectSentToMatchContract('DELETE', '/favourites').query).toEqual({ venueId: VENUE.toLowerCase() });
    await removeFavouriteActivity(ACTIVITY);
    expect(expectSentToMatchContract('DELETE', '/favourites').query).toEqual({ activityId: ACTIVITY });
  });
});
