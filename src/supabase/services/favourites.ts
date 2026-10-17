// Favourites, backed by the LifePass API — mirrors lifepass-ios
// Services/FavouritesService.swift. The old direct Supabase table access
// fails against the v1 backend (likes silently did nothing).
//
// `GET /favourites` returns both kinds in one call
// (`{ venues: [...], activities: [...] }`), so we fetch once and split.
// Add/remove are low-risk preference writes:
//   POST   /favourites  { venueId | activityId }
//   DELETE /favourites?venueId=…  (or ?activityId=…)
import { apiGet, apiPost, apiDelete } from '../../api/client';
import type { LegacyVenue as AppVenue } from '../../types/venue';

// A favourited venue as the API returns it — leaner than a full Venue
// (no coordinates or walk-in flags): name/city/image + the in-bundle/
// premium marker, plus the ids needed to open venue detail.
export type FavouriteVenue = {
  id: string; // favourite row id
  venueId: string;
  slug: string;
  name: string;
  description?: string | null;
  city?: string | null;
  address?: string | null;
  /** v1: free within the plan vs premium (à-la-carte). */
  inBundle?: boolean | null;
  imageUrl?: string | null;
  categories?: string[] | null;
  createdAt?: string | null;
};

// A favourited activity — carries venue ids so a row can open that
// venue's detail.
export type FavouriteActivity = {
  id: string; // favourite row id
  activityId: string;
  name: string;
  description?: string | null;
  durationMinutes?: number | null;
  imageUrl?: string | null;
  venueId: string;
  venueSlug: string;
  venueName: string;
  createdAt?: string | null;
};

type FavouritesResponse = {
  venues: FavouriteVenue[];
  activities: FavouriteActivity[];
};

// Adapt the lean API favourite into the app Venue shape the screens
// consume (saved rows read id/name/city/imageUrl; Coach tag derivation
// reads name/category). `id` must be the VENUE id — savedVenueIds and
// openVenue(v.id) both key on it.
function adaptFavouriteVenue(f: FavouriteVenue): AppVenue {
  return {
    id: f.venueId,
    slug: f.slug,
    name: f.name,
    description: f.description ?? '',
    address: f.address ?? '',
    city: f.city ?? '',
    latitude: 0,
    longitude: 0,
    imageUrl: f.imageUrl ?? '',
    classification: 'basic',
    category: f.categories ?? [],
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
    inBundle: f.inBundle ?? true,
  };
}

/** One round-trip for the whole favourites payload. */
export async function fetchFavourites(): Promise<FavouritesResponse> {
  return apiGet<FavouritesResponse>('/favourites');
}

export async function fetchFavouriteVenues(): Promise<AppVenue[]> {
  const { venues } = await fetchFavourites();
  return venues.map(adaptFavouriteVenue);
}

export async function fetchFavouriteActivities(): Promise<FavouriteActivity[]> {
  const { activities } = await fetchFavourites();
  return activities;
}

/** The API has no per-venue probe — read the list and check (same as iOS). */
export async function isFavourited(venueId: string): Promise<boolean> {
  const { venues } = await fetchFavourites();
  return venues.some((f) => f.venueId === venueId);
}

export async function addFavouriteVenue(venueId: string): Promise<void> {
  await apiPost('/favourites', { venueId });
}

export async function addFavouriteActivity(activityId: string): Promise<void> {
  await apiPost('/favourites', { activityId });
}

export async function removeFavouriteByVenue(venueId: string): Promise<void> {
  await apiDelete('/favourites', { venueId });
}

export async function removeFavouriteByActivity(activityId: string): Promise<void> {
  await apiDelete('/favourites', { activityId });
}
