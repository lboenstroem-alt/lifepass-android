// Explore's own venue list and its server search: the Android port of iOS
// `MapViewModel.loadVenues(search:)` (ViewModels/MapViewModel.swift).
//
// THE LIST. Explore keeps its own list (F6's `createVenueListStore`), as iOS
// gives Explore its own view model, so a search here never changes Home. It
// reads the app's browse session, so both show the same mix around the same
// point. It keeps the last unsearched load as the catalogue, and orders a
// search WITHIN it: searching only removes cards, never reshuffles the rest.
//
// THE SEARCH happens on the server (`GET /venues?limit=100&q=`), which matches
// the name, city and address with accents folded, and what a venue offers
// through English and Icelandic words ("gufubað", "heitur pottur"), word by
// word with the last word allowed to be a prefix. A search is sent 300 ms after
// the last keystroke, so typing "pool" sends one request, not four, and a new
// request cancels the one still on its way (AbortController); only the latest
// answer lands either way (the list store's own rule). A search of nothing but
// spaces is no search: the catalogue is fetched and refreshed. A load with no
// search (opening Explore, Try again on an empty search) is sent at once.
//
// SIGN-OUT. Prices in the list are resolved for the member who asked, so the
// list is forgotten at sign-out (./register.ts), with any search still on its
// way.
import { fetchVenues, type VenueQuery } from '../../api/venues';
import type { BrowseSessionStore } from '../../stores/browseSession';
import { createVenueListStore, type VenueListStore } from '../../stores/venuesStore';
import type { Venue } from '../../types/venue';

/** How long after the last keystroke a search is sent (iOS: 300 ms). */
export const SEARCH_DEBOUNCE_MS = 300;

type FetchVenues = (query: VenueQuery, options: { signal?: AbortSignal }) => Promise<Venue[]>;

export interface ExploreVenuesOptions {
  readonly fetch?: FetchVenues;
  readonly session?: BrowseSessionStore;
  readonly debounceMs?: number;
}

export interface ExploreVenues {
  /** The list (catalogue, last fetch, error, the browse order). */
  readonly store: VenueListStore;
  /**
   * iOS `loadVenues(search:)`: no search (undefined or null) loads the
   * catalogue at once; a search, even an empty one, waits out the debounce.
   * Either way it cancels a search still waiting.
   */
  search(text?: string | null): void;
  /** Loads now, without the debounce (a return to Explore, a retry). */
  loadNow(text?: string | null): Promise<void>;
  /** A search still waiting out its debounce is dropped. */
  cancelPending(): void;
  /** Forgets the list and anything on its way (sign-out). */
  reset(): void;
}

export function createExploreVenues(options: ExploreVenuesOptions = {}): ExploreVenues {
  const fetch: FetchVenues = options.fetch ?? ((query, callOptions) => fetchVenues(query, callOptions));
  const debounceMs = options.debounceMs ?? SEARCH_DEBOUNCE_MS;
  let inFlight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const store = createVenueListStore({
    session: options.session,
    fetch: (query) => {
      // A new request cancels the one still out: its answer would be dropped
      // anyway (the store keeps only the latest), so it need not finish.
      inFlight?.abort();
      const mine = new AbortController();
      inFlight = mine;
      return fetch(query, { signal: mine.signal }).finally(() => {
        if (inFlight === mine) inFlight = null;
      });
    },
  });

  const cancelPending = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const loadNow = (text?: string | null) => {
    cancelPending();
    return store.getState().load(text ? { search: text } : {});
  };

  return {
    store,
    search(text) {
      cancelPending();
      if (text === undefined || text === null) {
        void store.getState().load({});
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void store.getState().load({ search: text });
      }, debounceMs);
    },
    loadNow,
    cancelPending,
    reset() {
      cancelPending();
      inFlight?.abort();
      inFlight = null;
      store.getState().reset();
    },
  };
}

/** The Explore tab's list. */
export const exploreVenues: ExploreVenues = createExploreVenues();
