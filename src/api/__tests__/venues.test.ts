/**
 * The venue model on the wire: the decoding cases of iOS
 * VenueMarkerTypeTests.swift ("Decoding"), the money and position rules of
 * Venue.swift, and the two reads (`GET /venues`, `GET /venues/by-slug`)
 * against the contract.
 */
import { sampleResponse } from '@test/contract';
import { api, Reply } from '@test/server';

import { DecodingError } from '../errors';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';
import { decodeVenue, decodeVenuePage, fetchVenueBySlug, fetchVenues, stringsOf, venueToApi } from '../venues';

const ID = '610ea437-353d-47a7-af83-e31f9c9d501e';

const minimalVenue = { id: ID, slug: 'x', name: 'X', inBundle: true };

describe('decoding (VenueMarkerTypeTests)', () => {
  it('a venue without offerings still decodes', () => {
    const venue = decodeVenue(minimalVenue);
    expect(venue.offerings).toBeNull();
    expect(venue.markerType).toBeNull();
    expect(venue.id).toBe(ID);
  });

  it('offerings and the marker type round-trip', () => {
    const venue = decodeVenue({
      ...minimalVenue,
      category: 'gym',
      offerings: ['gym-floor', 'pool'],
      markerType: 'gymPool',
    });
    expect(venue.offerings).toEqual(['gym-floor', 'pool']);
    expect(venue.markerType).toBe('gymPool');
    const again = decodeVenue(JSON.parse(JSON.stringify(venueToApi(venue))));
    expect(again.offerings).toEqual(venue.offerings);
    expect(again.markerType).toBe(venue.markerType);
    expect(again).toEqual(venue);
  });

  it('a malformed offerings list does not cost the venue', () => {
    const venue = decodeVenue({ ...minimalVenue, offerings: 'pool', markerType: 7 });
    expect(venue.offerings).toBeNull();
    expect(venue.markerType).toBeNull();
  });

  /**
   * The web's `stringsOf`: a list with a stray element keeps its strings, so
   * the server's offerings still decide the ring.
   */
  it('a stray element keeps the other offerings', () => {
    const venue = decodeVenue({
      ...minimalVenue,
      category: 'gym',
      categories: ['Gym'],
      amenities: [],
      offerings: ['gym-floor', null, 3, { a: 1 }, ['pool'], true, 'pool'],
    });
    expect(venue.offerings).toEqual(['gym-floor', 'pool']);
  });

  /** A list with no strings left is still the server's (empty) list, not a missing one. */
  it('a list of nothing but nulls is an empty list', () => {
    expect(decodeVenue({ ...minimalVenue, offerings: [null, null] }).offerings).toEqual([]);
  });

  it('stringsOf reads a list for its strings only', () => {
    expect(stringsOf(['pool', null, 3])).toEqual(['pool']);
    expect(stringsOf('pool')).toBeNull();
    expect(stringsOf({ 0: 'pool' })).toBeNull();
    expect(stringsOf(undefined)).toBeNull();
  });
});

describe('the model', () => {
  it('reads every field of a full row', () => {
    const venue = decodeVenue({
      id: ID.toUpperCase(),
      slug: 'sky-lagoon',
      name: 'Sky Lagoon',
      description: 'A lagoon.',
      descriptionIs: 'Lón.',
      address: 'Vesturvör 44',
      city: 'Kópavogur',
      coordinates: { latitude: 64.115, longitude: -21.98 },
      imageUrl: 'https://example.test/sky.jpg',
      categories: ['Spa', 'Lagoon'],
      category: 'lagoon',
      walkInsAllowed: true,
      phone: '+354 527 6800',
      amenities: ['Sauna'],
      averageRating: 4.6,
      totalReviews: 12,
      displayOrder: 3,
      awaitingConnection: false,
      activitiesAwaitingConnection: true,
      openingHours: {
        monday: { open: '10:00', close: '22:00', closed: false },
        sunday: { closed: true },
        holiday: { open: 'ignored' },
      },
      offerings: ['lagoon', 'sauna'],
      inBundle: false,
      surchargePrice: 9990,
      memberSurchargePrice: 8990,
      resolvedSurchargePrice: 8490,
      topupPrice: 2650,
      daypassPrice: 2900,
      specialInstructions: 'not modelled',
    });
    expect(venue).toEqual({
      id: ID, // lower-cased, as the server writes ids
      slug: 'sky-lagoon',
      name: 'Sky Lagoon',
      description: 'A lagoon.',
      descriptionIs: 'Lón.',
      address: 'Vesturvör 44',
      city: 'Kópavogur',
      latitude: 64.115,
      longitude: -21.98,
      imageUrl: 'https://example.test/sky.jpg',
      categories: ['Spa', 'Lagoon'],
      primaryCategory: 'lagoon',
      walkInsAllowed: true,
      phone: '+354 527 6800',
      amenities: ['Sauna'],
      averageRating: 4.6,
      totalReviews: 12,
      displayOrder: 3,
      awaitingConnection: false,
      activitiesAwaitingConnection: true,
      openingHours: {
        monday: { open: '10:00', close: '22:00', closed: false },
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: { open: null, close: null, closed: true },
      },
      offerings: ['lagoon', 'sauna'],
      markerType: null,
      inBundle: false,
      surchargePrice: 9990,
      resolvedSurchargePrice: 8490,
      topupPrice: 2650,
      daypassPrice: 2900,
    });
  });

  it('a venue without coordinates is never placed at 0,0', () => {
    expect(decodeVenue(minimalVenue)).toMatchObject({ latitude: null, longitude: null });
    expect(decodeVenue({ ...minimalVenue, coordinates: null })).toMatchObject({ latitude: null, longitude: null });
    expect(decodeVenue({ ...minimalVenue, coordinates: {} })).toMatchObject({ latitude: null, longitude: null });
    // Half a position is no position.
    expect(decodeVenue({ ...minimalVenue, coordinates: { latitude: 64.1, longitude: null } })).toMatchObject({
      latitude: null,
      longitude: null,
    });
    // A real 0 stays a real 0.
    expect(decodeVenue({ ...minimalVenue, coordinates: { latitude: 0, longitude: 0 } })).toMatchObject({
      latitude: 0,
      longitude: 0,
    });
  });

  it('no photo is null, never a stock photo', () => {
    expect(decodeVenue(minimalVenue).imageUrl).toBeNull();
    expect(JSON.stringify(decodeVenue(minimalVenue))).not.toMatch(/picsum/);
  });

  /** A premium venue must never read as included and have its surcharge hidden. */
  it('a missing inBundle is premium', () => {
    const { inBundle, ...rest } = minimalVenue;
    expect(inBundle).toBe(true);
    expect(decodeVenue(rest).inBundle).toBe(false);
    expect(decodeVenue({ ...rest, inBundle: null }).inBundle).toBe(false);
  });

  it('id, slug and name are required, and the id is a UUID', () => {
    expect(() => decodeVenue({ slug: 'x', name: 'X' })).toThrow();
    expect(() => decodeVenue({ id: ID, name: 'X' })).toThrow();
    expect(() => decodeVenue({ id: ID, slug: 'x' })).toThrow();
    expect(() => decodeVenue({ id: 'not-a-uuid', slug: 'x', name: 'X' })).toThrow();
    expect(() => decodeVenue(null)).toThrow();
    expect(() => decodeVenue([minimalVenue])).toThrow();
  });

  /** As Swift's decodeIfPresent: absent or null is fine, a wrong type is not. */
  it('a field of the wrong type fails the decode', () => {
    expect(() => decodeVenue({ ...minimalVenue, inBundle: 'yes' })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, surchargePrice: '9990' })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, surchargePrice: 99.5 })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, coordinates: { latitude: '64', longitude: -21 } })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, categories: ['Gym', 3] })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, openingHours: 'always' })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, openingHours: { monday: { open: 9 } } })).toThrow();
    expect(() => decodeVenue({ ...minimalVenue, description: null, city: null })).not.toThrow();
  });

  it("decodes the contract's own venue samples", () => {
    for (const mode of ['minimal', 'full'] as const) {
      expect(() => decodeVenuePage(sampleResponse('GET', '/venues', 200, mode))).not.toThrow();
    }
    const full = decodeVenuePage(sampleResponse('GET', '/venues', 200, 'full'));
    expect(full).toHaveLength(1);
    expect(full[0].openingHours).toMatchObject({ monday: null });
  });

  it('a page decodes all or nothing', () => {
    expect(() => decodeVenuePage({ data: [minimalVenue, { id: ID }] })).toThrow();
    expect(() => decodeVenuePage({ data: 'none' })).toThrow();
    expect(decodeVenuePage({ data: [minimalVenue], pagination: {} })).toHaveLength(1);
  });
});

describe('the reads', () => {
  stubApiClientPerTest();

  it('GET /venues asks for one page of 100 and leaves empty filters out', async () => {
    api.on('GET', '/venues', replyFromContract('GET', '/venues', 200, 'full'));
    const venues = await fetchVenues();
    expect(venues).toHaveLength(1);
    const sent = expectSentToMatchContract('GET', '/venues');
    expect(sent.query).toEqual({ limit: '100' });
    expect(sent.headers.authorization).toBe('Bearer test-token');

    await fetchVenues({ search: '', category: null, city: undefined });
    expect(api.sent('/venues').query).toEqual({ limit: '100' });
  });

  it('GET /venues sends the search, one category and the city', async () => {
    api.on('GET', '/venues', replyFromContract('GET', '/venues'));
    await fetchVenues({ search: 'laug', category: 'Pool', city: 'Reykjavík' });
    const sent = expectSentToMatchContract('GET', '/venues');
    expect(sent.query).toEqual({ limit: '100', q: 'laug', category: 'Pool', city: 'Reykjavík' });

    await fetchVenues({ category: 'Gym', limit: 20 });
    expect(api.sent('/venues').query).toEqual({ limit: '20', category: 'Gym' });
  });

  it('GET /venues/by-slug/{slug} reads one venue', async () => {
    api.on('GET', '/venues/by-slug/:slug', (request) =>
      Reply.ok({ ...minimalVenue, slug: request.params.slug, name: 'Laugar' }),
    );
    const venue = await fetchVenueBySlug('world-class-laugar');
    expect(venue).toMatchObject({ id: ID, slug: 'world-class-laugar', name: 'Laugar' });
    expectSentToMatchContract('GET', '/venues/by-slug/world-class-laugar');
  });

  it('a row the app cannot read is a decoding error, not a crash', async () => {
    api.on('GET', '/venues', Reply.ok({ data: [{ ...minimalVenue, inBundle: 'yes' }] }));
    await expect(fetchVenues()).rejects.toBeInstanceOf(DecodingError);
  });
});
