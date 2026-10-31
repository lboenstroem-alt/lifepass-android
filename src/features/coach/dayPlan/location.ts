/**
 * "Near me" for the day plan (iOS `CoachViewModel.resolveLocationFix`).
 *
 * The fix is WARMED the moment "Near me" is tapped (and not before, so a
 * member who picks a region is never asked for location), and READ at
 * submit: the fix there is, or one that arrives within 4 seconds (the
 * permission dialog may still be on screen). Location refused, or nothing in
 * time: null, and the wizard plans for the Capital Region and says so
 * (`coach.plan.no_location`) rather than sending Reykjavík's centre dressed
 * up as the member's position.
 *
 * Only a fix with permission granted NOW counts (`selectGrantedLocation`),
 * never the Reykjavík stand-in the distance filters use. What is sent is
 * rounded to two decimals first (./model.ts `coarseArea`).
 */
import type { Coordinate } from '../../../lib/geo';
import { locationStore, selectGrantedLocation, type LocationState } from '../../../stores/locationStore';
import type { StoreApi } from 'zustand/vanilla';

/** How long submit waits for a fix (iOS: 4 s). */
export const PLAN_LOCATION_WAIT_MS = 4_000;

type LocationStoreApi = Pick<StoreApi<LocationState>, 'getState' | 'subscribe'>;

/**
 * Asks for a fix (iOS `LocationService.requestLocation()`): the system dialog
 * only while the member has not decided, a fresh fix only while allowed.
 */
export function warmPlanLocation(store: LocationStoreApi = locationStore): void {
  try {
    void store
      .getState()
      .requestLocation()
      .catch(() => undefined);
  } catch {
    // No location at all: submit plans for the capital.
  }
}

/** True once location is definitely refused (or switched off): nothing will arrive. */
function refused(state: LocationState): boolean {
  return state.permissionKnown && state.permission === 'denied';
}

/**
 * A real fix for "Near me", or null (see the file comment). Resolves as soon
 * as a granted fix arrives or location is refused; otherwise after
 * `waitMs`, with whatever is there then.
 */
export function resolvePlanLocation(
  store: LocationStoreApi = locationStore,
  waitMs: number = PLAN_LOCATION_WAIT_MS,
): Promise<Coordinate | null> {
  const now = selectGrantedLocation(store.getState());
  if (now) return Promise.resolve({ latitude: now.latitude, longitude: now.longitude });
  warmPlanLocation(store);

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (fix: Coordinate | null) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      if (timer !== null) clearTimeout(timer);
      resolve(fix ? { latitude: fix.latitude, longitude: fix.longitude } : null);
    };
    const check = (state: LocationState): boolean => {
      const fix = selectGrantedLocation(state);
      if (fix) {
        finish(fix);
        return true;
      }
      if (refused(state)) {
        finish(null);
        return true;
      }
      return false;
    };
    if (check(store.getState())) return;
    unsubscribe = store.subscribe((state) => {
      check(state);
    });
    timer = setTimeout(() => finish(selectGrantedLocation(store.getState())), waitMs);
  });
}
