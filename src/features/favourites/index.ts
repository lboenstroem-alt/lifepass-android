// The saved-venues contract (plan 3.0.3), filled by VENUE-2.
//
// Used by VENUE-1 (the heart on the venue page), HOME-1, LIB-1 (Saved) and
// COACH-1. Every hook reads ONE store (./store.ts), so every heart on every
// screen agrees and a tap shows at once:
//
//   const heart = useFavourite(venue.id);                    // a Coach card, a row
//   const heart = useFavourite(venue.id, { refresh: true }); // the venue page
//   <Heart filled={heart.isFavourite} onPress={() => heart.toggle()} />
//
//   const saved = useFavourites();          // Saved, the Coach
//   useFocusEffect(useCallback(() => saved.refresh(), [saved.refresh]));
//   saved.venues / saved.activities / saved.venueIds
//
// What iOS does, and so what these do:
//   - The heart is optimistic, ignores a second tap while its request is in
//     flight, and on a failure flips back and raises the "Heads up" alert
//     (`venue.err.favourite`). Where iOS reverts SILENTLY (the Coach's venue
//     cards, the Saved suggestions' heart), pass `{ alert: false }`.
//   - `useFavourite` reads `GET /favourites` once, if nothing has been read
//     yet: every heart reads the one store, which every tap keeps right. The
//     venue page passes `{ refresh: true }`, which reads the list again each
//     time the page mounts, as iOS VenueDetailViewModel.load does (there is
//     no per-venue probe). iOS's Coach cards never read it at all (CoachView:
//     `isFavourited` starts false); here they show the store, so a lazy
//     carousel costs no read once anything has loaded the list. Reads on
//     their way are always joined.
//   - `useFavourites` reads once if nothing has been read; a screen that iOS
//     reloads on every appearance (Saved) calls `refresh()` on focus.
//   - A failed read just means "not saved" (iOS VenueDetailViewModel).
import { useCallback, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import {
  favouritesStore,
  type FavouriteToggleOptions,
  type FavouriteToggleResult,
} from './store';
import type { FavouriteActivity, FavouriteVenue } from './api';

export {
  isPremiumFavourite,
  type FavouriteActivity,
  type FavouriteVenue,
  type FavouritesPayload,
} from './api';
export {
  createFavouritesStore,
  favouritesStore,
  showFavouriteAlert,
  type FavouriteToggleOptions,
  type FavouriteToggleResult,
  type FavouritesStatus,
  type FavouritesStore,
  type FavouritesStoreState,
} from './store';

export interface FavouritesState {
  /** The saved venues' ids, the member's unconfirmed taps included. */
  readonly venueIds: readonly string[];
  /** The saved venues' rows (Saved, the Coach), less any just unsaved. */
  readonly venues: readonly FavouriteVenue[];
  /** The saved classes (the Saved sheet's "Saved classes"). */
  readonly activities: readonly FavouriteActivity[];
  /** True until the first read has answered. */
  readonly loading: boolean;
  /** The last read failed (a failed toggle raises its own alert). */
  readonly failed: boolean;
  /** The last read's failure in the language on screen, or null. */
  readonly error: string | null;
  isFavourite(venueId: string): boolean;
  /** True while this venue's save or unsave is in flight (a spinner, if the surface shows one). */
  isToggling(venueId: string): boolean;
  /** Saves or unsaves `venueId`. */
  toggle(venueId: string, options?: FavouriteToggleOptions): Promise<void>;
  /** Saves `venueId` (the Saved suggestions' heart). */
  add(venueId: string, options?: FavouriteToggleOptions): Promise<FavouriteToggleResult>;
  /** Reads the list again. */
  refresh(): void;
}

export interface FavouriteState {
  readonly isFavourite: boolean;
  readonly loading: boolean;
  /** True while this venue's save or unsave is in flight; taps meanwhile are ignored. */
  readonly toggling: boolean;
  /** Saves or unsaves this venue. */
  toggle(options?: FavouriteToggleOptions): Promise<void>;
}

const isFavourite = (venueId: string) => favouritesStore.getState().isFavourite(venueId);
const isToggling = (venueId: string) => favouritesStore.getState().isToggling(venueId);
const toggle = async (venueId: string, options?: FavouriteToggleOptions) => {
  await favouritesStore.getState().toggle(venueId, options);
};
const add = (venueId: string, options?: FavouriteToggleOptions) => favouritesStore.getState().add(venueId, options);
const refresh = () => {
  void favouritesStore.getState().load();
};

/** Every saved venue and class (Saved, Home, the Coach). */
export function useFavourites(): FavouritesState {
  const venueIds = useStore(favouritesStore, (s) => s.savedIds);
  const venues = useStore(favouritesStore, (s) => s.venues);
  const activities = useStore(favouritesStore, (s) => s.activities);
  const loaded = useStore(favouritesStore, (s) => s.loaded);
  const status = useStore(favouritesStore, (s) => s.status);
  const error = useStore(favouritesStore, (s) => s.error);
  // Re-render when any heart starts or stops (isToggling reads it).
  useStore(favouritesStore, (s) => s.inFlight);

  useEffect(() => {
    void favouritesStore.getState().ensureLoaded();
  }, []);

  const failed = status === 'failed';
  return useMemo(
    () => ({
      venueIds,
      venues,
      activities,
      loading: !loaded && !failed,
      failed,
      error,
      isFavourite,
      isToggling,
      toggle,
      add,
      refresh,
    }),
    [venueIds, venues, activities, loaded, failed, error],
  );
}

export interface UseFavouriteOptions {
  /**
   * Read the list again when this heart mounts (or its venue changes), not
   * just once per session: the venue page, which iOS re-reads on every load.
   * A read already on its way is joined.
   */
  readonly refresh?: boolean;
}

/** One venue's heart. */
export function useFavourite(venueId: string, options: UseFavouriteOptions = {}): FavouriteState {
  const id = venueId.toLowerCase();
  const refreshOnMount = options.refresh === true;
  const saved = useStore(favouritesStore, (s) => s.savedIds.includes(id));
  const toggling = useStore(favouritesStore, (s) => s.inFlight[id] === true);
  const loading = useStore(favouritesStore, (s) => !s.loaded && s.status !== 'failed');

  useEffect(() => {
    if (!id) return;
    const store = favouritesStore.getState();
    void (refreshOnMount ? store.load() : store.ensureLoaded());
  }, [id, refreshOnMount]);

  const toggleThis = useCallback((options?: FavouriteToggleOptions) => toggle(id, options), [id]);
  return useMemo(
    () => ({ isFavourite: saved, loading, toggling, toggle: toggleThis }),
    [saved, loading, toggling, toggleThis],
  );
}
