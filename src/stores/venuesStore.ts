// A venue list: the Android port of iOS `VenueListViewModel`
// (ViewModels/VenueListViewModel.swift).
//
// It keeps the last fetch in the SERVER's order and the last unsearched,
// unfiltered fetch (the catalogue), and hands the venues out in the browse
// order (src/lib/browseOrder.ts) when READ, not when loaded:
//   - on a cold launch the first fix usually lands after the first load, and
//     the list takes it up at once, without a reload;
//   - a reload in the same visit gives the same order, so a pull to refresh
//     never reshuffles it;
//   - a search or filter is ordered WITHIN the catalogue, so narrowing a list
//     only removes cards and never reorders the ones it keeps.
// The order is memoised on (`fetchGeneration`, the browse session's
// `revision`), so a screen can read it as often as it likes.
//
// `venuesStore` is the app's shared list (Home, and anything that needs the
// catalogue). A screen with its own search (Explore) makes its own with
// `createVenueListStore()`, as iOS gives Explore its own view model, so a
// search there never changes Home; both read the same browse session.
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { errorMessage } from '../api/errorFormatter';
import { fetchVenues, type VenueQuery } from '../api/venues';
import { browseOrderWithin } from '../lib/browseOrder';
import type { Venue } from '../types/venue';
import { browseSession, type BrowseSessionStore } from './browseSession';

export interface VenueListState {
  /** The last unsearched, unfiltered fetch: what a search is ordered within. */
  readonly catalog: readonly Venue[];
  /** The last fetch, in the server's order. */
  readonly fetched: readonly Venue[];
  /** Bumps with every fetch that lands (and on reset): what the order is keyed on. */
  readonly fetchGeneration: number;
  readonly isLoading: boolean;
  /**
   * The last load's failure in the language on screen, or null. Home and
   * Explore show it as an error state with a retry when nothing else is on
   * screen; a load that works clears it.
   */
  readonly error: string | null;
  /** The filters of the last load that landed. */
  readonly query: VenueQuery;
  /** The browse session this list is ordered by. */
  readonly session: BrowseSessionStore;

  /**
   * Fetches `GET /venues` with `query` (none = the catalogue). Only the
   * latest load lands: an older answer arriving late is dropped.
   */
  load(query?: VenueQuery): Promise<void>;
  /** The loaded venues in the browse order (see the file comment). */
  ordered(): Venue[];
  /** Forgets everything (sign-out): the next member's prices are their own. */
  reset(): void;
}

export interface VenueListOptions {
  readonly fetch?: (query: VenueQuery) => Promise<Venue[]>;
  readonly session?: BrowseSessionStore;
}

export type VenueListStore = StoreApi<VenueListState>;

/** True when a query narrows the list (a search, a category or a city). */
export function isFilteredQuery(query: VenueQuery): boolean {
  return !!query.search || !!query.category || !!query.city;
}

export function createVenueListStore(options: VenueListOptions = {}): VenueListStore {
  const fetch = options.fetch ?? ((query: VenueQuery) => fetchVenues(query));
  const session = options.session ?? browseSession;
  let latest = 0;
  let memo: { fetch: number; revision: number; session: BrowseSessionStore; venues: Venue[] } | null = null;

  return createStore<VenueListState>()((set, get) => ({
    catalog: [],
    fetched: [],
    fetchGeneration: 0,
    isLoading: false,
    error: null,
    query: {},
    session,

    async load(query = {}) {
      const mine = ++latest;
      set({ isLoading: true });
      try {
        const rows = await fetch(query);
        if (mine !== latest) return;
        set({
          ...(isFilteredQuery(query) ? {} : { catalog: rows }),
          fetched: rows,
          fetchGeneration: get().fetchGeneration + 1,
          query,
          error: null,
          isLoading: false,
        });
      } catch (error) {
        if (mine !== latest) return;
        set({ error: errorMessage(error), isLoading: false });
      }
    },

    ordered() {
      const { fetched, catalog, fetchGeneration } = get();
      const { seed, origin, revision } = session.getState();
      if (memo && memo.fetch === fetchGeneration && memo.revision === revision && memo.session === session) {
        return memo.venues;
      }
      const venues = browseOrderWithin(fetched, catalog, seed, origin);
      memo = { fetch: fetchGeneration, revision, session, venues };
      return venues;
    },

    reset() {
      latest += 1;
      memo = null;
      set({
        catalog: [],
        fetched: [],
        fetchGeneration: get().fetchGeneration + 1,
        isLoading: false,
        error: null,
        query: {},
      });
    },
  }));
}

/** The app's shared venue list. */
export const venuesStore: VenueListStore = createVenueListStore();

/** Sign-out cleaner: venue prices are resolved for the member who asked. */
export function resetVenuesStore(): void {
  venuesStore.getState().reset();
}

/** React: a slice of the shared list (or of `store`). */
export function useVenueList<T>(selector: (state: VenueListState) => T, store: VenueListStore = venuesStore): T {
  return useStore(store, selector);
}

/**
 * React: the list's venues in the browse order. Re-renders when a fetch lands
 * or the visit changes (a new seed, the first fix, a real move).
 */
export function useOrderedVenues(store: VenueListStore = venuesStore): Venue[] {
  const generation = useStore(store, (state) => state.fetchGeneration);
  const session = useStore(store, (state) => state.session);
  const revision = useStore(session, (state) => state.revision);
  // `generation` and `revision` are what `ordered()` is keyed on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => store.getState().ordered(), [store, generation, revision]);
}
