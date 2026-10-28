/**
 * `GET /check-ins/walk-in/preview?venueId=[&activityId=]`: the Android port of
 * iOS `CheckInService.walkInPreview` and its `WalkInPreview`, `BookableActivity`,
 * `BookingProvider` and `WalkInCoverage` models. Shared by the venue page
 * (VENUE-1: which classes can be booked) and the walk-in flow (CHECKIN-2:
 * eligibility, the disclosed charge, guests, an attendable booking).
 *
 * What the preview answers:
 *   - eligibility for the instant (General) path: `allowed`, and a
 *     `blockingReason` when it cannot proceed;
 *   - `activities`: instant walk-in activities (no timetable);
 *   - `slotActivities`: activities booked through a timetable. Decoded with
 *     their provider and then FILTERED to the slot-bookable ones (Kling has no
 *     timetable, and a provider this build does not know cannot be booked),
 *     as iOS's venue page filters them; nothing else reads the rest;
 *   - `charge`: the disclosed à-la-carte charge, or null when free. The ONLY
 *     money disclosure: the member's own visit is free exactly when it is null
 *     or zero (`ownVisitIsFree`);
 *   - `attendableBooking`: a same-day booking at this venue, which can be
 *     marked present for free;
 *   - `guestBands`: the guest seats sold at the door (none = no guest UI);
 *   - `coveredBy`: what pays for the member's own visit.
 *
 * Strict where the money is, fail-soft only where iOS is: a malformed
 * `charge`, `attendableBooking` or `guestBands` fails the whole preview (the
 * screen shows an error, never "free" by mistake), while `coveredBy` is a
 * garnish read through iOS's `FailSoft`: missing, null, a kind this build does
 * not know, or a broken shape all read as no coverage. A provider string this
 * build does not know reads as `unknown`, not an error.
 */
import { apiGet, type RequestOptions } from './client';
import { parseIsoDate, wireId } from './wire';

/** The booking system behind a slot activity. */
export type BookingProvider = 'internal' | 'bokun' | 'noona' | 'acuity' | 'simplybook' | 'kling' | 'abler' | 'unknown';

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(['internal', 'bokun', 'noona', 'acuity', 'simplybook', 'kling', 'abler']);

/** Reads a provider string; one this build does not know is `unknown`. */
export function bookingProvider(raw: string): BookingProvider {
  return KNOWN_PROVIDERS.has(raw) ? (raw as BookingProvider) : 'unknown';
}

/**
 * Abler books by integer `eventId` against `/activities/{id}/classes`; every
 * other provider by `startsAt`/`endsAt` against `/availability`.
 */
export function usesClasses(provider: BookingProvider): boolean {
  return provider === 'abler';
}

/** Kling exposes no timetable, and an unknown provider cannot be booked either. */
export function isSlotBookable(provider: BookingProvider): boolean {
  return provider !== 'kling' && provider !== 'unknown';
}

/** A bookable activity at a venue (the only venue-activities list there is). */
export interface BookableActivity {
  /** Lower-case UUID. */
  readonly id: string;
  readonly name: string;
  readonly provider: BookingProvider;
}

/** An instant walk-in activity (no timetable). */
export interface WalkInActivity {
  readonly id: string;
  readonly name: string;
}

/** `{ kind: surcharge | topup, amountIsk, reason? }`. */
export interface WalkInCharge {
  readonly kind: string;
  readonly amountIsk: number;
  /** Frames the charge copy (`monthly_exhausted`, `premium_pass_visit`, ...). */
  readonly reason: string | null;
}

/** The member's same-day confirmed booking here; marking it present is free. */
export interface AttendableBooking {
  readonly bookingId: string;
  readonly activityName: string | null;
  readonly startsAt: Date;
  /** The class starts within 30 minutes either side of now. */
  readonly withinWindow: boolean;
}

/**
 * One guest band sold at the door: "adult" | "child" | "infant", the venue's
 * OWN age range for non-adults (never hard-code one), and the per-head price
 * (0 for infants).
 */
export interface GuestBandOffer {
  readonly band: string;
  readonly rangeLabel: string | null;
  readonly unitIsk: number;
}

/**
 * What pays for the member's OWN visit (API 0.25.0, iOS `WalkInCoverage`).
 * `charge` stays the only money disclosure: a pass or a membership together
 * with a charge is a visit that spends an entitlement AND costs money.
 */
export type WalkInCoverage =
  | {
      readonly kind: 'pass';
      /** `day` | `explorer` | `adventurer` | `local` | `lagoon_duo`; an unknown one is "your pass". */
      readonly passType: string;
      /** The product it was bought as; not shown (the app names the pass from `passType`). */
      readonly passName: string | null;
      readonly visitsTotal: number;
      /** Visits used BEFORE this one. */
      readonly visitsUsed: number;
      /** What the pass has left once this visit is counted. */
      readonly visitsLeftAfter: number;
      readonly expiresAt: Date | null;
    }
  | {
      readonly kind: 'subscription';
      /** "Plus"; null only if the subscription lapsed mid-request. */
      readonly tierName: string | null;
      /** `network` (gyms and studios) | `pool`. */
      readonly lane: string | null;
      /** The lane's monthly visits left after this one; null when unknown. */
      readonly visitsLeftAfter: number | null;
    }
  | { readonly kind: 'money' };

/** Something the member already holds pays for the visit. */
export function isEntitlement(coverage: WalkInCoverage): boolean {
  return coverage.kind !== 'money';
}

export interface WalkInPreview {
  readonly venue: { readonly id: string; readonly slug: string; readonly name: string };
  readonly walkInsAllowed: boolean;
  readonly activities: readonly WalkInActivity[];
  /** Slot-bookable activities only (see the file comment). */
  readonly slotActivities: readonly BookableActivity[];
  /** Whether the instant (General) path is available. */
  readonly allowed: boolean;
  /**
   * `walk_ins_not_allowed` | `walk_in_no_activity` | `daily_use_cap_reached` |
   * `no_active_plan_or_pass` | `boutique_requires_membership` |
   * `monthly_cap_reached` | `trial_venue_not_included` | `trial_visits_spent`,
   * or null.
   */
  readonly blockingReason: string | null;
  readonly charge: WalkInCharge | null;
  readonly attendableBooking: AttendableBooking | null;
  /** Null from an older server; empty or null means no guest UI. */
  readonly guestBands: readonly GuestBandOffer[] | null;
  /** Null from an older server, when `allowed` is false, or for a shape this build cannot read. */
  readonly coveredBy: WalkInCoverage | null;
}

/** The member's own visit costs nothing: no `charge`, or a zero one. Guest prices are not part of it. */
export function ownVisitIsFree(preview: Pick<WalkInPreview, 'charge'>): boolean {
  return (preview.charge?.amountIsk ?? 0) <= 0;
}

/**
 * The preview for `venueId`. Pass `activityId` for the PER-ACTIVITY charge
 * (an activity can override the venue's surcharge), so the price disclosed
 * equals what the confirm charges. Ids go out lower-case (`wireId`).
 */
export async function fetchWalkInPreview(
  venueId: string,
  activityId?: string | null,
  options: Pick<RequestOptions, 'signal'> = {},
): Promise<WalkInPreview> {
  return apiGet<WalkInPreview>(
    '/check-ins/walk-in/preview',
    { venueId: wireId(venueId), activityId: activityId ? wireId(activityId) : undefined },
    { ...options, decode: decodeWalkInPreview },
  );
}

// MARK: - Decoding

/** Why a value did not decode; the client turns it into a `DecodingError`. */
export class WalkInPreviewDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'WalkInPreviewDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WalkInPreviewDecodeError(path, 'an object');
  }
  return value as Json;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new WalkInPreviewDecodeError(path, 'a list');
  return value;
}

/** Absent and null are both "not there" (Swift `decodeIfPresent`). */
function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function string(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new WalkInPreviewDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function optionalString(json: Json, key: string, path: string): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new WalkInPreviewDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function bool(json: Json, key: string, path: string): boolean {
  const value = json[key];
  if (typeof value !== 'boolean') throw new WalkInPreviewDecodeError(`${path}.${key}`, 'a boolean');
  return value;
}

function integer(json: Json, key: string, path: string): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new WalkInPreviewDecodeError(`${path}.${key}`, 'an integer');
  }
  return value;
}

function optionalInteger(json: Json, key: string, path: string): number | null {
  if (present(json, key) === undefined) return null;
  return integer(json, key, path);
}

function uuid(json: Json, key: string, path: string): string {
  const value = string(json, key, path);
  if (!UUID.test(value)) throw new WalkInPreviewDecodeError(`${path}.${key}`, 'a UUID');
  return value.toLowerCase();
}

function date(json: Json, key: string, path: string): Date {
  const value = parseIsoDate(string(json, key, path));
  if (!value) throw new WalkInPreviewDecodeError(`${path}.${key}`, 'an ISO-8601 date');
  return value;
}

function optionalDate(json: Json, key: string, path: string): Date | null {
  if (present(json, key) === undefined) return null;
  return date(json, key, path);
}

function decodeCharge(value: unknown, path: string): WalkInCharge | null {
  if (value === undefined || value === null) return null;
  const json = object(value, path);
  return {
    kind: string(json, 'kind', path),
    amountIsk: integer(json, 'amountIsk', path),
    reason: optionalString(json, 'reason', path),
  };
}

function decodeAttendableBooking(value: unknown, path: string): AttendableBooking | null {
  if (value === undefined || value === null) return null;
  const json = object(value, path);
  return {
    bookingId: uuid(json, 'bookingId', path),
    activityName: optionalString(json, 'activityName', path),
    startsAt: date(json, 'startsAt', path),
    withinWindow: bool(json, 'withinWindow', path),
  };
}

function decodeGuestBands(value: unknown, path: string): GuestBandOffer[] | null {
  if (value === undefined || value === null) return null;
  return list(value, path).map((item, index) => {
    const at = `${path}[${index}]`;
    const json = object(item, at);
    return {
      band: string(json, 'band', at),
      rangeLabel: optionalString(json, 'rangeLabel', at),
      unitIsk: integer(json, 'unitIsk', at),
    };
  });
}

/**
 * `coveredBy` as iOS reads it, or THROWS for a kind or shape this build
 * cannot read; `readCoverage` turns that into "no coverage".
 */
export function decodeWalkInCoverage(value: unknown, path = 'coveredBy'): WalkInCoverage {
  const json = object(value, path);
  const kind = string(json, 'kind', path);
  switch (kind) {
    case 'pass':
      return {
        kind: 'pass',
        passType: string(json, 'passType', path),
        passName: optionalString(json, 'passName', path),
        visitsTotal: integer(json, 'visitsTotal', path),
        visitsUsed: integer(json, 'visitsUsed', path),
        visitsLeftAfter: integer(json, 'visitsLeftAfter', path),
        expiresAt: optionalDate(json, 'expiresAt', path),
      };
    case 'subscription':
      return {
        kind: 'subscription',
        tierName: optionalString(json, 'tierName', path),
        lane: optionalString(json, 'lane', path),
        visitsLeftAfter: optionalInteger(json, 'visitsLeftAfter', path),
      };
    case 'money':
      return { kind: 'money' };
    default:
      throw new WalkInPreviewDecodeError(`${path}.kind`, 'pass, subscription or money');
  }
}

/**
 * iOS `FailSoft<WalkInCoverage>`: the coverage, or null when it is missing,
 * null or unreadable. For the preview AND the check-in response, which arrives
 * after the visit is recorded and must never fail over a balance line.
 */
export function readCoverage(value: unknown): WalkInCoverage | null {
  if (value === undefined || value === null) return null;
  try {
    return decodeWalkInCoverage(value);
  } catch {
    return null;
  }
}

function decodeBookableActivity(value: unknown, path: string): BookableActivity {
  const json = object(value, path);
  return {
    id: uuid(json, 'id', path),
    name: string(json, 'name', path),
    provider: bookingProvider(string(json, 'provider', path)),
  };
}

/** The preview's `data` (see the file comment for what is strict and what is not). */
export function decodeWalkInPreview(raw: unknown): WalkInPreview {
  const path = 'preview';
  const json = object(raw, path);
  const venue = object(json.venue, `${path}.venue`);
  const slotActivities = list(json.slotActivities, `${path}.slotActivities`).map((item, index) =>
    decodeBookableActivity(item, `${path}.slotActivities[${index}]`),
  );
  return {
    venue: {
      id: uuid(venue, 'id', `${path}.venue`),
      slug: string(venue, 'slug', `${path}.venue`),
      name: string(venue, 'name', `${path}.venue`),
    },
    walkInsAllowed: bool(json, 'walkInsAllowed', path),
    activities: list(json.activities, `${path}.activities`).map((item, index) => {
      const at = `${path}.activities[${index}]`;
      const activity = object(item, at);
      return { id: uuid(activity, 'id', at), name: string(activity, 'name', at) };
    }),
    slotActivities: slotActivities.filter((activity) => isSlotBookable(activity.provider)),
    allowed: bool(json, 'allowed', path),
    blockingReason: optionalString(json, 'blockingReason', path),
    charge: decodeCharge(json.charge, `${path}.charge`),
    attendableBooking: decodeAttendableBooking(json.attendableBooking, `${path}.attendableBooking`),
    guestBands: decodeGuestBands(json.guestBands, `${path}.guestBands`),
    coveredBy: readCoverage(json.coveredBy),
  };
}
