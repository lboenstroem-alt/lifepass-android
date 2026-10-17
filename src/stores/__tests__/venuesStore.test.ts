/**
 * The venue list store (iOS VenueListViewModel): VenueLoadErrorTests, the
 * catalogue a search is ordered within, the latest load winning, sign-out,
 * and the hook that re-orders when the visit changes.
 */
import { act, renderHook } from '@testing-library/react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { decodeVenue, venueToApi } from '../../api/venues';
import { setCurrentLanguage } from '../../i18n';
import { browseOrder, browseOrderWithin } from '../../lib/browseOrder';
import type { Venue } from '../../types/venue';
import { createBrowseSession } from '../browseSession';
import { createVenueListStore, isFilteredQuery, useOrderedVenues, venuesStore, resetVenuesStore } from '../venuesStore';

stubApiClientPerTest();

function venue(n: number, name: string, extra: Record<string, unknown> = {}): Venue {
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `v${n}`,
    name,
    inBundle: true,
    coordinates: { latitude: 64.1 + n / 100, longitude: -21.9 },
    ...extra,
  });
}

const catalog = [
  venue(1, 'World Class Laugar'),
  venue(2, 'World Class Kringlan'),
  venue(3, 'Sky Lagoon'),
  venue(4, 'Hressó'),
  venue(5, 'Box800', { awaitingConnection: true }),
  venue(6, 'Reykjavik Yoga'),
];

const page = (venues: readonly Venue[]) =>
  Reply.ok({ data: venues.map(venueToApi), pagination: { nextCursor: null, hasMore: false, limit: 100 } });

const ids = (list: readonly Venue[]) => list.map((v) => v.id);

/**
 * A venue list that failed to load says so, in the account's language, and a
 * retry that works clears it (before 2.5.0 a failed load looked like LifePass
 * had no venues).
 */
it('a failed load leaves a localised error and a retry clears it', async () => {
  setCurrentLanguage('is');
  const list = createVenueListStore({ session: createBrowseSession({ seed: 1 }) });

  api.on('GET', '/venues', Reply.raw(502, '<html>Bad gateway</html>'));
  await list.getState().load();
  expect(list.getState().ordered()).toEqual([]);
  expect(list.getState().error).toBe('Þjónninn svaraði á óvæntan hátt (HTTP 502).');
  expect(list.getState().isLoading).toBe(false);

  api.on('GET', '/venues', Reply.ok({ data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
  await list.getState().load();
  expect(list.getState().error).toBeNull();
});

it('a failed reload keeps the venues already on screen', async () => {
  const list = createVenueListStore({ session: createBrowseSession({ seed: 1 }) });
  api.on('GET', '/venues', page(catalog));
  await list.getState().load();
  api.on('GET', '/venues', Reply.fail());
  await list.getState().load();
  expect(list.getState().fetched).toHaveLength(catalog.length);
  expect(list.getState().error).not.toBeNull();
});

it('a search is ordered within the catalogue, which it never replaces', async () => {
  const session = createBrowseSession({ seed: 42 });
  const list = createVenueListStore({ session });
  api.on('GET', '/venues', (request) =>
    page(request.query.q ? catalog.filter((v) => v.name.startsWith('World') || v.name.startsWith('Sky')) : catalog),
  );
  await list.getState().load();
  expect(list.getState().catalog).toHaveLength(catalog.length);

  await list.getState().load({ search: 'world' });
  expect(api.sent('/venues').query).toEqual({ limit: '100', q: 'world' });
  expect(list.getState().catalog).toHaveLength(catalog.length); // still the unsearched list
  expect(list.getState().fetched).toHaveLength(3);
  const full = ids(browseOrder(catalog, 42, null));
  const shown = ids(list.getState().ordered());
  expect(shown).toEqual(full.filter((id) => shown.includes(id)));
  expect(list.getState().query).toEqual({ search: 'world' });
});

it('a category or a city narrows the list as a search does', () => {
  expect(isFilteredQuery({})).toBe(false);
  expect(isFilteredQuery({ search: '' })).toBe(false);
  expect(isFilteredQuery({ search: 'x' })).toBe(true);
  expect(isFilteredQuery({ category: 'Gym' })).toBe(true);
  expect(isFilteredQuery({ city: 'Akureyri' })).toBe(true);
});

/** Typing fast: an older answer arriving after a newer one never lands. */
it('only the latest load lands', async () => {
  const list = createVenueListStore({ session: createBrowseSession({ seed: 1 }) });
  api.on('GET', '/venues', (request) =>
    request.query.q === 'slow' ? Reply.delayed(50, page(catalog)) : page([catalog[2]]),
  );
  const slow = list.getState().load({ search: 'slow' });
  await list.getState().load({ search: 'fast' });
  expect(list.getState().isLoading).toBe(false);
  await slow;
  expect(ids(list.getState().fetched)).toEqual([catalog[2].id]);
  expect(list.getState().query).toEqual({ search: 'fast' });
});

it('the order is kept until the fetch or the visit changes', async () => {
  const session = createBrowseSession({ seed: 9 });
  const list = createVenueListStore({ session });
  api.on('GET', '/venues', page(catalog));
  await list.getState().load();
  const first = list.getState().ordered();
  expect(list.getState().ordered()).toBe(first); // memoised

  session.getState().locationDidChange({ latitude: 64.16, longitude: -21.9 });
  const banded = list.getState().ordered();
  expect(banded).not.toBe(first);
  expect(ids(banded)).toEqual(ids(browseOrderWithin(catalog, catalog, 9, session.getState().origin)));
});

/** The next member must never see the last member's resolved prices. */
it('sign-out forgets the list, and an answer still on the way', async () => {
  api.on('GET', '/venues', Reply.delayed(30, page(catalog)));
  const loading = venuesStore.getState().load();
  resetVenuesStore();
  await loading;
  expect(venuesStore.getState()).toMatchObject({ catalog: [], fetched: [], error: null, isLoading: false });
  expect(venuesStore.getState().ordered()).toEqual([]);
});

it('the hook re-orders when the first fix arrives, without a reload', async () => {
  const session = createBrowseSession({ seed: 99 });
  const list = createVenueListStore({ session });
  api.on('GET', '/venues', page(catalog));
  await list.getState().load();

  const { result } = await renderHook(() => useOrderedVenues(list));
  expect(ids(result.current)).toEqual(ids(browseOrder(catalog, 99, null)));
  const requests = api.requests.length;

  await act(async () => session.getState().locationDidChange({ latitude: 64.15, longitude: -21.9 }));
  expect(ids(result.current)).toEqual(ids(browseOrder(catalog, 99, session.getState().origin)));
  expect(api.requests.length).toBe(requests); // no reload
});
