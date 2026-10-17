// The two inputs of the browse order (src/lib/browseOrder.ts) that belong to
// the member's VISIT rather than to a list: the rotation seed and the origin of
// the distance bands. The Android port of iOS `BrowseSession`
// (Services/VenueOrdering.swift). One per app (`browseSession`); Explore's list
// and Home's list read it, so both show the same mix around the same point.
//
// SEED: one per visit, as on the web (whose seed cookie lapses 30 minutes after
// the last Browse view). A visit starts at launch, and again when the app comes
// back to the foreground after `VISIT_GAP_MS` or more in the background:
// Android keeps an app's process alive for hours or days, so a seed drawn once
// per process would show a member the same mix for a week. Nothing that
// happens in the foreground draws one: filters, searches, tab switches,
// navigation and a pull to refresh all keep the mix.
//
// ORIGIN: where the bands are drawn around. The first real fix (the location
// store's granted fix) sets it, and it then holds until the member has moved
// more than `REBAND_DISTANCE_M`, so a later fix or GPS jitter never moves a
// venue near a band edge (3, 15, 60 km) across it while the member is
// browsing. Without permission it is null: no fix, no distance order, never the
// Reykjavík fallback. A new visit starts from the latest fix.
//
// `revision` changes whenever either does, so a list can key a memo or an
// animation on it. The location never leaves the phone.
//
// The app wires the lifecycle (background / active) in
// src/stores/locationStore.ts (`startLocationLifecycle`).
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { distanceMeters, type Coordinate } from '../lib/geo';
import { MAX_SEED, randomSeed } from '../lib/browseOrder';

/** Time in the background after which coming back is a new visit: the web's visit window. */
export const VISIT_GAP_MS = 30 * 60 * 1000;
/** How far the member must move before the bands are drawn again. */
export const REBAND_DISTANCE_M = 1_000;

export interface BrowseSessionState {
  /** The visit's rotation seed (unsigned 32-bit). */
  readonly seed: number;
  /** The band origin: a real fix, or null. */
  readonly origin: Coordinate | null;
  /** Bumps whenever `seed` or `origin` changes. */
  readonly revision: number;
  /**
   * A new granted fix, or null when there is none (permission taken away).
   * Told by the location store on every fix and every permission change.
   */
  locationDidChange(granted: Coordinate | null): void;
  /** The app went to the background (Android `AppState` 'background'). */
  didEnterBackground(now?: number): void;
  /**
   * The app is in the foreground again. After `VISIT_GAP_MS` or more in the
   * background this is a new visit: a new seed, and bands around `granted`,
   * the latest real fix (null without one). Returns whether a new visit
   * began. Becoming active without having been in the background changes
   * nothing, and the background time is used once.
   */
  didBecomeActive(now: number | undefined, granted: Coordinate | null): boolean;
}

export interface BrowseSessionOptions {
  readonly seed: number;
  readonly origin?: Coordinate | null;
  /** A fixed (debug) seed is never redrawn. */
  readonly seedIsFixed?: boolean;
  /** Draws the next visit's seed (tests pass their own). */
  readonly drawSeed?: () => number;
}

export type BrowseSessionStore = StoreApi<BrowseSessionState>;

/** A browse session; the app uses the shared `browseSession`. */
export function createBrowseSession(options: BrowseSessionOptions): BrowseSessionStore {
  const seedIsFixed = options.seedIsFixed ?? false;
  const drawSeed = options.drawSeed ?? randomSeed;
  // Not state: nothing renders from it.
  let backgroundedAt: number | null = null;

  return createStore<BrowseSessionState>()((set, get) => ({
    seed: options.seed >>> 0,
    origin: options.origin ?? null,
    revision: 0,

    locationDidChange(granted) {
      const { origin, revision } = get();
      if (!granted) {
        if (origin) set({ origin: null, revision: revision + 1 });
        return;
      }
      if (origin && distanceMeters(origin, granted) <= REBAND_DISTANCE_M) return;
      set({ origin: granted, revision: revision + 1 });
    },

    didEnterBackground(now = Date.now()) {
      backgroundedAt = now;
    },

    didBecomeActive(now = Date.now(), granted) {
      const since = backgroundedAt;
      backgroundedAt = null;
      if (seedIsFixed || since === null || now - since < VISIT_GAP_MS) return false;
      set({ seed: drawSeed() >>> 0, origin: granted, revision: get().revision + 1 });
      return true;
    },
  }));
}

/**
 * A fixed seed for a development build (`EXPO_PUBLIC_LP_BROWSE_SEED=<n>`), for
 * screenshots and device QA; never in a release build. The Android twin of
 * iOS's DEBUG `-LPBrowseSeed <n>`.
 */
export function debugFixedSeed(raw: string | undefined = process.env.EXPO_PUBLIC_LP_BROWSE_SEED): number | null {
  if (!__DEV__ || raw === undefined) return null;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const seed = Number(value);
  return seed <= MAX_SEED ? seed : null;
}

const fixedSeed = debugFixedSeed();

/** The seed the first visit starts with. */
export const launchSeed: number = fixedSeed ?? randomSeed();

/**
 * The app's session. Starts without an origin: the location store pushes the
 * first granted fix to it, and reads nothing back from here.
 */
export const browseSession: BrowseSessionStore = createBrowseSession({
  seed: launchSeed,
  origin: null,
  seedIsFixed: fixedSeed !== null,
});

/** React: a slice of the shared session (or of `store`). */
export function useBrowseSession<T>(selector: (state: BrowseSessionState) => T, store: BrowseSessionStore = browseSession): T {
  return useStore(store, selector);
}
