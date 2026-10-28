// Venues for Home's tests, built through the API decoder so they are the
// shape the app really holds.
import { decodeVenue, venueToApi } from '../../../api/venues';
import type { Venue } from '../../../types/venue';

/** Reykjavík centre, and points a known distance from it along the meridian. */
export const REYKJAVIK = { latitude: 64.1466, longitude: -21.9426 };

/** About `metres` north of Reykjavík centre (1° of latitude is 111,195 m on the app's sphere). */
export function north(metres: number): { latitude: number; longitude: number } {
  return { latitude: REYKJAVIK.latitude + metres / 111_195, longitude: REYKJAVIK.longitude };
}

export function venueId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export interface TestVenueOptions {
  readonly at?: { latitude: number; longitude: number } | null;
  readonly image?: string | null;
  readonly comingSoon?: boolean;
  readonly reviews?: number | null;
  readonly extra?: Record<string, unknown>;
}

export function testVenue(n: number, name: string, options: TestVenueOptions = {}): Venue {
  const at = options.at === undefined ? north(n * 100) : options.at;
  return decodeVenue({
    id: venueId(n),
    slug: `venue-${n}`,
    name,
    inBundle: true,
    ...(at ? { coordinates: at } : {}),
    ...(options.image === undefined ? { imageUrl: `https://img.example/${n}.jpg` } : options.image ? { imageUrl: options.image } : {}),
    ...(options.comingSoon ? { awaitingConnection: true } : {}),
    ...(options.reviews !== undefined && options.reviews !== null ? { totalReviews: options.reviews } : {}),
    ...options.extra,
  });
}

/** `GET /venues`'s page for these venues. */
export function venuePage(venues: readonly Venue[]) {
  return { data: venues.map(venueToApi), pagination: { nextCursor: null, hasMore: false, limit: 100 } };
}

export const ids = (list: readonly { readonly id: string }[]) => list.map((venue) => venue.id);
