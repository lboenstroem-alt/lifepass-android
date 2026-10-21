/**
 * Saved venues and saved classes, backed by the LifePass API: the Android port
 * of iOS `FavouritesService` (Services/FavouritesService.swift) and its models
 * (Models/Favourite.swift).
 *
 *   GET    /favourites                    { venues: [...], activities: [...] }
 *   POST   /favourites                    { venueId } or { activityId }
 *   DELETE /favourites?venueId=…          (or ?activityId=…)
 *
 * `GET /favourites` returns both kinds in one call, so one read fills the
 * whole store. The API has no per-venue "is this saved" probe: a heart reads
 * the list, as iOS `isFavourite(venueId:)` does.
 *
 * Add and remove are low-risk preference writes: no Idempotency-Key (the
 * mobile contract, iOS FavouritesService). The server answers an add of a
 * venue that is already saved, and a remove of one that is not, with a plain
 * success, so a write never has to know the server's state first.
 *
 * DECODING follows the Swift `Codable` structs: the ids, `slug`/`name` (and
 * the activity's venue fields) are required, everything else may be missing or
 * null, and a value of the wrong type fails the read (a `DecodingError`, "the
 * server answered unexpectedly"), as `JSONDecoder` would. Ids are kept in
 * lower case: iOS compares them as `UUID` values, which ignores case, and the
 * Android store compares strings.
 */
import { apiDelete, apiGet, apiPost, parseIsoDate, wireId, type RequestOptions } from '../../api';

/** A saved venue as `GET /favourites` returns it (iOS `FavouriteVenue`). */
export interface FavouriteVenue {
  /** The favourite row's id. */
  readonly id: string;
  /** The venue's id (lower case): what a heart and `isFavourite` key on. */
  readonly venueId: string;
  /** Opens the venue page (`VenueDetail { slug }`). */
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly city: string | null;
  readonly address: string | null;
  /** v1: free within the plan (true) or premium, a la carte (false). */
  readonly inBundle: boolean | null;
  readonly imageUrl: string | null;
  readonly categories: readonly string[] | null;
  readonly createdAt: Date | null;
}

/** A saved class as `GET /favourites` returns it (iOS `FavouriteActivity`). */
export interface FavouriteActivity {
  /** The favourite row's id. */
  readonly id: string;
  /** The activity's id (lower case). */
  readonly activityId: string;
  readonly name: string;
  readonly description: string | null;
  readonly durationMinutes: number | null;
  readonly imageUrl: string | null;
  readonly venueId: string;
  /** Tapping the row opens this venue's page. */
  readonly venueSlug: string;
  readonly venueName: string;
  readonly createdAt: Date | null;
}

/** The whole `GET /favourites` answer. */
export interface FavouritesPayload {
  readonly venues: readonly FavouriteVenue[];
  readonly activities: readonly FavouriteActivity[];
}

/**
 * Premium = not in the bundle (iOS `FavouriteVenue.isPremium`). A favourite
 * row with no marker counts as in the bundle, exactly as the Swift reads it
 * (`!(inBundle ?? true)`); the Saved sheet's "Premium" tag follows this.
 */
export function isPremiumFavourite(venue: Pick<FavouriteVenue, 'inBundle'>): boolean {
  return !(venue.inBundle ?? true);
}

type CallOptions = Pick<RequestOptions, 'signal'>;

/** `GET /favourites`: one round-trip for both kinds. */
export function fetchFavourites(options: CallOptions = {}): Promise<FavouritesPayload> {
  return apiGet<FavouritesPayload>('/favourites', undefined, { ...options, decode: decodeFavourites });
}

/** `POST /favourites { venueId }`. Saving a venue that is already saved succeeds. */
export async function addFavouriteVenue(venueId: string): Promise<void> {
  await apiPost('/favourites', { venueId: wireId(venueId) });
}

/** `POST /favourites { activityId }`. */
export async function addFavouriteActivity(activityId: string): Promise<void> {
  await apiPost('/favourites', { activityId: wireId(activityId) });
}

/** `DELETE /favourites?venueId=`. Removing a venue that is not saved succeeds. */
export async function removeFavouriteVenue(venueId: string): Promise<void> {
  await apiDelete('/favourites', { venueId: wireId(venueId) });
}

/** `DELETE /favourites?activityId=`. */
export async function removeFavouriteActivity(activityId: string): Promise<void> {
  await apiDelete('/favourites', { activityId: wireId(activityId) });
}

// MARK: - Decoding

/** Why a favourites answer did not decode; the client turns it into a `DecodingError`. */
export class FavouritesDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'FavouritesDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FavouritesDecodeError(path, 'an object');
  }
  return value as Json;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new FavouritesDecodeError(path, 'a list');
  return value;
}

/** Absent and null are both "not there" (Swift `decodeIfPresent`). */
function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function requiredString(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new FavouritesDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function requiredId(json: Json, key: string, path: string): string {
  const value = requiredString(json, key, path);
  if (!UUID.test(value)) throw new FavouritesDecodeError(`${path}.${key}`, 'a UUID');
  return value.toLowerCase();
}

function optionalString(json: Json, key: string, path: string): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new FavouritesDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalBool(json: Json, key: string, path: string): boolean | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'boolean') throw new FavouritesDecodeError(`${path}.${key}`, 'a boolean');
  return value;
}

function optionalInteger(json: Json, key: string, path: string): number | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new FavouritesDecodeError(`${path}.${key}`, 'a whole number');
  }
  return value;
}

function optionalStrings(json: Json, key: string, path: string): string[] | null {
  const value = present(json, key);
  if (value === undefined) return null;
  return array(value, `${path}.${key}`).map((item, i) => {
    if (typeof item !== 'string') throw new FavouritesDecodeError(`${path}.${key}[${i}]`, 'a string');
    return item;
  });
}

function optionalDate(json: Json, key: string, path: string): Date | null {
  const raw = optionalString(json, key, path);
  if (raw === null) return null;
  const date = parseIsoDate(raw);
  // A date that is there but unreadable fails the decode, as JSONDecoder does.
  if (!date) throw new FavouritesDecodeError(`${path}.${key}`, 'an ISO-8601 date');
  return date;
}

export function decodeFavouriteVenue(value: unknown, path = 'venue'): FavouriteVenue {
  const json = object(value, path);
  return {
    id: requiredId(json, 'id', path),
    venueId: requiredId(json, 'venueId', path),
    slug: requiredString(json, 'slug', path),
    name: requiredString(json, 'name', path),
    description: optionalString(json, 'description', path),
    city: optionalString(json, 'city', path),
    address: optionalString(json, 'address', path),
    inBundle: optionalBool(json, 'inBundle', path),
    imageUrl: optionalString(json, 'imageUrl', path),
    categories: optionalStrings(json, 'categories', path),
    createdAt: optionalDate(json, 'createdAt', path),
  };
}

export function decodeFavouriteActivity(value: unknown, path = 'activity'): FavouriteActivity {
  const json = object(value, path);
  return {
    id: requiredId(json, 'id', path),
    activityId: requiredId(json, 'activityId', path),
    name: requiredString(json, 'name', path),
    description: optionalString(json, 'description', path),
    durationMinutes: optionalInteger(json, 'durationMinutes', path),
    imageUrl: optionalString(json, 'imageUrl', path),
    venueId: requiredId(json, 'venueId', path),
    venueSlug: requiredString(json, 'venueSlug', path),
    venueName: requiredString(json, 'venueName', path),
    createdAt: optionalDate(json, 'createdAt', path),
  };
}

/** The `data` of `GET /favourites`: both lists are required, all or nothing. */
export function decodeFavourites(data: unknown): FavouritesPayload {
  const json = object(data, 'favourites');
  return {
    venues: array(json.venues, 'favourites.venues').map((v, i) => decodeFavouriteVenue(v, `favourites.venues[${i}]`)),
    activities: array(json.activities, 'favourites.activities').map((a, i) =>
      decodeFavouriteActivity(a, `favourites.activities[${i}]`),
    ),
  };
}
