// @f4-stub (plan 3.0.3): the class booking sheet, filled by CLASS-2; used by CLASS-1 and COACH-3.
//
// iOS `ClassBookingSheet(occurrence:onBooked:)`: one class session's sheet
// (book, other times, card-less class pay). Opened imperatively; the host is
// CLASS-2's to mount.
// Keep the exported names and signatures; replace the bodies (and this marker).
// `ClassSheetHost` is mounted once by F4's tabs shell.
//
// CLASS-1 (contract): the occurrence is the feed's own session type,
// `ClassOccurrence` (../model/occurrence.ts, iOS ClassOccurrence.swift), as
// the stub anticipated, and `onDismiss` lets the feed re-read once the sheet
// has gone after a booking (iOS `.sheet(item:onDismiss:)`).
import type { ClassOccurrence } from '../model/occurrence';

export { default as ClassSheetHost } from './ClassSheetHost';

/** What the sheet needs to identify a session: the feed's (or a Coach plan's) `ClassOccurrence`. */
export type ClassSheetOccurrence = ClassOccurrence;

export interface OpenClassSheetOptions {
  /** A booking landed (confirmed, or accepted and pending): the screen underneath refreshes. */
  readonly onBooked?: () => void;
  /** The sheet has gone, however it closed. */
  readonly onDismiss?: () => void;
}

/** Opens the class sheet over whatever is showing. A no-op until CLASS-2 lands. */
export function openClassSheet(occurrence: ClassSheetOccurrence, options: OpenClassSheetOptions = {}): void {
  void occurrence;
  void options;
}
