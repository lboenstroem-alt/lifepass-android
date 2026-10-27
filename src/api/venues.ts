/**
 * Venue reads: the Android port of iOS `VenueService` (Services/VenueService.swift)
 * and the `Venue` decoder (Models/Venue.swift).
 *
 *   GET /venues?limit=100[&q][&category][&city]   the lists (one page is the
 *                                                  whole catalogue today)
 *   GET /venues/by-slug/{slug}                     one venue; the API has no
 *                                                  get-by-id, so the venue page
 *                                                  is reached by slug
 *
 * Both answer the `VenueSummary` shape, read by `decodeVenue` exactly as iOS
 * reads it: `id`, `slug` and `name` are required, every other field may be
 * missing or null, and a field of the wrong TYPE fails the decode (a
 * `DecodingError`, shown as "the server answered unexpectedly"), with two
 * deliberate exceptions that are fail-soft, as on iOS and the web:
 *   - `offerings`: a list keeps its strings and drops anything else (the web's
 *     `stringsOf`), and a value that is not a list reads as none, so one stray
 *     element never costs the member the venue;
 *   - `markerType`: anything but a string reads as none;
 *   - the rating numbers of API 0.46.0, `totalRatings` and the
 *     `equipmentRating` / `cleanlinessRating` sub-scores: garnish beside the
 *     stars, so a malformed one reads as none (`softCount`, `softSubRating`).
 * A list page decodes all or nothing, as iOS's `[Venue]` does.
 */
import { apiGet, type RequestOptions } from './client';
import type { DayHours, OpeningHours, SubRating, Venue } from '../types/venue';
import { WEEKDAYS } from '../types/venue';

/** One page holds the whole catalogue (about 45 venues; the API caps a page at 100). */
export const VENUE_PAGE_LIMIT = 100;

/** The filters `GET /venues` takes. Empty values are left out of the request. */
export interface VenueQuery {
  /** Free-text search (`q`), sent as typed. */
  readonly search?: string | null;
  /**
   * ONE database category (the API filters on a single string). A filter chip
   * maps its id to its first database category before calling (iOS
   * `CategoryMapping.dbCategories(for:).first`).
   */
  readonly category?: string | null;
  readonly city?: string | null;
  /** Default `VENUE_PAGE_LIMIT`; the Coach venue wizard asks for 20. */
  readonly limit?: number;
}

type CallOptions = Pick<RequestOptions, 'signal'>;

/** `GET /venues`: active public venues in the server's order (`display_order`). */
export async function fetchVenues(query: VenueQuery = {}, options: CallOptions = {}): Promise<Venue[]> {
  return apiGet<Venue[]>(
    '/venues',
    {
      limit: query.limit ?? VENUE_PAGE_LIMIT,
      q: query.search || undefined,
      category: query.category || undefined,
      city: query.city || undefined,
    },
    { ...options, decode: decodeVenuePage },
  );
}

/** `GET /venues/by-slug/{slug}`: one venue. */
export async function fetchVenueBySlug(slug: string, options: CallOptions = {}): Promise<Venue> {
  return apiGet<Venue>(`/venues/by-slug/${encodeURIComponent(slug)}`, undefined, {
    ...options,
    decode: decodeVenue,
  });
}

// MARK: - Decoding

/** Why a value did not decode; the client turns it into a `DecodingError`. */
export class VenueDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'VenueDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Json {
  if (!isObject(value)) throw new VenueDecodeError(path, 'an object');
  return value;
}

/** Absent and null are both "not there" (Swift `decodeIfPresent`). */
function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function requiredString(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new VenueDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalString(json: Json, key: string, path: string): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new VenueDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalBool(json: Json, key: string, path: string): boolean | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'boolean') throw new VenueDecodeError(`${path}.${key}`, 'a boolean');
  return value;
}

function optionalNumber(json: Json, key: string, path: string): number | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new VenueDecodeError(`${path}.${key}`, 'a number');
  return value;
}

function optionalInteger(json: Json, key: string, path: string): number | null {
  const value = optionalNumber(json, key, path);
  if (value !== null && !Number.isInteger(value)) throw new VenueDecodeError(`${path}.${key}`, 'an integer');
  return value;
}

function optionalStrings(json: Json, key: string, path: string): string[] | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new VenueDecodeError(`${path}.${key}`, 'a list of strings');
  }
  return [...(value as string[])];
}

/** A count read fail-soft: a whole number of 0 or more, anything else none. */
export function softCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A sub-score (`{ average, count }`, API 0.46.0) read fail-soft: an average
 * from 1 to 5 given by at least one member, anything else none. The server
 * sends one only from 3 ratings up; the phone never applies that rule itself.
 */
export function softSubRating(value: unknown): SubRating | null {
  if (!isObject(value)) return null;
  const { average } = value;
  const count = softCount(value.count);
  if (typeof average !== 'number' || !Number.isFinite(average) || average < 1 || average > 5) return null;
  if (count === null || count === 0) return null;
  return { average, count };
}

/**
 * A list read for its strings only: `["pool", null, 3]` is `["pool"]`, and
 * `[null, null]` is `[]` (still the server's list, not a missing one). Anything
 * that is not a list is none (iOS `StringElements`, the web's `stringsOf`).
 */
export function stringsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

function decodeDayHours(value: unknown, path: string): DayHours | null {
  if (value === undefined || value === null) return null;
  const day = object(value, path);
  return {
    open: optionalString(day, 'open', path),
    close: optionalString(day, 'close', path),
    closed: optionalBool(day, 'closed', path),
  };
}

function decodeOpeningHours(value: unknown, path: string): OpeningHours | null {
  if (value === undefined || value === null) return null;
  const hours = object(value, path);
  const result = {} as Record<(typeof WEEKDAYS)[number], DayHours | null>;
  for (const day of WEEKDAYS) result[day] = decodeDayHours(hours[day], `${path}.${day}`);
  return result;
}

/**
 * One `VenueSummary` (see the file comment for what is strict and what is
 * fail-soft). The id is kept lower-case, the way the server writes ids, so
 * ids from different screens compare equal.
 */
export function decodeVenue(raw: unknown, path = 'venue'): Venue {
  const json = object(raw, path);
  const id = requiredString(json, 'id', path);
  if (!UUID.test(id)) throw new VenueDecodeError(`${path}.id`, 'a UUID');

  let latitude: number | null = null;
  let longitude: number | null = null;
  const coordinates = present(json, 'coordinates');
  if (coordinates !== undefined) {
    const point = object(coordinates, `${path}.coordinates`);
    latitude = optionalNumber(point, 'latitude', `${path}.coordinates`);
    longitude = optionalNumber(point, 'longitude', `${path}.coordinates`);
    // Half a position is no position: never drawn, never measured from.
    if (latitude === null || longitude === null) {
      latitude = null;
      longitude = null;
    }
  }

  const markerType = present(json, 'markerType');

  return {
    id: id.toLowerCase(),
    slug: requiredString(json, 'slug', path),
    name: requiredString(json, 'name', path),
    description: optionalString(json, 'description', path),
    descriptionIs: optionalString(json, 'descriptionIs', path),
    address: optionalString(json, 'address', path),
    city: optionalString(json, 'city', path),
    latitude,
    longitude,
    imageUrl: optionalString(json, 'imageUrl', path),
    categories: optionalStrings(json, 'categories', path),
    primaryCategory: optionalString(json, 'category', path),
    walkInsAllowed: optionalBool(json, 'walkInsAllowed', path),
    phone: optionalString(json, 'phone', path),
    amenities: optionalStrings(json, 'amenities', path),
    averageRating: optionalNumber(json, 'averageRating', path),
    totalReviews: optionalInteger(json, 'totalReviews', path),
    // Fail-soft (see the file comment).
    totalRatings: softCount(present(json, 'totalRatings')),
    equipmentRating: softSubRating(present(json, 'equipmentRating')),
    cleanlinessRating: softSubRating(present(json, 'cleanlinessRating')),
    displayOrder: optionalInteger(json, 'displayOrder', path),
    awaitingConnection: optionalBool(json, 'awaitingConnection', path),
    activitiesAwaitingConnection: optionalBool(json, 'activitiesAwaitingConnection', path),
    openingHours: decodeOpeningHours(present(json, 'openingHours'), `${path}.openingHours`),
    // Fail-soft (see the file comment).
    offerings: stringsOf(present(json, 'offerings')),
    markerType: typeof markerType === 'string' ? markerType : null,
    inBundle: optionalBool(json, 'inBundle', path) ?? false,
    surchargePrice: optionalInteger(json, 'surchargePrice', path),
    resolvedSurchargePrice: optionalInteger(json, 'resolvedSurchargePrice', path),
    topupPrice: optionalInteger(json, 'topupPrice', path),
    daypassPrice: optionalInteger(json, 'daypassPrice', path),
  };
}

/** `GET /venues`'s page (`{ data, pagination, facets }`); only `data` is read. */
export function decodeVenuePage(raw: unknown): Venue[] {
  const page = object(raw, 'page');
  if (!Array.isArray(page.data)) throw new VenueDecodeError('page.data', 'a list');
  return page.data.map((row, index) => decodeVenue(row, `page.data[${index}]`));
}

/**
 * A venue back in the API's shape, so a round trip is stable (iOS
 * `Venue.encode(to:)`, used for fixtures and caches). Absent fields are left
 * out; `inBundle` is always written.
 */
export function venueToApi(venue: Venue): Json {
  const out: Json = { id: venue.id, slug: venue.slug, name: venue.name };
  const put = (key: string, value: unknown) => {
    if (value !== null && value !== undefined) out[key] = value;
  };
  put('description', venue.description);
  put('descriptionIs', venue.descriptionIs);
  put('address', venue.address);
  put('city', venue.city);
  if (venue.latitude !== null && venue.longitude !== null) {
    out.coordinates = { latitude: venue.latitude, longitude: venue.longitude };
  }
  put('imageUrl', venue.imageUrl);
  put('categories', venue.categories);
  put('category', venue.primaryCategory);
  put('walkInsAllowed', venue.walkInsAllowed);
  put('phone', venue.phone);
  put('amenities', venue.amenities);
  put('averageRating', venue.averageRating);
  put('totalReviews', venue.totalReviews);
  put('totalRatings', venue.totalRatings);
  put('equipmentRating', venue.equipmentRating);
  put('cleanlinessRating', venue.cleanlinessRating);
  put('displayOrder', venue.displayOrder);
  put('awaitingConnection', venue.awaitingConnection);
  put('activitiesAwaitingConnection', venue.activitiesAwaitingConnection);
  if (venue.openingHours) {
    const hours: Json = {};
    for (const day of WEEKDAYS) {
      const value = venue.openingHours[day];
      if (!value) continue;
      const entry: Json = {};
      if (value.open !== null) entry.open = value.open;
      if (value.close !== null) entry.close = value.close;
      if (value.closed !== null) entry.closed = value.closed;
      hours[day] = entry;
    }
    out.openingHours = hours;
  }
  put('offerings', venue.offerings);
  put('markerType', venue.markerType);
  out.inBundle = venue.inBundle;
  put('surchargePrice', venue.surchargePrice);
  put('resolvedSurchargePrice', venue.resolvedSurchargePrice);
  put('topupPrice', venue.topupPrice);
  put('daypassPrice', venue.daypassPrice);
  return out;
}
