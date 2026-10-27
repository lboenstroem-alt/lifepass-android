/**
 * The favourites calls (iOS FavouritesService): what goes on the wire and how
 * the answer is read.
 */
import { sampleResponse, withValue } from '@test/contract';
import { api, Reply } from '@test/server';

import { DecodingError } from '../../../api';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage } from '../../../i18n';
import {
  addFavouriteActivity,
  addFavouriteAttraction,
  addFavouriteVenue,
  decodeFavourites,
  fetchFavourites,
  isPremiumFavourite,
  removeFavouriteActivity,
  removeFavouriteAttraction,
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

/** A saved place as the server lists it (API 0.45.0 `FavouriteAttraction`, every key present). */
const placeRow = (overrides: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  attractionId: '33333333-3333-4333-8333-333333333333',
  slug: 'skogafoss',
  name: 'Skógafoss',
  localName: 'Skógafoss',
  kind: 'waterfall',
  kindLabel: 'Waterfall',
  region: 'south',
  regionLabel: 'South Iceland',
  lengthM: null,
  durationMinutes: null,
  difficulty: null,
  difficultyLabel: null,
  outAndBack: false,
  imageUrl: 'https://upload.example/skogafoss-640.jpg',
  imageAlt: 'Skógafoss',
  imageIsMapPlate: false,
  imageCredit: 'Jane Doe',
  imageLicense: 'CC BY-SA 4.0',
  createdAt: '2026-10-27T12:00:00.000Z',
  ...overrides,
});

describe('saved hikes and sights (API 0.45.0)', () => {
  it('asks for the places in the language on screen, and reads the contract sample', async () => {
    setCurrentLanguage('is');
    api.on('GET', '/favourites', replyFromContract('GET', '/favourites', 200, 'full'));
    const payload = await fetchFavourites();
    const sent = expectSentToMatchContract('GET', '/favourites');
    expect(sent.query).toEqual({ include: 'attractions', locale: 'is' });
    expect(payload.attractions.length).toBeGreaterThan(0);
    expect(payload.attractions[0].slug).toEqual(expect.any(String));
    setCurrentLanguage('en');
    await fetchFavourites();
    expect(expectSentToMatchContract('GET', '/favourites').query).toEqual({ include: 'attractions', locale: 'en' });
  });

  it('reads a place, every field', () => {
    const [place] = decodeFavourites({ venues: [], activities: [], attractions: [placeRow({ lengthM: 7100, durationMinutes: 180, outAndBack: true, kind: 'hike' })] }).attractions;
    expect(place).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      attractionId: '33333333-3333-4333-8333-333333333333',
      slug: 'skogafoss',
      name: 'Skógafoss',
      localName: 'Skógafoss',
      kind: 'hike',
      kindLabel: 'Waterfall',
      region: 'south',
      regionLabel: 'South Iceland',
      lengthM: 7100,
      durationMinutes: 180,
      difficulty: null,
      difficultyLabel: null,
      outAndBack: true,
      imageUrl: 'https://upload.example/skogafoss-640.jpg',
      imageAlt: 'Skógafoss',
      imageIsMapPlate: false,
      imageCredit: 'Jane Doe',
      imageLicense: 'CC BY-SA 4.0',
      createdAt: new Date('2026-10-27T12:00:00.000Z'),
    });
  });

  it('a server that sends no places (or an answer without the key) is an empty list', () => {
    expect(decodeFavourites({ venues: [], activities: [] }).attractions).toEqual([]);
    expect(decodeFavourites({ venues: [], activities: [], attractions: 'none' }).attractions).toEqual([]);
  });

  it('drops a place it cannot show and keeps the rest, and never costs the venue hearts', () => {
    const payload = decodeFavourites({
      venues: [venueRow()],
      activities: [],
      attractions: [placeRow({ slug: null }), placeRow({ slug: 'glymur', name: '' }), placeRow({ slug: 'glymur', lengthM: 'far' }), 3],
    });
    expect(payload.venues).toHaveLength(1);
    expect(payload.attractions.map((p) => [p.slug, p.lengthM])).toEqual([['glymur', null]]);
  });

  it('lists a place once, whatever the server repeats', () => {
    const payload = decodeFavourites({ venues: [], activities: [], attractions: [placeRow(), placeRow({ id: 'again' })] });
    expect(payload.attractions).toHaveLength(1);
  });

  it('saves with { attractionSlug } and no Idempotency-Key, and removes by ?attractionSlug=', async () => {
    api.on('POST', '/favourites', replyFromContract('POST', '/favourites'));
    await addFavouriteAttraction('skogafoss');
    const saved = expectSentToMatchContract('POST', '/favourites');
    expect(saved.body).toEqual({ attractionSlug: 'skogafoss' });
    expect(saved.headers['idempotency-key']).toBeUndefined();
    api.on('DELETE', '/favourites', replyFromContract('DELETE', '/favourites'));
    await removeFavouriteAttraction('skogafoss');
    expect(expectSentToMatchContract('DELETE', '/favourites').query).toEqual({ attractionSlug: 'skogafoss' });
  });

  it('a refused save is thrown for the store to undo (404: an unpublished place)', async () => {
    api.on('POST', '/favourites', Reply.problem(404, 'favourite_target_not_found'));
    await expect(addFavouriteAttraction('gone')).rejects.toMatchObject({ status: 404 });
  });
});
