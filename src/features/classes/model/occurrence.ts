/**
 * One dated class session: the exact occurrence a member tapped, with
 * everything the class sheet needs to book THAT session and nothing else
 * (iOS Models/ClassOccurrence.swift).
 *
 * WHY. A feed row used to hand the booking flow only the activity (its id and
 * a label). The event id and the start time were dropped, so the flow opened
 * on a date picker set to today and then listed the venue's whole timetable
 * for the member to find the class they had already picked. This keeps the
 * occurrence's identity (the Abler `eventId`, or the first-party slot's start
 * and end) all the way to `POST /bookings`.
 *
 * The feed is a hint (an Abler snapshot about 15 minutes old). The sheet
 * re-checks the session's day before it offers Confirm, and the create call
 * re-validates everything again.
 */
import type { ClassFeedItem } from '../../../api/classFeed';
import type { BookingFlowActivity } from '../../../navigation/types';

/** The booking provider of an Abler class (`activities.provider`). */
export const PROVIDER_ABLER = 'abler';
/** A first-party class (iOS `BookingProvider.internalProvider`). */
export const PROVIDER_INTERNAL = 'internal';

/** How the session is booked: an Abler class by its event, a first-party class by its slot times. */
export type ClassOccurrenceHandle = { readonly kind: 'ablerClass'; readonly eventId: number } | { readonly kind: 'slot' };

/** The feed's registration state for the session, used only to seed the sheet until the day's timetable answers. */
export interface ClassOccurrenceSnapshot {
  readonly canBook: boolean | null;
  readonly canBookReason: string | null;
  readonly full: boolean;
  readonly attendanceCurrent: number | null;
  readonly attendanceLimit: number | null;
  readonly registrationOpensAt: Date | null;
}

export interface ClassOccurrence {
  readonly id: string;
  /**
   * The activity the session belongs to: what the booking is made against,
   * and what "See other times" opens the full booking flow on.
   */
  readonly activity: BookingFlowActivity;
  /**
   * The venue, for the `BookingFlow` route (Android's flow is reached by venue
   * and activity). Null only where a caller does not know it (a Coach plan).
   */
  readonly venueId: string | null;
  readonly venueSlug: string | null;
  readonly handle: ClassOccurrenceHandle;
  readonly startsAt: Date;
  /**
   * Null only for a Coach plan's slot handle, which carries no end. The
   * sheet's re-check then supplies it; without it a slot cannot be booked.
   */
  readonly endsAt: Date | null;
  readonly className: string | null;
  readonly venueName: string;
  readonly instructor: string | null;
  /**
   * The room the row showed ("Salur 3", API 0.44.0), or null. The sheet shows
   * the day's timetable's room once its re-check answers (computed live), this
   * one until then.
   */
  readonly room: string | null;
  readonly surchargeFromIsk: number | null;
  readonly snapshot: ClassOccurrenceSnapshot | null;
}

/**
 * A row's stable identity (iOS `ClassFeedItem.id`). The venue id is included
 * because the same upstream event can legitimately appear under more than one
 * venue while location filters are being tuned.
 */
export function classFeedRowId(item: ClassFeedItem): string {
  const { booking } = item;
  const discriminator = booking.kind === 'class' ? `e${booking.eventId}` : booking.kind === 'slot' ? 'slot' : 'x';
  const seconds = Math.trunc(item.startsAt.getTime() / 1000);
  return `${item.venue.id}-${booking.activityId}-${seconds}-${discriminator}`;
}

/**
 * The activity to hand the booking flow (iOS `bookableActivity`). For Abler
 * the flow shows the venue's class timetable, so the venue name labels it
 * best (web parity); first-party slots are labelled by the class itself. Null
 * for a booking kind this build does not know.
 */
export function bookableActivity(item: ClassFeedItem): BookingFlowActivity | null {
  const { booking } = item;
  switch (booking.kind) {
    case 'class':
      return { id: booking.activityId, name: item.venue.name, provider: PROVIDER_ABLER };
    case 'slot':
      return { id: booking.activityId, name: item.name ?? item.venue.name, provider: PROVIDER_INTERNAL };
    default:
      return null;
  }
}

/**
 * The exact session this row shows, or null for a booking kind this build
 * does not know (the row then stays non-tappable). A slot keeps its own
 * handle times: they are what the create call sends.
 */
export function toOccurrence(item: ClassFeedItem): ClassOccurrence | null {
  const activity = bookableActivity(item);
  if (!activity) return null;
  const { booking } = item;
  let handle: ClassOccurrenceHandle;
  let startsAt: Date;
  let endsAt: Date;
  switch (booking.kind) {
    case 'class':
      handle = { kind: 'ablerClass', eventId: booking.eventId };
      startsAt = item.startsAt;
      endsAt = item.endsAt;
      break;
    case 'slot':
      handle = { kind: 'slot' };
      startsAt = booking.startsAt;
      endsAt = booking.endsAt;
      break;
    default:
      return null;
  }
  return {
    id: classFeedRowId(item),
    activity,
    venueId: item.venue.id,
    venueSlug: item.venue.slug,
    handle,
    startsAt,
    endsAt,
    className: item.name,
    venueName: item.venue.name,
    instructor: item.instructor,
    room: item.room,
    surchargeFromIsk: item.surchargeFromIsk,
    snapshot: {
      canBook: item.canBook,
      canBookReason: item.canBookReason,
      full: item.full,
      attendanceCurrent: item.attendance?.current ?? null,
      attendanceLimit: item.attendance?.limit ?? null,
      registrationOpensAt: item.registrationOpensAt,
    },
  };
}
