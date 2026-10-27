// The near-black card at the foot of the hero (iOS `HomeView.pickupCard`),
// in one of two modes:
//   - the member's soonest booking: the HERO's photo as its thumbnail (the
//     booking read carries no venue image, and a stock photo is never shown
//     as a venue), the venue in italics (with a class's room after it, "Hress
//     · Salur 3", API 0.44.0, on a second line if it needs one), when it is,
//     and "View" to Profile;
//   - none: a calendar tile, "No upcoming bookings", "Explore venues nearby"
//     and "Explore" to the Explore tab.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText, VenueImage } from '../../components/ui';
import { venueWithRoom } from '../../copy/classRoom';
import { useT } from '../../i18n';
import { colors, hairline, minTouch } from '../../theme';
import { bookingWhen, type UpcomingBooking } from './upcoming';

const WHITE = '#FFFFFF';
const white = (opacity: number) => `rgba(255,255,255,${opacity})`;
/** iOS `Color.lpAurora.opacity(0.35)`: the hairline round the CTA. */
const AURORA_35 = 'rgba(71,133,194,0.35)';

type Props = {
  booking: UpcomingBooking | null;
  /** The hero venue's photo, the booking's thumbnail. */
  thumbnailUrl: string | null;
  onView: () => void;
  onExplore: () => void;
  /** For tests: the day the "Today" / "Tomorrow" words are measured from. */
  now?: Date;
};

export default function UpcomingCard({ booking, thumbnailUrl, onView, onExplore, now }: Props) {
  const { t } = useT();
  const title = booking ? venueWithRoom(booking.venueName, booking.room) : t('home.no_upcoming');
  const subtitle = booking ? bookingWhen(booking.startsAt, t, now) : t('home.explore_nearby');
  const cta = booking ? t('common.view') : t('explore.title');

  return (
    <View style={styles.card} testID="home.upcoming">
      {booking ? (
        <VenueImage uri={thumbnailUrl} style={styles.thumb} testID="home.upcoming.thumbnail" />
      ) : (
        <View style={[styles.thumb, styles.calendarTile]}>
          <Ionicons name="calendar-outline" size={24} color={white(0.55)} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
      )}

      <View style={styles.text}>
        <LPText size={9} weight="bold" tracking={1} color={white(0.55)}>
          {t('home.upcoming').toUpperCase()}
        </LPText>
        <LPText size={17} weight="medium" italic color={WHITE} numberOfLines={booking?.room ? 2 : 1} testID="home.upcoming.title">
          {title}
        </LPText>
        <LPText size={12} color={white(0.7)} numberOfLines={1}>
          {subtitle}
        </LPText>
      </View>

      <Pressable
        onPress={booking ? onView : onExplore}
        accessibilityRole="button"
        accessibilityLabel={cta}
        hitSlop={4}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        testID={booking ? 'home.upcoming.view' : 'home.upcoming.explore'}
      >
        <LPText size={13} weight="semibold" color={WHITE}>
          {cta}
        </LPText>
        <Ionicons name="arrow-forward" size={11} color={WHITE} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    // iOS `.background(Color.lpPaper)`: the near-black ink card.
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: hairline,
    borderColor: white(0.12),
  },
  thumb: { width: 60, height: 60, borderRadius: 12 },
  calendarTile: { backgroundColor: white(0.1), alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2, marginRight: 8 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    minWidth: minTouch,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.rust,
    borderWidth: hairline,
    borderColor: AURORA_35,
  },
  pressed: { opacity: 0.85 },
});
