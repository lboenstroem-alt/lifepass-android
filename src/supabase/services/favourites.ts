/* eslint lifepass/no-literal-copy: "error" */
/**
 * @deprecated The first build's favourites service, kept as a thin shim for
 * the legacy screens until their owners move to `src/features/favourites`.
 * The calls themselves live in src/features/favourites/api.ts (the port of
 * iOS FavouritesService); new code reads the shared store through
 * `useFavourites()` / `useFavourite(venueId)` and never calls these.
 */
import type { LegacyVenue as AppVenue } from '../../types/venue';
import {
  addFavouriteActivity,
  addFavouriteVenue,
  fetchFavourites,
  isPremiumFavourite,
  removeFavouriteActivity,
  removeFavouriteVenue,
  type FavouriteActivity,
  type FavouriteVenue,
  type FavouritesPayload,
} from '../../features/favourites/api';

export type { FavouriteActivity, FavouriteVenue, FavouritesPayload };
export {
  addFavouriteActivity,
  addFavouriteVenue,
  fetchFavourites,
  removeFavouriteActivity,
  removeFavouriteVenue as removeFavouriteByVenue,
  removeFavouriteActivity as removeFavouriteByActivity,
};

/**
 * The lean API favourite in the first build's venue shape, for the legacy
 * screens (saved rows read id/name/city/imageUrl; the Coach's tags read
 * name/category). `id` is the VENUE id: saved ids and `openVenue(v.id)` both
 * key on it.
 */
export function adaptFavouriteVenue(f: FavouriteVenue): AppVenue {
  return {
    id: f.venueId,
    slug: f.slug,
    name: f.name,
    description: f.description ?? '',
    address: f.address ?? '',
    city: f.city ?? '',
    // The favourites payload has no position: none, never 0,0 (F6 LegacyVenue).
    latitude: null,
    longitude: null,
    imageUrl: f.imageUrl ?? '',
    classification: 'basic',
    category: [...(f.categories ?? [])],
    creditCost: 0,
    walkInsAllowed: false,
    walkInCreditCost: 0,
    amenities: [],
    openingHours: {},
    phone: '',
    averageRating: 0,
    totalReviews: 0,
    activities: [],
    reviews: [],
    // The legacy rows draw a price pill from this. A favourite with no marker
    // is in the bundle, as iOS FavouriteVenue.isPremium reads it
    // (`!(inBundle ?? true)`); one rule with this package's isPremiumFavourite.
    inBundle: !isPremiumFavourite(f),
  };
}

export async function fetchFavouriteVenues(): Promise<AppVenue[]> {
  const { venues } = await fetchFavourites();
  return venues.map(adaptFavouriteVenue);
}

export async function fetchFavouriteActivities(): Promise<FavouriteActivity[]> {
  const { activities } = await fetchFavourites();
  return [...activities];
}

/** The API has no per-venue probe: read the list and check (same as iOS). */
export async function isFavourited(venueId: string): Promise<boolean> {
  const { venues } = await fetchFavourites();
  const id = venueId.toLowerCase();
  return venues.some((f) => f.venueId === id);
}
