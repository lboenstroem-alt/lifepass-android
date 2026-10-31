/**
 * What the phone does on top of the server's filters (iOS
 * `ClassesViewModel.feedEntries`, `passesClientFilters`, `distanceKm`, and
 * the web's `classesWithDistance`).
 *
 * TWO POSITIONS, never mixed:
 *  - `fix`: the member's REAL position (a fix, location permission granted
 *    now), or null. The ONLY source of a printed distance: with one, every
 *    card shows its km, whether or not "Near me" is on.
 *  - `nearMeOrigin`: the "Near me" radius filter's centre, null when it is
 *    off. It is the fix, or central Reykjavík without one. The fallback
 *    narrows the list but never puts a number on a card: "1.2 km" on a card
 *    reads as "from you", and measured from the capital it would be wrong at
 *    a glance for someone in Akureyri.
 *
 * The location never leaves the phone.
 */
import type { ClassFeedItem } from '../../../api/classFeed';
import { distanceMeters, type Coordinate } from '../../../lib/geo';

/** A class the list shows, with the distance its card prints (null: none). */
export interface FeedEntry {
  readonly item: ClassFeedItem;
  readonly distanceKm: number | null;
}

/** Kilometres from `origin` to the class's venue; null when the venue has no coordinates. */
export function distanceKm(origin: Coordinate, item: ClassFeedItem): number | null {
  const coordinates = item.venue.coordinates;
  if (!coordinates) return null;
  return distanceMeters(origin, coordinates) / 1000;
}

/**
 * The filters the phone applies on top of the server's: a class that has
 * started is gone, and with "Near me" on (`origin` set) a venue without
 * coordinates or beyond the radius is out. ONE definition for the list and
 * the empty day's look-ahead, so "next" never names a class the list would
 * then hide.
 */
export function passesClientFilters(item: ClassFeedItem, now: Date, origin: Coordinate | null, radiusKm: number): boolean {
  if (!(item.startsAt.getTime() > now.getTime())) return false;
  if (!origin) return true;
  const km = distanceKm(origin, item);
  if (km === null) return false;
  return km <= radiusKm;
}

/** The classes the list shows, each with the distance its card prints. */
export function feedEntries(
  items: readonly ClassFeedItem[],
  now: Date,
  fix: Coordinate | null,
  nearMeOrigin: Coordinate | null,
  radiusKm: number,
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const item of items) {
    if (!passesClientFilters(item, now, nearMeOrigin, radiusKm)) continue;
    entries.push({ item, distanceKm: fix ? distanceKm(fix, item) : null });
  }
  return entries;
}
