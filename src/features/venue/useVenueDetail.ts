/**
 * Loading the venue page: the Android port of iOS `VenueDetailViewModel`
 * (ViewModels/VenueDetailViewModel.swift).
 *
 *   1. `GET /venues/by-slug/{slug}`: the venue. The API has no get-by-id, so
 *      the page is addressed by slug (a first-build caller's id is looked up
 *      first, ./resolveSlug.ts). A failure here is the page's failed state.
 *   2. Then, side by side, keyed by the venue's UUID:
 *      - `GET /check-ins/walk-in/preview?venueId=`: the bookable classes
 *        (`slotActivities`, already filtered to slot-bookable providers by
 *        the decoder). BEST EFFORT: a venue whose preview fails still
 *        renders, with no class list;
 *      - `GET /venues/{venueId}/reviews`: the inline reviews. A failure here
 *        keeps the page and raises the "Heads up" alert with the reason,
 *        as iOS's `try await reviewsTask` does.
 *   3. `venue_detail_viewed {venue_id, venue_name}`, after the reviews have
 *      answered (iOS tracks it at the end of the same `do` block, so a
 *      reviews failure skips it there too).
 *
 * The favourite heart is not loaded here: it reads the shared favourites
 * store (src/features/favourites), as every heart in the app does.
 *
 * Only the latest load lands: a retry, or the page closing, drops an answer
 * still on its way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '../../api/errorFormatter';
import { fetchVenueBySlug } from '../../api/venues';
import { fetchWalkInPreview, isSlotBookable, type BookableActivity, type WalkInPreview } from '../../api/walkInPreview';
import { t } from '../../i18n';
import { track } from '../../lib/analytics';
import type { Venue } from '../../types/venue';
import { loadVenueReviews, type VenueReviewItem } from './reviewsSource';
import { resolveVenueSlug } from './resolveSlug';

/** Which venue: by slug, or (first-build callers only) by id. */
export type VenueTarget = { readonly slug: string } | { readonly venueId: string };

export interface VenueDetailData {
  readonly venue: Venue | null;
  /** Null until loaded, or when the preview failed. */
  readonly walkInPreview: WalkInPreview | null;
  /** The bookable classes (the preview's slot-bookable `slotActivities`); empty without a preview. */
  readonly slotActivities: readonly BookableActivity[];
  readonly reviews: readonly VenueReviewItem[];
  readonly isLoading: boolean;
  /**
   * In the language on screen when it failed. With no venue it is the failed
   * state's message; with a venue it is the "Heads up" alert's.
   */
  readonly error: string | null;
}

export type VenueLoadResult =
  | { readonly kind: 'failed'; readonly error: string }
  | {
      readonly kind: 'loaded';
      readonly venue: Venue;
      readonly walkInPreview: WalkInPreview | null;
      readonly slotActivities: readonly BookableActivity[];
      /** Null when the reviews read failed: the page keeps what it had. */
      readonly reviews: readonly VenueReviewItem[] | null;
      readonly error: string | null;
    };

/** One load of the page (steps 1 to 3 of the file comment), outside React. */
export async function loadVenueDetail(target: VenueTarget): Promise<VenueLoadResult> {
  let venue: Venue;
  try {
    let slug: string | null = 'slug' in target ? target.slug : null;
    if (slug === null && 'venueId' in target) slug = await resolveVenueSlug(target.venueId);
    if (slug === null) return { kind: 'failed', error: t('venue.could_not_load') };
    venue = await fetchVenueBySlug(slug);
  } catch (error) {
    return { kind: 'failed', error: errorMessage(error) };
  }

  const [preview, reviews] = await Promise.allSettled([fetchWalkInPreview(venue.id), loadVenueReviews(venue.id)]);
  const walkInPreview = preview.status === 'fulfilled' ? preview.value : null;
  const slotActivities = walkInPreview ? walkInPreview.slotActivities.filter((a) => isSlotBookable(a.provider)) : [];

  if (reviews.status === 'rejected') {
    return {
      kind: 'loaded',
      venue,
      walkInPreview,
      slotActivities,
      reviews: null,
      error: errorMessage(reviews.reason),
    };
  }
  track('venue_detail_viewed', { venue_id: venue.id, venue_name: venue.name });
  return { kind: 'loaded', venue, walkInPreview, slotActivities, reviews: reviews.value, error: null };
}

const INITIAL: VenueDetailData = {
  venue: null,
  walkInPreview: null,
  slotActivities: [],
  reviews: [],
  isLoading: true,
  error: null,
};

export interface VenueDetailModel extends VenueDetailData {
  /** Loads the page again (the failed state's "Try again"). */
  load(): void;
  /** Reads the reviews again (after the member may have written one); a failure keeps the old ones. */
  reloadReviews(): void;
  /** The "Heads up" alert was dismissed. */
  clearError(): void;
}

/** The page's data for `target`, loaded on mount and whenever the target changes. */
export function useVenueDetail(target: VenueTarget): VenueDetailModel {
  const key = 'slug' in target ? `slug:${target.slug}` : `id:${target.venueId}`;
  const targetRef = useRef(target);
  targetRef.current = target;

  const [state, setState] = useState<VenueDetailData>(INITIAL);
  const generation = useRef(0);
  const venueId = state.venue?.id ?? null;

  const load = useCallback(() => {
    const mine = ++generation.current;
    setState((current) => ({ ...current, isLoading: true, error: null }));
    void loadVenueDetail(targetRef.current).then((result) => {
      if (generation.current !== mine) return;
      setState((current) =>
        result.kind === 'failed'
          ? { ...current, isLoading: false, error: result.error }
          : {
              venue: result.venue,
              walkInPreview: result.walkInPreview,
              slotActivities: result.slotActivities,
              reviews: result.reviews ?? current.reviews,
              isLoading: false,
              error: result.error,
            },
      );
    });
    // `key` names the target; the ref holds its current object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
    return () => {
      // Closing the page (or a new target) drops whatever is still loading.
      generation.current += 1;
    };
  }, [load]);

  const reloadReviews = useCallback(() => {
    if (venueId === null) return;
    const mine = generation.current;
    loadVenueReviews(venueId).then(
      (reviews) => {
        if (generation.current === mine) setState((current) => ({ ...current, reviews }));
      },
      () => {
        // iOS logs and keeps the reviews it has.
      },
    );
  }, [venueId]);

  const clearError = useCallback(() => setState((current) => ({ ...current, error: null })), []);

  return { ...state, load, reloadReviews, clearError };
}
