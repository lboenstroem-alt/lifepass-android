// @f4-stub (plan 3.0.3): the class booking sheet, filled by CLASS-2; used by CLASS-1 and COACH-3.
//
// iOS `ClassBookingSheet(occurrence:onBooked:)`: one class session's sheet
// (book, other times, card-less class pay). Opened imperatively; the host is
// CLASS-2's to mount.
// Keep the exported names and signatures; replace the bodies (and this marker).
// `ClassSheetHost` is mounted once by F4's tabs shell.
export { default as ClassSheetHost } from './ClassSheetHost';

/**
 * What the sheet needs to identify a session. CLASS-1's feed occurrence
 * satisfies it; CLASS-2 may require more of it (the feed type) once both exist.
 */
export interface ClassSheetOccurrence {
  /** The provider's event id (`eventId` in the booking body). */
  readonly eventId: string;
  readonly venueId: string;
  readonly activityId: string;
  /** ISO start. */
  readonly startsAt: string;
}

export interface OpenClassSheetOptions {
  /** A booking landed (confirmed, or accepted and pending): the screen underneath refreshes. */
  readonly onBooked?: () => void;
}

/** Opens the class sheet over whatever is showing. A no-op until CLASS-2 lands. */
export function openClassSheet(occurrence: ClassSheetOccurrence, options: OpenClassSheetOptions = {}): void {
  void occurrence;
  void options;
}
