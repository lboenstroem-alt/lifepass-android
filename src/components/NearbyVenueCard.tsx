// A card on Home's "A short walk from here" shelf (iOS HomeView's private
// `NearbyVenueCard`): 170 dp wide, a 130 dp photo with the price badge, the
// name, the city line, and a "Book it" pill.
//
// NO DISTANCE. The shelf may be measured from Reykjavík centre when the phone
// has no fix, so a distance here could claim a proximity the app does not
// have; iOS prints none, and neither does this.
//
// The pill is a label, not a button: the whole card opens the venue (where
// the walk-in, coming-soon and booking states live), so TalkBack reads the
// card as one control.
import { StyleSheet, View } from 'react-native';

import BookItPill from './BookItPill';
import { LPText, VenueImage } from './ui';
import { useT } from '../i18n';
import { colors, hairline } from '../theme';
import { isPremium, priceLabel, type Venue } from '../types/venue';

/** iOS `Color.lpInk.opacity(0.75)`: the badge's backing over the photo. */
const BADGE_BACKING = 'rgba(248,246,241,0.75)';

export type NearbyCardVenue = Pick<
  Venue,
  'id' | 'name' | 'city' | 'address' | 'imageUrl' | 'inBundle' | 'surchargePrice' | 'resolvedSurchargePrice' | 'primaryCategory'
>;

/** The card's second line: city, else address, else Reykjavík (iOS `city ?? address ?? "Reykjavík"`). */
export function nearbyCityLine(venue: Pick<Venue, 'city' | 'address'>, fallback: string): string {
  return venue.city ?? venue.address ?? fallback;
}

export default function NearbyVenueCard({ venue }: { venue: NearbyCardVenue }) {
  const { t } = useT();
  return (
    <View style={styles.card}>
      <View style={styles.photo}>
        <VenueImage uri={venue.imageUrl} height={130} recyclingKey={venue.id} style={styles.image} />
        <View style={styles.badge}>
          <LPText size={10} weight="bold" tracking={0.5} color={isPremium(venue) ? colors.signal : colors.moss}>
            {priceLabel(venue, t)}
          </LPText>
        </View>
      </View>
      <View style={styles.info}>
        <View style={styles.text}>
          <LPText size={14} weight="semibold" tracking={-0.1} color={colors.paper} numberOfLines={1}>
            {venue.name}
          </LPText>
          <LPText size={11} color={colors.paper3} numberOfLines={1}>
            {nearbyCityLine(venue, t('home.android.city_fallback_nearby'))}
          </LPText>
        </View>
        <BookItPill fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 170,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: hairline,
    borderColor: colors.line,
  },
  photo: { width: 170, height: 130 },
  image: { width: 170 },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: BADGE_BACKING,
  },
  info: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  text: { gap: 3 },
});
