/**
 * Explore's list and its server search (iOS MapViewModel.loadVenues): the
 * 300 ms debounce, a new request cancelling the old, the request it sends,
 * a search ordered within the catalogue, and the sign-out cleaner.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { decodeVenue, venueToApi, type VenueQuery } from '../../../api/venues';
import { registeredHookIds, runSignOutCleaners } from '../../../app/signOut';
import { browseOrder } from '../../../lib/browseOrder';
import { createBrowseSession } from '../../../stores/browseSession';
import type { Venue } from '../../../types/venue';
import { createExploreVenues, exploreVenues, SEARCH_DEBOUNCE_MS } from '../exploreVenues';

stubApiClientPerTest();

function venue(n: number, name: string, extra: Record<string, unknown> = {}): Venue {
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `v${n}`,
    name,
    inBundle: true,
    city: n % 2 === 0 ? 'Reykjavík' : 'Akureyri',
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
  venue(7, 'Sundhöllin'),
  venue(8, 'Mjölnir'),
];

const ids = (list: readonly Venue[]) => list.map((v) => v.id);

/** A fake `GET /venues`: records each call, answers from `answer`. */
function fakeFetch(answer: (query: VenueQuery) => Venue[] = () => catalog) {
  const calls: { query: VenueQuery; signal?: AbortSignal }[] = [];
  const fetch = jest.fn(async (query: VenueQuery, options: { signal?: AbortSignal }) => {
    calls.push({ query, signal: options.signal });
    return answer(query);
  });
  return { fetch, calls };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('the debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('typing quickly sends one request, 300 ms after the last keystroke', async () => {
    const { fetch, calls } = fakeFetch();
    const explore = createExploreVenues({ fetch, session: createBrowseSession({ seed: 1 }) });
    for (const text of ['p', 'po', 'poo', 'pool']) {
      explore.search(text);
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    }
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(1);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toEqual({ search: 'pool', limit: 100 });
  });

  it('loads the catalogue at once with no search, and drops a search still waiting', async () => {
    const { fetch, calls } = fakeFetch();
    const explore = createExploreVenues({ fetch, session: createBrowseSession({ seed: 1 }) });
    explore.search('sauna');
    explore.search(null);
    await flush();
    expect(calls.map((call) => call.query)).toEqual([{ limit: 100 }]);
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('reads a search of only spaces as no search: the catalogue is fetched and refreshed', async () => {
    const { fetch, calls } = fakeFetch();
    const explore = createExploreVenues({ fetch, session: createBrowseSession({ seed: 1 }) });
    explore.search('   ');
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await flush();
    expect(calls.map((call) => call.query)).toEqual([{ limit: 100 }]);
    expect(ids(explore.store.getState().catalog)).toEqual(ids(catalog));
  });
});

describe('cancelling', () => {
  it('a new request aborts the one still out, and only the latest answer lands', async () => {
    const pending: ((venues: Venue[]) => void)[] = [];
    const signals: AbortSignal[] = [];
    const fetch = jest.fn(
      (_query: VenueQuery, options: { signal?: AbortSignal }) =>
        new Promise<Venue[]>((resolve) => {
          signals.push(options.signal!);
          pending.push(resolve);
        }),
    );
    const explore = createExploreVenues({ fetch, session: createBrowseSession({ seed: 1 }) });
    const first = explore.loadNow('yoga');
    const second = explore.loadNow('pool');
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    pending[1]!([catalog[6]!]);
    pending[0]!([catalog[5]!]);
    await Promise.all([first, second]);
    expect(ids(explore.store.getState().fetched)).toEqual([catalog[6]!.id]);
    expect(explore.store.getState().query).toEqual({ search: 'pool' });
  });

  it('reset forgets the list and aborts what is on its way', async () => {
    const signals: AbortSignal[] = [];
    let release: (venues: Venue[]) => void = () => undefined;
    const fetch = jest.fn(
      (_query: VenueQuery, options: { signal?: AbortSignal }) =>
        new Promise<Venue[]>((resolve) => {
          signals.push(options.signal!);
          release = resolve;
        }),
    );
    const explore = createExploreVenues({ fetch, session: createBrowseSession({ seed: 1 }) });
    const load = explore.loadNow(null);
    explore.reset();
    expect(signals[0]!.aborted).toBe(true);
    release(catalog);
    await load;
    expect(explore.store.getState().fetched).toEqual([]);
    expect(explore.store.getState().catalog).toEqual([]);
  });
});

describe('the request', () => {
  it('is GET /venues with limit 100 and q, and the answer becomes the list', async () => {
    api.on('GET', '/venues', (request) =>
      Reply.ok({
        data: (request.query.q ? catalog.slice(0, 2) : catalog).map(venueToApi),
        pagination: { nextCursor: null, hasMore: false, limit: 100 },
      }),
    );
    const explore = createExploreVenues({ session: createBrowseSession({ seed: 1 }) });
    await explore.loadNow(null);
    expect(api.sent('/venues').query).toEqual({ limit: '100' });
    await explore.loadNow('heitur pottur');
    expect(api.sent('/venues').query).toEqual({ limit: '100', q: 'heitur pottur' });
    expect(ids(explore.store.getState().fetched)).toEqual(ids(catalog.slice(0, 2)));
    expect(ids(explore.store.getState().catalog)).toEqual(ids(catalog));
  });
});

describe('the order', () => {
  /**
   * iOS testASearchOrderedWithinTheCatalogKeepsTheCatalogsOrder, through the
   * list Explore reads: a search only removes cards from the browse order.
   */
  it('a search keeps the catalogue order', async () => {
    const searches = [
      catalog.filter((v) => v.name.startsWith('World') || v.name.startsWith('Sky')),
      catalog.filter((v) => v.city !== 'Reykjavík'),
      catalog.filter((v) => v.name.toLowerCase().includes('o')),
    ];
    for (const seed of [1, 7, 42, 2024, 99991]) {
      for (const origin of [null, { latitude: 64.1466, longitude: -21.9426 }]) {
        let results: Venue[] = catalog;
        const session = createBrowseSession({ seed, origin });
        const explore = createExploreVenues({ session, fetch: async () => results });
        await explore.loadNow(null);
        const full = ids(browseOrder(catalog, seed, origin));
        expect(ids(explore.store.getState().ordered())).toEqual(full);
        for (const search of searches) {
          results = [...search].reverse();
          await explore.loadNow('x');
          const shown = ids(explore.store.getState().ordered());
          expect([...shown].sort()).toEqual(ids(search).sort());
          expect(shown).toEqual(full.filter((id) => shown.includes(id)));
        }
      }
    }
  });
});

describe('sign-out', () => {
  it('forgets the Explore list', async () => {
    expect(registeredHookIds().signOut).toContain('explore.venues');
    api.on('GET', '/venues', Reply.ok({ data: catalog.map(venueToApi), pagination: { nextCursor: null, hasMore: false, limit: 100 } }));
    await exploreVenues.loadNow(null);
    expect(exploreVenues.store.getState().fetched).toHaveLength(catalog.length);
    await runSignOutCleaners({ memberId: 'member-a' });
    expect(exploreVenues.store.getState().fetched).toEqual([]);
    expect(exploreVenues.store.getState().catalog).toEqual([]);
  });
});
