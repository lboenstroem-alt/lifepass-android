/**
 * My bookings: the list and the cancel. The Android port of the read half of
 * iOS `BookingService` (Services/BookingService.swift `fetchBookings`,
 * `cancelBooking`) and of its read model (Models/Booking.swift `Booking`).
 * Owned by LIB-1; it replaces the list half of the first build's
 * src/supabase/services/bookings.ts, whose model folded `pending` into
 * "confirmed" (a booking whose money is still uncertain read as booked).
 *
 *   GET  /bookings?range=upcoming|past&limit=100   one unified feed (internal and provider)
 *   POST /bookings/{bookingId}/cancel               the member's own cancel (Idempotency-Key)
 *
 * THE STATUS IS KEPT RAW (`pending`, `confirmed`, `checked_in`, `cancelled`,
 * `completed`, `no_show`, or anything a newer server adds): the screen draws
 * "Pending" in amber, "Checked in", or "Confirmed" from it, exactly as iOS
 * switches on the string, and `isCancellable` reads it.
 *
 * THE CANCEL KEY is the caller's: one key per booking until the server has
 * answered that cancel for good (src/api/idempotency.ts `ActionKeys`). A key
 * derived from the booking id would replay the first answer to every later
 * attempt, which is how the first build kept showing an old refusal.
 *
 * DECODING is as strict as Swift's `Decodable`: every required field must be
 * there with its type (ids are UUIDs, times ISO-8601), optional ones may be
 * missing or null, and one unreadable row fails the whole page (a load error,
 * never half a list). Ids are kept in lower case, as every Android id is.
 */
import { apiGet, apiPost, type RequestOptions } from './client';
import { parseIsoDate, wireId } from './wire';

/** Which half of the feed (`GET /bookings?range=`). */
export type BookingRange = 'upcoming' | 'past' | 'all';

/** The first page at a generous size; the lists do not paginate yet (iOS `limit=100`). */
export const BOOKINGS_LIST_LIMIT = 100;

/** A booking as `GET /bookings` lists it (iOS `Booking`). */
export interface MemberBooking {
  /** Lower-case UUID. */
  readonly id: string;
  /** Raw v1 status: pending | confirmed | checked_in | cancelled | completed | no_show. */
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
  readonly venue: { readonly id: string; readonly slug: string; readonly name: string };
  readonly activity: { readonly id: string; readonly name: string } | null;
  /** The provider class's snapshotted name ("Hot Yoga"); null for slot bookings. */
  readonly externalTitle: string | null;
  /** The class's snapshotted location label; null for slot bookings. */
  readonly location: string | null;
}

/**
 * The class's name when the provider snapshotted one, else the internal
 * activity's (iOS `Booking.activityName`); null when neither is there, and
 * the screen writes "Booking".
 */
export function bookingActivityName(booking: Pick<MemberBooking, 'externalTitle' | 'activity'>): string | null {
  return booking.externalTitle ?? booking.activity?.name ?? null;
}

/**
 * A confirmed or still-pending booking that has not started yet (iOS
 * `Booking.isCancellable`): only these get the cancel button.
 */
export function isCancellable(booking: Pick<MemberBooking, 'status' | 'startsAt'>, now: Date = new Date()): boolean {
  return (booking.status === 'confirmed' || booking.status === 'pending') && booking.startsAt.getTime() > now.getTime();
}

type CallOptions = Pick<RequestOptions, 'signal'>;

/** `GET /bookings?range=&limit=100`: the caller's bookings, in the server's order. */
export function fetchBookings(range: BookingRange, options: CallOptions = {}): Promise<MemberBooking[]> {
  return apiGet<MemberBooking[]>(
    '/bookings',
    { range, limit: BOOKINGS_LIST_LIMIT },
    { ...options, decode: decodeBookingsPage },
  );
}

/**
 * `POST /bookings/{id}/cancel` under the caller's key. iOS sends no reason:
 * Swift leaves a nil optional out of the body, so the body is `{}` (the API
 * takes an optional `reason` of 3 to 128 characters, and refuses a null one).
 * The answer (`BookingResult`) is not read: success is the 2xx, as on iOS.
 */
export async function cancelBooking(bookingId: string, idempotencyKey: string): Promise<void> {
  await apiPost(`/bookings/${encodeURIComponent(wireId(bookingId))}/cancel`, {}, { idempotencyKey });
}

// MARK: - Decoding

/** Why a bookings answer did not decode; the client turns it into a `DecodingError`. */
export class BookingsListDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'BookingsListDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BookingsListDecodeError(path, 'an object');
  }
  return value as Json;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new BookingsListDecodeError(path, 'a string');
  return value;
}

function uuid(value: unknown, path: string): string {
  const raw = string(value, path);
  if (!UUID.test(raw)) throw new BookingsListDecodeError(path, 'a UUID');
  return raw.toLowerCase();
}

function date(value: unknown, path: string): Date {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new BookingsListDecodeError(path, 'an ISO-8601 date');
  return parsed;
}

/** Absent or null is null; any other wrong type fails, as Swift's `decodeIfPresent` does. */
function optional<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === undefined || value === null ? null : read(value);
}

/** One row of the feed. */
export function decodeMemberBooking(raw: unknown, path = 'booking'): MemberBooking {
  const json = object(raw, path);
  const venue = object(json.venue, `${path}.venue`);
  const activity = optional(json.activity, (value) => {
    const ref = object(value, `${path}.activity`);
    return { id: uuid(ref.id, `${path}.activity.id`), name: string(ref.name, `${path}.activity.name`) };
  });
  return {
    id: uuid(json.id, `${path}.id`),
    status: string(json.status, `${path}.status`),
    startsAt: date(json.startsAt, `${path}.startsAt`),
    endsAt: date(json.endsAt, `${path}.endsAt`),
    cancelledAt: optional(json.cancelledAt, (value) => date(value, `${path}.cancelledAt`)),
    cancellationReason: optional(json.cancellationReason, (value) => string(value, `${path}.cancellationReason`)),
    venue: {
      id: uuid(venue.id, `${path}.venue.id`),
      slug: string(venue.slug, `${path}.venue.slug`),
      name: string(venue.name, `${path}.venue.name`),
    },
    activity,
    externalTitle: optional(json.externalTitle, (value) => string(value, `${path}.externalTitle`)),
    location: optional(json.location, (value) => string(value, `${path}.location`)),
  };
}

/**
 * The envelope's `data`: a page, `{ data: [...], pagination }`. Both are
 * required, as iOS `Paginated` reads them (`pagination.hasMore` a boolean);
 * the cursor and limit may be missing or null.
 */
export function decodeBookingsPage(raw: unknown): MemberBooking[] {
  const page = object(raw, 'bookings');
  const pagination = object(page.pagination, 'bookings.pagination');
  if (typeof pagination.hasMore !== 'boolean') {
    throw new BookingsListDecodeError('bookings.pagination.hasMore', 'a boolean');
  }
  optional(pagination.nextCursor, (value) => string(value, 'bookings.pagination.nextCursor'));
  optional(pagination.limit, (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new BookingsListDecodeError('bookings.pagination.limit', 'an integer');
    }
    return value;
  });
  if (!Array.isArray(page.data)) throw new BookingsListDecodeError('bookings.data', 'an array');
  return page.data.map((row, index) => decodeMemberBooking(row, `bookings.data[${index}]`));
}
