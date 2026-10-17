/**
 * Explore's filter rules (iOS SearchMapView): the class chips, the category
 * chips, the counts over the search results, the badge, and the taps on the
 * group chips.
 */
import { decodeVenue } from '../../../api/venues';
import { CATEGORY_GROUPS } from '../../../data/categories';
import type { Venue } from '../../../types/venue';
import {
  activeFilterCount,
  applyFilters,
  categoryCount,
  CLASS_FILTERS,
  classFilterCount,
  clearFilters,
  matchesClassFilter,
  NO_FILTERS,
  tapAllCategories,
  tapCategory,
  tapClassFilter,
  tapGroup,
  type ExploreFilters,
} from '../filters';

function venue(n: number, extra: Record<string, unknown> = {}): Venue {
  return decodeVenue({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `v${n}`,
    name: `Venue ${n}`,
    inBundle: true,
    ...extra,
  });
}

const gym = venue(1, { categories: ['Gym', 'Sauna'] });
const premiumSpa = venue(2, { inBundle: false, surchargePrice: 3990, categories: ['spa'] });
const pool = venue(3, { categories: ['Swimming Pool'] });
const untagged = venue(4, { inBundle: false });
const venues = [gym, premiumSpa, pool, untagged];

const group = (id: string) => CATEGORY_GROUPS.find((g) => g.id === id)!;

describe('the class chips', () => {
  it('are All, In your plan and Premium with the iOS keys', () => {
    expect(CLASS_FILTERS).toEqual([
      { id: 'all', labelKey: 'common.all' },
      { id: 'inBundle', labelKey: 'explore.filter.in_plan' },
      { id: 'premium', labelKey: 'explore.filter.premium' },
    ]);
  });

  it('keep in-plan venues or premium ones (premium = not in the bundle)', () => {
    expect(matchesClassFilter(gym, 'inBundle')).toBe(true);
    expect(matchesClassFilter(gym, 'premium')).toBe(false);
    expect(matchesClassFilter(premiumSpa, 'premium')).toBe(true);
    expect(matchesClassFilter(premiumSpa, 'inBundle')).toBe(false);
    expect(classFilterCount(venues, 'all')).toBe(4);
    expect(classFilterCount(venues, 'inBundle')).toBe(2);
    expect(classFilterCount(venues, 'premium')).toBe(2);
  });
});

describe('applying the filters', () => {
  it('keeps the order it was given and applies both rows', () => {
    expect(applyFilters(venues, NO_FILTERS)).toEqual(venues);
    expect(applyFilters(venues, { classFilter: 'premium', category: null })).toEqual([premiumSpa, untagged]);
    expect(applyFilters(venues, { classFilter: 'all', category: 'pool' })).toEqual([pool]);
    expect(applyFilters(venues, { classFilter: 'inBundle', category: 'spa' })).toEqual([]);
    expect(applyFilters([pool, gym], { classFilter: 'inBundle', category: null })).toEqual([pool, gym]);
  });

  it('counts a category over the venues it is given (the search results)', () => {
    expect(categoryCount(venues, 'sauna')).toBe(1);
    expect(categoryCount(venues, 'spa')).toBe(1);
    expect(categoryCount([gym], 'spa')).toBe(0);
  });
});

describe('the Filters badge', () => {
  it('counts a class chip other than All and a category', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ classFilter: 'premium', category: null })).toBe(1);
    expect(activeFilterCount({ classFilter: 'all', category: 'gym' })).toBe(1);
    expect(activeFilterCount({ classFilter: 'inBundle', category: 'gym' })).toBe(2);
  });
});

describe('the taps', () => {
  it('opens one group at a time, and closes the open one', () => {
    let filters: ExploreFilters = NO_FILTERS;
    filters = tapGroup(filters, 'gym', group('gym').memberIds);
    expect(filters.openGroup).toBe('gym');
    filters = tapGroup(filters, 'wellness', group('wellness').memberIds);
    expect(filters.openGroup).toBe('wellness');
    filters = tapGroup(filters, 'wellness', group('wellness').memberIds);
    expect(filters.openGroup).toBeNull();
  });

  it('clears the category when its own group is tapped, opening or closing it', () => {
    const chosen: ExploreFilters = { classFilter: 'premium', category: 'sauna', openGroup: 'wellness' };
    expect(tapGroup(chosen, 'wellness', group('wellness').memberIds)).toEqual({
      classFilter: 'premium',
      category: null,
      openGroup: null,
    });
    // Its row closed because another group was opened: tapping it opens it and clears.
    const elsewhere: ExploreFilters = { ...chosen, openGroup: 'gym' };
    expect(tapGroup(elsewhere, 'wellness', group('wellness').memberIds)).toEqual({
      classFilter: 'premium',
      category: null,
      openGroup: 'wellness',
    });
    // Another group leaves the category alone.
    expect(tapGroup(chosen, 'gym', group('gym').memberIds).category).toBe('sauna');
  });

  it('toggles a granular chip, and All clears the category and closes the row', () => {
    let filters: ExploreFilters = { ...NO_FILTERS, openGroup: 'gym' };
    filters = tapCategory(filters, 'gym');
    expect(filters.category).toBe('gym');
    expect(tapCategory(filters, 'gym').category).toBeNull();
    expect(tapCategory(filters, 'cardio').category).toBe('cardio');
    expect(tapAllCategories(filters)).toEqual({ classFilter: 'all', category: null, openGroup: null });
    expect(tapClassFilter(filters, 'premium').classFilter).toBe('premium');
  });

  it('clear puts every chip back', () => {
    expect(clearFilters()).toEqual({ classFilter: 'all', category: null, openGroup: null });
  });
});
