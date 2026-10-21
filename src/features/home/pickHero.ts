// The venue featured at the top of Home: the Android port of iOS
// `HomeView.pickHero()` and the `hero` it resolves to (Views/Home/HomeView.swift).
//
// THE RULE, run after every venue load or refresh and whenever the location
// fix changes:
//   1. Never a "coming soon" venue while one that can be visited exists: it
//      has nothing to book yet.
//   2. Prefer a venue WITH a photo: the hero is 520 pt of full-bleed imagery,
//      and a venue with no image renders as a grey slab. (This is why the
//      first build's stock-photo fallback had to go: it made every venue look
//      as if it had one.)
//   3. With a real fix, the nearest of those within 20 km: a place the member
//      could be at in half an hour is worth more than a beautiful one on the
//      other side of the country. 20 km reaches the next town from the
//      capital and keeps "near you" true.
//   4. Otherwise keep whatever is already featured rather than reshuffling
//      under the member (a pull to refresh holds still), and pick at random
//      only when nothing is featured yet.
//
// The id is held per Home VISIT: iOS rebuilds Home at every tab switch, so a
// visit starts with no hero and rolls a new one; Android keeps the screen
// mounted and starts each visit by passing `currentId: null`
// (./useHomeVisit.ts).
//
// The fix must be a GRANTED one (`selectGrantedLocation`): a position kept
// from before permission was taken away is not where the member is.
import { nearestWithin, type Coordinate } from '../../lib/geo';
import { isComingSoon, type Venue } from '../../types/venue';

/** How far the featured venue may be (iOS `heroRadius`). */
export const HERO_RADIUS_M = 20_000;

/** What the rule reads of a venue. */
export type HeroCandidate = Pick<Venue, 'id' | 'imageUrl' | 'latitude' | 'longitude' | 'awaitingConnection'>;

export interface PickHeroInput {
  /** The member's real position, or null without one. */
  readonly grantedFix: Coordinate | null;
  /** The venue featured now in this visit, or null at the start of one. */
  readonly currentId: string | null;
  /** [0, 1); `Math.random` in the app, fixed in tests. */
  readonly random?: () => number;
}

/** True for a venue whose photo can fill the hero (iOS `primaryImageUrl?.isEmpty == false`). */
export function hasHeroImage(venue: Pick<Venue, 'imageUrl'>): boolean {
  return typeof venue.imageUrl === 'string' && venue.imageUrl.length > 0;
}

/**
 * The id to feature next, or null when there is nothing to feature (no
 * venues and nothing featured yet). An id that is already featured is kept
 * even if the venue has since left the list: `resolveHero` then falls back
 * to the first venue, as iOS does.
 */
export function pickHero(venues: readonly HeroCandidate[], input: PickHeroInput): string | null {
  const bookable = venues.filter((venue) => !isComingSoon(venue));
  const candidates = bookable.length > 0 ? bookable : venues;
  const withImage = candidates.filter(hasHeroImage);
  const pool = withImage.length > 0 ? withImage : candidates;

  if (input.grantedFix) {
    const near = nearestWithin(pool, input.grantedFix, HERO_RADIUS_M);
    if (near) return near.id;
  }

  // No fix yet, or nothing within reach.
  if (input.currentId !== null) return input.currentId;
  if (pool.length === 0) return null;
  const random = input.random ?? Math.random;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index]!.id;
}

/** The venue the hero shows: the featured one, else the first in the list (iOS `hero`). */
export function resolveHero<V extends { readonly id: string }>(venues: readonly V[], heroId: string | null): V | null {
  if (heroId !== null) {
    const featured = venues.find((venue) => venue.id === heroId);
    if (featured) return featured;
  }
  return venues[0] ?? null;
}
