/**
 * A venue's reviews, shared by the venue page's inline block, the reviews
 * page and the write sheet. iOS keeps them on the venue page's view model and
 * hands the same array to the reviews sheet; after a review is posted it
 * reloads them, and the block and the sheet both show the new list. Here the
 * venue page (VENUE-1) and the reviews page are separate routes, so they meet
 * in this store, keyed by venue id: the venue page reads its reviews through
 * `loadVenueReviews` (every load, every return), and the reviews page opens
 * on those rows without reading again.
 *
 * Only the latest read of a venue lands; a reload keeps the rows on screen
 * until it answers (iOS `reloadReviews` swaps the array when it has one, and
 * keeps the old one when the reload fails).
 *
 * SIGN-OUT: `reset()` (registered in src/features/favourites/register.ts).
 * The rows are public, but each read also names the member's own review.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import { errorMessage, TransportError } from '../../../api';
import { fetchVenueReviews, type VenueReviewsPage } from './api';
import type { ServerReviewSummary, VenueReview } from './model';

export type VenueReviewsStatus = 'loading' | 'loaded' | 'failed';

export interface VenueReviewsEntry {
  readonly status: VenueReviewsStatus;
  /** The loaded rows; empty until the first read lands. */
  readonly reviews: readonly VenueReview[];
  /** True once a read of this venue has landed. */
  readonly loaded: boolean;
  readonly ownReviewId: string | null;
  /**
   * The server's summary of every rating (API 0.46.0), or null (an older
   * server, or one that did not read): what the reviews page's summary shows.
   */
  readonly summary: ServerReviewSummary | null;
  /** The last read's failure in the language on screen, or null. */
  readonly error: string | null;
  /** When the rows on screen were read (ms since the epoch), or null before the first read lands. */
  readonly readAt: number | null;
}

export interface EnsureLoadedOptions {
  /**
   * Rows read longer ago than this are read again, behind the rows already
   * on screen (the reviews page; see VenueReviewsScreen). Without it, rows
   * read once are kept for the session.
   */
  readonly maxAgeMs?: number;
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
  /**
   * Reads if this venue has never been read, its last read failed, or (with
   * `maxAgeMs`) its rows are older than that. Joins a read on its way.
   */
  ensureLoaded(venueId: string, options?: EnsureLoadedOptions): Promise<readonly VenueReview[]>;
  reset(): void;
}

export type VenueReviewsStore = StoreApi<VenueReviewsStoreState>;

export interface VenueReviewsStoreOptions {
  readonly fetch?: (venueId: string) => Promise<VenueReviewsPage>;
  /** The clock (tests). */
  readonly now?: () => number;
}

const key = (id: string) => id.toLowerCase();

export const EMPTY_REVIEWS_ENTRY: VenueReviewsEntry = Object.freeze({
  status: 'loading',
  reviews: [],
  loaded: false,
  ownReviewId: null,
  summary: null,
  error: null,
  readAt: null,
});

export function createVenueReviewsStore(options: VenueReviewsStoreOptions = {}): VenueReviewsStore {
  const fetch = options.fetch ?? ((venueId: string) => fetchVenueReviews(venueId));
  const now = options.now ?? Date.now;
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
          patch(id, {
            status: 'loaded',
            loaded: true,
            reviews: page.reviews,
            ownReviewId: page.ownReviewId,
            summary: page.summary,
            error: null,
            readAt: now(),
          });
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

      ensureLoaded(venueId, ensureOptions) {
        const id = key(venueId);
        const entry = get().byVenue[id];
        const joined = pending[id];
        if (joined) return joined;
        const maxAge = ensureOptions?.maxAgeMs;
        const fresh =
          entry?.status === 'loaded' && (maxAge === undefined || (entry.readAt !== null && now() - entry.readAt <= maxAge));
        if (entry && fresh) return Promise.resolve(entry.reviews);
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

export interface LoadVenueReviewsOptions {
  /** Read again even when a read of this venue is on its way (a review was just posted). */
  readonly force?: boolean;
  /**
   * Stops THIS caller waiting: the promise rejects as the API client rejects
   * an aborted call (`TransportError('cancelled')`, so `isCancellation` holds).
   * The shared read itself runs on, since the reviews page may be waiting too.
   */
  readonly signal?: AbortSignal;
}

const cancelled = () => new TransportError('cancelled');

/**
 * For the venue page: `GET /venues/{venueId}/reviews` into the shared store,
 * read next to its other calls (a rejection is its own), newest first. It is
 * a drop-in for the page's own reader (same call, rows with the same fields),
 * so the page's block and the reviews page show one list.
 */
export function loadVenueReviews(venueId: string, options: LoadVenueReviewsOptions = {}): Promise<VenueReview[]> {
  const { signal, force } = options;
  if (signal?.aborted) return Promise.reject(cancelled());
  const read = venueReviewsStore
    .getState()
    .load(venueId, { force })
    .then((rows) => [...rows]);
  if (!signal) return read;
  return new Promise<VenueReview[]>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    read.then(
      (rows) => {
        signal.removeEventListener('abort', onAbort);
        resolve(rows);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
