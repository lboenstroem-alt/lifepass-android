// Classes discovery's public surface (CLASS-1), for other features:
//
//   - The session a class sheet books (`ClassOccurrence`) and how a feed row
//     becomes one, for the class sheet (CLASS-2) and the Coach (COACH-3).
//   - The feed's day rules and client filters, for anything that reads
//     `GET /classes` the way the list does (the Coach's class lookup).
//   - The month calendar, for any screen that needs a day picker.
//
// This barrel holds leaf modules only, so the class sheet (sheet/**), the
// booking flow and the Coach can import from it without a require cycle or
// pulling in the feed. The screen itself is NOT here: it opens the class
// sheet, so the sheet importing it back would loop (sheet -> barrel ->
// screen -> sheet). Mount it from its slot path,
// `src/features/classes/ClassesDiscovery.tsx` (plan 3.0.3); Plan opens the
// `ClassesDiscoveryModal` route.
export {
  bookableActivity,
  classFeedRowId,
  PROVIDER_ABLER,
  PROVIDER_INTERNAL,
  toOccurrence,
  type ClassOccurrence,
  type ClassOccurrenceHandle,
  type ClassOccurrenceSnapshot,
} from './model/occurrence';
export { chipCopy, classFeedChip, type ClassFeedChip } from './model/chip';
export { feedEntries, passesClientFilters, distanceKm, type FeedEntry } from './feed/clientFilters';
export { FEATURED_CATEGORIES, isoDay, lookAheadWindow, startOfIsoDay } from './feed/days';
// The month calendar on the venue's calendar (Reykjavík days, a min/max
// range), for any screen that needs a day picker like the full schedule's.
export { default as DayCalendar, type DayCalendarProps } from './ui/DayCalendar';
export type { DayRange } from './feed/days';
