// Explore's single search row (iOS SearchMapView `searchField`): the search
// box, the Map/List switch and the Filters button, styled as one cluster.
//
// - The switch shows the OTHER view's icon and says so to TalkBack ("Show
//   list" on the map, "Show map" on the list). During its one-time emphasis
//   (./mapToggleHint.ts) it carries the word too, in the accent colour, with
//   a ring that grows and fades twice (a still ring with Remove animations).
// - Filters is filled while the panel is open or a filter is on, with a rust
//   badge counting the filters on.
import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, hairline, radius, sans } from '../../theme';

export type Presentation = 'map' | 'list';

export interface SearchRowProps {
  readonly text: string;
  readonly onChangeText: (text: string) => void;
  readonly onFocus?: () => void;
  readonly presentation: Presentation;
  readonly onTogglePresentation: () => void;
  /** The one-time emphasis is showing. */
  readonly hintActive: boolean;
  /** 0 to 1 through a pulse (./mapToggleHint.ts). */
  readonly hintPulse: Animated.Value;
  readonly reduceMotion: boolean;
  readonly filtersOpen: boolean;
  readonly activeFilterCount: number;
  readonly onToggleFilters: () => void;
}

const SearchRow = forwardRef<TextInput, SearchRowProps>(function SearchRow(
  {
    text,
    onChangeText,
    onFocus,
    presentation,
    onTogglePresentation,
    hintActive,
    hintPulse,
    reduceMotion,
    filtersOpen,
    activeFilterCount,
    onToggleFilters,
  },
  ref,
) {
  const { t } = useT();
  const highlighted = filtersOpen || activeFilterCount > 0;
  const onMap = presentation === 'map';
  const pulseScale = hintPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const pulseOpacity = hintPulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Ionicons name="search" size={14} color={colors.paper3} {...hiddenFromAccessibility} />
        <TextInput
          ref={ref}
          value={text}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder={t('explore.search')}
          placeholderTextColor={colors.paper3}
          accessibilityLabel={t('explore.search')}
          selectionColor={colors.rust}
          cursorColor={colors.rust}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.input}
          testID="explore.search"
        />
      </View>

      <Pressable
        onPress={onTogglePresentation}
        accessibilityRole="button"
        accessibilityLabel={t(onMap ? 'explore.show_list' : 'explore.show_map')}
        testID="explore.mapListToggle"
        style={({ pressed }) => [
          styles.toggle,
          hintActive && styles.toggleHinted,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={onMap ? 'list' : 'map-outline'}
          size={17}
          color={hintActive ? colors.accentText : colors.paper2}
          {...hiddenFromAccessibility}
        />
        {hintActive ? (
          <LPText size={12.5} weight="semibold" tracking={-0.1} color={colors.accentText} testID="explore.mapListToggle.hint">
            {t(onMap ? 'explore.hint_list' : 'explore.hint_map')}
          </LPText>
        ) : null}
        {hintActive && !reduceMotion ? (
          <Animated.View
            pointerEvents="none"
            {...hiddenFromAccessibility}
            style={[styles.pulse, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]}
          />
        ) : null}
      </Pressable>

      <Pressable
        onPress={onToggleFilters}
        accessibilityRole="button"
        accessibilityLabel={t('explore.filters')}
        accessibilityState={{ expanded: filtersOpen }}
        testID="explore.filters"
        style={({ pressed }) => [styles.filters, highlighted && styles.filtersOn, pressed && styles.pressed]}
      >
        <Ionicons name="options-outline" size={13} color={highlighted ? colors.ink : colors.paper2} {...hiddenFromAccessibility} />
        <LPText size={12.5} weight="semibold" tracking={-0.1} color={highlighted ? colors.ink : colors.paper2}>
          {t('explore.filters')}
        </LPText>
        <Ionicons
          name={filtersOpen ? 'chevron-up' : 'chevron-down'}
          size={10}
          color={highlighted ? colors.ink : colors.paper2}
          style={styles.chevron}
          {...hiddenFromAccessibility}
        />
        {activeFilterCount > 0 ? (
          <View style={styles.badge} {...hiddenFromAccessibility} testID="explore.filters.badge">
            <LPText size={10} weight="bold" color={colors.onAccent} maxScale={1.3}>
              {String(activeFilterCount)}
            </LPText>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
});

export default SearchRow;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  input: { flex: 1, ...sans(14), color: colors.paper, paddingVertical: 8 },
  toggle: {
    minWidth: 44,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  toggleHinted: { paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.rust },
  pulse: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.field,
    borderWidth: 2,
    borderColor: colors.rust,
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  filtersOn: { backgroundColor: colors.paper, borderColor: colors.paper },
  chevron: { opacity: 0.6 },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 16,
    minHeight: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
