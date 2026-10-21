/**
 * Bookings as the app reads them.
 *
 * `MemberBooking` (src/api/bookingsList.ts) is the real model: the `GET
 * /bookings` row with its RAW status, which My bookings (Profile, LIB-1)
 * draws ("Pending" in amber, "Checked in", "Confirmed") and cancels by.
 *
 * `Booking` below is the first Android build's folded shape, kept only for
 * the screens not yet rebuilt that still read it through the old service
 * (the Coach heading, src/coach/deriveTags.ts, src/utils/activityHeading.ts).
 * Its 3-state status folds `pending` into "confirmed", so it must never be
 * used to say whether a booking is held: new code reads `MemberBooking`.
 * QA-1 deletes it with its last reader.
 */
export type { BookingRange, MemberBooking } from '../api/bookingsList';

/** @deprecated The first build's folded status; new code reads `MemberBooking.status`. */
export type BookingStatus = 'confirmed' | 'canceled' | 'completed';

/** @deprecated The first build's booking; new code reads `MemberBooking`. */
export interface Booking {
  id: string;
  venueId: string;
  venueName: string;
  /** None today: the bookings API carries no venue image (never a stock photo). */
  venueImageUrl?: string;
  activityName: string;
  bookingTime: Date;
  status: BookingStatus;
  creditCost: number;
  isLuxury: boolean;
}
