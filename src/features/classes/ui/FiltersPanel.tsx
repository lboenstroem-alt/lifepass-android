// The filter rows at the top of the scrolling list (iOS ClassesDiscoveryView
// `filtersPanel`): they scroll away with the classes (2.5.4: on a phone they
// used to take the top half of the screen for good), and the Filters chip
// folds them.
//
//  - Near me, and with it on the 1 / 5 / 10 km radius.
//  - Today, Tomorrow, the day after, the calendar circle (today's day of the
//    month, or the custom pick, highlighted) that opens the full schedule,
//    and "Clear" whenever a day is selected: the only escape from a custom
//    pick, which no quick chip can reach.
//  - The eight featured categories (server-side, toggled).
//  - The location note, while "Near me" measures from central Reykjavík.
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import { FEATURED_CATEGORIES, RADIUS_OPTIONS } from '../feed/days';
import FilterPill from './FilterPill';
import { quickDateLabel, radiusLabel } from './labels';

export interface FiltersPanelProps {
  readonly nearMeEnabled: boolean;
  readonly radiusKm: number;
  readonly quickDates: readonly string[];
  readonly selectedDateIso: string | null;
  readonly customDateActive: boolean;
  readonly circleDayNumber: number;
  readonly category: string | null;
  readonly usingLocationFallback: boolean;
  readonly onToggleNearMe: () => void;
  readonly onSelectRadius: (km: number) => void;
  readonly onToggleDate: (dayIso: string) => void;
  readonly onOpenCalendar: () => void;
  readonly onClearDate: () => void;
  readonly onToggleCategory: (slug: string) => void;
}

export default function FiltersPanel(props: FiltersPanelProps) {
  const { t, language } = useT();
  const { nearMeEnabled, radiusKm, quickDates, selectedDateIso, customDateActive, circleDayNumber, category } = props;
  return (
    <View testID="classes.filters.panel">
      <View style={styles.row}>
        <FilterPill
          testID="classes.near_me"
          label={t('classes.near_me')}
          icon="navigate"
          selected={nearMeEnabled}
          onPress={props.onToggleNearMe}
        />
        {nearMeEnabled
          ? RADIUS_OPTIONS.map((km) => (
              <FilterPill
                key={km}
                testID={`classes.radius.${km}`}
                variant="accent"
                label={radiusLabel(km)}
                selected={radiusKm === km}
                onPress={() => props.onSelectRadius(km)}
              />
            ))
          : null}
      </View>

      <View style={styles.row}>
        {quickDates.map((dayIso, index) => (
          <FilterPill
            key={dayIso}
            testID={`classes.day.${index}`}
            label={quickDateLabel(index, dayIso, language)}
            selected={selectedDateIso === dayIso}
            onPress={() => props.onToggleDate(dayIso)}
          />
        ))}
        <Pressable
          testID="classes.calendar"
          onPress={props.onOpenCalendar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('classes.date_pick')}
          accessibilityValue={{ text: String(circleDayNumber) }}
          accessibilityState={{ selected: customDateActive }}
          style={({ pressed }) => [
            styles.circle,
            customDateActive ? styles.circleActive : styles.circleIdle,
            pressed && styles.pressed,
          ]}
        >
          <LPText size={12} weight="bold" color={customDateActive ? colors.onAccent : colors.paper2} maxScale={1.4}>
            {String(circleDayNumber)}
          </LPText>
        </Pressable>
        {selectedDateIso !== null ? (
          <Pressable
            testID="classes.date_clear"
            onPress={props.onClearDate}
            hitSlop={12}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <LPText size={12.5} weight="medium" color={colors.accentText}>
              {t('classes.date_clear')}
            </LPText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categories}
        contentContainerStyle={styles.categoryLine}
        keyboardShouldPersistTaps="handled"
      >
        {FEATURED_CATEGORIES.map((slug) => (
          <FilterPill
            key={slug}
            testID={`classes.category.${slug}`}
            label={t(`classes.cat_${slug}`)}
            selected={category === slug}
            onPress={() => props.onToggleCategory(slug)}
          />
        ))}
      </ScrollView>

      {props.usingLocationFallback ? (
        <View style={styles.note}>
          <LPText testID="classes.location_fallback" size={11} color={colors.paper3}>
            {t('classes.location_fallback')}
          </LPText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 6 },
  circle: {
    width: 33,
    height: 33,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleIdle: { backgroundColor: colors.ink2, borderColor: colors.line },
  circleActive: { backgroundColor: colors.rust, borderColor: colors.rust },
  categories: { marginBottom: 8 },
  categoryLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
  note: { paddingHorizontal: 20, paddingBottom: 6 },
  pressed: { opacity: 0.8 },
});
