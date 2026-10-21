// The class booking sheet (CLASS-2, plan 3.0.3): one class session's sheet,
// opened over whatever is showing. Used by the classes feed (CLASS-1) and the
// Coach's plan cards (COACH-3).
//
//   openClassSheet(occurrence, {
//     onBooked: () => { bookedHere = true; },
//     onDismiss: () => { if (bookedHere) reload(); },
//   });
//
// iOS `ClassBookingSheet(occurrence:onBooked:)` in a `.sheet(item:onDismiss:)`.
// The sheet books THAT session (the Abler event, or the first-party slot's
// times), with the charge disclosure, the price above Confirm, consent, the
// pay-and-save-card page for a member with no saved card, and every refusal
// and outcome the full flow has. A session that started, left the schedule
// or can't be booked says so and offers "See other times" (the full flow on
// that day). `ClassSheetHost` is mounted once by F4's tabs shell.
//
// THE COACH. A plan's class step books through `bookCoachClass(session,
// { navigation })` (../coachLookup.ts, re-exported here because another
// feature reaches this one only through an index): the plan's own handle,
// else the same class found in the feed, else the venue's page.
export { default as ClassSheetHost } from './ClassSheetHost';
export { openClassSheet, type ClassSheetOccurrence, type OpenClassSheetOptions } from './open';
export {
  bookCoachClass,
  coachClassOccurrence,
  COACH_CLASS_LOOKUP_PAGES,
  COACH_CLASS_START_TOLERANCE_MS,
  feedOccurrenceMatching,
  resolveCoachClassOccurrence,
  type BookCoachClassOptions,
  type CoachClassBooking,
  type CoachClassLookupDeps,
  type CoachPlanClass,
} from '../coachLookup';
