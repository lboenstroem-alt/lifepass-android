/**
 * React: one venue's reviews from the shared store (./store.ts).
 *
 *   const { reviews, loaded, status, reload } = useVenueReviews(venue.id);
 *
 * With `autoLoad` (the default) the venue is read once when the hook first
 * sees it and has no rows yet; the venue page, which reads its reviews next
 * to its other calls, can pass `autoLoad: false` and call
 * `loadVenueReviews(id)` itself.
 */
import { useCallback, useEffect } from 'react';
import { useStore } from 'zustand';

import type { VenueReview } from './model';
import { EMPTY_REVIEWS_ENTRY, venueReviewsStore, type VenueReviewsEntry } from './store';

export interface VenueReviewsHook extends VenueReviewsEntry {
  /** Reads the reviews again (a pull to refresh, a retry). */
  reload(): Promise<readonly VenueReview[] | null>;
}

const ignore = () => null;

export function useVenueReviews(
  venueId: string | null | undefined,
  options: { readonly autoLoad?: boolean } = {},
): VenueReviewsHook {
  const id = venueId ? venueId.toLowerCase() : '';
  const autoLoad = options.autoLoad ?? true;
  const entry = useStore(venueReviewsStore, (s) => (id ? s.byVenue[id] : undefined)) ?? EMPTY_REVIEWS_ENTRY;

  useEffect(() => {
    if (id && autoLoad) venueReviewsStore.getState().ensureLoaded(id).catch(ignore);
  }, [id, autoLoad]);

  const reload = useCallback(
    () => (id ? venueReviewsStore.getState().load(id, { force: true }).catch(ignore) : Promise.resolve(null)),
    [id],
  );

  return { ...entry, reload };
}
