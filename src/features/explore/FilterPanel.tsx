// Explore's Filters panel (iOS SearchMapView, the `showFilters` block): the
// Venues / Classes switch, the class chips (All / In your plan / Premium),
// then "All" and the five category groups, and the open group's row of
// granular chips. Collapsed by default behind the Filters button, so the map
// and the list get the room.
//
// Every count is over the venues the search returned (./filters.ts).
import { ScrollView, StyleSheet, View } from 'react-native';

import { CATEGORY_GROUPS, groupMemberFilters } from '../../data/categories';
import { useT } from '../../i18n';
import type { Venue } from '../../types/venue';
import ExploreModeToggle, { type ExploreMode } from './ExploreModeToggle';
import FilterChip from './FilterChip';
import {
  CLASS_FILTERS,
  categoryCount,
  classFilterCount,
  groupIsActive,
  tapAllCategories,
  tapCategory,
  tapClassFilter,
  tapGroup,
  type ExploreFilters,
} from './filters';

export interface FilterPanelProps {
  /** The search results, before any chip: what the counts count. */
  readonly venues: readonly Venue[];
  readonly filters: ExploreFilters;
  readonly onChangeFilters: (next: ExploreFilters) => void;
  readonly mode: ExploreMode;
  readonly onChangeMode: (mode: ExploreMode) => void;
}

export default function FilterPanel({ venues, filters, onChangeFilters, mode, onChangeMode }: FilterPanelProps) {
  const { t } = useT();
  const openGroup = filters.openGroup;

  return (
    <View testID="explore.filters.panel">
      <View style={styles.modeRow}>
        <ExploreModeToggle mode={mode} onChange={onChangeMode} />
      </View>

      <View style={styles.classRow}>
        {CLASS_FILTERS.map((item) => (
          <FilterChip
            key={item.id}
            title={t(item.labelKey)}
            count={classFilterCount(venues, item.id)}
            selected={filters.classFilter === item.id}
            dot={item.id === 'premium'}
            onPress={() => onChangeFilters(tapClassFilter(filters, item.id))}
            testID={`explore.class.${item.id}`}
          />
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={[styles.groupScroll, openGroup === null ? styles.groupScrollLast : styles.groupScrollOpen]}
        contentContainerStyle={styles.scrollContent}
      >
        <FilterChip
          title={t('common.all')}
          count={venues.length}
          selected={filters.category === null && openGroup === null}
          onPress={() => onChangeFilters(tapAllCategories(filters))}
          testID="explore.category.all"
        />
        {CATEGORY_GROUPS.map((group) => {
          const isOpen = openGroup === group.id;
          const isActive = groupIsActive(group.memberIds, filters.category);
          return (
            <FilterChip
              key={group.id}
              title={group.displayName}
              expanded={isOpen}
              selected={isOpen || isActive}
              onPress={() => onChangeFilters(tapGroup(filters, group.id, group.memberIds))}
              testID={`explore.group.${group.id}`}
            />
          );
        })}
      </ScrollView>

      {openGroup !== null ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.subScroll}
          contentContainerStyle={styles.subContent}
          testID={`explore.group.${openGroup}.row`}
        >
          {groupMemberFilters(openGroup).map((filter) => (
            <FilterChip
              key={filter.id}
              variant="sub"
              title={filter.displayName}
              count={categoryCount(venues, filter.id)}
              selected={filters.category === filter.id}
              onPress={() => onChangeFilters(tapCategory(filters, filter.id))}
              testID={`explore.category.${filter.id}`}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: { paddingHorizontal: 20, paddingBottom: 10 },
  classRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 20, paddingBottom: 6 },
  groupScroll: { flexGrow: 0 },
  groupScrollLast: { marginBottom: 10 },
  groupScrollOpen: { marginBottom: 4 },
  // Chips centred and the row as tall as its tallest chip, so a large font
  // size never clips a chip in half.
  scrollContent: { paddingHorizontal: 20, paddingVertical: 4, gap: 8, alignItems: 'center' },
  subScroll: { flexGrow: 0, marginBottom: 10 },
  subContent: { paddingHorizontal: 20, paddingVertical: 2, gap: 8, alignItems: 'center' },
});
