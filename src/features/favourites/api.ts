/**
 * Saved venues, saved classes and saved hikes and sights, backed by the
 * LifePass API: the Android port of iOS `FavouritesService`
 * (Services/FavouritesService.swift) and its models (Models/Favourite.swift).
 *
 *   GET    /favourites?include=attractions&locale=   { venues, activities, attractions }
 *   POST   /favourites                    { venueId }, { activityId } or { attractionSlug }
 *   DELETE /favourites?venueId=…          (or ?activityId=…, ?attractionSlug=…)
 *
 * `GET /favourites` returns every kind in one call, so one read fills the
 * whole store. The API has no per-venue or per-place "is this saved" probe: a
 * heart reads the list, as iOS `isFavourite(venueId:)` does.
 *
 * HIKES AND SIGHTS (API 0.45.0). A place is saved and unsaved by its slug,
 * which every attractions payload carries and which never changes. The list
 * carries the saved places only when asked (`include=attractions`; without it
 * the answer is exactly the 0.43.0 one), with their labels in the asked
 * language (`locale`, the app's). Their decode is LOSSY per item (a malformed
 * place is dropped, the rest kept) and a missing `attractions` key is an empty
 * list: the places came later, and one odd place must never cost the member
 * their venue hearts.
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
import { currentLanguage, type Lang } from '../../i18n';

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

/**
 * A saved hike or sight as `GET /favourites?include=attractions` returns it
 * (API 0.45.0, `FavouriteAttraction`): published places only, newest first,
 * the words already in the asked language.
 */
export interface FavouriteAttraction {
  /** The favourite row's id. */
  readonly id: string;
  readonly attractionId: string | null;
  /** What the heart keys on, and what opens the place's card (`AttractionDetail { slug }`). */
  readonly slug: string;
  /** In the asked language (the English exonym on `en` where one exists). */
  readonly name: string;
  /** The Icelandic name. */
  readonly localName: string | null;
  readonly kind: string;
  /** "Waterfall", "Hike": the server's words. */
  readonly kindLabel: string | null;
  readonly region: string;
  /** "South Iceland": the server's words. */
  readonly regionLabel: string | null;
  readonly lengthM: number | null;
  readonly durationMinutes: number | null;
  readonly difficulty: string | null;
  readonly difficultyLabel: string | null;
  /** `lengthM` is one way, and `durationMinutes` already covers there and back. */
  readonly outAndBack: boolean;
  /** An absolute 640-wide photograph, or the location plate. */
  readonly imageUrl: string | null;
  readonly imageAlt: string | null;
  /** The plate: a map, shown whole and never called a photo. */
  readonly imageIsMapPlate: boolean;
  /** A photograph's author and licence; both null for the plate. */
  readonly imageCredit: string | null;
  readonly imageLicense: string | null;
  readonly createdAt: Date | null;
}

/** The whole `GET /favourites` answer. */
export interface FavouritesPayload {
  readonly venues: readonly FavouriteVenue[];
  readonly activities: readonly FavouriteActivity[];
  /** The saved hikes and sights (API 0.45.0); empty from a server that sends none. */
  readonly attractions: readonly FavouriteAttraction[];
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

/**
 * `GET /favourites?include=attractions&locale=`: one round-trip for every
 * kind, the places' words in `locale` (default: the language on screen).
 */
export function fetchFavourites(locale: Lang = currentLanguage(), options: CallOptions = {}): Promise<FavouritesPayload> {
  return apiGet<FavouritesPayload>(
    '/favourites',
    { include: 'attractions', locale },
    { ...options, decode: decodeFavourites },
  );
}

/**
 * `POST /favourites { attractionSlug }` (API 0.45.0). Saving a place that is
 * already saved succeeds; an unknown or unpublished one is a 404.
 */
export async function addFavouriteAttraction(slug: string): Promise<void> {
  await apiPost('/favourites', { attractionSlug: slug });
}

/**
 * `DELETE /favourites?attractionSlug=` (API 0.45.0). Always succeeds for the
 * member, saved or not, published or not.
 */
export async function removeFavouriteAttraction(slug: string): Promise<void> {
  await apiDelete('/favourites', { attractionSlug: slug });
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

/** A string with something in it, else null. */
function softText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A whole number of 0 or more, else null. */
function softWhole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * One saved place, or null when it cannot be shown: it needs its slug (what
 * the heart and the card key on) and a name. Everything else is read softly.
 */
export function decodeFavouriteAttraction(value: unknown): FavouriteAttraction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const json = value as Json;
  const slug = softText(json.slug);
  const name = softText(json.name);
  if (slug === null || name === null) return null;
  const createdAt = typeof json.createdAt === 'string' ? parseIsoDate(json.createdAt) : null;
  return {
    id: softText(json.id) ?? slug,
    attractionId: softText(json.attractionId),
    slug,
    name,
    localName: softText(json.localName),
    kind: softText(json.kind) ?? 'other',
    kindLabel: softText(json.kindLabel),
    region: softText(json.region) ?? '',
    regionLabel: softText(json.regionLabel),
    lengthM: softWhole(json.lengthM),
    durationMinutes: softWhole(json.durationMinutes),
    difficulty: softText(json.difficulty),
    difficultyLabel: softText(json.difficultyLabel),
    outAndBack: json.outAndBack === true,
    imageUrl: softText(json.imageUrl),
    imageAlt: softText(json.imageAlt),
    imageIsMapPlate: json.imageIsMapPlate === true,
    imageCredit: softText(json.imageCredit),
    imageLicense: softText(json.imageLicense),
    createdAt,
  };
}

/** The saved places: lossy per item, and none when the key is missing (see the file comment). */
export function decodeFavouriteAttractions(value: unknown): FavouriteAttraction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const places: FavouriteAttraction[] = [];
  for (const item of value) {
    const place = decodeFavouriteAttraction(item);
    // One row per place: a heart keys on the slug.
    if (place && !seen.has(place.slug)) {
      seen.add(place.slug);
      places.push(place);
    }
  }
  return places;
}

/**
 * The `data` of `GET /favourites`: the venue and class lists are required,
 * all or nothing (as iOS reads them); the places are read lossily.
 */
export function decodeFavourites(data: unknown): FavouritesPayload {
  const json = object(data, 'favourites');
  return {
    venues: array(json.venues, 'favourites.venues').map((v, i) => decodeFavouriteVenue(v, `favourites.venues[${i}]`)),
    activities: array(json.activities, 'favourites.activities').map((a, i) =>
      decodeFavouriteActivity(a, `favourites.activities[${i}]`),
    ),
    attractions: decodeFavouriteAttractions(json.attractions),
  };
}
