/**
 * The pool picker's order and its second line (iOS `PlanVenuePickerSheet`
 * `sorted` and `distanceLabel`, Views/Plan/PlanVenuePickerSheet.swift).
 *
 * Nearest first when the phone has a fix the member granted; otherwise the
 * catalogue's own order, which is not a guess dressed up as proximity, with
 * the city under each name instead of a distance. Distance is computed on
 * the phone from the fix the app already has: no location is sent anywhere,
 * and the picker never asks for one.
 */
import type { Lang } from '../../../i18n';
import { decimal } from '../../../i18n/format';
import { coordinateOf, distanceMeters, type Coordinate } from '../../../lib/geo';
import type { Venue } from '../../../types/venue';

/** What `GET /venues` is asked for (iOS `fetchVenuesFromAPI(category: "Pool", limit: 40)`). */
export const POOL_CATEGORY = 'Pool';
export const POOL_LIMIT = 40;

type Located = Pick<Venue, 'latitude' | 'longitude'>;

function distanceFrom(venue: Located, origin: Coordinate): number | null {
  const position = coordinateOf(venue);
  return position ? distanceMeters(position, origin) : null;
}

/**
 * Nearest first from `origin` (a venue without coordinates last, ties in
 * catalogue order); the catalogue's order when there is no origin.
 */
export function sortPools<V extends Located>(venues: readonly V[], origin: Coordinate | null): V[] {
  if (!origin) return [...venues];
  return venues
    .map((venue, index) => ({ venue, index, metres: distanceFrom(venue, origin) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.metres === b.metres ? a.index - b.index : a.metres - b.metres))
    .map(({ venue }) => venue);
}

/**
 * "2.4 km" / "2,4 km" from the fix, the city without one, or nothing. Always
 * kilometres with one decimal, as iOS prints it ("0.4 km", never "400 m").
 */
export function poolDistanceLabel(venue: Located & Pick<Venue, 'city'>, origin: Coordinate | null, lang: Lang): string | null {
  const metres = origin ? distanceFrom(venue, origin) : null;
  if (metres === null) return venue.city;
  return `${decimal(metres / 1000, lang)} km`;
}
