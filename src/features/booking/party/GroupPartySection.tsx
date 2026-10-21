// @f4-stub (plan 3.0.3): the group party section of a booking, filled by BOOK-2; mounted by BOOK-1.
//
// Guests by age band, the party size and its rules. Controlled by the
// booking screen. Keep the default export and its props; replace the body
// (and this marker). A filler may add OPTIONAL props. Renders nothing until
// BOOK-2 lands.
//
// BOOK-1's mount (src/features/booking/BookingFlowScreen.tsx) also passes the
// optional props below, so the section can draw iOS's per-guest picker
// ("Guest 2", "Guest 3", each with the venue's own band names and ranges)
// without a change to the mount. `onChangeGuests` with counts by band is
// enough on its own: the session keeps every seat's band from them.
import type { AgeBandOffer } from '../../../api/bookings';

/** Guests by age band (the booking body's `guestAgeBands`, by band). */
export type GuestCounts = Readonly<Record<string, number>>;

export interface GroupPartySectionProps {
  readonly venueId: string;
  readonly activityId: string;
  readonly guests: GuestCounts;
  readonly onChangeGuests: (guests: GuestCounts) => void;
  /** A booking is in flight: nothing changes. */
  readonly disabled?: boolean;
  /**
   * The bands this venue sells, in its order, from the availability answer
   * (empty: adults only, no picker; iOS `offeredAgeBands`).
   */
  readonly ageBands?: readonly AgeBandOffer[];
  /** One band per GUEST seat, in order; index 0 is the second person (iOS `guestAgeBands`). */
  readonly guestBands?: readonly string[];
  /** One seat's band changed (iOS `changeGuestAgeBand(at:to:)`). */
  readonly onChangeGuestBand?: (index: number, band: string) => void;
}

export default function GroupPartySection(_props: GroupPartySectionProps) {
  return null;
}
