// The feed's fixed header row (iOS ClassesDiscoveryView `searchRow`): the
// search field ("Search classes, yoga, pilates, HIIT…", debounced by the
// store) and the Filters chip, which folds the filter rows away and counts
// what is applied (Near me, a day, a category) in a badge.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius, sans } from '../../../theme';

export interface SearchRowProps {
  readonly searchText: string;
  readonly onChangeSearch: (text: string) => void;
  readonly filtersExpanded: boolean;
  readonly onToggleFilters: () => void;
  readonly activeFilterCount: number;
}

export default function SearchRow({ searchText, onChangeSearch, filtersExpanded, onToggleFilters, activeFilterCount }: SearchRowProps) {
  const { t } = useT();
  const highlighted = filtersExpanded || activeFilterCount > 0;
  const chipText = highlighted ? colors.ink : colors.paper2;
  const filters = t('explore.filters');
  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Ionicons name="search" size={14} color={colors.paper3} accessibilityElementsHidden importantForAccessibility="no" />
        <TextInput
          testID="classes.search"
          value={searchText}
          onChangeText={onChangeSearch}
          placeholder={t('classes.search')}
          placeholderTextColor={colors.paper3}
          selectionColor={colors.rust}
          cursorColor={colors.rust}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={[sans(14), styles.input]}
        />
      </View>
      <Pressable
        testID="classes.filters"
        onPress={onToggleFilters}
        accessibilityRole="button"
        accessibilityLabel={filters}
        accessibilityValue={activeFilterCount > 0 ? { text: String(activeFilterCount) } : undefined}
        accessibilityState={{ expanded: filtersExpanded, selected: filtersExpanded }}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: highlighted ? colors.paper : colors.ink2,
            borderColor: highlighted ? colors.paper : colors.line,
          },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="options-outline" size={13} color={chipText} />
        <LPText size={12.5} weight="semibold" color={chipText} tracking={-0.1} numberOfLines={1}>
          {filters}
        </LPText>
        <Ionicons name={filtersExpanded ? 'chevron-up' : 'chevron-down'} size={10} color={chipText} style={styles.chevron} />
        {activeFilterCount > 0 ? (
          <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <LPText size={10} weight="bold" color={colors.onAccent} maxScale={1.5}>
              {String(activeFilterCount)}
            </LPText>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 44,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  input: { flex: 1, color: colors.paper, paddingVertical: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    borderWidth: hairline,
  },
  chevron: { opacity: 0.6 },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 16,
    minHeight: 16,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
});
