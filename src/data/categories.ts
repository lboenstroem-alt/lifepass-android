// Venue categories for filtering: the Android port of iOS `CategoryMapping`
// (Models/CategoryMapping.swift), the filter half (the map-ring half is
// EXPL-2's src/lib/venueMarkerType.ts).
//
// A venue's `categories` are free-text tags from the database ("Gym",
// "Fitness Center", "Yoga Studio", ...). A filter id maps to the tags that
// count as it, and a venue matches when it shares any of them, compared
// without case (iOS lowercases both sides).
//
// The display names are English in BOTH languages, as on iOS, which draws
// them from these tables rather than from the string tables ("Gym & Fitness"
// reads "Gym & Fitness" in Icelandic too). They are data, not copy: changing
// one is an iOS change first.

/** A filter: its id, the chip's name and the database tags it covers. */
export interface FilterCategory {
  readonly id: string;
  readonly displayName: string;
  /** The tags in a venue's `categories` (or an activity's) that count as this filter. */
  readonly dbCategories: readonly string[];
}

/** An expandable group on Explore; `memberIds` index into `GRANULAR_FILTERS`. */
export interface CategoryGroup {
  readonly id: string;
  readonly displayName: string;
  readonly memberIds: readonly string[];
}

// MARK: - Explore: granular categories and their groups

/**
 * The granular categories Explore's group chips open onto (iOS
 * `CategoryMapping.granularFilters`). The order here is the order of the
 * chips in an open group's row.
 */
export const GRANULAR_FILTERS: readonly FilterCategory[] = [
  { id: 'cardio', displayName: 'Cardio', dbCategories: ['Cardio'] },
  { id: 'strength', displayName: 'Strength', dbCategories: ['Strength'] },
  { id: 'gym', displayName: 'Gym', dbCategories: ['Gym', 'Fitness Center'] },
  { id: 'pool', displayName: 'Pool', dbCategories: ['Pool', 'Swimming Pool'] },
  { id: 'fitness', displayName: 'Fitness', dbCategories: ['Fitness'] },
  { id: 'spa', displayName: 'Spa', dbCategories: ['Spa'] },
  { id: 'sauna', displayName: 'Sauna', dbCategories: ['Sauna', 'Steam Room'] },
  { id: 'lagoon', displayName: 'Lagoon', dbCategories: ['Lagoon', 'Geothermal Bath'] },
  { id: 'hotspring', displayName: 'Hot Spring', dbCategories: ['Hot Spring', 'Hot Springs', 'Geothermal'] },
  { id: 'golf', displayName: 'Golf', dbCategories: ['Golf', 'Golf Course'] },
  { id: 'pilates', displayName: 'Pilates', dbCategories: ['Pilates', 'Pilates Studio'] },
  { id: 'yoga', displayName: 'Yoga', dbCategories: ['Yoga', 'Yoga Studio', 'Meditation', 'Breathwork', 'Mindfulness'] },
  { id: 'recovery', displayName: 'Recovery', dbCategories: ['Recovery', 'Recovery Center', 'Cold Plunge'] },
  { id: 'barre', displayName: 'Barre', dbCategories: ['Barre'] },
  { id: 'skillx', displayName: 'SkillX', dbCategories: ['SkillX', 'Skill'] },
  { id: 'infrared', displayName: 'Infrared', dbCategories: ['Infrared', 'Infrared Sauna'] },
  { id: 'padel', displayName: 'Padel', dbCategories: ['Padel'] },
  { id: 'mma', displayName: 'MMA', dbCategories: ['MMA', 'Mixed Martial Arts'] },
  { id: 'boxing', displayName: 'Boxing', dbCategories: ['Boxing'] },
  { id: 'groupclasses', displayName: 'Group Classes', dbCategories: ['Group Classes', 'Group Class'] },
  { id: 'grouptraining', displayName: 'Group Training', dbCategories: ['Group Training'] },
  { id: 'massage', displayName: 'Massage', dbCategories: ['Massage', 'Massage Therapy'] },
  { id: 'swimming', displayName: 'Swimming', dbCategories: ['Swimming'] },
];

/**
 * Explore's five group chips, in order (iOS `CategoryMapping.groups`). There
 * is no sixth "Boutique" chip: iOS has none, and the owner removed the first
 * Android build's (decision D4).
 */
export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    id: 'gym',
    displayName: 'Gym & Fitness',
    memberIds: ['gym', 'strength', 'cardio', 'fitness', 'barre', 'groupclasses', 'grouptraining', 'skillx', 'infrared'],
  },
  { id: 'martialarts', displayName: 'Martial Arts', memberIds: ['mma', 'boxing'] },
  {
    id: 'wellness',
    displayName: 'Wellness',
    memberIds: ['pool', 'spa', 'hotspring', 'massage', 'lagoon', 'sauna', 'recovery'],
  },
  { id: 'sports', displayName: 'Sports', memberIds: ['padel', 'golf', 'swimming'] },
  { id: 'pilatesyoga', displayName: 'Pilates & Yoga', memberIds: ['pilates', 'yoga'] },
];

/** The group with this id, or undefined. */
export function categoryGroup(groupId: string): CategoryGroup | undefined {
  return CATEGORY_GROUPS.find((group) => group.id === groupId);
}

/**
 * The chips of an open group's row, in `GRANULAR_FILTERS` order (iOS filters
 * `granularFilters` by the members, so the row does not follow `memberIds`).
 */
export function groupMemberFilters(groupId: string): FilterCategory[] {
  const members = categoryGroup(groupId)?.memberIds ?? [];
  return GRANULAR_FILTERS.filter((filter) => members.includes(filter.id));
}

/** The database tags for a granular filter id; an unknown id stands for itself (iOS `granularDbCategories`). */
export function granularDbCategories(filterId: string): readonly string[] {
  return GRANULAR_FILTERS.find((filter) => filter.id === filterId)?.dbCategories ?? [filterId];
}

/**
 * Whether a venue's tags meet a granular filter: any shared tag, compared
 * without case (iOS SearchMapView `applyFilters` and `countFor`). A venue
 * without tags matches no category.
 */
export function matchesCategory(venueCategories: readonly string[] | null | undefined, filterId: string): boolean {
  if (!venueCategories || venueCategories.length === 0) return false;
  const wanted = new Set(granularDbCategories(filterId).map((tag) => tag.toLowerCase()));
  return venueCategories.some((tag) => wanted.has(tag.toLowerCase()));
}

// MARK: - The five broad filters (server-side category search)

/**
 * The broad filters (iOS `CategoryMapping.filters`). No screen shows them as
 * chips any more; they survive for `dbCategories`, which the Coach's venue
 * search sends to `GET /venues?category=`.
 */
export const BROAD_FILTERS: readonly FilterCategory[] = [
  {
    id: 'yoga',
    displayName: 'Yoga',
    dbCategories: [
      'Yoga', 'Pilates', 'Meditation', 'Breathwork', 'Mindfulness',
      'Yoga Studio', 'Pilates Studio',
      'yoga', 'pilates', 'meditation', 'breathwork', 'mindfulness',
    ],
  },
  {
    id: 'pilates',
    displayName: 'Pilates',
    dbCategories: ['Pilates', 'pilates', 'Pilates Studio', 'Barre', 'barre'],
  },
  {
    id: 'strength',
    displayName: 'Strength',
    dbCategories: [
      'Gym', 'HIIT', 'CrossFit', 'Strength', 'Weightlifting',
      'Fitness', 'Conditioning', 'Cardio', 'Core', 'Toning',
      'Group Class', 'Group Training', 'Mixed',
      'Cycling', 'Running',
      'Gym', 'Fitness Center', 'Sports Facility',
      'Climbing Gym', 'Ice Rink',
      'Tennis', 'Padel', 'Badminton', 'Basketball', 'Volleyball',
      'Climbing', 'Bouldering', 'Dance', 'Martial Arts',
      'gym', 'fitness', 'strength', 'hiit', 'crossfit',
    ],
  },
  {
    id: 'recovery',
    displayName: 'Recovery',
    dbCategories: [
      'Sauna', 'Steam Room', 'Cold Plunge', 'Ice Bath',
      'Massage', 'Hot Tub', 'Cryotherapy',
      'Infrared', 'Red Light Therapy',
      'Recovery', 'Flexibility',
      'Physical Therapy', 'Chiropractor',
      'Recovery Center',
      'recovery', 'sauna', 'massage', 'cryotherapy',
    ],
  },
  {
    id: 'spa',
    displayName: 'Spa',
    dbCategories: [
      'Spa', 'Massage', 'Wellness',
      'Swimming', 'Pool',
      'Spa', 'Wellness Center', 'Pool',
      'Hot Spring', 'Geothermal Bath',
      'spa', 'wellness', 'pool', 'geothermal',
    ],
  },
  {
    id: 'boutique',
    displayName: 'Boutique',
    // The FIRST entry is what goes out as `?category=`: the API matches it
    // against the venue's ACCESS category (`boutique`) as well as its tags,
    // so boutique studios filter without a "Boutique" tag on each.
    dbCategories: ['boutique', 'Boutique'],
  },
];

/**
 * The database tags for a filter id: a broad filter's, else a granular one's,
 * else the id itself (iOS `CategoryMapping.dbCategories(for:)`). The API
 * takes ONE category, the first of these (iOS VenueService).
 */
export function dbCategories(filterId: string): readonly string[] {
  return (
    BROAD_FILTERS.find((filter) => filter.id === filterId)?.dbCategories ??
    GRANULAR_FILTERS.find((filter) => filter.id === filterId)?.dbCategories ?? [filterId]
  );
}
