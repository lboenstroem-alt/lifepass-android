// LEGACY venue reads for the screens written before the parity build
// (deleted by QA-1 once HOME-1, EXPL-1, VENUE-1, LIB-1, BOOK-1, COACH-1 and
// CHECKIN-1 have moved to src/api/venues.ts and src/stores/venuesStore.ts).
//
// Every venue now comes through the API decoder (src/api/venues.ts) and is
// reshaped into the old `LegacyVenue` here, so even the old screens get no
// stock photo (an empty `imageUrl` instead) and no 0,0 position (null). The
// retired credit fields are filled with placeholders the old screens still
// read; the classification is derived from the bundle (premium = 'luxury').
//
// Activities still come from a direct Supabase table read until VENUE-1 and
// BOOK-1 switch to the walk-in preview's `slotActivities`
// (src/api/walkInPreview.ts).
import { supabase } from '../lib/client';
import { apiGet } from '../../api/client';
import { fetchVenueBySlug as fetchApiVenueBySlug, fetchVenues as fetchApiVenues, VENUE_PAGE_LIMIT } from '../../api/venues';
import type { Activity as DbActivity } from '../types/venue';
import type {
  DayHours,
  LegacyActivity,
  LegacyOpeningHours,
  LegacyOpeningHoursDay,
  LegacyVenue,
  LegacyVenueReview,
  OpeningHours,
  Venue,
} from '../../types/venue';
import { WEEKDAYS } from '../../types/venue';

// Public bucket holding venue/activity images; used for activity rows,
// which still come straight from the DB with relative storage paths.
const STORAGE_BASE = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/venue-images`;

function storageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${STORAGE_BASE}/${encoded}`;
}

function legacyDay(day: DayHours | null): LegacyOpeningHoursDay | undefined {
  if (!day) return undefined;
  return { open: day.open ?? undefined, close: day.close ?? undefined, closed: day.closed ?? undefined };
}

function legacyHours(hours: OpeningHours | null): LegacyOpeningHours {
  const result: LegacyOpeningHours = {};
  if (!hours) return result;
  for (const day of WEEKDAYS) result[day] = legacyDay(hours[day]);
  return result;
}

/** The API model in the old screens' shape (see the file comment). */
export function toLegacyVenue(venue: Venue): LegacyVenue {
  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    description: venue.description ?? '',
    address: venue.address ?? '',
    city: venue.city ?? '',
    latitude: venue.latitude,
    longitude: venue.longitude,
    imageUrl: venue.imageUrl ?? '',
    classification: venue.inBundle ? 'basic' : 'luxury',
    category: [...(venue.categories ?? [])],
    primaryCategory: venue.primaryCategory ?? undefined,
    creditCost: 1,
    walkInsAllowed: venue.walkInsAllowed ?? false,
    walkInCreditCost: 1,
    amenities: [...(venue.amenities ?? [])],
    openingHours: legacyHours(venue.openingHours),
    phone: venue.phone ?? '',
    averageRating: venue.averageRating ?? 0,
    totalReviews: venue.totalReviews ?? 0,
    activities: [],
    reviews: [],
    specialInstructions: undefined,
    inBundle: venue.inBundle,
    surchargePrice: venue.surchargePrice ?? undefined,
    resolvedSurchargePrice: venue.resolvedSurchargePrice ?? undefined,
    topupPrice: venue.topupPrice ?? undefined,
    daypassPrice: venue.daypassPrice ?? undefined,
  };
}

/** A DB activity row in the old shape; no photo is an empty `imageUrl`, never a stock photo. */
export function adaptActivity(db: DbActivity): LegacyActivity {
  return {
    id: db.id,
    name: db.name,
    imageUrl: db.image_url ?? storageUrl(db.image_storage_path) ?? '',
    creditCost: 1,
    durationMinutes: db.duration_minutes ?? 60,
    classification: 'basic',
  };
}

/** @deprecated Use `fetchVenues` in src/api/venues.ts. */
export async function fetchVenues(opts?: { search?: string; city?: string }): Promise<LegacyVenue[]> {
  const venues = await fetchApiVenues({ search: opts?.search, city: opts?.city });
  return venues.map(toLegacyVenue);
}

/** @deprecated Use `fetchVenues({ category, limit })` in src/api/venues.ts. */
export async function fetchVenuesFromAPI(category: string | null, limit = 20): Promise<LegacyVenue[]> {
  const venues = await fetchApiVenues({ category, limit });
  return venues.map(toLegacyVenue);
}

/** @deprecated Use `fetchVenueBySlug` in src/api/venues.ts. */
export async function fetchVenueBySlug(slug: string): Promise<LegacyVenue> {
  return toLegacyVenue(await fetchApiVenueBySlug(slug));
}

/**
 * @deprecated The API has no get-by-id; the venue page is reached by slug.
 * Kept for the old screens that still navigate by id: one page holds the
 * whole catalogue.
 */
export async function fetchVenueById(id: string): Promise<LegacyVenue> {
  const venues = await fetchApiVenues({ limit: VENUE_PAGE_LIMIT });
  const match = venues.find((venue) => venue.id === id.toLowerCase());
  if (!match) throw new Error('Venue not found');
  return toLegacyVenue(match);
}

/** @deprecated Activities come from the walk-in preview (src/api/walkInPreview.ts). */
export async function fetchActivities(venueId: string): Promise<LegacyActivity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('venue_id', venueId)
    .eq('active', true)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data as DbActivity[]).map(adaptActivity);
}

// `GET /venues/{venueId}/reviews` (iOS VenueService.fetchVenueReviews); VENUE-2
// replaces it with the reviews feature. Reviews are keyed by venue UUID.
type ApiReviewsResponse = {
  rows: {
    id: string;
    venueId: string;
    rating: number;
    comment?: string | null;
    createdAt: string;
    reviewer?: { fullNameInitial?: string; fullName?: string | null };
  }[];
  canWriteReview?: boolean;
  ownReviewId?: string | null;
};

/** @deprecated VENUE-2 owns reviews. */
export async function fetchVenueReviews(venueId: string): Promise<LegacyVenueReview[]> {
  const resp = await apiGet<ApiReviewsResponse>(`/venues/${venueId}/reviews`);
  return resp.rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment ?? '',
    createdAt: new Date(r.createdAt),
  }));
}
