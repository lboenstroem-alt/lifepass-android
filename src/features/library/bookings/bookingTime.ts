/* eslint lifepass/no-literal-copy: "error" */
/**
 * When a booking is, as My bookings writes it: the port of iOS LibraryView's
 * `Date.relativeLabel` (Views/Profile/LibraryView.swift).
 *
 *   "Today · 14:00", "Tomorrow · 09:30", "Yesterday · 18:00"
 *   any other day: "21 Oct 2026, 14:00"
 *
 * THE CLOCK. A booking is at a venue in Iceland, so the day and the time are
 * read on Reykjavík's calendar (UTC, no daylight saving), as every venue
 * time in the app is and as Home's upcoming card reads the same bookings: a
 * member whose phone is still on another zone sees the 14:00 class at 14:00.
 * (iOS reads the phone's zone here; the two only differ on a phone set to
 * another zone.)
 *
 * THE WORDS. "Today", "Tomorrow" and "Yesterday" follow the account language
 * (library.today / .tomorrow / .yesterday). The time is 24-hour on every
 * phone. Any other day is iOS's abbreviated date with the short time, in
 * English for every account: the iOS bundle is English only, so Foundation
 * writes that date in English for an Icelandic account too (Home's upcoming
 * card makes the same call). Medium date and time are joined with a comma, as
 * the British English convention the app formats by (src/i18n/format.ts).
 */
import { addServerDays, formatDatePattern, isInvalidDate, serverDay, venueTime } from '../../../i18n/format';

/** `t`, or a `useT().t`. */
type Translate = (key: string) => string;

/** The separator iOS puts between the day word and the time. */
const DOT = ' · ';

/** '' for a date that holds no instant. */
export function relativeBookingTime(date: Date, translate: Translate, now: Date = new Date()): string {
  if (isInvalidDate(date) || isInvalidDate(now)) return '';
  const time = venueTime(date);
  const day = serverDay(date);
  const today = serverDay(now);
  if (day === today) return `${translate('library.today')}${DOT}${time}`;
  if (day === addServerDays(today, 1)) return `${translate('library.tomorrow')}${DOT}${time}`;
  if (day === addServerDays(today, -1)) return `${translate('library.yesterday')}${DOT}${time}`;
  return `${formatDatePattern(date, 'd MMM y', 'en')}, ${time}`;
}

/** The past row's line: the activity, then when (iOS `"\(activity) · \(relativeLabel)"`). */
export function pastRowDetail(activity: string, when: string): string {
  return `${activity}${DOT}${when}`;
}
