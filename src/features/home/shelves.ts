// Home's two venue shelves: the Android port of iOS `HomeView.nearby` and
// `HomeView.popular` (Views/Home/HomeView.swift). Pure, so the rules are
// tested without a screen.
//
// Both take the venues in the BROWSE order (src/stores/venuesStore.ts
// `useOrderedVenues`): the visit's seeded rotation inside distance bands, so
// a tie keeps the same place for the whole visit and a pull to refresh never
// reshuffles a shelf.
import { coordinateOf, distanceMeters, type Coordinate } from '../../lib/geo';
import { comingSoonLast } from '../../lib/browseOrder';
import type { Venue } from '../../types/venue';

/** "A short walk from here" reaches this far (iOS `nearbyRadius`). */
export const NEARBY_RADIUS_M = 5_000;
/** The Nearby shelf shows at most this many cards. */
export const NEARBY_LIMIT = 6;
/** "Most Popular Now" shows at most this many rows. */
export const POPULAR_LIMIT = 4;

/** What the shelves read of a venue. */
export type ShelfVenue = Pick<Venue, 'id' | 'latitude' | 'longitude' | 'awaitingConnection' | 'totalReviews'>;

/**
 * Every venue but the hero within 5 km of `origin`, nearest first, every
 * bookable venue before a "coming soon" one, at most six.
 *
 * `origin` is the last fix or Reykjavík centre (`selectEffectiveLocation`):
 * without permission the shelf shows central Reykjavík. That is a FILTER
 * only. The cards never print a distance, so the shelf never claims a
 * proximity the phone does not have. A venue with no position is left out
 * (it cannot be within anything).
 */
export function nearbyShelf<V extends ShelfVenue>(venues: readonly V[], heroId: string | null, origin: Coordinate): V[] {
  const scored: { venue: V; distance: number; index: number }[] = [];
  venues.forEach((venue, index) => {
    if (venue.id === heroId) return;
    const point = coordinateOf(venue);
    if (!point) return;
    const distance = distanceMeters(point, origin);
    if (distance > NEARBY_RADIUS_M) return;
    scored.push({ venue, distance, index });
  });
  // Nearest first. Equal distances keep the browse order (a stable sort;
  // iOS's `sorted` is not stable, but two venues the same distance away are
  // the same building, so either order is iOS's).
  scored.sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.index - b.index));
  return comingSoonLast(scored.map(({ venue }) => venue)).slice(0, NEARBY_LIMIT);
}

/**
 * Every venue not featured or in Nearby, by review count (a global
 * popularity signal), most first. Ties (most venues have few or no reviews)
 * keep the browse order, so they rotate per visit and hold still while the
 * app is in use. Then every bookable venue before a "coming soon" one, at
 * most four.
 */
export function popularShelf<V extends ShelfVenue>(venues: readonly V[], excludedIds: ReadonlySet<string>): V[] {
  const ranked = venues
    .map((venue, index) => ({ venue, index }))
    .filter(({ venue }) => !excludedIds.has(venue.id))
    .sort((a, b) => {
      const ra = a.venue.totalReviews ?? 0;
      const rb = b.venue.totalReviews ?? 0;
      return ra !== rb ? rb - ra : a.index - b.index;
    })
    .map(({ venue }) => venue);
  return comingSoonLast(ranked).slice(0, POPULAR_LIMIT);
}

/** The ids Popular leaves out: the hero and everything in Nearby. */
export function popularExclusions(heroId: string | null, nearby: readonly { readonly id: string }[]): Set<string> {
  const excluded = new Set(nearby.map((venue) => venue.id));
  if (heroId !== null) excluded.add(heroId);
  return excluded;
}
