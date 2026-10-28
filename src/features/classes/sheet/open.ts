// `openClassSheet` itself (re-exported by ./index.ts, plan 3.0.3). Its own
// module so the Coach lookup (../coachLookup.ts) can open the sheet without
// loading the sheet's index, which re-exports the lookup.
import type { RefObject } from 'react';

import type { ClassOccurrence } from '../model/occurrence';
import { presentClassSheet } from './requests';

/** What the sheet needs to identify a session: the feed's (or a Coach plan's) `ClassOccurrence`. */
export type ClassSheetOccurrence = ClassOccurrence;

export interface OpenClassSheetOptions {
  /**
   * A booking landed (confirmed, or accepted and pending), or may have: the
   * screen underneath refreshes what it lists. Also called when the member
   * comes back from the full schedule ("See other times"), where a booking
   * can land out of the sheet's sight (iOS reloads the feed when the flow
   * pushed inside the sheet booked).
   */
  readonly onBooked?: () => void;
  /**
   * The sheet has gone, however it closed: called exactly once per opening,
   * after any `onBooked`, on every way it ends: its close button, hardware
   * back, a swipe down, Done on an outcome, a newer `openClassSheet`, and the
   * member coming back from the full schedule it opened. A page the sheet
   * opens for a refusal's step (Plans, Account, My bookings) does NOT end it:
   * the sheet steps aside and comes back when the member does, checking the
   * same class again (iOS presents those over the sheet). The feed re-reads
   * here after a booking (iOS `.sheet(item:onDismiss:)`).
   */
  readonly onDismiss?: () => void;
  /**
   * The row or button that opened the sheet: TalkBack focus goes back to it
   * once the sheet has gone and the member is where it was opened (iOS
   * VoiceOver returns to the element that presented a sheet). Not after a
   * page took the member elsewhere, nor when a newer sheet replaced it.
   */
  readonly returnFocusRef?: RefObject<unknown>;
}

/**
 * Opens the class sheet over whatever is showing. A sheet already up is
 * replaced (its opener hears `onDismiss`), unless it has a booking in
 * flight: then this request is dropped and its opener hears `onDismiss` at
 * once, so nothing waits on it.
 */
export function openClassSheet(occurrence: ClassSheetOccurrence, options: OpenClassSheetOptions = {}): void {
  const { onBooked, onDismiss, returnFocusRef } = options;
  if (!presentClassSheet(occurrence, { onBooked, onDismiss, returnFocusRef })) {
    options.onDismiss?.();
  }
}
