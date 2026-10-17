// @f4-stub (plan 3.0.3): the saved-venues store, filled by VENUE-2.
//
// Used by VENUE-1 (the heart on the venue page), HOME-1, LIB-1 (Saved) and
// COACH-1. One shared store on iOS (`FavouritesStore`): every heart on every
// screen agrees, and a toggle shows at once.
//
// Keep these exports and signatures; replace the bodies (and this marker).
// Until VENUE-2 lands they read the first build's favourites hook.
import { useFavouriteVenues } from '../../supabase/hooks/useFavourites';

export interface FavouritesState {
  /** The saved venues' ids. */
  readonly venueIds: readonly string[];
  /** True until the first read has answered. */
  readonly loading: boolean;
  /** The last read or toggle failed. */
  readonly failed: boolean;
  isFavourite(venueId: string): boolean;
  /** Saves or unsaves `venueId`. */
  toggle(venueId: string): Promise<void>;
  /** Reads the list again. */
  refresh(): void;
}

export interface FavouriteState {
  readonly isFavourite: boolean;
  readonly loading: boolean;
  /** Saves or unsaves this venue. */
  toggle(): Promise<void>;
}

/** Every saved venue (Saved, Home, the Coach). */
export function useFavourites(): FavouritesState {
  const legacy = useFavouriteVenues();
  return {
    venueIds: legacy.savedVenueIds,
    loading: legacy.loading,
    failed: legacy.error !== null,
    isFavourite: (venueId) => legacy.savedVenueIds.includes(venueId),
    toggle: legacy.toggle,
    refresh: legacy.refetch,
  };
}

/** One venue's heart. */
export function useFavourite(venueId: string): FavouriteState {
  const all = useFavourites();
  return {
    isFavourite: all.isFavourite(venueId),
    loading: all.loading,
    toggle: () => all.toggle(venueId),
  };
}
