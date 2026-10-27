/* eslint lifepass/no-literal-copy: "error" */
/**
 * Favourites' third section, "Hikes & sights" / "Útivist" (API 0.45.0): the
 * hikes and sights the member saved with a place's heart, newest first, as
 * the server lists them. Drawn under the venues on Profile's Saved half and
 * on the Coach's Saved sheet, from the one favourites store, so a heart
 * tapped on a sight is already right here.
 *
 *   heading   "Hikes & sights"
 *   rows      the saved places (src/features/attractions/SavedSightRow.tsx):
 *             a row opens the place's card, its button takes it off the list
 *             (at once; back with "Could not remove favourite. Please try
 *             again." if the server refuses)
 *   empty     "No saved hikes or sights yet" and "Tap the heart on a hike, a
 *             waterfall or any other sight to keep it here.", with "Find
 *             hikes and sights", which opens Explore's map with the sights
 *             showing (Home's "See all on the map"), as on iOS
 *   loading   before the first read of the list has answered, a spinner
 *             rather than an empty state that may not be true
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';
import SavedSightRow from '../../attractions/SavedSightRow';
import { favouritesStore, type FavouriteAttraction } from '../../favourites';

export interface SavedSightsSectionProps {
  readonly attractions: readonly FavouriteAttraction[];
  /** No read of the list has answered yet. */
  readonly loading: boolean;
  /** Opens a place's card. */
  readonly onOpenSight: (slug: string) => void;
  /** The empty state's "Find hikes and sights": Explore's map with the sights showing. */
  readonly onFindSights: () => void;
  /** The section's test id; rows are `${testID}.row.{slug}`. */
  readonly testID: string;
}

export default function SavedSightsSection({ attractions, loading, onOpenSight, onFindSights, testID }: SavedSightsSectionProps) {
  const { t } = useT();
  const cta = t('favourites.empty.outdoors.cta');
  return (
    <View style={styles.section} testID={testID}>
      <Kicker text={t('favourites.tabs.outdoors')} color={colors.paper3} accessibilityRole="header" />
      {attractions.length === 0 && loading ? (
        <View style={styles.loading} testID={`${testID}.loading`}>
          <ActivityIndicator color={colors.rust} accessibilityLabel={t('a11y.loading')} />
        </View>
      ) : attractions.length === 0 ? (
        <View style={styles.empty} testID={`${testID}.empty`}>
          <View style={styles.emptyTitle}>
            <View {...hiddenFromAccessibility}>
              <Ionicons name="heart-outline" size={14} color={colors.paper3} />
            </View>
            <LPText size={15} weight="semibold" color={colors.paper} style={styles.flex}>
              {t('favourites.empty.outdoors.title')}
            </LPText>
          </View>
          <LPText size={13} color={colors.paper3}>
            {t('favourites.empty.outdoors.body')}
          </LPText>
          <Pressable
            onPress={onFindSights}
            accessibilityRole="button"
            accessibilityLabel={cta}
            style={({ pressed }) => [styles.find, pressed && styles.pressed]}
            testID={`${testID}.find`}
          >
            <View {...hiddenFromAccessibility}>
              <Ionicons name="map-outline" size={13} color={colors.rust} />
            </View>
            <LPText size={13} weight="semibold" color={colors.rust}>
              {cta}
            </LPText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {attractions.map((place) => (
            <SavedSightRow
              key={place.slug}
              place={place}
              onOpen={() => onOpenSight(place.slug)}
              onRemove={() => void favouritesStore.getState().removeAttraction(place.slug)}
              testID={`${testID}.row.${place.slug}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  list: { gap: 10 },
  loading: { paddingVertical: 12, alignItems: 'center' },
  empty: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
  emptyTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  find: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 48 },
  pressed: { opacity: 0.7 },
});
