// Home's "UPCOMING" card: the member's soonest booking, and the line that
// says when it is. The Android port of what iOS Home reads from
// `MyBookingsViewModel.upcomingBookings.first` and of `HomeView.bookingWhen`.
//
// WHY HOME READS ITS OWN LIST. The card needs three fields of one booking.
// Profile's bookings list (LIB-1) and the booking flow's service (BOOK-1)
// are rebuilt in parallel with Home, so Home reads `GET /bookings` for
// itself, as narrowly as it uses it, rather than lean on a shape that is
// about to change. The request is iOS's: `range=upcoming`, `limit=100`.
//
// THE CLOCK. A booking is at a venue in Iceland, so "Today", "Tomorrow" and
// the time are read on Reykjavík's calendar (UTC, no daylight saving), the
// way every venue time in the app is: a tourist whose phone still runs on
// New York time sees the 14:00 class at 14:00. (iOS 2.5.6 Home reads the
// phone's zone here; the venue clock is the rule everywhere else since the
// 2.5.0 audit, and the two only differ on a phone set to another zone.)
//
// THE WORDS. "Today" and "Tomorrow" follow the account language
// (library.today / library.tomorrow). A later day is written "Sat 7 Jun" in
// English for every account, as iOS writes it: the iOS bundle is English
// only, so Foundation formats that date in English for an Icelandic account
// too.
import { apiGet } from '../../api';
import { parseIsoDate } from '../../api/wire';
import { addServerDays, formatDatePattern, isInvalidDate, serverDay, venueTime } from '../../i18n/format';

/** What the card shows of a booking. */
export interface UpcomingBooking {
  readonly id: string;
  readonly venueName: string;
  readonly startsAt: Date;
}

/** `t`, or a `useT().t`. */
type Translate = (key: string) => string;

/** A row the card cannot show; the client turns it into a `DecodingError`. */
export class UpcomingBookingDecodeError extends Error {
  constructor(path: string) {
    super(`bookings: unreadable ${path}`);
    this.name = 'UpcomingBookingDecodeError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The page's bookings, strictly: a row without an id, a start or a venue name
 * fails the whole read, as iOS's `Decodable` does (the card then shows "No
 * upcoming bookings", never a half-read booking).
 */
export function decodeUpcomingPage(data: unknown): UpcomingBooking[] {
  if (!isRecord(data) || !Array.isArray(data.data)) throw new UpcomingBookingDecodeError('data');
  return data.data.map((row, index) => {
    const path = `data[${index}]`;
    if (!isRecord(row)) throw new UpcomingBookingDecodeError(path);
    const { id, startsAt, venue } = row;
    if (typeof id !== 'string' || id.length === 0) throw new UpcomingBookingDecodeError(`${path}.id`);
    const start = typeof startsAt === 'string' ? parseIsoDate(startsAt) : null;
    if (!start) throw new UpcomingBookingDecodeError(`${path}.startsAt`);
    if (!isRecord(venue) || typeof venue.name !== 'string') throw new UpcomingBookingDecodeError(`${path}.venue.name`);
    return { id, venueName: venue.name, startsAt: start };
  });
}

/** Soonest first (iOS sorts by `startsAt` ascending after every load). Ties keep the server's order. */
export function sortedUpcoming(bookings: readonly UpcomingBooking[]): UpcomingBooking[] {
  return bookings
    .map((booking, index) => ({ booking, index }))
    .sort((a, b) => a.booking.startsAt.getTime() - b.booking.startsAt.getTime() || a.index - b.index)
    .map(({ booking }) => booking);
}

/** `GET /bookings?range=upcoming&limit=100`, soonest first. Throws on any failure. */
export async function fetchUpcomingBookings(options: { signal?: AbortSignal } = {}): Promise<UpcomingBooking[]> {
  const rows = await apiGet<UpcomingBooking[]>(
    '/bookings',
    { range: 'upcoming', limit: 100 },
    { signal: options.signal, decode: decodeUpcomingPage },
  );
  return sortedUpcoming(rows);
}

/**
 * "Today · 18:00", "Tomorrow · 09:30" or "Sat 7 Jun · 14:00" (see the file
 * comment for the clock and the words). '' for a date that holds no instant.
 */
export function bookingWhen(date: Date, translate: Translate, now: Date = new Date()): string {
  if (isInvalidDate(date) || isInvalidDate(now)) return '';
  const time = venueTime(date);
  const day = serverDay(date);
  const today = serverDay(now);
  if (day === today) return `${translate('library.today')} · ${time}`;
  if (day === addServerDays(today, 1)) return `${translate('library.tomorrow')} · ${time}`;
  return `${formatDatePattern(date, 'EEE d MMM', 'en')} · ${time}`;
}
