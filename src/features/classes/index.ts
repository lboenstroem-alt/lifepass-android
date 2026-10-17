// Classes discovery's public surface (CLASS-1), for other features:
//
//   - `ClassesDiscovery` (a published slot: src/features/classes/ClassesDiscovery.tsx),
//     mounted by Explore; Plan opens the `ClassesDiscoveryModal` route.
//   - The session a class sheet books (`ClassOccurrence`) and how a feed row
//     becomes one, for the class sheet (CLASS-2) and the Coach (COACH-3).
//   - The feed's day rules and client filters, for anything that reads
//     `GET /classes` the way the list does (the Coach's class lookup).
export { default as ClassesDiscovery } from './ClassesDiscovery';
export type { ClassesDiscoveryProps } from './ClassesDiscovery';
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
