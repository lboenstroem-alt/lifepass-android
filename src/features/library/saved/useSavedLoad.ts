/* eslint lifepass/no-literal-copy: "error" */
/**
 * What a Saved surface loads: the port of iOS `FavouritesViewModel`
 * (ViewModels/FavouritesViewModel.swift), over the app's ONE favourites
 * store (src/features/favourites, VENUE-2) rather than a copy per screen, so
 * a heart tapped on a venue page is already right here.
 *
 * `load()` reads `GET /favourites` (through the store) and `GET /venues`
 * (the suggestions' pool) side by side, and is what a surface calls on every
 * appearance, as iOS reloads on every `onAppear`:
 *   - `isLoading` is true for the whole load (iOS draws a spinner over the
 *     half meanwhile);
 *   - a favourites read that fails keeps the last lists and leaves the
 *     suggestions as they were (iOS throws before it assigns them); nothing
 *     is shown, as iOS never shows that error;
 *   - a venues read that fails empties the suggestions (`try? ... ?? []`).
 *
 * The venues are a plain read in the server's order, not the browse store:
 * the shelf is "the first three you have not saved", as iOS reads it.
 *
 * The store is read directly rather than through `useFavourites()`, which
 * reads the list once on mount by itself: Profile reads it on its focus
 * already, and iOS reads once per appearance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { fetchVenues } from '../../../api/venues';
import { favouritesStore, type FavouriteActivity, type FavouriteAttraction, type FavouriteVenue } from '../../favourites';
import type { Venue } from '../../../types/venue';

export interface SavedLoad {
  /** The saved venues, less any just unsaved. */
  readonly venues: readonly FavouriteVenue[];
  /** The saved classes. */
  readonly activities: readonly FavouriteActivity[];
  /** The saved hikes and sights (API 0.45.0), less any just unsaved. */
  readonly attractions: readonly FavouriteAttraction[];
  /** `GET /venues`, the suggestions' pool. */
  readonly allVenues: readonly Venue[];
  readonly isLoading: boolean;
  /** Reads both again. */
  load(): Promise<void>;
}

export interface SavedLoadDeps {
  readonly fetchVenues: () => Promise<Venue[]>;
}

const defaultDeps: SavedLoadDeps = { fetchVenues: () => fetchVenues() };

export function useSavedLoad(deps: SavedLoadDeps = defaultDeps): SavedLoad {
  const venues = useStore(favouritesStore, (s) => s.venues);
  const activities = useStore(favouritesStore, (s) => s.activities);
  const attractions = useStore(favouritesStore, (s) => s.attractions);
  const [allVenues, setAllVenues] = useState<readonly Venue[]>([]);
  const [isLoading, setLoading] = useState(false);
  const mounted = useRef(true);
  const latest = useRef(0);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    const venuesRead = depsRef.current.fetchVenues().then(
      (list) => list,
      () => null,
    );
    try {
      await favouritesStore.getState().load();
      if (favouritesStore.getState().status === 'failed') return;
      const pool = await venuesRead;
      if (mounted.current && mine === latest.current) setAllVenues(pool ?? []);
    } finally {
      if (mounted.current && mine === latest.current) setLoading(false);
    }
  }, []);

  return {
    venues,
    activities,
    attractions,
    allVenues,
    isLoading,
    load,
  };
}
