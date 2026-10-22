/**
 * Bookings as the app reads them.
 *
 * `MemberBooking` (src/api/bookingsList.ts) is the real model: the `GET
 * /bookings` row with its RAW status, which My bookings (Profile, LIB-1)
 * draws ("Pending" in amber, "Checked in", "Confirmed") and cancels by.
 *
 * `Booking` below is the first Android build's folded shape. Its one
 * remaining reader is the legacy service src/supabase/services/bookings.ts
 * (BOOK-1's `fetchBookings`, `fetchUpcomingBookings` and `cancelBooking`,
 * which no screen calls any more). Its 3-state status folds `pending` into
 * "confirmed", so it must never be used to say whether a booking is held:
 * new code reads `MemberBooking`. It goes when those legacy functions do
 * (BOOK-1 or QA-1).
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
