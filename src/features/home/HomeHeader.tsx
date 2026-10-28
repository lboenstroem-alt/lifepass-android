// The top of Home (iOS `HomeView.heroBlock` and `HomeView.headerOnly`).
//
// With a venue to feature: a 520 dp full-bleed photo running under the status
// bar, washed with the page colour (iOS stops: 35 % at the top, 5 % at 30 %,
// 60 % at 70 %, solid at the foot, so the text at the base reads on paper),
// the wordmark and the avatar, the pass chip, then the weather line, the
// greeting and the upcoming card.
//
// With no venues at all (still loading, or the load failed): only a 260 dp
// header, the wordmark and a person button. No greeting, weather or card.
//
// The avatar and the person button both open Profile (bookings and saved),
// and both say so to TalkBack (`a11y.open_profile`).
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText, VenueImage, Wordmark } from '../../components/ui';
import type { ActivePass } from '../../api/profile';
import { useT } from '../../i18n';
import { weatherLine, type WeatherSnapshot } from '../../services/weather';
import { colors, gutter, hairline, minTouch } from '../../theme';
import type { Venue } from '../../types/venue';
import { avatarInitial } from './greeting';
import { passVisitsText } from './passChip';
import ProfileMovedCallout from './ProfileMovedCallout';
import UpcomingCard from './UpcomingCard';
import type { UpcomingBooking } from './upcoming';

export const HERO_HEIGHT = 520;
export const HEADER_ONLY_HEIGHT = 260;
/** Below the status bar: the top bar's own gap (iOS pads 56 pt from the screen top). */
const TOP_BAR_GAP = 12;
/** The person button's hit area (iOS `.frame(width: 44, height: 44)`). */
const BUTTON = minTouch;

/** iOS `Color.lpInk.opacity(x)`: the page colour, #F8F6F1. */
const ink = (opacity: number) => `rgba(248,246,241,${opacity})`;
/** iOS `Color.lpInk2.opacity(0.55)`: the avatar's frosted fill. */
const AVATAR_FILL = 'rgba(242,239,232,0.55)';
const AVATAR_RIM = 'rgba(255,255,255,0.18)';

type HeroProps = {
  venue: Venue;
  /** The status bar's height: the photo runs under it, the controls clear it. */
  topInset: number;
  /** The first name, or the localized fallback ("there" / "þú"). */
  firstName: string;
  greeting: string;
  weather: WeatherSnapshot | null;
  pass: ActivePass | null;
  booking: UpcomingBooking | null;
  showProfileHint: boolean;
  onOpenProfile: () => void;
  onViewBooking: () => void;
  onDismissHint: () => void;
  onExplore: () => void;
};

export function HomeHero({
  venue,
  topInset,
  firstName,
  greeting,
  weather,
  pass,
  booking,
  showProfileHint,
  onOpenProfile,
  onViewBooking,
  onDismissHint,
  onExplore,
}: HeroProps) {
  const { t } = useT();
  const topBarTop = topInset + TOP_BAR_GAP;

  return (
    <View style={styles.hero} testID="home.hero">
      <VenueImage uri={venue.imageUrl} style={StyleSheet.absoluteFill} recyclingKey={venue.id} testID="home.hero.image" />
      <LinearGradient
        colors={[ink(0.35), ink(0.05), ink(0.6), ink(1)]}
        locations={[0, 0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.heroContent}>
        <View style={[styles.topBar, { paddingTop: topBarTop }]}>
          <Wordmark height={22} />
          <Pressable
            onPress={onOpenProfile}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.open_profile')}
            style={styles.button}
            testID="home.avatar"
          >
            <View style={styles.avatar}>
              <LPText serif size={15} weight="semibold" italic color={colors.paper} maxScale={1.3}>
                {avatarInitial(firstName)}
              </LPText>
            </View>
          </Pressable>
        </View>

        {pass ? (
          // Not a control: it tells, it does not open anything (iOS).
          <View style={styles.passChip} testID="home.passChip">
            <Ionicons name="ticket" size={10} color={colors.aurora} accessibilityElementsHidden importantForAccessibility="no" />
            <LPText size={12} weight="semibold" color={colors.aurora} style={styles.passText}>
              {passVisitsText(pass, t)}
            </LPText>
          </View>
        ) : null}

        <View style={styles.spacer} />

        <View style={styles.editorial}>
          {weather ? (
            <View style={styles.weatherRow} testID="home.weather">
              <MaterialCommunityIcons name={weather.icon} size={13} color={colors.paper2} accessibilityElementsHidden importantForAccessibility="no" />
              <LPText
                size={11}
                weight="semibold"
                tracking={1}
                color={colors.paper2}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={styles.weatherText}
              >
                {weatherLine(weather)}
              </LPText>
            </View>
          ) : null}

          <LPText serif size={36} tracking={-1} color={colors.paper} accessibilityRole="header" testID="home.greeting">
            {`${greeting}, `}
            <LPText serif italic size={36} tracking={-1} color={colors.paper}>
              {`${firstName}.`}
            </LPText>
          </LPText>

          <UpcomingCard booking={booking} thumbnailUrl={venue.imageUrl} onView={onViewBooking} onExplore={onExplore} />
        </View>
      </View>

      {showProfileHint ? <ProfileMovedCallout buttonTop={topBarTop} right={gutter} onDismiss={onDismissHint} /> : null}
    </View>
  );
}

type HeaderOnlyProps = {
  showProfileHint: boolean;
  onOpenProfile: () => void;
  onDismissHint: () => void;
};

/** The person button sits in the middle of the 260 dp header (iOS centres the row in its frame). */
const HEADER_ROW_TOP = (HEADER_ONLY_HEIGHT - (BUTTON + 2 * gutter)) / 2 + gutter;

export function HomeHeaderOnly({ showProfileHint, onOpenProfile, onDismissHint }: HeaderOnlyProps) {
  const { t } = useT();
  return (
    <View style={styles.headerOnly} testID="home.headerOnly">
      <View style={styles.headerRow}>
        <Wordmark height={22} />
        <Pressable
          onPress={onOpenProfile}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.open_profile')}
          style={styles.button}
          testID="home.avatar"
        >
          <Ionicons name="person-circle-outline" size={24} color={colors.paper2} />
        </Pressable>
      </View>
      {showProfileHint ? <ProfileMovedCallout buttonTop={HEADER_ROW_TOP} right={gutter} onDismiss={onDismissHint} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // At least 520 dp (iOS's frame); at the largest text sizes the hero grows
  // with its words instead of drawing them over the sections below.
  hero: { minHeight: HERO_HEIGHT, zIndex: 1 },
  heroContent: { minHeight: HERO_HEIGHT },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
  },
  button: { width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: AVATAR_FILL,
    borderWidth: hairline,
    borderColor: AVATAR_RIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: gutter, paddingTop: 10 },
  passText: { flexShrink: 1 },
  spacer: { flex: 1 },
  editorial: { gap: 14, paddingHorizontal: gutter, paddingBottom: 28 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weatherText: { flexShrink: 1 },
  headerOnly: { minHeight: HEADER_ONLY_HEIGHT, justifyContent: 'center', zIndex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: gutter,
  },
});
