/**
 * A venue's reviews, shared by the venue page's inline block, the reviews
 * page and the write sheet. iOS keeps them on the venue page's view model and
 * hands the same array to the reviews sheet; after a review is posted it
 * reloads them, and the block and the sheet both show the new list. Here the
 * venue page (VENUE-1) and the reviews page are separate routes, so they meet
 * in this store, keyed by venue id.
 *
 * Only the latest read of a venue lands; a reload keeps the rows on screen
 * until it answers (iOS `reloadReviews` swaps the array when it has one, and
 * keeps the old one when the reload fails).
 *
 * SIGN-OUT: `reset()` (registered in src/features/favourites/register.ts).
 * The rows are public, but each read also names the member's own review.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import { errorMessage } from '../../../api';
import { fetchVenueReviews, type VenueReviewsPage } from './api';
import type { VenueReview } from './model';

export type VenueReviewsStatus = 'loading' | 'loaded' | 'failed';

export interface VenueReviewsEntry {
  readonly status: VenueReviewsStatus;
  /** The loaded rows; empty until the first read lands. */
  readonly reviews: readonly VenueReview[];
  /** True once a read of this venue has landed. */
  readonly loaded: boolean;
  readonly ownReviewId: string | null;
  /** The last read's failure in the language on screen, or null. */
  readonly error: string | null;
}

export interface VenueReviewsStoreState {
  readonly byVenue: Readonly<Record<string, VenueReviewsEntry>>;
  /**
   * Reads a venue's reviews. Joins a read of the same venue already on its
   * way unless `force` (a review was just posted). Resolves with the rows;
   * rejects with the API error when the read fails (the venue page reads it
   * next to its other calls with `Promise.allSettled`).
   */
  load(venueId: string, options?: { readonly force?: boolean }): Promise<readonly VenueReview[]>;
  /** Reads once if this venue has never been read (or its last read failed). */
  ensureLoaded(venueId: string): Promise<readonly VenueReview[]>;
  reset(): void;
}

export type VenueReviewsStore = StoreApi<VenueReviewsStoreState>;

export interface VenueReviewsStoreOptions {
  readonly fetch?: (venueId: string) => Promise<VenueReviewsPage>;
}

const key = (id: string) => id.toLowerCase();

export const EMPTY_REVIEWS_ENTRY: VenueReviewsEntry = Object.freeze({
  status: 'loading',
  reviews: [],
  loaded: false,
  ownReviewId: null,
  error: null,
});

export function createVenueReviewsStore(options: VenueReviewsStoreOptions = {}): VenueReviewsStore {
  const fetch = options.fetch ?? ((venueId: string) => fetchVenueReviews(venueId));
  let generation = 0;
  const latest: Record<string, number> = {};
  const pending: Partial<Record<string, Promise<readonly VenueReview[]>>> = {};

  return createStore<VenueReviewsStoreState>()((set, get) => {
    const patch = (id: string, next: Partial<VenueReviewsEntry>) => {
      const current = get().byVenue[id] ?? EMPTY_REVIEWS_ENTRY;
      set({ byVenue: { ...get().byVenue, [id]: { ...current, ...next } } });
    };

    const read = async (id: string): Promise<readonly VenueReview[]> => {
      const mine = (latest[id] = (latest[id] ?? 0) + 1);
      const gen = generation;
      patch(id, { status: 'loading' });
      try {
        const page = await fetch(id);
        if (gen === generation && mine === latest[id]) {
          patch(id, { status: 'loaded', loaded: true, reviews: page.reviews, ownReviewId: page.ownReviewId, error: null });
        }
        return page.reviews;
      } catch (error) {
        if (gen === generation && mine === latest[id]) patch(id, { status: 'failed', error: errorMessage(error) });
        throw error;
      }
    };

    return {
      byVenue: {},

      load(venueId, loadOptions) {
        const id = key(venueId);
        const joined = pending[id];
        if (joined && !loadOptions?.force) return joined;
        const promise = read(id).finally(() => {
          if (pending[id] === promise) delete pending[id];
        });
        pending[id] = promise;
        return promise;
      },

      ensureLoaded(venueId) {
        const id = key(venueId);
        const entry = get().byVenue[id];
        const joined = pending[id];
        if (joined) return joined;
        if (entry && entry.status === 'loaded') return Promise.resolve(entry.reviews);
        return get().load(id);
      },

      reset() {
        generation += 1;
        for (const id of Object.keys(pending)) delete pending[id];
        set({ byVenue: {} });
      },
    };
  });
}

/** The app's shared reviews. */
export const venueReviewsStore: VenueReviewsStore = createVenueReviewsStore();

/** Sign-out: forget every venue's reviews and drop answers still on their way. */
export function resetVenueReviews(): void {
  venueReviewsStore.getState().reset();
}

/** For the venue page: the reviews, read next to its other calls (a rejection is its own). */
export function loadVenueReviews(venueId: string, options?: { readonly force?: boolean }): Promise<readonly VenueReview[]> {
  return venueReviewsStore.getState().load(venueId, options);
}
