/* eslint lifepass/no-literal-copy: "error" */
/**
 * @deprecated The first build's favourites hook, kept for the legacy screens
 * (Home, Bookings' Saved tab, the Coach, the old venue page) until their
 * owners move to `useFavourites()` / `useFavourite(venueId)` from
 * src/features/favourites.
 *
 * It no longer keeps a list of its own: it reads the shared favourites store,
 * so every legacy screen and every new one show the same hearts, a tap flips
 * at once, a double tap while the request is in flight is ignored, and a
 * failure flips back with the "Heads up" alert (iOS VenueDetailViewModel).
 * Like the first build, it reads the list when it mounts (joining a read
 * already on its way).
 */
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import { favouritesStore } from '../../features/favourites';
import type { LegacyVenue as AppVenue } from '../../types/venue';
import { adaptFavouriteVenue } from '../services/favourites';

type FavouritesState = {
  savedVenues: AppVenue[];
  savedVenueIds: string[];
  loading: boolean;
  /** The last read's failure in the language on screen, or null. */
  error: string | null;
  toggle: (venueId: string) => Promise<void>;
  refetch: () => void;
};

const toggle = async (venueId: string) => {
  await favouritesStore.getState().toggle(venueId);
};
const refetch = () => {
  void favouritesStore.getState().load();
};

export function useFavouriteVenues(): FavouritesState {
  const venues = useStore(favouritesStore, (s) => s.venues);
  const savedIds = useStore(favouritesStore, (s) => s.savedIds);
  const loaded = useStore(favouritesStore, (s) => s.loaded);
  const status = useStore(favouritesStore, (s) => s.status);
  const error = useStore(favouritesStore, (s) => s.error);

  useEffect(() => {
    void favouritesStore.getState().load();
  }, []);

  const savedVenues = useMemo(() => venues.map(adaptFavouriteVenue), [venues]);
  const savedVenueIds = useMemo(() => [...savedIds], [savedIds]);

  return {
    savedVenues,
    savedVenueIds,
    // Only the first read shows a spinner; a refetch refreshes in place.
    loading: !loaded && status !== 'failed',
    error,
    toggle,
    refetch,
  };
}
