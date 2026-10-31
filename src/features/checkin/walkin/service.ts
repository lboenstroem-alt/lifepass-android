/* eslint lifepass/no-literal-copy: "error" */
/**
 * The walk-in's two calls: the Android port of iOS `CheckInService`
 * (Services/CheckInService.swift) and its `CheckInResult` / `WalkInResult`.
 *
 *   GET  /check-ins/walk-in/preview?venueId=[&activityId=]   (src/api/walkInPreview.ts)
 *   POST /check-ins/walk-in                                    (here)
 *
 * The server owns provider routing, lane and cap accounting and à-la-carte
 * pricing; the phone previews, then confirms. A charge-bearing walk-in
 * answers `402 charge_consent_required` (an `offer`) unless `acceptCharge`
 * and `acceptedChargeAmountIsk` are sent: the caller discloses the offer,
 * gets consent, then sends the SAME body again under the SAME
 * Idempotency-Key with consent.
 *
 * THE BODY (iOS encodes optionals with `encodeIfPresent`): `venueId` always;
 * `activityId` only for an activity (omitted for a venue-level walk-in and
 * for marking a booked class present); `acceptCharge` and
 * `acceptedChargeAmountIsk` only with consent; `bookingAction` only once the
 * member chose on the attendance sheet; `guestAgeBands` only when guests
 * ride (the server refuses an empty list, and `maxItems` is 9). Ids go out
 * lower case.
 *
 * THE ANSWER arrives after the visit is recorded, so what is only garnish on
 * the receipt is read fail-soft: an unreadable `memberShortName` or
 * `coveredBy` is dropped, never turned into an error that would invite the
 * member to scan (and pay) again. The rest is read as strictly as iOS reads
 * it.
 */
import { API_TIMEOUTS, apiPost } from '../../../api';
import { fetchWalkInPreview, readCoverage, type WalkInCoverage, type WalkInPreview } from '../../../api/walkInPreview';
import { parseIsoDate, wireId } from '../../../api/wire';
import type { CheckInParty } from '../../../api/profile';

export type { WalkInPreview } from '../../../api/walkInPreview';

/** The member's choice on the attendance sheet. */
export type BookingAction = 'attend' | 'walk_in';

/** What one `POST /check-ins/walk-in` asks for. */
export interface WalkInConfirmInput {
  readonly venueId: string;
  /** The picked activity; null for a venue-level walk-in or a class marked present. */
  readonly activityId: string | null;
  /** True only after the member consented to the disclosed charge. */
  readonly acceptCharge?: boolean;
  /** The consented amount (the offer's `amountIsk`); sent only with `acceptCharge`. */
  readonly acceptedChargeAmountIsk?: number | null;
  readonly bookingAction?: BookingAction | null;
  /** One band per guest (`adult` | `child` | `infant`), the member never in it. */
  readonly guestAgeBands?: readonly string[] | null;
}

/** The walk-in's body, keys in the order iOS encodes them (see the file comment). */
export function walkInBody(input: WalkInConfirmInput): Record<string, unknown> {
  const body: Record<string, unknown> = { venueId: wireId(input.venueId) };
  if (input.activityId) body.activityId = wireId(input.activityId);
  if (input.acceptCharge) {
    body.acceptCharge = true;
    if (input.acceptedChargeAmountIsk != null) body.acceptedChargeAmountIsk = input.acceptedChargeAmountIsk;
  }
  if (input.bookingAction) body.bookingAction = input.bookingAction;
  if (input.guestAgeBands && input.guestAgeBands.length > 0) body.guestAgeBands = [...input.guestAgeBands];
  return body;
}

/** A venue or activity as the check-in names it. */
export interface CheckInRef {
  readonly id: string;
  readonly slug: string | null;
  readonly name: string;
}

/** `POST /check-ins/walk-in`'s answer (iOS `CheckInResult`, adapted as `WalkInResult`). */
export interface WalkInResult {
  readonly checkInId: string;
  readonly bookingId: string | null;
  readonly source: string | null;
  /** The cap lane the visit counted against (`network` | `pool` | `surcharge` | `topup` | `pass`). */
  readonly countedAgainst: string | null;
  readonly checkedInAt: Date | null;
  readonly venue: CheckInRef | null;
  readonly activity: CheckInRef | null;
  /**
   * The guests this scan admitted (the member is always one more), or null
   * for a solo walk-in and on an older server.
   */
  readonly party: CheckInParty | null;
  /**
   * The member, ALREADY SHORTENED BY THE SERVER ("Lucas B."). Null when the
   * server sent none, null, something unreadable or a blank: the proof then
   * names nobody, never an email and never a placeholder. `memberName` is
   * never read.
   */
  readonly memberShortName: string | null;
  /** What paid for the member's own visit, read back after the commit; null when unreadable. */
  readonly coveredBy: WalkInCoverage | null;
}

/** Why the answer did not decode; the client turns it into a `DecodingError`. */
export class WalkInResultDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'WalkInResultDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Absent and null are both "not there" (Swift `decodeIfPresent`). */
function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new WalkInResultDecodeError(path, 'a UUID');
  return value.toLowerCase();
}

function optionalUuid(json: Json, key: string): string | null {
  const value = present(json, key);
  return value === undefined ? null : uuid(value, key);
}

function optionalString(json: Json, key: string, path = key): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new WalkInResultDecodeError(path, 'a string');
  return value;
}

function integer(json: Json, key: string, path: string): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new WalkInResultDecodeError(`${path}.${key}`, 'an integer');
  return value;
}

function ref(value: unknown, path: string): CheckInRef | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new WalkInResultDecodeError(path, 'an object');
  const name = value.name;
  if (typeof name !== 'string') throw new WalkInResultDecodeError(`${path}.name`, 'a string');
  return { id: uuid(value.id, `${path}.id`), slug: optionalString(value, 'slug', `${path}.slug`), name };
}

function party(value: unknown): CheckInParty | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new WalkInResultDecodeError('party', 'an object');
  return {
    adults: integer(value, 'adults', 'party'),
    children: integer(value, 'children', 'party'),
    infants: integer(value, 'infants', 'party'),
    guestChargeIsk: integer(value, 'guestChargeIsk', 'party'),
  };
}

/** iOS `FailSoft<String>` plus the blank check: a name, or null. */
function shortName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** The answer's `data` (see the file comment for what is strict and what is not). */
export function decodeWalkInResult(raw: unknown): WalkInResult {
  if (!isObject(raw)) throw new WalkInResultDecodeError('checkIn', 'an object');
  let checkedInAt: Date | null = null;
  const at = optionalString(raw, 'checkedInAt');
  if (at !== null) {
    checkedInAt = parseIsoDate(at);
    if (!checkedInAt) throw new WalkInResultDecodeError('checkedInAt', 'an ISO-8601 date');
  }
  return {
    checkInId: uuid(raw.checkInId, 'checkInId'),
    bookingId: optionalUuid(raw, 'bookingId'),
    source: optionalString(raw, 'source'),
    countedAgainst: optionalString(raw, 'countedAgainst'),
    checkedInAt,
    venue: ref(raw.venue, 'venue'),
    activity: ref(raw.activity, 'activity'),
    party: party(raw.party),
    memberShortName: shortName(raw.memberShortName),
    coveredBy: readCoverage(raw.coveredBy),
  };
}

/**
 * The preview (iOS `walkInPreview(venueId:activityId:)`). Pass `activityId`
 * for the PER-ACTIVITY charge, so the price disclosed is the one the
 * confirm charges.
 */
export function walkInPreview(venueId: string, activityId?: string | null): Promise<WalkInPreview> {
  return fetchWalkInPreview(venueId, activityId ?? null);
}

/**
 * Records the walk-in under the attempt's `idempotencyKey` (reused across a
 * network retry AND the consent re-POST). Waits as long as a booking create
 * (120 s): a walk-in rides the same collect-first rail, with the venue's
 * system in the loop.
 */
export function confirmWalkIn(input: WalkInConfirmInput, idempotencyKey: string): Promise<WalkInResult> {
  return apiPost('/check-ins/walk-in', walkInBody(input), {
    idempotencyKey,
    timeoutMs: API_TIMEOUTS.bookingCreate,
    decode: decodeWalkInResult,
  });
}
