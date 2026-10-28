/**
 * The day plan as it comes back from `POST /coach`: the Android port of iOS
 * `CoachResponse`, `CoachPlan`, `CoachPlanStep`, `CoachPlanVenue`,
 * `CoachPlanClass`, `CoachClassBooking`, `CoachPlanSight`,
 * `CoachPlanDistance`, `CoachDecode`, `CoachLossyList` and
 * `CoachIndexedList` (Models/CoachPlan.swift).
 *
 * Everything a card shows was hydrated by the server from its own rows, so
 * the phone never renders a field the model typed.
 *
 * LOSSY, STEP BY STEP. A plan is a courtesy on top of `reply`:
 * - a malformed step costs that step (an unknown slot or kind, a missing or
 *   malformed card, a sight no road or ferry reaches);
 * - a malformed plan, or one with no step left, costs the plan (no plan);
 * - neither ever costs the member the reply. Old servers send `reply` alone.
 *
 * CHIPS AND REFINEMENTS PAIR BY POSITION on the wire, so both are read
 * index-keeping: an unreadable chip leaves a hole rather than sliding the
 * refinement after it onto the wrong label. A pairing whose label disagrees
 * with its chip is dropped, and the chip's wording decides instead.
 *
 * Times are parsed here from their ISO strings, with or without fractional
 * seconds (`parseIsoDate`).
 *
 * THE CHAT'S CLASS CARDS (API 0.36.0) are the same `CoachPlanClass` as a
 * plan's class step, with the card's own extras (status, spots left, the
 * price line, the "from" price), read card by card (`decodeClassCards`).
 * A saved chat keeps them in the server's own shape (`encodePlanClass`), so
 * the same fail-soft decoder reads them back.
 */
import { decodeCoachFreeMessages, type CoachFreeMessages } from '../../../api';
import { parseIsoDate } from '../../../api/wire';
import {
  parseAttractionDrive,
  parseRoadAccess,
  roadKilometres,
  type AttractionDrive,
  type AttractionRoadAccess,
} from '../../attractions';
import type { CoachClassBooking, CoachPlanClass } from '../../classes/sheet';
import type { Lang, Params } from '../../../i18n';
import { isRefineChange, refineChangeForChip, type CoachRefineChange } from './model';

// MARK: - Shapes

/** A plan's place in the day; drawn in this order whatever order the wire used. */
export type CoachPlanSlot = 'before' | 'main' | 'after';
const SLOT_ORDER: Readonly<Record<CoachPlanSlot, number>> = { before: 0, main: 1, after: 2 };

export type CoachPlanStepKind = 'venue' | 'class' | 'sight';

/** A venue step's card, before the venue's full row loads (iOS `CoachPlanVenue`). */
export interface CoachPlanVenue {
  readonly slug: string;
  readonly name: string;
  readonly city: string | null;
  readonly imageUrl: string | null;
  readonly category: string | null;
  /** Already worded by the server for this member ("Included", "from ISK 4,990"). */
  readonly priceLabel: string | null;
}

/** A sight step's card (iOS `CoachPlanSight`). */
export interface CoachPlanSight {
  readonly slug: string;
  /** Already localised by the server. */
  readonly name: string;
  readonly kind: string;
  /** "" when the wire had none. */
  readonly region: string;
  readonly imageUrl: string | null;
  /** Who took the photo. A photograph is only drawn when this came with it. */
  readonly imageCredit: string | null;
  readonly driveFromReykjavik: AttractionDrive | null;
  /** Null for a value this build does not know, which prints no travel line. */
  readonly roadAccess: AttractionRoadAccess | null;
}

/**
 * How far a step is (iOS `CoachPlanDistance`): a measured drive (whole
 * minutes, at least 1), or a straight line (km), which is never presented
 * as a drive.
 */
export interface CoachPlanDistance {
  readonly basis: 'drive' | 'straight_line';
  readonly minutes: number | null;
  readonly km: number | null;
}

interface StepBase {
  /** iOS `CoachPlanStep.id`: slot, kind and the card's key. */
  readonly id: string;
  readonly slot: CoachPlanSlot;
  /** "" when the step has none. */
  readonly note: string;
  readonly distance: CoachPlanDistance | null;
}

export type CoachPlanStep =
  | (StepBase & { readonly kind: 'venue'; readonly venue: CoachPlanVenue })
  | (StepBase & { readonly kind: 'class'; readonly classSession: CoachPlanClass })
  | (StepBase & { readonly kind: 'sight'; readonly sight: CoachPlanSight });

/** A Before / Main / After plan (iOS `CoachPlan`). */
export interface CoachPlan {
  /** Opaque: sent back as `refine.planId`. It carries the whole state (answers, earlier refinements). */
  readonly id: string;
  /** "" when the wire had none (the reply, or `coach.plan.intro_fallback`, is shown instead). */
  readonly intro: string;
  /** Before, then main, then after. Never empty. */
  readonly steps: readonly CoachPlanStep[];
  /** Up to three refinement labels, trimmed and unique. */
  readonly chips: readonly string[];
  /** What each kept chip asks for, when the server said so (read through `planChangeForChip`). */
  readonly chipChanges: Readonly<Record<string, CoachRefineChange>>;
}

/** At most this many refinement chips (iOS `CoachPlan.maxChips`). */
export const MAX_PLAN_CHIPS = 3;

/** `data` of the answer to a plan request (iOS `CoachResponse`). */
export interface CoachPlanResponse {
  /** Always sent (for a plan, its intro); "" when missing or not a string. */
  readonly reply: string;
  /** Null when there was none, it did not decode, or no step was left. */
  readonly plan: CoachPlan | null;
  /** What is left of a free account's messages. A count this build cannot read never costs the answer. */
  readonly freeMessages: CoachFreeMessages | null;
}

// MARK: - Helpers (iOS CoachDecode)

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A step or card that cannot be drawn. */
class Unusable extends Error {}

/** A trimmed, non-blank string, or null for absent, null, blank or not a string. */
function optionalString(json: Json, key: string): string | null {
  const value = json[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requiredString(json: Json, key: string): string {
  const value = optionalString(json, key);
  if (value === null) throw new Unusable(key);
  return value;
}

function optionalDate(json: Json, key: string): Date | null {
  const raw = optionalString(json, key);
  return raw === null ? null : parseIsoDate(raw);
}

/** A whole number as Swift's `decode(Int.self)` reads one (a fraction or a figure past Int's range is none). */
function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 2 ** 63 ? value : null;
}

/** RFC 4122 text, any case (what Swift's `UUID` decodes). */
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs a decoder; a value it refuses is null (Swift `try?`). */
function lossy<T>(decode: () => T): T | null {
  try {
    return decode();
  } catch {
    return null;
  }
}

// MARK: - Cards

function decodeVenueCard(raw: unknown): CoachPlanVenue {
  if (!isObject(raw)) throw new Unusable('venue');
  return {
    slug: requiredString(raw, 'slug'),
    name: requiredString(raw, 'name'),
    city: optionalString(raw, 'city'),
    imageUrl: optionalString(raw, 'imageUrl'),
    category: optionalString(raw, 'category'),
    priceLabel: optionalString(raw, 'priceLabel'),
  };
}

/**
 * The class feed's booking handle (iOS `CoachClassBooking`): a kind this
 * build does not know, an activity id that is not a UUID, or an Abler class
 * without its event is no handle at all. A slot keeps its own start and end
 * only as a pair, the end after the start.
 */
export function decodeClassBooking(raw: unknown): CoachClassBooking | null {
  if (!isObject(raw)) return null;
  const kind = raw.kind;
  if (kind !== 'class' && kind !== 'slot') return null;
  const activityId = raw.activityId;
  if (typeof activityId !== 'string' || !UUID_TEXT.test(activityId)) return null;
  const eventId = wholeNumber(raw.eventId);
  if (kind === 'class' && eventId === null) return null;
  let slotStartsAt: Date | null = null;
  let slotEndsAt: Date | null = null;
  if (kind === 'slot') {
    const starts = optionalDate(raw, 'startsAt');
    const ends = optionalDate(raw, 'endsAt');
    if (starts && ends && ends.getTime() > starts.getTime()) {
      slotStartsAt = starts;
      slotEndsAt = ends;
    }
  }
  return { kind, activityId, eventId, slotStartsAt, slotEndsAt };
}

/** A class step's card, or a chat class card (iOS `CoachPlanClass.init(from:)`). */
export function decodePlanClass(raw: unknown): CoachPlanClass {
  if (!isObject(raw)) throw new Unusable('class');
  let id: string;
  if (typeof raw.id === 'string' && raw.id !== '') {
    id = raw.id;
  } else {
    const number = wholeNumber(raw.id);
    if (number === null) throw new Unusable('id');
    id = String(number);
  }
  const title = optionalString(raw, 'title');
  // A class with no start time cannot be placed in a day or booked.
  const startsAt = optionalDate(raw, 'startsAt');
  if (!startsAt) throw new Unusable('startsAt');
  const ends = optionalDate(raw, 'endsAt');
  const endsAt = ends && ends.getTime() > startsAt.getTime() ? ends : null;
  const venueSlug = requiredString(raw, 'venueSlug');
  const venueName = requiredString(raw, 'venueName');
  // The chat card's extras each fail soft on their own: a value this build
  // cannot read is no value, never a lost card.
  const spots = wholeNumber(raw.spotsLeft);
  const surcharge = wholeNumber(raw.surchargeFromIsk);
  return {
    id,
    title,
    startsAt,
    endsAt,
    venueSlug,
    venueName,
    booking: decodeClassBooking(raw.booking),
    status: optionalString(raw, 'status'),
    spotsLeft: spots === null ? null : Math.max(spots, 0),
    priceLabel: optionalString(raw, 'priceLabel'),
    surchargeFromIsk: surcharge !== null && surcharge > 0 ? surcharge : null,
  };
}

/** The most class cards a reply shows; the server sends at most 6 (iOS `CoachResponse.maxClassCards`). */
export const MAX_CLASS_CARDS = 6;

/**
 * A reply's `classes` (iOS `CoachResponse.classes`), FAIL SOFT, card by card:
 * a card this build cannot read is dropped, a list that is not a list is no
 * cards, a class sent twice is shown once, and six at most. Empty from an
 * older server.
 */
export function decodeClassCards(value: unknown): CoachPlanClass[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cards: CoachPlanClass[] = [];
  for (const entry of value) {
    if (entry === null) continue;
    const card = lossy(() => decodePlanClass(entry));
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
    if (cards.length === MAX_CLASS_CARDS) break;
  }
  return cards;
}

/** A date as the server writes one ("2026-10-13T12:10:00.000Z"), which `parseIsoDate` reads back to the same instant. */
function wireDate(date: Date): string {
  return date.toISOString();
}

/** A booking handle in the server's shape (iOS `CoachClassBooking.encode(to:)`). */
function encodeClassBooking(booking: CoachClassBooking): Json {
  const json: Json = { kind: booking.kind, activityId: booking.activityId.toLowerCase() };
  if (booking.eventId !== null) json.eventId = booking.eventId;
  if (booking.slotStartsAt) json.startsAt = wireDate(booking.slotStartsAt);
  if (booking.slotEndsAt) json.endsAt = wireDate(booking.slotEndsAt);
  return json;
}

/**
 * A class card in the server's own shape (iOS `CoachPlanClass.encode(to:)`),
 * for a saved chat: `decodePlanClass` reads it back to the same card. What is
 * absent is left out. Nothing here is the member's own: the cards are the
 * generic timetable rows.
 */
export function encodePlanClass(session: CoachPlanClass): Json {
  const json: Json = { id: session.id };
  if (session.title !== null) json.title = session.title;
  json.startsAt = wireDate(session.startsAt);
  if (session.endsAt) json.endsAt = wireDate(session.endsAt);
  json.venueSlug = session.venueSlug;
  json.venueName = session.venueName;
  if (session.booking) json.booking = encodeClassBooking(session.booking);
  if (session.status != null) json.status = session.status;
  if (session.spotsLeft != null) json.spotsLeft = session.spotsLeft;
  if (session.priceLabel != null) json.priceLabel = session.priceLabel;
  if (session.surchargeFromIsk != null) json.surchargeFromIsk = session.surchargeFromIsk;
  return json;
}

function decodeSightCard(raw: unknown): CoachPlanSight {
  if (!isObject(raw)) throw new Unusable('sight');
  return {
    slug: requiredString(raw, 'slug'),
    name: requiredString(raw, 'name'),
    kind: requiredString(raw, 'kind'),
    region: typeof raw.region === 'string' ? raw.region : '',
    imageUrl: optionalString(raw, 'imageUrl'),
    imageCredit: optionalString(raw, 'imageCredit'),
    driveFromReykjavik: parseAttractionDrive(raw.driveFromReykjavik),
    roadAccess: parseRoadAccess(optionalString(raw, 'roadAccess')),
  };
}

/**
 * A step's distance (iOS `CoachPlanDistance.init(from:)`), or null for an
 * unknown basis. Minutes are rounded to whole ones and must be at least 1;
 * kilometres must be a finite, non-negative figure. A figure that fails
 * costs the line, never the step.
 */
export function decodePlanDistance(raw: unknown): CoachPlanDistance | null {
  if (!isObject(raw)) return null;
  const basis = raw.basis;
  if (basis !== 'drive' && basis !== 'straight_line') return null;
  let minutes: number | null = null;
  if (typeof raw.minutes === 'number' && Number.isFinite(raw.minutes)) {
    const whole = wholeNumber(Math.sign(raw.minutes) * Math.round(Math.abs(raw.minutes)));
    if (whole !== null && whole >= 1) minutes = whole;
  }
  const km = typeof raw.km === 'number' && Number.isFinite(raw.km) && raw.km >= 0 ? raw.km : null;
  return { basis, minutes, km };
}

/**
 * The one line a card prints about getting there (iOS
 * `CoachPlanDistance.label`). A measured drive reads as minutes of driving
 * and nothing else; a straight line reads "about N km away" and is NEVER
 * dressed up as a drive time, because across a fjord the two can differ by
 * an hour. Null when the figure it needs is missing.
 */
export function planDistanceLabel(
  distance: CoachPlanDistance,
  language: Lang,
  t: (key: string, params?: Params) => string,
): string | null {
  if (distance.basis === 'drive') {
    if (distance.minutes === null) return null;
    return t('coach.plan.distance.drive', { minutes: String(distance.minutes) });
  }
  if (distance.km === null) return null;
  const metres = Math.sign(distance.km) * Math.round(Math.abs(distance.km * 1000));
  if (wholeNumber(metres) === null) return null;
  return t('coach.plan.distance.straight', { km: roadKilometres(Math.max(metres, 100), language) });
}

// MARK: - Steps

function isSlot(value: unknown): value is CoachPlanSlot {
  return value === 'before' || value === 'main' || value === 'after';
}

function isStepKind(value: unknown): value is CoachPlanStepKind {
  return value === 'venue' || value === 'class' || value === 'sight';
}

/**
 * One step (iOS `CoachPlanStep.init(from:)`). Throws for a step that cannot
 * be drawn: only the card that matches the kind is read, and it is required.
 */
export function decodePlanStep(raw: unknown): CoachPlanStep {
  if (!isObject(raw)) throw new Unusable('step');
  const { slot, kind } = raw;
  // A slot or kind this build does not know has no place in the sequence and no card to draw.
  if (!isSlot(slot) || !isStepKind(kind)) throw new Unusable('slot');
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  const distance = lossy(() => decodePlanDistance(raw.distance));
  switch (kind) {
    case 'venue': {
      const venue = decodeVenueCard(raw.venue);
      return { id: `${slot}-venue-${venue.slug}`, slot, kind, note, distance, venue };
    }
    case 'class': {
      const classSession = decodePlanClass(raw.class);
      return { id: `${slot}-class-${classSession.id}`, slot, kind, note, distance, classSession };
    }
    case 'sight': {
      const sight = decodeSightCard(raw.sight);
      // Never send somebody to a place no road or ferry reaches, even if a server were to propose one.
      if (sight.roadAccess === 'offshore') throw new Unusable('offshore');
      return { id: `${slot}-sight-${sight.slug}`, slot, kind, note, distance, sight };
    }
  }
}

// MARK: - The plan

/** iOS `CoachIndexedList`: every entry keeps its index; one that is null or does not decode is a hole. */
function indexedList<T>(value: unknown, decode: (entry: unknown) => T | null): (T | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry === null ? null : lossy(() => decode(entry))));
}

/** One `refinements` entry; a change this build does not know leaves the chip to its wording. */
function decodeRefinement(raw: unknown): { readonly change: CoachRefineChange | null; readonly label: string | null } {
  if (!isObject(raw)) throw new Unusable('refinement');
  const change = optionalString(raw, 'change')?.toLowerCase() ?? null;
  return { change: change !== null && isRefineChange(change) ? change : null, label: optionalString(raw, 'label') };
}

/**
 * The plan (iOS `CoachPlan.init(from:)`). Throws without an id: a chip
 * could not refine it, and it is the one thing a plan cannot be shown
 * honestly without. A plan whose steps all fail still decodes here, with no
 * steps (`decodeCoachPlanResponse` reads that as no plan).
 */
export function decodeCoachPlan(raw: unknown): CoachPlan {
  if (!isObject(raw) || typeof raw.id !== 'string') throw new Unusable('plan');
  const intro = typeof raw.intro === 'string' ? raw.intro.trim() : '';

  // iOS CoachLossyList: a null or an unreadable step is stepped over.
  const wireSteps = Array.isArray(raw.steps)
    ? raw.steps.flatMap((entry) => {
        if (entry === null) return [];
        const step = lossy(() => decodePlanStep(entry));
        return step ? [step] : [];
      })
    : [];
  const steps = wireSteps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => SLOT_ORDER[a.step.slot] - SLOT_ORDER[b.step.slot] || a.index - b.index)
    .map(({ step }) => step);

  const wireChips = indexedList(raw.chips, (entry) => (typeof entry === 'string' ? entry : null));
  const wireRefinements = indexedList(raw.refinements, decodeRefinement);
  const chips: string[] = [];
  const chipChanges: Record<string, CoachRefineChange> = {};
  for (let index = 0; index < wireChips.length; index += 1) {
    const trimmed = wireChips[index]?.trim() ?? '';
    if (trimmed === '' || chips.includes(trimmed)) continue;
    chips.push(trimmed);
    const entry = index < wireRefinements.length ? wireRefinements[index] : null;
    // The server sends the same text in both places. A label that disagrees
    // means the two arrays are not the pair they seem, so the wording decides.
    if (entry && entry.change !== null && (entry.label === null || entry.label === trimmed)) {
      chipChanges[trimmed] = entry.change;
    }
    if (chips.length === MAX_PLAN_CHIPS) break;
  }

  return { id: raw.id, intro, steps, chips, chipChanges };
}

/**
 * The change a refinement chip asks for (iOS `CoachPlan.change(forChip:)`):
 * what the server said the chip does, or, from a server that does not say,
 * what its wording implies.
 */
export function planChangeForChip(plan: Pick<CoachPlan, 'chipChanges'>, chip: string): CoachRefineChange {
  const trimmed = chip.trim();
  return Object.prototype.hasOwnProperty.call(plan.chipChanges, trimmed)
    ? plan.chipChanges[trimmed]!
    : refineChangeForChip(trimmed);
}

/**
 * The answer to a plan request (iOS `CoachResponse.init(from:)`): a plan
 * that does not decode, or has nothing left to show once unusable steps are
 * dropped, reads as no plan, and the reply still shows.
 */
export function decodeCoachPlanResponse(data: unknown): CoachPlanResponse {
  const body = isObject(data) ? data : {};
  const plan = lossy(() => decodeCoachPlan(body.plan));
  return {
    reply: typeof body.reply === 'string' ? body.reply : '',
    plan: plan && plan.steps.length > 0 ? plan : null,
    freeMessages: decodeCoachFreeMessages(body.freeMessages) ?? null,
  };
}

/** The venue steps' slugs, once each, in plan order (iOS `hydratePlanVenues`). */
export function planVenueSlugs(plan: Pick<CoachPlan, 'steps'>): string[] {
  const slugs: string[] = [];
  for (const step of plan.steps) {
    if (step.kind === 'venue' && !slugs.includes(step.venue.slug)) slugs.push(step.venue.slug);
  }
  return slugs;
}
