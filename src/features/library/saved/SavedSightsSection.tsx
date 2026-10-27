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
 *             waterfall or any other sight to keep it here."
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';
import SavedSightRow from '../../attractions/SavedSightRow';
import { favouritesStore, type FavouriteAttraction } from '../../favourites';

export interface SavedSightsSectionProps {
  readonly attractions: readonly FavouriteAttraction[];
  /** Opens a place's card. */
  readonly onOpenSight: (slug: string) => void;
  /** The section's test id; rows are `${testID}.row.{slug}`. */
  readonly testID: string;
}

export default function SavedSightsSection({ attractions, onOpenSight, testID }: SavedSightsSectionProps) {
  const { t } = useT();
  return (
    <View style={styles.section} testID={testID}>
      <Kicker text={t('favourites.tabs.outdoors')} color={colors.paper3} accessibilityRole="header" />
      {attractions.length === 0 ? (
        <View style={styles.empty} testID={`${testID}.empty`}>
          <View {...hiddenFromAccessibility}>
            <Ionicons name="heart-outline" size={22} color={colors.paper4} />
          </View>
          <LPText size={14} weight="semibold" color={colors.paper2} align="center">
            {t('favourites.empty.outdoors.title')}
          </LPText>
          <LPText size={13} color={colors.paper3} align="center">
            {t('favourites.empty.outdoors.body')}
          </LPText>
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
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
    backgroundColor: colors.ink2,
  },
});
