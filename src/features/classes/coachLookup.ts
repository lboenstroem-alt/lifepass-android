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
 * A Coach slot handle carries no end. The sheet's re-check supplies it, and
 * if that fails the session is "unresolved" with Try again: a slot is never
 * booked blind.
 *
 * COACH-3 decodes the plan (its lossy plan decoder) and hands each class step
 * here as a `CoachPlanClass`.
 */
import { fetchClassFeedPage, type ClassFeedFetcher, type ClassFeedItem } from '../../api/classFeed';
import { VenueTimeFormat } from '../../i18n';
import { openSharedRoute, type SharedRouteNavigation } from '../../navigation/sharedSheet';
import { PROVIDER_ABLER, PROVIDER_INTERNAL, toOccurrence, type ClassOccurrence } from './model/occurrence';
import { openClassSheet, type OpenClassSheetOptions } from './sheet/open';
import { knownVenueIdForSlug } from './sheet/pages';
import { classSheetSignOuts } from './sheet/requests';

/**
 * The class feed's booking handle on a plan's class: `{ kind: "class",
 * activityId, eventId }` or `{ kind: "slot", activityId }`. A kind this build
 * does not know, or an Abler class without its event, is no handle at all
 * (the plan's decoder drops it, as iOS `CoachClassBooking` does).
 */
export interface CoachClassBooking {
  readonly kind: 'class' | 'slot';
  readonly activityId: string;
  readonly eventId: number | null;
}

/** A class step in a Coach plan (iOS `CoachPlanClass`). */
export interface CoachPlanClass {
  readonly id: string;
  /** Null when the venue gave the class no name. */
  readonly title: string | null;
  readonly startsAt: Date;
  /** Null when the plan gave none (or one not after the start). */
  readonly endsAt: Date | null;
  readonly venueSlug: string;
  readonly venueName: string;
  /**
   * The class's room ("Salur 3", API 0.44.0), or null; absent from a Coach
   * answer cached before 0.44.0 (null). Shown after the venue name.
   */
  readonly room: string | null;
  /** The class feed's booking handle, when the server included it. */
  readonly booking: CoachClassBooking | null;
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
  if (booking.kind === 'class') {
    if (booking.eventId == null) return null;
    // Labelled the way the Classes tab labels an Abler row: by the venue,
    // whose timetable "See other times" opens.
    occurrenceActivity = { id: booking.activityId, name: session.venueName, provider: PROVIDER_ABLER };
    handle = { kind: 'ablerClass', eventId: booking.eventId };
  } else {
    occurrenceActivity = { id: booking.activityId, name: session.title ?? session.venueName, provider: PROVIDER_INTERNAL };
    handle = { kind: 'slot' };
  }
  const endsAt = session.endsAt && session.endsAt.getTime() > session.startsAt.getTime() ? session.endsAt : null;
  return {
    id: `coach-${session.id}-${Math.trunc(session.startsAt.getTime() / 1000)}`,
    activity: occurrenceActivity,
    venueId: venueIdForSlug(session.venueSlug),
    venueSlug: session.venueSlug,
    handle,
    startsAt: session.startsAt,
    endsAt,
    className: session.title,
    venueName: session.venueName,
    instructor: null,
    room: session.room,
    surchargeFromIsk: null,
    snapshot: null,
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
