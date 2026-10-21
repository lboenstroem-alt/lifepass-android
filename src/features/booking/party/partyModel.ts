/**
 * The group party's rules as the party section draws and changes them: the
 * Android port of iOS BookingFlowView's `groupStepper` and `guestAgePicker`
 * (Views/Booking/BookingFlowView.swift) and BookingViewModel's
 * `syncGuestAgeBands`.
 *
 * THE MEMBER IS ALWAYS AN ADULT. The party counts the member who books, but
 * the member's seat is never in the guest list: they are charged and
 * reserved as an adult, and nothing here can say otherwise. Only GUEST seats
 * (the second person on) have a band.
 *
 * A NEW GUEST IS AN ADULT. The stepper grows the list with an adult (the
 * band that costs the venue most, so a slip never short-changes it) and
 * shrinks it from the END, so an age already picked stays with its person.
 *
 * Pure functions of their inputs and a language, so the tests read the same
 * labels and seat lists the section shows.
 */
import type { AgeBandOffer } from '../../../api/bookings';
import { translate, type Lang } from '../../../i18n';
import { bandLabelKey } from '../bookingCopy';

/** Guests by age band (`{ adult: 1, child: 2 }`), the slot contract's `guests`. */
export type GuestCounts = Readonly<Record<string, number>>;

/** The smallest party: the member alone. */
export const MIN_PARTY = 1;
/** The largest party one booking takes, the member included (the server refuses more). */
export const MAX_PARTY = 10;

/** A count that is not a whole, positive number is none. */
function wholeCount(raw: number): number {
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/** Guests by band, from the per-seat list. */
export function countsFromBands(bands: readonly string[]): GuestCounts {
  const counts: Record<string, number> = {};
  for (const band of bands) counts[band] = (counts[band] ?? 0) + 1;
  return counts;
}

/**
 * A seat list for counts alone (a caller that passes no `guestBands`): the
 * venue's bands in its order, then any band it does not list, never more
 * than nine guests. Which seat is which is not known from counts, so this is
 * only for drawing the rows and stepping.
 */
export function bandsFromCounts(counts: GuestCounts, bandOrder: readonly string[] = []): string[] {
  const known = bandOrder.filter((band) => band in counts);
  const others = Object.keys(counts).filter((band) => !bandOrder.includes(band));
  const bands: string[] = [];
  for (const band of [...new Set([...known, ...others])]) {
    for (let left = wholeCount(counts[band]); left > 0; left -= 1) bands.push(band);
  }
  return bands.slice(0, MAX_PARTY - 1);
}

/** People on the booking for a guest list: the member plus every guest. */
export function partySize(guestBands: readonly string[]): number {
  return MIN_PARTY + guestBands.length;
}

/**
 * The guest seats after one tap of the stepper, or null when the party is
 * already at that bound (iOS clamps to 1...10 and does nothing at a bound).
 * Plus adds an adult at the end; minus removes the LAST guest.
 */
export function steppedBands(guestBands: readonly string[], direction: 1 | -1): string[] | null {
  const next = partySize(guestBands) + direction;
  if (next < MIN_PARTY || next > MAX_PARTY) return null;
  return direction > 0 ? [...guestBands, 'adult'] : guestBands.slice(0, -1);
}

/**
 * The per-guest age rows show only when the venue sells more than one band
 * and someone besides the member is coming (iOS `showsAgeBands`; the section
 * itself renders only for a Bókun slot activity).
 */
export function showsGuestAges(ageBands: readonly AgeBandOffer[], guestBands: readonly string[]): boolean {
  return ageBands.length > 1 && guestBands.length > 0;
}

/**
 * "Child (6-15)": the band's name with the venue's OWN range, never a
 * hard-coded one, because the bands differ per venue and a wrong range is
 * what makes someone pick the wrong ticket. No range: the name alone.
 */
export function bandOptionLabel(band: string, range: string | null | undefined, lang: Lang): string {
  const name = translate(bandLabelKey(band), lang);
  return range ? `${name} (${range})` : name;
}

/**
 * The label for a band already picked, with the range the venue gives it.
 * It names the band the request carries, never "Adult" in its place:
 * showing Adult while the request still says child would misstate what is
 * being booked.
 */
export function selectedBandLabel(band: string, offered: readonly AgeBandOffer[], lang: Lang): string {
  return bandOptionLabel(band, offered.find((offer) => offer.band === band)?.rangeLabel, lang);
}
