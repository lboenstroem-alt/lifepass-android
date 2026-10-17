// @f4-stub (plan 3.0.3): the group party section of a booking, filled by BOOK-2; mounted by BOOK-1.
//
// Guests by age band, the party size and its rules. Controlled by the
// booking screen. Keep the default export and its props; replace the body
// (and this marker). A filler may add OPTIONAL props. Renders nothing until
// BOOK-2 lands.

/** Guests by age band (the booking body's `guestAgeBands`, by band). */
export type GuestCounts = Readonly<Record<string, number>>;

export interface GroupPartySectionProps {
  readonly venueId: string;
  readonly activityId: string;
  readonly guests: GuestCounts;
  readonly onChangeGuests: (guests: GuestCounts) => void;
  /** A booking is in flight: nothing changes. */
  readonly disabled?: boolean;
}

export default function GroupPartySection(_props: GroupPartySectionProps) {
  return null;
}
