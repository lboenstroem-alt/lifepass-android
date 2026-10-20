/**
 * The slug of a venue known only by its id.
 *
 * The venue page is addressed by slug (the API has no get-by-id), and every
 * rebuilt caller passes one. Until the first build's screens are rebuilt by
 * their owners (Home, Explore, Profile, the Coach), some still open the page
 * with `{ venueId }` (plan 3.0.2, `LegacyVenueDetailParams`). Such an id is
 * looked up in the venue list this phone already holds, and only when it is
 * not there in a fresh copy of the catalogue (one page holds every venue).
 * QA-1 removes this with the last legacy caller.
 */
import type { RequestOptions } from '../../api/client';
import { fetchVenues } from '../../api/venues';
import { venuesStore } from '../../stores/venuesStore';
import type { Venue } from '../../types/venue';

function slugIn(venues: readonly Venue[], id: string): string | null {
  return venues.find((venue) => venue.id === id)?.slug ?? null;
}

/** The venue's slug, or null when no listed venue has that id. A failed read rejects. */
export async function resolveVenueSlug(
  venueId: string,
  options: Pick<RequestOptions, 'signal'> = {},
): Promise<string | null> {
  const id = venueId.toLowerCase();
  const held = venuesStore.getState();
  const cached = slugIn(held.fetched, id) ?? slugIn(held.catalog, id);
  if (cached) return cached;
  return slugIn(await fetchVenues({}, options), id);
}
