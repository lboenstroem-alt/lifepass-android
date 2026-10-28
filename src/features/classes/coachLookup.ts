/**
 * A Coach plan's class step, booked: the session the class sheet opens for
 * it (iOS `CoachPlanClass.classOccurrence` in Models/ClassOccurrence.swift and
 * `CoachViewModel.classOccurrence(for:)` / `feedOccurrence(matching:in:)`).
 *
 *   await bookCoachClass(session, { navigation });   // COACH-3's Book button
 *
 * - The plan carried the class feed's booking handle: the sheet opens on it
 *   directly (an Abler class labelled by its venue, a slot by its title).
 * - Otherwise the class is looked up in `GET /classes` for its Reykjavík day:
 *   first searched by its title, then up to three unfiltered pages. A match
 *   is the same venue and a start within a minute, preferring the same title;
 *   a differently named row is taken only when it is the venue's ONLY class at
 *   that time (two rooms, two classes: the sheet would sit one Confirm away
 *   from the wrong one).
 * - Nothing found: the venue's page opens instead, whose timetable books it,
 *   rather than guessing.
 *
 * A sign-out while the lookup runs drops the answer: the feed is public and
 * still answers, and the sheet would otherwise open on this member's plan
 * class for whoever signs in next (iOS tears the Coach view, and its sheet,
 * down at sign-out).
 *
 * A Coach slot is booked by its handle's own start and end when the server
 * sent them (what the create call sends, as for a Classes row), else by the
 * class's times. With no end at all the sheet's re-check supplies it, and if
 * that fails the session is "unresolved" with Try again: a slot is never
 * booked blind.
 *
 * A chat class card (API 0.36.0) also carries its own verdict (open, full,
 * opens later, spots left) and the feed's "from" price. Both ride into the
 * sheet, so a card that said Full or "opens later" is never offered Confirm
 * when the sheet's re-check cannot answer (`coachCardSnapshot`).
 *
 * COACH-3 decodes the plan (its lossy plan decoder) and hands each class step
 * here as a `CoachPlanClass`; the chat's class cards are decoded the same way.
 */
import { fetchClassFeedPage, type ClassFeedFetcher, type ClassFeedItem } from '../../api/classFeed';
import { VenueTimeFormat } from '../../i18n';
import { openSharedRoute, type SharedRouteNavigation } from '../../navigation/sharedSheet';
import {
  PROVIDER_ABLER,
  PROVIDER_INTERNAL,
  toOccurrence,
  type ClassOccurrence,
  type ClassOccurrenceSnapshot,
} from './model/occurrence';
import { openClassSheet, type OpenClassSheetOptions } from './sheet/open';
import { knownVenueIdForSlug } from './sheet/pages';
import { classSheetSignOuts } from './sheet/requests';

/**
 * The class feed's booking handle on a plan's class: `{ kind: "class",
 * activityId, eventId }` or `{ kind: "slot", activityId, startsAt, endsAt }`.
 * A kind this build does not know, or an Abler class without its event, is no
 * handle at all (the plan's decoder drops it, as iOS `CoachClassBooking` does).
 */
export interface CoachClassBooking {
  readonly kind: 'class' | 'slot';
  readonly activityId: string;
  readonly eventId: number | null;
  /**
   * A slot's own times, which are what the create call sends (as for a
   * Classes row). Null (or absent) when the server left them out or they are
   * not a start before an end; the class's own times stand in.
   */
  readonly slotStartsAt?: Date | null;
  readonly slotEndsAt?: Date | null;
}

/**
 * A chat class card's booking state on the wire (API 0.36.0), from the same
 * verdict the booking flow uses: `open`, `full`, `opens_later`, or a state a
 * later server added, which is never bookable from the card.
 */
export type CoachClassStatus = string;

/** A class step in a Coach plan, or a class card under a chat reply (iOS `CoachPlanClass`). */
export interface CoachPlanClass {
  readonly id: string;
  /** Null when the venue gave the class no name. */
  readonly title: string | null;
  readonly startsAt: Date;
  /** Null when the plan gave none (or one not after the start). */
  readonly endsAt: Date | null;
  readonly venueSlug: string;
  readonly venueName: string;
  /** The class feed's booking handle, when the server included it. */
  readonly booking: CoachClassBooking | null;

  // Chat cards only (API 0.36.0), all generic, never the member's own. A day
  // plan's class carries none of them (absent or null).

  /** Whether booking is open now. Null when the server sent none. */
  readonly status?: CoachClassStatus | null;
  /** Spots left (never below 0); null when the class has no limit or none is known. */
  readonly spotsLeft?: number | null;
  /**
   * Already worded by the server in the reply's language ("Included in your
   * plan", "From 4,500 ISK"). The booking sheet shows the exact charge.
   */
  readonly priceLabel?: string | null;
  /** The class feed's public "from" price (above 0), as `GET /classes` ships it. */
  readonly surchargeFromIsk?: number | null;
}

/**
 * A chat card's own verdict, so the sheet starts from it and keeps it if the
 * one-day re-check can't answer (offline, a 5xx): a card that said Full or
 * "opens later" is then not offered Confirm (iOS `cardSnapshot`). Null when
 * the card carried neither a status nor a spot count, which is every day
 * plan's class, so that path seeds exactly as before. The re-check replaces
 * it, and the create call stays the real gate.
 */
export function coachCardSnapshot(
  session: Pick<CoachPlanClass, 'status' | 'spotsLeft'>,
): ClassOccurrenceSnapshot | null {
  const status = session.status ?? null;
  const spotsLeft = session.spotsLeft ?? null;
  if (status === null && spotsLeft === null) return null;
  let canBook: boolean | null;
  let canBookReason: string | null = null;
  switch (status) {
    case null:
      canBook = null;
      break;
    case 'open':
      canBook = true;
      break;
    case 'full':
      canBook = false;
      canBookReason = 'class_full';
      break;
    case 'opens_later':
      // The sheet's own "not open yet" wording.
      canBook = false;
      canBookReason = 'event_not_open';
      break;
    default:
      canBook = false;
  }
  return {
    canBook,
    canBookReason,
    full: status === 'full',
    // Spots left as a count against a limit of the same size, which is how
    // the sheet and the slot seed read "N left".
    attendanceCurrent: spotsLeft === null ? null : 0,
    attendanceLimit: spotsLeft,
    registrationOpensAt: null,
  };
}

/** The longest a feed row's start may differ from the plan's and still be that class. */
export const COACH_CLASS_START_TOLERANCE_MS = 60_000;

/** How many unfiltered feed pages the lookup reads at most. */
export const COACH_CLASS_LOOKUP_PAGES = 3;

/**
 * The session, when the plan carried the feed's booking handle; null without
 * one (the class is then looked up first). `venueIdForSlug` names the venue
 * when the phone already knows it, for the full schedule's route.
 */
export function coachClassOccurrence(
  session: CoachPlanClass,
  venueIdForSlug: (slug: string) => string | null = () => null,
): ClassOccurrence | null {
  const booking = session.booking;
  if (!booking) return null;
  let occurrenceActivity: ClassOccurrence['activity'];
  let handle: ClassOccurrence['handle'];
  let startsAt = session.startsAt;
  let endsAt = session.endsAt && session.endsAt.getTime() > session.startsAt.getTime() ? session.endsAt : null;
  if (booking.kind === 'class') {
    if (booking.eventId == null) return null;
    // Labelled the way the Classes tab labels an Abler row: by the venue,
    // whose timetable "See other times" opens.
    occurrenceActivity = { id: booking.activityId, name: session.venueName, provider: PROVIDER_ABLER };
    handle = { kind: 'ablerClass', eventId: booking.eventId };
  } else {
    occurrenceActivity = { id: booking.activityId, name: session.title ?? session.venueName, provider: PROVIDER_INTERNAL };
    handle = { kind: 'slot' };
    // The slot handle's own times are what the create call sends, exactly
    // as a Classes row books it.
    const slotStart = booking.slotStartsAt ?? null;
    const slotEnd = booking.slotEndsAt ?? null;
    if (slotStart && slotEnd && slotEnd.getTime() > slotStart.getTime()) {
      startsAt = slotStart;
      endsAt = slotEnd;
    }
  }
  const surcharge = session.surchargeFromIsk ?? null;
  return {
    id: `coach-${session.id}-${Math.trunc(startsAt.getTime() / 1000)}`,
    activity: occurrenceActivity,
    venueId: venueIdForSlug(session.venueSlug),
    venueSlug: session.venueSlug,
    handle,
    startsAt,
    endsAt,
    className: session.title,
    venueName: session.venueName,
    instructor: null,
    // A chat card carries the feed's "from" price; a day plan's class does
    // not. The sheet uses it only while it has no disclosure.
    surchargeFromIsk: surcharge !== null && surcharge > 0 ? surcharge : null,
    snapshot: coachCardSnapshot(session),
  };
}

/**
 * The feed row that IS the plan's class: the same venue, a start within a
 * minute, and the plan's title. A row with another title only when it is the
 * venue's ONLY class at that time; with two (different rooms) null sends the
 * member to the venue's timetable instead. The matched row's own session is
 * kept, event id and times included.
 */
export function feedOccurrenceMatching(session: CoachPlanClass, items: readonly ClassFeedItem[]): ClassOccurrence | null {
  const sameTime = items.filter(
    (item) =>
      item.venue.slug === session.venueSlug &&
      Math.abs(item.startsAt.getTime() - session.startsAt.getTime()) < COACH_CLASS_START_TOLERANCE_MS &&
      toOccurrence(item) !== null,
  );
  const titled = sameTime.find((item) => item.name === session.title);
  if (titled) return toOccurrence(titled);
  return sameTime.length === 1 ? toOccurrence(sameTime[0]!) : null;
}

export interface CoachClassLookupDeps {
  readonly fetchPage?: ClassFeedFetcher;
  readonly venueIdForSlug?: (slug: string) => string | null;
}

/**
 * The exact session a class step books: the plan's own handle, else the same
 * class found in the feed for its Reykjavík day (by its title first, then up
 * to three unfiltered pages). Null when neither finds it; a page that fails
 * ends that part of the search, never the whole answer.
 */
export async function resolveCoachClassOccurrence(
  session: CoachPlanClass,
  deps: CoachClassLookupDeps = {},
): Promise<ClassOccurrence | null> {
  const fetchPage = deps.fetchPage ?? fetchClassFeedPage;
  const own = coachClassOccurrence(session, deps.venueIdForSlug ?? knownVenueIdForSlug);
  if (own) return own;
  const day = VenueTimeFormat.day(session.startsAt);
  if (session.title) {
    try {
      const page = await fetchPage({ query: session.title, start: day, end: day });
      const match = feedOccurrenceMatching(session, page.classes);
      if (match) return match;
    } catch {
      // The search failed: the unfiltered pages may still have it.
    }
  }
  let cursor: string | null = null;
  for (let read = 0; read < COACH_CLASS_LOOKUP_PAGES; read += 1) {
    let page;
    try {
      page = await fetchPage({ start: day, end: day, cursor });
    } catch {
      break;
    }
    const match = feedOccurrenceMatching(session, page.classes);
    if (match) return match;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return null;
}

export interface BookCoachClassOptions extends CoachClassLookupDeps, OpenClassSheetOptions {
  /** The Coach screen's navigation, for the venue's page when nothing is found. */
  readonly navigation: SharedRouteNavigation;
  /** Opens the sheet (the app's `openClassSheet` by default). */
  readonly openSheet?: typeof openClassSheet;
}

/**
 * A class step's Book: the class sheet on its session, or, when the feed has
 * no such class, the venue's page (its timetable books it). Says which;
 * `none` when the member signed out while it looked (nothing opens, and the
 * opener hears `onDismiss` as for any sheet that never came).
 */
export async function bookCoachClass(
  session: CoachPlanClass,
  options: BookCoachClassOptions,
): Promise<'sheet' | 'venue' | 'none'> {
  const signOutsBefore = classSheetSignOuts();
  const occurrence = await resolveCoachClassOccurrence(session, options);
  if (classSheetSignOuts() !== signOutsBefore) {
    try {
      options.onDismiss?.();
    } catch {
      // The opener's own failure; nothing opened either way.
    }
    return 'none';
  }
  if (occurrence) {
    const { onBooked, onDismiss, returnFocusRef } = options;
    (options.openSheet ?? openClassSheet)(occurrence, { onBooked, onDismiss, returnFocusRef });
    return 'sheet';
  }
  openSharedRoute(options.navigation, 'VenueDetail', { slug: session.venueSlug });
  return 'venue';
}
