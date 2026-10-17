// LEGACY: Home's position before the parity build (deleted by QA-1 once HOME-1
// reads src/stores/locationStore.ts directly).
//
// Now a thin view of the location store: on mount it asks for location the
// way iOS Home does (`requestLocation()`: the system dialog only while the
// member has not decided, never again after), and it returns the GRANTED fix,
// or null. It no longer prompts on every mount, and a fix kept from before
// permission was taken away is never returned.
import { useEffect } from 'react';

import type { Coordinate } from '../lib/geo';
import { locationStore, startLocationLifecycle, useGrantedLocation } from '../stores/locationStore';

export type Coords = Coordinate;

/** The member's granted position, or null until (and unless) they allow location. */
export function useLocation(): Coords | null {
  const granted = useGrantedLocation();
  useEffect(() => {
    // The app-wide wiring (idempotent): F4 starts it at the root as well.
    startLocationLifecycle();
    void locationStore.getState().requestLocation();
  }, []);
  return granted;
}
