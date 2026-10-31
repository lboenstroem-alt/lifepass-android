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
 *      reviews failure skips it there too). Only a load that lands is
 *      counted: iOS runs the load in the page's `.task`, which is cancelled
 *      when the page goes away, so a member who left before it answered
 *      records no view.
 *
 * The favourite heart is not loaded here: it reads the shared favourites
 * store (src/features/favourites), as every heart in the app does.
 *
 * iOS loads in `.task`, which runs again each time the page reappears (back
 * from a booking, the scanner, a plan bought from a refusal), so prices the
 * server works out for the member are read afresh. `refresh()` is that second
 * read; the screen calls it when the member comes back. It keeps the page on
 * screen while it reads instead of iOS's spinner, so the member does not lose
 * their place.
 *
 * The data belongs to one target. When the same screen is given another
 * venue (React Navigation can swap a focused page's params in place), the
 * previous venue's page, reviews and errors are dropped at once: iOS builds
 * a new view model per slug, so one venue's rows never show under another.
 *
 * Only the latest load lands: a retry, a new target or the page closing
 * cancels a read still on its way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { RequestOptions } from '../../api/client';
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

/** One string per target, so a change of venue is seen even when the params object is new. */
export function venueTargetKey(target: VenueTarget): string {
  return 'slug' in target ? `slug:${target.slug}` : `id:${target.venueId}`;
}

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

/** One load of the page (steps 1 and 2 of the file comment), outside React. */
export async function loadVenueDetail(
  target: VenueTarget,
  options: Pick<RequestOptions, 'signal'> = {},
): Promise<VenueLoadResult> {
  let venue: Venue;
  try {
    let slug: string | null = 'slug' in target ? target.slug : null;
    if (slug === null && 'venueId' in target) slug = await resolveVenueSlug(target.venueId, options);
    if (slug === null) return { kind: 'failed', error: t('venue.could_not_load') };
    venue = await fetchVenueBySlug(slug, options);
  } catch (error) {
    return { kind: 'failed', error: errorMessage(error) };
  }

  const [preview, reviews] = await Promise.allSettled([
    fetchWalkInPreview(venue.id, null, options),
    loadVenueReviews(venue.id, options),
  ]);
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
  return { kind: 'loaded', venue, walkInPreview, slotActivities, reviews: reviews.value, error: null };
}

/** Step 3: a load that answered whole (its reviews too) is a view of the page. */
export function isCountedView(result: VenueLoadResult): result is Extract<VenueLoadResult, { kind: 'loaded' }> {
  return result.kind === 'loaded' && result.error === null;
}

const INITIAL: VenueDetailData = {
  venue: null,
  walkInPreview: null,
  slotActivities: [],
  reviews: [],
  isLoading: true,
  error: null,
};

/** The page's data and the target it was loaded for (null before the first load). */
interface HeldData extends VenueDetailData {
  readonly key: string | null;
}

/** A load's answer over what the page holds for the same target. */
function landed(current: HeldData, result: VenueLoadResult): HeldData {
  // A failed re-read keeps the page and says why ("Heads up"), as iOS's
  // `load` leaves `venue` set; a first read that fails holds no venue, so it
  // is the failed state.
  if (result.kind === 'failed') return { ...current, isLoading: false, error: result.error };
  const sameVenue = current.venue?.id === result.venue.id;
  return {
    key: current.key,
    venue: result.venue,
    walkInPreview: result.walkInPreview,
    slotActivities: result.slotActivities,
    // Failed reviews keep what this venue showed; never another venue's.
    reviews: result.reviews ?? (sameVenue ? current.reviews : []),
    isLoading: false,
    error: result.error,
  };
}

export interface VenueDetailModel extends VenueDetailData {
  /** Loads the page again, with the spinner (the failed state's "Try again"). */
  load(): void;
  /**
   * Reads the page again because the member came back to it (iOS `.task` on
   * reappear). The page stays on screen while it reads; with no page yet it
   * is an ordinary load. Nothing happens while a load is already on its way.
   */
  refresh(): void;
  /** Reads the reviews again (after the member may have written one); a failure keeps the old ones. */
  reloadReviews(): void;
  /** The "Heads up" alert was dismissed. */
  clearError(): void;
}

/** The page's data for `target`, loaded on mount and whenever the target changes. */
export function useVenueDetail(target: VenueTarget): VenueDetailModel {
  const key = venueTargetKey(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  const [held, setHeld] = useState<HeldData>({ ...INITIAL, key: null });
  const generation = useRef(0);
  /** The read on its way, cancelled when another load, a new target or closing supersedes it. */
  const inflight = useRef<AbortController | null>(null);

  // Between a change of target and its load starting, the previous venue's
  // data is never handed out (not even for one frame).
  const state: HeldData = held.key === key ? held : { ...INITIAL, key };
  const venueId = state.venue?.id ?? null;

  const run = useCallback(
    (quiet: boolean) => {
      const mine = ++generation.current;
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setHeld((current) => {
        if (current.key !== key) return { ...INITIAL, key };
        if (quiet && current.venue !== null) return { ...current, error: null };
        return { ...current, isLoading: true, error: null };
      });
      void loadVenueDetail(targetRef.current, { signal: controller.signal }).then((result) => {
        if (generation.current !== mine) return;
        inflight.current = null;
        if (isCountedView(result)) {
          track('venue_detail_viewed', { venue_id: result.venue.id, venue_name: result.venue.name });
        }
        setHeld((current) => (current.key === key ? landed(current, result) : current));
      });
    },
    // `key` names the target; the ref holds its current object.
    [key],
  );

  useEffect(() => {
    run(false);
    return () => {
      // Closing the page (or a new target) drops whatever is still loading.
      generation.current += 1;
      inflight.current?.abort();
      inflight.current = null;
    };
  }, [run]);

  const load = useCallback(() => run(false), [run]);

  const refresh = useCallback(() => {
    if (inflight.current !== null) return;
    run(true);
  }, [run]);

  const reloadReviews = useCallback(() => {
    if (venueId === null) return;
    const mine = generation.current;
    loadVenueReviews(venueId).then(
      (reviews) => {
        if (generation.current !== mine) return;
        setHeld((current) => (current.venue?.id === venueId ? { ...current, reviews } : current));
      },
      () => {
        // iOS logs and keeps the reviews it has.
      },
    );
  }, [venueId]);

  const clearError = useCallback(() => setHeld((current) => ({ ...current, error: null })), []);

  return {
    venue: state.venue,
    walkInPreview: state.walkInPreview,
    slotActivities: state.slotActivities,
    reviews: state.reviews,
    isLoading: state.isLoading,
    error: state.error,
    load,
    refresh,
    reloadReviews,
    clearError,
  };
}
