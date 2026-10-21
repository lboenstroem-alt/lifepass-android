/**
 * The category tables (iOS CategoryMapping): Explore's five groups and their
 * granular chips, matching a venue's tags without case, and the broad
 * filters the venue search sends as `?category=`.
 */
import {
  BROAD_FILTERS,
  CATEGORY_GROUPS,
  dbCategories,
  GRANULAR_FILTERS,
  granularDbCategories,
  groupMemberFilters,
  matchesCategory,
} from '../categories';

describe('the groups', () => {
  it('are the five iOS groups, in order, with no Boutique chip (owner decision D4)', () => {
    expect(CATEGORY_GROUPS.map((group) => group.displayName)).toEqual([
      'Gym & Fitness',
      'Martial Arts',
      'Wellness',
      'Sports',
      'Pilates & Yoga',
    ]);
    expect(GRANULAR_FILTERS.some((filter) => filter.id === 'boutique')).toBe(false);
  });

  it('name only granular categories, and every granular category belongs to one group', () => {
    const ids = GRANULAR_FILTERS.map((filter) => filter.id);
    const members = CATEGORY_GROUPS.flatMap((group) => group.memberIds);
    expect(members.filter((id) => !ids.includes(id))).toEqual([]);
    expect([...members].sort()).toEqual([...ids].sort());
    expect(new Set(members).size).toBe(members.length);
  });

  it('open onto their members in the granular order, as iOS filters `granularFilters`', () => {
    expect(groupMemberFilters('gym').map((filter) => filter.id)).toEqual([
      'cardio',
      'strength',
      'gym',
      'fitness',
      'barre',
      'skillx',
      'infrared',
      'groupclasses',
      'grouptraining',
    ]);
    expect(groupMemberFilters('pilatesyoga').map((filter) => filter.displayName)).toEqual(['Pilates', 'Yoga']);
    expect(groupMemberFilters('nope')).toEqual([]);
  });
});

describe('matching a venue', () => {
  it('matches any shared tag, without case', () => {
    expect(matchesCategory(['fitness center'], 'gym')).toBe(true);
    expect(matchesCategory(['GYM'], 'gym')).toBe(true);
    expect(matchesCategory(['Spa', 'Yoga Studio'], 'yoga')).toBe(true);
    expect(matchesCategory(['Spa'], 'yoga')).toBe(false);
  });

  it('never matches a venue without tags', () => {
    expect(matchesCategory(null, 'gym')).toBe(false);
    expect(matchesCategory([], 'gym')).toBe(false);
  });

  it('reads an unknown id as the tag itself (iOS granularDbCategories)', () => {
    expect(granularDbCategories('climbing')).toEqual(['climbing']);
    expect(matchesCategory(['Climbing'], 'climbing')).toBe(true);
  });
});

describe('the broad filters (the venue search)', () => {
  it('send their first tag, a broad filter before a granular one of the same id', () => {
    expect(dbCategories('yoga')[0]).toBe('Yoga');
    expect(dbCategories('strength')[0]).toBe('Gym');
    expect(dbCategories('boutique')[0]).toBe('boutique');
    expect(dbCategories('lagoon')).toEqual(['Lagoon', 'Geothermal Bath']);
    expect(dbCategories('climbing')).toEqual(['climbing']);
    expect(BROAD_FILTERS.map((filter) => filter.id)).toEqual(['yoga', 'pilates', 'strength', 'recovery', 'spa', 'boutique']);
  });
});
