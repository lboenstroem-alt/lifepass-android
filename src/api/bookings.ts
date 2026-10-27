/**
 * The booking flow's API: the Android port of iOS `BookingService`
 * (Services/BookingService.swift) and the models it reads and sends
 * (Models/BookingModels.swift, Models/AvailabilitySlot.swift,
 * Models/Booking.swift `CreateBookingInput`). Owned by BOOK-1; it replaces
 * the flow half of the first build's src/supabase/services/bookings.ts.
 *
 *   GET  /activities/{id}/availability?start&end&participants   slot timetable
 *   GET  /activities/{id}/classes?start&end                     Abler classes
 *   GET  /activities/{id}/booking-preview?startsAt[&visitChoice][&participants][&guestAgeBands]
 *   POST /bookings                                              create (Idempotency-Key, 120 s)
 *
 * DAYS. `start` and `end` are the VENUE's calendar days (`YYYY-MM-DD`,
 * Reykjavík, which is UTC with no daylight saving): the server reads them as
 * venue days, and the date step shows venue days, so a phone still on a
 * home zone asks for the day the member picked. Callers pass days, never
 * instants (`VenueTimeFormat.day`).
 *
 * TIMES go out as ISO-8601 UTC with no fraction (`2030-03-14T10:00:00Z`),
 * which is what iOS sends; the server refuses a bare date.
 *
 * THE CREATE sends exactly one shape: a slot (`startsAt`/`endsAt`, with the
 * party and rung) or an Abler class (`eventId`); both is a 400. A charge
 * comes back as `402 charge_consent_required` (a `ProblemError` with
 * `offer`), which the caller discloses and re-POSTs with consent under the
 * SAME Idempotency-Key. It waits up to 120 s: a paid booking can take the
 * server more than a minute (Kling authorise, capture and read-backs, then
 * Bókun or Abler), and a client that gave up at 60 s told the member
 * "failed" while the server went on to book and charge.
 *
 * Decoding is as strict as iOS's Decodable where the money and the time are
 * (a malformed slot, class or preview fails the read, shown as an error,
 * never as a wrong time or "free"), and lenient only for garnish iOS also
 * treats as optional (a class's coaches and location, a slot's extras, the
 * class's room).
 */
import { API_TIMEOUTS, apiGet, apiPost } from './client';
import { parseIsoDate, readRoom, toWireDate, wireId } from './wire';

// ---------------------------------------------------------------------------
// Models

/**
 * A bookable slot (iOS `AvailabilitySlot`). The API slot has no id (it is a
 * hint, not a reservation), so one is made from the activity and the start.
 */
export interface AvailabilitySlot {
  readonly id: string;
  readonly activityId: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly isAvailable: boolean;
  /** Null when the provider reports unlimited capacity. */
  readonly remainingCapacity: number | null;
  /** The provider's instructor, when it names one. */
  readonly instructor: string | null;
  /** The provider's class title ("Hot Yoga"), when it names one. */
  readonly title: string | null;
}

/** A slot's id: the activity and the start instant (iOS synthesises the same). */
export function slotId(activityId: string, startTime: Date): string {
  return `${wireId(activityId)}-${startTime.getTime()}`;
}

/** Builds a slot (the class sheet seeds one from a feed row). */
export function makeSlot(fields: Omit<AvailabilitySlot, 'id'>): AvailabilitySlot {
  return { id: slotId(fields.activityId, fields.startTime), ...fields };
}

/**
 * One age band a venue sells for a GUEST seat. The server lists only bands it
 * can complete (priced, payable, mapped to a provider ticket), so the app
 * renders the list verbatim and never invents one.
 */
export interface AgeBandOffer {
  /** `adult` | `child` | `infant` (server-owned; an unknown one is shown by its key). */
  readonly band: string;
  /** The venue's OWN range ("6-15"), never a hard-coded one. */
  readonly rangeLabel: string | null;
  /** Per-guest price; null for adults, priced by the guest rung. */
  readonly priceIsk: number | null;
}

/** `GET /activities/{id}/availability`, decoded: the timetable and the bands the venue sells. */
export interface AvailabilityResult {
  readonly slots: readonly AvailabilitySlot[];
  /** Empty (the common case): adults only, no picker. */
  readonly ageBands: readonly AgeBandOffer[];
}

export interface ClassCoach {
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/** An Abler class session (iOS `ActivityClass`). Booked by `eventId`. */
export interface ActivityClass {
  readonly eventId: number;
  readonly name: string | null;
  readonly description: string | null;
  readonly start: Date;
  readonly end: Date;
  readonly coaches: readonly ClassCoach[];
  /** `limit` 0 is no capacity, -1 unlimited. */
  readonly attendance: { readonly current: number; readonly limit: number };
  readonly full: boolean;
  readonly canBook: boolean | null;
  readonly canBookReason: string | null;
  /** When registration opens, if the provider says: "Registration opens {time}". */
  readonly registrationOpensAt: Date | null;
  /**
   * The room the class is in ("Salur 4"), computed live by the server on every
   * read (API 0.44.0), or null: shown alone on the venue's timetable and as the
   * "Room" row of the confirm card (src/copy/classRoom.ts).
   */
  readonly room: string | null;
}

/** The server's `canBook` when present; else derived (iOS `isBookable`). */
export function isClassBookable(klass: Pick<ActivityClass, 'canBook' | 'full' | 'attendance'>): boolean {
  return klass.canBook ?? (!klass.full && klass.attendance.limit !== 0);
}

/** "Sigrún Jónsdóttir, Jón" (iOS `coachNames`). */
export function coachNames(klass: Pick<ActivityClass, 'coaches'>): string {
  return klass.coaches
    .map((coach) => [coach.firstName, coach.lastName].filter((part): part is string => part != null).join(' '))
    .filter((name) => name.length > 0)
    .join(', ');
}

/** A group's composition on the preview (premium lagoon group bookings). */
export interface GroupBreakdown {
  readonly participants: number;
  readonly ownAmountIsk: number;
  /** The AVERAGE guest price: right only for a party that is all one band. */
  readonly guestUnitIsk: number;
  readonly guestCount: number;
  /** Per band; absent from an older server (the average line then stands). */
  readonly guests: readonly { readonly band: string; readonly count: number; readonly unitIsk: number }[] | null;
}

/** True when the party mixes bands and the average line would state a price nobody pays. */
export function isMixedParty(breakdown: GroupBreakdown): boolean {
  return (breakdown.guests?.length ?? 0) > 1;
}

/** One premium rung the member can pick. */
export interface VisitChoiceOption {
  /** `spend_visit` | `keep_visit`. */
  readonly choice: string;
  readonly priceIsk: number;
  readonly consumesVisit: boolean;
  readonly surchargeReason: string;
  readonly breakdown: GroupBreakdown | null;
}

/**
 * The read-only mirror of the create gate (iOS `BookingPreview`). `kind`,
 * `priceIsk`, `surchargeReason` and `breakdown` always mirror the SELECTED
 * rung when `visitChoice` is present.
 */
export interface BookingPreview {
  /** `free` | `surcharge` | `topup` | `pass`. */
  readonly kind: string;
  /** Only on a top-up: `monthly_exhausted` | `boutique_overflow` | `boutique_not_included`. */
  readonly topupReason: string | null;
  /** On a surcharge: `boutique_overflow`, `boutique_access`, `premium_*`. */
  readonly surchargeReason: string | null;
  /** Null for free and pass; a group's TOTAL when `breakdown` is present. */
  readonly priceIsk: number | null;
  readonly remainingMonthly: number | null;
  readonly isLastBeforeTopUp: boolean;
  readonly breakdown: GroupBreakdown | null;
  /** Present only when the member genuinely has two premium rungs to pick between. */
  readonly visitChoice: { readonly selected: string; readonly options: readonly VisitChoiceOption[] } | null;
}

/** A surcharge or a top-up: money is taken when the member confirms. */
export function requiresCharge(preview: Pick<BookingPreview, 'kind'>): boolean {
  return preview.kind === 'surcharge' || preview.kind === 'topup';
}

/**
 * `POST /bookings`' body (iOS `CreateBookingInput`): a slot window OR an
 * Abler class, never both. Consent rides on the re-POST after a 402.
 */
export type CreateBookingInput =
  | {
      readonly kind: 'slot';
      readonly activityId: string;
      readonly startsAt: Date;
      readonly endsAt: Date;
      /** People INCLUDING the member; only above 1 (premium lagoon slots). */
      readonly participants?: number | null;
      /** One band per GUEST seat; the member is never in it and always an adult. */
      readonly guestAgeBands?: readonly string[] | null;
      /** `keep_visit` | `spend_visit`: load bearing, it changes the amount. */
      readonly visitChoice?: string | null;
      readonly acceptCharge?: boolean;
      readonly acceptedChargeAmountIsk?: number;
    }
  | {
      readonly kind: 'class';
      readonly activityId: string;
      readonly eventId: number;
      readonly acceptCharge?: boolean;
      readonly acceptedChargeAmountIsk?: number;
    };

/** This input plus charge consent (same shape; re-POSTed under the same key). */
export function withConsent(input: CreateBookingInput, amountIsk: number): CreateBookingInput {
  return { ...input, acceptCharge: true, acceptedChargeAmountIsk: amountIsk };
}

/**
 * The create's JSON, keys in iOS's order. Absent values are left out, so
 * exactly one shape is sent; an empty band list is left out too (a solo
 * booking has no guest seats, and an empty array is still a length the
 * server checks against `participants`).
 */
export function createBookingBody(input: CreateBookingInput): Record<string, string | number | boolean | string[]> {
  const body: Record<string, string | number | boolean | string[]> = { activityId: wireId(input.activityId) };
  if (input.kind === 'slot') {
    body.startsAt = toWireDate(input.startsAt);
    body.endsAt = toWireDate(input.endsAt);
  } else {
    body.eventId = input.eventId;
  }
  if (input.acceptCharge != null) body.acceptCharge = input.acceptCharge;
  if (input.acceptedChargeAmountIsk != null) body.acceptedChargeAmountIsk = input.acceptedChargeAmountIsk;
  if (input.kind === 'slot') {
    if (input.participants != null) body.participants = input.participants;
    if (input.guestAgeBands && input.guestAgeBands.length > 0) body.guestAgeBands = [...input.guestAgeBands];
    if (input.visitChoice != null) body.visitChoice = input.visitChoice;
  }
  return body;
}

/** `POST /bookings`' answer (only what the flow reads). */
export interface CreateBookingResult {
  readonly bookingId: string;
  /** `confirmed` | `checked_in` is booked; anything else (`pending`) is not yet. */
  readonly status: string;
  readonly remainingMonthly: number | null;
  readonly isLastBeforeTopUp: boolean | null;
  readonly topUpApplied: boolean | null;
  /**
   * The booked class's room ("Salur 4", API 0.44.0), or null (every slot
   * booking, and a class with none). Decoded for completeness: My bookings
   * shows the room from the latest `GET /bookings`, which follows a class the
   * club moves, never this snapshot.
   */
  readonly room: string | null;
}

// ---------------------------------------------------------------------------
// Calls

/**
 * `GET /activities/{id}/availability` for the venue days `startDay` to
 * `endDay` (inclusive, at most 14). `participants` (at most 10) makes the
 * capacity check cover the whole party. Never reserves: the create checks the
 * slot again.
 */
export function fetchAvailability(
  activityId: string,
  startDay: string,
  endDay: string,
  participants = 1,
): Promise<AvailabilityResult> {
  return apiGet(
    `/activities/${wireId(activityId)}/availability`,
    { start: startDay, end: endDay, participants: Math.max(1, participants) },
    { decode: decodeAvailability },
  );
}

/** `GET /activities/{id}/classes` for the venue days `startDay` to `endDay` (at most 31). */
export function fetchClasses(activityId: string, startDay: string, endDay: string): Promise<ActivityClass[]> {
  return apiGet(
    `/activities/${wireId(activityId)}/classes`,
    { start: startDay, end: endDay },
    { decode: decodeClassesResult },
  );
}

export interface PreviewOptions {
  /** Above 1 the price is the group TOTAL with a `breakdown`. */
  readonly participants?: number;
  /** One per GUEST seat, in entry order; priced exactly as the create will charge. */
  readonly guestAgeBands?: readonly string[] | null;
  /** Never for a class: the API refuses a rung beside an `eventId`. */
  readonly visitChoice?: string | null;
}

/** `GET /activities/{id}/booking-preview` at one start: the charge disclosure. */
export function fetchBookingPreview(
  activityId: string,
  startsAt: Date,
  options: PreviewOptions = {},
): Promise<BookingPreview> {
  const query: Record<string, string | number> = { startsAt: toWireDate(startsAt) };
  if (options.visitChoice != null) query.visitChoice = options.visitChoice;
  if ((options.participants ?? 1) > 1) query.participants = options.participants!;
  if (options.guestAgeBands && options.guestAgeBands.length > 0) query.guestAgeBands = options.guestAgeBands.join(',');
  return apiGet(`/activities/${wireId(activityId)}/booking-preview`, query, { decode: decodeBookingPreview });
}

/**
 * `POST /bookings` under the attempt's key. A 402 with an offer, every
 * refusal, a gateway page and a timeout are thrown as the client's errors;
 * the booking session reads them (src/features/booking/bookingSession.ts).
 */
export function createBooking(input: CreateBookingInput, idempotencyKey: string): Promise<CreateBookingResult> {
  return apiPost('/bookings', createBookingBody(input), {
    idempotencyKey,
    timeoutMs: API_TIMEOUTS.bookingCreate,
    decode: decodeCreateBookingResult,
  });
}

// ---------------------------------------------------------------------------
// Decoding

/** Why a booking payload did not decode; the client turns it into a `DecodingError`. */
export class BookingDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'BookingDecodeError';
  }
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BookingDecodeError(path, 'an object');
  }
  return value as Json;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new BookingDecodeError(path, 'an array');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new BookingDecodeError(path, 'a string');
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new BookingDecodeError(path, 'an integer');
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new BookingDecodeError(path, 'a boolean');
  return value;
}

function date(value: unknown, path: string): Date {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new BookingDecodeError(path, 'an ISO-8601 date');
  return parsed;
}

/** Absent or null is null; any other wrong type fails, as Swift's `decodeIfPresent` does. */
function optional<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === undefined || value === null ? null : read(value);
}

/** A garnish read fail-soft: anything but a string is none. */
function softString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function decodeAvailability(raw: unknown): AvailabilityResult {
  const json = object(raw, 'availability');
  const activityId = string(json.activityId, 'availability.activityId');
  const slots = list(json.slots, 'availability.slots').map((entry, index) => {
    const path = `availability.slots[${index}]`;
    const slot = object(entry, path);
    return makeSlot({
      activityId,
      startTime: date(slot.startsAt, `${path}.startsAt`),
      endTime: date(slot.endsAt, `${path}.endsAt`),
      isAvailable: bool(slot.available, `${path}.available`),
      remainingCapacity: optional(slot.remainingCapacity, (v) => int(v, `${path}.remainingCapacity`)),
      instructor: softString(slot.instructor),
      title: softString(slot.title),
    });
  });
  const ageBands =
    optional(json.ageBands, (value) =>
      list(value, 'availability.ageBands').map((entry, index) => {
        const path = `availability.ageBands[${index}]`;
        const band = object(entry, path);
        return {
          band: string(band.band, `${path}.band`),
          rangeLabel: optional(band.rangeLabel, (v) => string(v, `${path}.rangeLabel`)),
          priceIsk: optional(band.priceIsk, (v) => int(v, `${path}.priceIsk`)),
        };
      }),
    ) ?? [];
  return { slots, ageBands };
}

export function decodeActivityClass(raw: unknown, path = 'class'): ActivityClass {
  const json = object(raw, path);
  const attendance = object(json.attendance, `${path}.attendance`);
  const coaches = Array.isArray(json.coaches)
    ? json.coaches
        .filter((coach): coach is Json => typeof coach === 'object' && coach !== null)
        .map((coach) => ({ firstName: softString(coach.firstName), lastName: softString(coach.lastName) }))
    : [];
  return {
    eventId: int(json.eventId, `${path}.eventId`),
    name: optional(json.name, (v) => string(v, `${path}.name`)),
    description: softString(json.description),
    start: date(json.start, `${path}.start`),
    end: date(json.end, `${path}.end`),
    coaches,
    attendance: {
      current: int(attendance.current, `${path}.attendance.current`),
      limit: int(attendance.limit, `${path}.attendance.limit`),
    },
    full: bool(json.full, `${path}.full`),
    canBook: optional(json.canBook, (v) => bool(v, `${path}.canBook`)),
    canBookReason: optional(json.canBookReason, (v) => string(v, `${path}.canBookReason`)),
    registrationOpensAt: optional(json.registrationOpensAt, (v) => date(v, `${path}.registrationOpensAt`)),
    // Garnish, read fail-soft (src/api/wire.ts `readRoom`).
    room: readRoom(json.room),
  };
}

export function decodeClassesResult(raw: unknown): ActivityClass[] {
  const json = object(raw, 'classes');
  return list(json.classes, 'classes.classes').map((entry, index) => decodeActivityClass(entry, `classes.classes[${index}]`));
}

function decodeBreakdown(raw: unknown, path: string): GroupBreakdown {
  const json = object(raw, path);
  return {
    participants: int(json.participants, `${path}.participants`),
    ownAmountIsk: int(json.ownAmountIsk, `${path}.ownAmountIsk`),
    guestUnitIsk: int(json.guestUnitIsk, `${path}.guestUnitIsk`),
    guestCount: int(json.guestCount, `${path}.guestCount`),
    guests: optional(json.guests, (value) =>
      list(value, `${path}.guests`).map((entry, index) => {
        const line = object(entry, `${path}.guests[${index}]`);
        return {
          band: string(line.band, `${path}.guests[${index}].band`),
          count: int(line.count, `${path}.guests[${index}].count`),
          unitIsk: int(line.unitIsk, `${path}.guests[${index}].unitIsk`),
        };
      }),
    ),
  };
}

export function decodeBookingPreview(raw: unknown): BookingPreview {
  const json = object(raw, 'preview');
  const visitChoice = optional(json.visitChoice, (value) => {
    const choice = object(value, 'preview.visitChoice');
    return {
      selected: string(choice.selected, 'preview.visitChoice.selected'),
      options: list(choice.options, 'preview.visitChoice.options').map((entry, index) => {
        const path = `preview.visitChoice.options[${index}]`;
        const option = object(entry, path);
        return {
          choice: string(option.choice, `${path}.choice`),
          priceIsk: int(option.priceIsk, `${path}.priceIsk`),
          consumesVisit: bool(option.consumesVisit, `${path}.consumesVisit`),
          surchargeReason: string(option.surchargeReason, `${path}.surchargeReason`),
          breakdown: optional(option.breakdown, (v) => decodeBreakdown(v, `${path}.breakdown`)),
        };
      }),
    };
  });
  return {
    kind: string(json.kind, 'preview.kind'),
    topupReason: optional(json.topupReason, (v) => string(v, 'preview.topupReason')),
    surchargeReason: optional(json.surchargeReason, (v) => string(v, 'preview.surchargeReason')),
    priceIsk: optional(json.priceIsk, (v) => int(v, 'preview.priceIsk')),
    remainingMonthly: optional(json.remainingMonthly, (v) => int(v, 'preview.remainingMonthly')),
    isLastBeforeTopUp: bool(json.isLastBeforeTopUp, 'preview.isLastBeforeTopUp'),
    breakdown: optional(json.breakdown, (v) => decodeBreakdown(v, 'preview.breakdown')),
    visitChoice,
  };
}

export function decodeCreateBookingResult(raw: unknown): CreateBookingResult {
  const json = object(raw, 'booking');
  return {
    bookingId: wireId(string(json.bookingId, 'booking.bookingId')),
    status: string(json.status, 'booking.status'),
    remainingMonthly: optional(json.remainingMonthly, (v) => int(v, 'booking.remainingMonthly')),
    isLastBeforeTopUp: optional(json.isLastBeforeTopUp, (v) => bool(v, 'booking.isLastBeforeTopUp')),
    topUpApplied: optional(json.topUpApplied, (v) => bool(v, 'booking.topUpApplied')),
    room: readRoom(json.room),
  };
}
