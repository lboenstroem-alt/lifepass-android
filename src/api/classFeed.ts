/**
 * The cross-venue class discovery feed: the Android port of iOS
 * `ClassFeedService` (Services/ClassFeedService.swift) and the `ClassFeed`
 * models (Models/ClassFeed.swift).
 *
 *   GET /classes?limit=100[&q][&category][&start][&end][&cursor]
 *
 * The server merges Abler classes (a snapshot about 15 minutes old) with
 * first-party classes into one time-ordered list. The timetable is a hint:
 * the booking flow re-validates bookability, capacity and pricing when it
 * creates the booking.
 *
 * Search (`q`) and category filtering are server-side; the distance filter is
 * client-side ONLY. Each item carries its venue's coordinates and the
 * member's location never leaves the phone (the privacy policy's promise,
 * mirrored from the web Classes tab).
 *
 * Decoding is iOS's: a page decodes all or nothing (Swift `[ClassFeedItem]`),
 * a field of the wrong type fails it (a `DecodingError`, which the feed shows
 * as its load error), and one deliberate exception is fail-soft: a booking
 * `kind` this build does not know becomes `unsupported`, a row that still
 * renders but cannot be tapped (forward compatibility).
 */
import { apiGet, type RequestOptions } from './client';
import { TransportError } from './errors';
import { parseIsoDate } from './wire';

/** Every request asks for a full page (iOS `limit: Int = 100`). */
export const CLASS_FEED_PAGE_LIMIT = 100;

/**
 * The widest window one request may ask for: the server answers `start...end`
 * inclusive up to 14 days (`start` + 13) and refuses a wider one with a 400
 * (`class-feed-range-too-wide`). iOS `ClassFeedService.maxSpanDays`.
 */
export const CLASS_FEED_MAX_SPAN_DAYS = 14;

// MARK: - Models

/** A venue's position on the feed. */
export interface ClassFeedCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** The venue a class is at: just enough for a card and for distance math. */
export interface ClassFeedVenue {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Null when the venue has none: never placed at 0,0, never measured from. */
  readonly coordinates: ClassFeedCoordinates | null;
}

/** `attendance`; `limit` -1 means unlimited. */
export interface ClassFeedAttendance {
  readonly current: number;
  readonly limit: number;
}

/**
 * The booking handle: Abler classes book by `eventId`, first-party classes by
 * their slot times, both through the standard booking flow. A kind this build
 * does not know is `unsupported`: the row still renders, it just cannot launch
 * a booking.
 */
export type ClassFeedBooking =
  | { readonly kind: 'class'; readonly activityId: string; readonly eventId: number }
  | { readonly kind: 'slot'; readonly activityId: string; readonly startsAt: Date; readonly endsAt: Date }
  | { readonly kind: 'unsupported'; readonly activityId: string };

/**
 * A single feed entry: an upcoming class at some venue, with just enough
 * context to render a discovery card and hand off to the booking flow.
 */
export interface ClassFeedItem {
  /** "abler" | "internal". */
  readonly source: string;
  readonly name: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly instructor: string | null;
  readonly locationText: string | null;
  readonly attendance: ClassFeedAttendance | null;
  readonly full: boolean;
  /** The provider's bookability verdict; null when unknown (first-party classes). */
  readonly canBook: boolean | null;
  readonly canBookReason: string | null;
  readonly registrationOpensAt: Date | null;
  readonly categorySlugs: readonly string[];
  /**
   * Cheapest possible surcharge at this venue, only for venues outside the
   * tier bundle; in-bundle venues (boutiques included) show none. Never a
   * caller-specific quote: the booking flow discloses the exact charge.
   */
  readonly surchargeFromIsk: number | null;
  readonly venue: ClassFeedVenue;
  readonly booking: ClassFeedBooking;
}

/** One page of the feed. */
export interface ClassFeedPage {
  readonly classes: readonly ClassFeedItem[];
  readonly nextCursor: string | null;
  readonly fetchedAt: Date;
}

// MARK: - Fetching

/** The filters one page is asked for. Empty values are left out of the request. */
export interface ClassFeedPageQuery {
  /** `q`, sent as given (the feed trims it and cuts it to 80 characters first). */
  readonly query?: string | null;
  /** A category slug (server-side; the server tolerates any slug). */
  readonly category?: string | null;
  /** First venue-local day, `YYYY-MM-DD` (inclusive). */
  readonly start?: string | null;
  /** Last venue-local day, `YYYY-MM-DD` (inclusive); the same as `start` for one day. */
  readonly end?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export type ClassFeedCallOptions = Pick<RequestOptions, 'signal'>;

/** What fetches one page: `fetchClassFeedPage` in the app, a fake in a test if it wants one. */
export type ClassFeedFetcher = (query: ClassFeedPageQuery, options?: ClassFeedCallOptions) => Promise<ClassFeedPage>;

/**
 * Fetch one feed page (iOS `ClassFeedService.fetchPage`). With no days the
 * server answers its default window (today + 7, as the web tab).
 */
export async function fetchClassFeedPage(
  query: ClassFeedPageQuery = {},
  options: ClassFeedCallOptions = {},
): Promise<ClassFeedPage> {
  return apiGet<ClassFeedPage>(
    '/classes',
    {
      limit: query.limit ?? CLASS_FEED_PAGE_LIMIT,
      q: query.query || undefined,
      category: query.category || undefined,
      start: query.start || undefined,
      end: query.end || undefined,
      cursor: query.cursor || undefined,
    },
    { signal: options.signal, decode: decodeClassFeedPage },
  );
}

/** How a look-ahead through the feed ended (iOS `ClassFeedService.LookAhead`). */
export type ClassFeedLookAhead =
  /** The earliest class in the window that the caller accepted. */
  | { readonly kind: 'found'; readonly item: ClassFeedItem }
  /** The window was read to its end and nothing in it was accepted. */
  | { readonly kind: 'exhausted' }
  /** `maxPages` were read without an answer and more remain: "nothing" would be a guess. */
  | { readonly kind: 'gaveUp' };

export interface FirstMatchOptions {
  readonly query: string | null;
  readonly category: string | null;
  readonly start: string;
  readonly end: string;
  /** iOS default 10; the empty day's look-ahead reads 3. */
  readonly maxPages?: number;
  /**
   * The CLIENT-side filters (already started, "Near me"). The server cannot
   * apply them, so a page can come back full of classes none of which count,
   * and only the next page can say whether one does.
   */
  readonly accept: (item: ClassFeedItem) => boolean;
  /** Cancels the look-ahead (and its request in flight). */
  readonly signal?: AbortSignal;
  readonly fetchPage?: ClassFeedFetcher;
}

/**
 * Read the feed for `start...end` (venue-local days, inclusive, at most
 * `CLASS_FEED_MAX_SPAN_DAYS` apart) page by page, with the same server-side
 * filters as the list, and return the earliest class `accept` takes (iOS
 * `ClassFeedService.firstMatch`). The feed is time-ordered across pages, so
 * the first page with an accepted class holds the earliest one.
 */
export async function firstMatch(options: FirstMatchOptions): Promise<ClassFeedLookAhead> {
  const { query, category, start, end, accept, signal } = options;
  const maxPages = options.maxPages ?? 10;
  const fetchPage = options.fetchPage ?? fetchClassFeedPage;
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    // Swift `Task.checkCancellation()`: a cancelled look-ahead asks nothing more.
    if (signal?.aborted) throw new TransportError('cancelled');
    const result: ClassFeedPage = await fetchPage({ query, category, start, end, cursor }, { signal });
    let earliest: ClassFeedItem | null = null;
    for (const item of result.classes) {
      if (!accept(item)) continue;
      // Strictly earlier only: Swift's `min(by:)` keeps the first of equals.
      if (!earliest || item.startsAt.getTime() < earliest.startsAt.getTime()) earliest = item;
    }
    if (earliest) return { kind: 'found', item: earliest };
    if (!result.nextCursor) return { kind: 'exhausted' };
    cursor = result.nextCursor;
  }
  return { kind: 'gaveUp' };
}

// MARK: - Decoding

/** Why a value did not decode; the client turns it into a `DecodingError`. */
export class ClassFeedDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'ClassFeedDecodeError';
  }
}

type Json = Record<string, unknown>;

/** Swift's `UUID` decoding: anything else fails the item. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Json {
  if (!isObject(value)) throw new ClassFeedDecodeError(path, 'an object');
  return value;
}

/** Absent and null are both "not there" (Swift `decodeIfPresent`). */
function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function requiredString(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new ClassFeedDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalString(json: Json, key: string, path: string): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new ClassFeedDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function requiredUuid(json: Json, key: string, path: string): string {
  const value = requiredString(json, key, path);
  if (!UUID.test(value)) throw new ClassFeedDecodeError(`${path}.${key}`, 'a UUID');
  return value;
}

function requiredBool(json: Json, key: string, path: string): boolean {
  const value = json[key];
  if (typeof value !== 'boolean') throw new ClassFeedDecodeError(`${path}.${key}`, 'a boolean');
  return value;
}

function optionalBool(json: Json, key: string, path: string): boolean | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'boolean') throw new ClassFeedDecodeError(`${path}.${key}`, 'a boolean');
  return value;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function requiredInteger(json: Json, key: string, path: string): number {
  const value = json[key];
  if (!isInteger(value)) throw new ClassFeedDecodeError(`${path}.${key}`, 'an integer');
  return value;
}

function optionalInteger(json: Json, key: string, path: string): number | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (!isInteger(value)) throw new ClassFeedDecodeError(`${path}.${key}`, 'an integer');
  return value;
}

function requiredNumber(json: Json, key: string, path: string): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ClassFeedDecodeError(`${path}.${key}`, 'a number');
  return value;
}

function requiredDate(json: Json, key: string, path: string): Date {
  const date = parseIsoDate(requiredString(json, key, path));
  if (!date) throw new ClassFeedDecodeError(`${path}.${key}`, 'an ISO-8601 date');
  return date;
}

function optionalDate(json: Json, key: string, path: string): Date | null {
  const raw = optionalString(json, key, path);
  if (raw === null) return null;
  const date = parseIsoDate(raw);
  if (!date) throw new ClassFeedDecodeError(`${path}.${key}`, 'an ISO-8601 date');
  return date;
}

function decodeAttendance(json: Json, path: string): ClassFeedAttendance | null {
  const value = present(json, 'attendance');
  if (value === undefined) return null;
  const attendance = object(value, `${path}.attendance`);
  return {
    current: requiredInteger(attendance, 'current', `${path}.attendance`),
    limit: requiredInteger(attendance, 'limit', `${path}.attendance`),
  };
}

function decodeVenue(json: Json, path: string): ClassFeedVenue {
  const venue = object(json.venue, `${path}.venue`);
  const where = `${path}.venue`;
  const raw = present(venue, 'coordinates');
  let coordinates: ClassFeedCoordinates | null = null;
  if (raw !== undefined) {
    const point = object(raw, `${where}.coordinates`);
    coordinates = {
      latitude: requiredNumber(point, 'latitude', `${where}.coordinates`),
      longitude: requiredNumber(point, 'longitude', `${where}.coordinates`),
    };
  }
  return {
    id: requiredUuid(venue, 'id', where),
    slug: requiredString(venue, 'slug', where),
    name: requiredString(venue, 'name', where),
    coordinates,
  };
}

/** iOS `BookingRef.init(from:)`: an unknown kind is `unsupported`, never a failure. */
export function decodeClassFeedBooking(value: unknown, path = 'booking'): ClassFeedBooking {
  const booking = object(value, path);
  const activityId = requiredUuid(booking, 'activityId', path);
  const kind = requiredString(booking, 'kind', path);
  switch (kind) {
    case 'class':
      return { kind: 'class', activityId, eventId: requiredInteger(booking, 'eventId', path) };
    case 'slot':
      return {
        kind: 'slot',
        activityId,
        startsAt: requiredDate(booking, 'startsAt', path),
        endsAt: requiredDate(booking, 'endsAt', path),
      };
    default:
      return { kind: 'unsupported', activityId };
  }
}

/** One feed item, as iOS `ClassFeedItem` decodes it. */
export function decodeClassFeedItem(value: unknown, path = 'item'): ClassFeedItem {
  const json = object(value, path);
  const slugs = json.categorySlugs;
  if (!Array.isArray(slugs) || !slugs.every((slug) => typeof slug === 'string')) {
    throw new ClassFeedDecodeError(`${path}.categorySlugs`, 'a list of strings');
  }
  return {
    source: requiredString(json, 'source', path),
    name: optionalString(json, 'name', path),
    startsAt: requiredDate(json, 'startsAt', path),
    endsAt: requiredDate(json, 'endsAt', path),
    instructor: optionalString(json, 'instructor', path),
    locationText: optionalString(json, 'locationText', path),
    attendance: decodeAttendance(json, path),
    full: requiredBool(json, 'full', path),
    canBook: optionalBool(json, 'canBook', path),
    canBookReason: optionalString(json, 'canBookReason', path),
    registrationOpensAt: optionalDate(json, 'registrationOpensAt', path),
    categorySlugs: [...(slugs as string[])],
    surchargeFromIsk: optionalInteger(json, 'surchargeFromIsk', path),
    venue: decodeVenue(json, path),
    booking: decodeClassFeedBooking(json.booking, `${path}.booking`),
  };
}

/** A feed page: every item or nothing. */
export function decodeClassFeedPage(value: unknown): ClassFeedPage {
  const json = object(value, 'page');
  if (!Array.isArray(json.classes)) throw new ClassFeedDecodeError('page.classes', 'a list');
  return {
    classes: json.classes.map((item, index) => decodeClassFeedItem(item, `page.classes[${index}]`)),
    nextCursor: optionalString(json, 'nextCursor', 'page'),
    fetchedAt: requiredDate(json, 'fetchedAt', 'page'),
  };
}
