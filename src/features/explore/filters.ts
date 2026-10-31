// Explore's filters, as pure functions: the class chips (All / In your plan /
// Premium), the category groups and their granular chips, the counts on
// every chip and the badge on the Filters button. The Android port of the
// filter half of iOS SearchMapView (`ClassFilter`, `applyFilters`,
// `activeFilterCount`, `classCountFor`, `countFor`, the group chip's tap).
//
// THE COUNTS are over the venues the search returned (iOS `viewModel.venues`),
// before any chip: each chip says how many of the venues on offer it would
// keep. The first Android build counted the whole catalogue, so a search for
// "pool" still said "Gym 14".
//
// The filters apply to the map and the list alike, and to the list AFTER it
// is ordered, so a chip only removes cards and never reshuffles the rest.
import { matchesCategory } from '../../data/categories';
import { isPremium, type Venue } from '../../types/venue';

/**
 * The access chips (iOS `SearchMapView.ClassFilter`): every venue, the ones
 * inside the member's plan (`inBundle`), or the premium ones.
 */
export type ClassFilter = 'all' | 'inBundle' | 'premium';

/** The chips in order, with their iOS keys. */
export const CLASS_FILTERS: readonly { readonly id: ClassFilter; readonly labelKey: string }[] = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'inBundle', labelKey: 'explore.filter.in_plan' },
  { id: 'premium', labelKey: 'explore.filter.premium' },
];

/** Whether `venue` passes the access chip. */
export function matchesClassFilter(venue: Venue, filter: ClassFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'inBundle':
      return venue.inBundle;
    case 'premium':
      return isPremium(venue);
  }
}

/** What the filter rows hold (the screen's state). */
export interface ExploreFilters {
  readonly classFilter: ClassFilter;
  /** The granular category chosen (`GRANULAR_FILTERS` id), or null. */
  readonly category: string | null;
  /** The group whose row is open, or null; one at a time. */
  readonly openGroup: string | null;
}

export const NO_FILTERS: ExploreFilters = { classFilter: 'all', category: null, openGroup: null };

/** The class chip and the category, applied (iOS `applyFilters(to:)`). Keeps the input order. */
export function applyFilters<V extends Venue>(venues: readonly V[], filters: Pick<ExploreFilters, 'classFilter' | 'category'>): V[] {
  const { classFilter, category } = filters;
  return venues.filter(
    (venue) => matchesClassFilter(venue, classFilter) && (category === null || matchesCategory(venue.categories, category)),
  );
}

/** The badge on the Filters button: one for an access chip other than All, one for a category. */
export function activeFilterCount(filters: Pick<ExploreFilters, 'classFilter' | 'category'>): number {
  return (filters.classFilter !== 'all' ? 1 : 0) + (filters.category !== null ? 1 : 0);
}

/** An access chip's count over `venues` (the search results). */
export function classFilterCount(venues: readonly Venue[], filter: ClassFilter): number {
  return venues.filter((venue) => matchesClassFilter(venue, filter)).length;
}

/** A granular chip's count over `venues` (the search results). */
export function categoryCount(venues: readonly Venue[], filterId: string): number {
  return venues.filter((venue) => matchesCategory(venue.categories, filterId)).length;
}

/** Whether the chosen category belongs to `memberIds` (its group chip is then drawn active). */
export function groupIsActive(memberIds: readonly string[], category: string | null): boolean {
  return category !== null && memberIds.includes(category);
}

// MARK: - Taps

/** "All": no category and no group open. */
export function tapAllCategories(filters: ExploreFilters): ExploreFilters {
  return { ...filters, category: null, openGroup: null };
}

/**
 * A group chip: opens its row, or closes it when it is the open one (one row
 * at a time). When the chosen category is one of its members, the tap also
 * clears that category, whether it opens the row or closes it (iOS
 * `groupChip`).
 */
export function tapGroup(filters: ExploreFilters, groupId: string, memberIds: readonly string[]): ExploreFilters {
  return {
    ...filters,
    openGroup: filters.openGroup === groupId ? null : groupId,
    category: groupIsActive(memberIds, filters.category) ? null : filters.category,
  };
}

/** A granular chip in the open row: chooses it, or clears it when it is the chosen one. */
export function tapCategory(filters: ExploreFilters, filterId: string): ExploreFilters {
  return { ...filters, category: filters.category === filterId ? null : filterId };
}

/** An access chip. */
export function tapClassFilter(filters: ExploreFilters, classFilter: ClassFilter): ExploreFilters {
  return { ...filters, classFilter };
}

/**
 * The "Clear" link, which Android keeps (owner decision D4; iOS has the key
 * `explore.filters_clear` but no link): every chip back to its default and
 * the open row closed.
 */
export function clearFilters(): ExploreFilters {
  return NO_FILTERS;
}
