/**
 * The legacy venue reads the pre-parity screens still use: built from the API
 * model, so they too get no stock photo and no 0,0 position.
 */
import * as fs from 'fs';
import * as path from 'path';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeVenue } from '../../../api/venues';
import { adaptActivity, fetchVenueById, fetchVenues, toLegacyVenue } from '../venues';
import type { Activity as DbActivity } from '../../types/venue';

const ID = '610ea437-353d-47a7-af83-e31f9c9d501e';

it('a venue without a photo or a position keeps neither', () => {
  const legacy = toLegacyVenue(decodeVenue({ id: ID, slug: 'x', name: 'X' }));
  expect(legacy.imageUrl).toBe('');
  expect(legacy.latitude).toBeNull();
  expect(legacy.longitude).toBeNull();
  expect(JSON.stringify(legacy)).not.toMatch(/picsum/);
  // No inBundle on the wire is premium: the old 'luxury' slot.
  expect(legacy.inBundle).toBe(false);
  expect(legacy.classification).toBe('luxury');
});

it('keeps every field the old screens read', () => {
  const legacy = toLegacyVenue(
    decodeVenue({
      id: ID,
      slug: 'laugar',
      name: 'Laugar',
      city: 'Reykjavík',
      coordinates: { latitude: 64.14, longitude: -21.87 },
      imageUrl: 'https://example.test/laugar.jpg',
      categories: ['Gym', 'Pool'],
      category: 'gym',
      walkInsAllowed: true,
      openingHours: { monday: { open: '06:00', close: '22:00', closed: false } },
      inBundle: true,
      topupPrice: 2650,
    }),
  );
  expect(legacy).toMatchObject({
    id: ID,
    slug: 'laugar',
    city: 'Reykjavík',
    latitude: 64.14,
    longitude: -21.87,
    imageUrl: 'https://example.test/laugar.jpg',
    category: ['Gym', 'Pool'],
    primaryCategory: 'gym',
    classification: 'basic',
    walkInsAllowed: true,
    openingHours: { monday: { open: '06:00', close: '22:00', closed: false } },
    inBundle: true,
    topupPrice: 2650,
    surchargePrice: undefined,
  });
});

it('an activity without a photo gets none, never a stock photo', () => {
  const activity = adaptActivity({
    id: 'a1',
    name: 'Yoga',
    image_url: null,
    image_storage_path: null,
    duration_minutes: null,
  } as DbActivity);
  expect(activity.imageUrl).toBe('');
  expect(activity.durationMinutes).toBe(60);
});

describe('reads', () => {
  stubApiClientPerTest();

  it('lists and finds a venue by id through the API', async () => {
    api.on(
      'GET',
      '/venues',
      Reply.ok({ data: [{ id: ID, slug: 'x', name: 'X', inBundle: true }], pagination: {} }),
    );
    expect((await fetchVenues({ search: 'x' }))[0]).toMatchObject({ id: ID, classification: 'basic' });
    expect(api.sent('/venues').query).toEqual({ limit: '100', q: 'x' });
    expect((await fetchVenueById(ID.toUpperCase())).id).toBe(ID);
    await expect(fetchVenueById('00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });
});

/** A stock photo shown as a venue misrepresents it: none anywhere in the app's code. */
it('no stock photo service is referenced anywhere in the app', () => {
  const root = path.resolve(__dirname, '../../..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && /picsum\.photos/.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
