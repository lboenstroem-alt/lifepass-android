// One venue in Explore's list (iOS SearchMapView `listRow`): the photo, a
// premium dot and the name, "{city} · Walk-ins" when walk-ins are allowed,
// the first two category tags, and the compact price pill. A tap opens the
// venue's page.
import { Pressable, StyleSheet, View } from 'react-native';

import PricePill from '../../components/PricePill';
import { hiddenFromAccessibility, LPText, VenueImage } from '../../components/ui';
import { useT, type Params } from '../../i18n';
import { colors, hairline, radius } from '../../theme';
import { isPremium, type Venue } from '../../types/venue';

type Translate = (key: string, params?: Params) => string;

/**
 * The place line: the city (or the country when the venue has none) and,
 * when walk-ins are allowed, " · Walk-ins" ("Walk-in" in Icelandic).
 */
export function listRowPlace(venue: Pick<Venue, 'city' | 'walkInsAllowed'>, t: Translate): string {
  const place = venue.city ?? t('explore.android.city_fallback');
  return venue.walkInsAllowed === true ? `${place} · ${t('explore.walk_ins')}` : place;
}

/**
 * Foundation's `String.capitalized`, which iOS applies to a tag: each word's
 * first letter upper case and the rest lower case ("hot tub" reads "Hot Tub",
 * "MMA" reads "Mma"). Words break at anything but a letter, a digit or an
 * apostrophe.
 */
export function capitalized(value: string): string {
  return value.replace(/[\p{L}\p{N}']+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/** The tags under the name: the venue's first two categories, capitalised. */
export function listRowTags(venue: Pick<Venue, 'categories'>): string[] {
  return (venue.categories ?? []).slice(0, 2).map(capitalized);
}

export interface ExploreListRowProps {
  readonly venue: Venue;
  readonly onPress: (venue: Venue) => void;
}

export default function ExploreListRow({ venue, onPress }: ExploreListRowProps) {
  const { t } = useT();
  const tags = listRowTags(venue);
  const premium = isPremium(venue);
  return (
    <Pressable
      onPress={() => onPress(venue)}
      accessibilityRole="button"
      testID={`explore.row.${venue.slug}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <VenueImage uri={venue.imageUrl} height={88} recyclingKey={venue.id} style={styles.image} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          {premium ? <View style={styles.dot} {...hiddenFromAccessibility} testID={`explore.row.${venue.slug}.premium`} /> : null}
          <LPText size={15} weight="semibold" color={colors.paper} style={styles.name}>
            {venue.name}
          </LPText>
        </View>
        <LPText size={12} color={colors.paper3}>
          {listRowPlace(venue, t)}
        </LPText>
        {tags.length > 0 ? (
          <View style={styles.tags}>
            {tags.map((tag, index) => (
              <View key={`${tag}-${index}`} style={styles.tag}>
                <LPText size={10} weight="medium" tracking={0.3} color={colors.paper2}>
                  {tag}
                </LPText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <PricePill venue={venue} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  image: { width: 88, height: 88, borderRadius: 10, overflow: 'hidden' },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.signal },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: { backgroundColor: colors.ink3, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  pressed: { opacity: 0.85 },
});
