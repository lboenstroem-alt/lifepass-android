/* eslint lifepass/no-literal-copy: "error" */
// The top of the page under the hero (iOS VenueDetailView `meta`,
// `descriptionBlock`, `amenitiesBlock`).
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { localizedDescription, type Venue } from '../../../types/venue';
import { hasDirections, ratingLine } from '../model';
import { DirectionsCapsule } from './shared';

/**
 * The rating (★ 4.6 · 23 ratings, or "No reviews yet"), which opens the
 * reviews, and the Directions capsule when there is somewhere to go.
 */
export function MetaRow({
  venue,
  onOpenReviews,
  onDirections,
}: {
  readonly venue: Venue;
  readonly onOpenReviews: () => void;
  readonly onDirections: () => void;
}) {
  const { language } = useT();
  const line = ratingLine(venue, language);
  const spoken = 'empty' in line ? line.empty : [line.rating, line.count].filter(Boolean).join(' ');
  return (
    <View style={styles.meta}>
      <Pressable
        onPress={onOpenReviews}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        hitSlop={8}
        style={({ pressed }) => [styles.rating, pressed && styles.pressed]}
        testID="venue.meta.rating"
      >
        {'empty' in line ? (
          <LPText size={12} color={colors.paper3}>
            {line.empty}
          </LPText>
        ) : (
          <>
            <Ionicons name="star" size={12} color={colors.signal} />
            <LPText size={13} weight="semibold" color={colors.paper}>
              {line.rating}
            </LPText>
            {line.count ? (
              <LPText size={12} color={colors.paper3}>
                {line.count}
              </LPText>
            ) : null}
          </>
        )}
      </Pressable>
      {hasDirections(venue) ? <DirectionsCapsule onPress={onDirections} /> : null}
    </View>
  );
}

/** The description in the account language (Icelandic falls back to the English). */
export function DescriptionBlock({ venue }: { readonly venue: Venue }) {
  const { language } = useT();
  const text = localizedDescription(venue, language);
  if (!text) return null;
  return (
    <LPText size={15} color={colors.paper2} style={styles.description}>
      {text}
    </LPText>
  );
}

/** The amenity chips, wrapping (iOS FlowLayout, 8 pt apart). */
export function AmenitiesBlock({ venue }: { readonly venue: Venue }) {
  const amenities = venue.amenities;
  if (!amenities || amenities.length === 0) return null;
  return (
    <View style={styles.chips}>
      {amenities.map((amenity, index) => (
        <View key={`${amenity}-${index}`} style={styles.chip}>
          <LPText size={12} weight="medium" tracking={0.2} color={colors.paper2}>
            {amenity}
          </LPText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minHeight: 32 },
  description: { lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.ink3,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.7 },
});
