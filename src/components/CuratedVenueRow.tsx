// A row of Home's "Most Popular Now" list (iOS HomeView's private
// `CuratedVenueRow`): a 72 dp photo, the name, the city line, up to two
// category chips, and on the trailing side the compact price pill above a
// "Book it" pill.
//
// NO FAVOURITE HEART (owner decision D4): iOS Home has none. Favourites live
// on the venue page and Profile's Saved tab, and this slot carries the price,
// which the first Android build hid behind the heart. The whole row opens the
// venue; the pills are labels.
import { StyleSheet, View } from 'react-native';

import BookItPill from './BookItPill';
import PricePill from './PricePill';
import { LPText, VenueImage } from './ui';
import { useT } from '../i18n';
import { colors, hairline } from '../theme';
import type { Venue } from '../types/venue';

export type CuratedRowVenue = Pick<
  Venue,
  | 'id'
  | 'name'
  | 'city'
  | 'address'
  | 'imageUrl'
  | 'categories'
  | 'inBundle'
  | 'surchargePrice'
  | 'resolvedSurchargePrice'
  | 'primaryCategory'
>;

/** The row's second line: city, else address, else Iceland (iOS `city ?? address ?? "Iceland"`). */
export function curatedCityLine(venue: Pick<Venue, 'city' | 'address'>, fallback: string): string {
  return venue.city ?? venue.address ?? fallback;
}

/**
 * Swift's `String.capitalized`: every word's first letter upper case and the
 * rest lower case ("hot YOGA" is "Hot Yoga"). Words are split at spaces,
 * hyphens and other non-letters, as Foundation splits them.
 */
export function capitalized(text: string): string {
  return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase());
}

/** Up to two category chips (iOS `venue.category?.prefix(2)`). */
export function rowCategories(venue: Pick<Venue, 'categories'>): string[] {
  return (venue.categories ?? []).slice(0, 2).map(capitalized);
}

export default function CuratedVenueRow({ venue }: { venue: CuratedRowVenue }) {
  const { t } = useT();
  const chips = rowCategories(venue);
  return (
    <View style={styles.row}>
      <VenueImage uri={venue.imageUrl} recyclingKey={venue.id} style={styles.image} />

      <View style={styles.info}>
        <LPText size={15} weight="semibold" color={colors.paper}>
          {venue.name}
        </LPText>
        <LPText size={12} color={colors.paper3}>
          {curatedCityLine(venue, t('home.android.city_fallback_popular'))}
        </LPText>
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((chip, index) => (
              <View key={`${chip}-${index}`} style={styles.chip}>
                <LPText size={10} weight="medium" tracking={0.4} color={colors.paper2}>
                  {chip}
                </LPText>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.trailing}>
        <PricePill venue={venue} compact />
        <BookItPill />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  image: { width: 72, height: 72, borderRadius: 10 },
  info: { flex: 1, gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: colors.ink3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  trailing: { alignItems: 'flex-end', gap: 8 },
});
