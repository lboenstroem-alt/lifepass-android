import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { colors, fonts } from '../../theme';
import { useVenues } from '../../supabase/hooks/useVenues';
import { useLocation } from '../../hooks/useLocation';
import { haversineMeters, REYKJAVIK_CENTRE } from '../../lib/geo';
import { useBookings } from '../../supabase/hooks/useBookings';
import { useAuth } from '../../supabase/hooks/useAuth';
import { useWeather } from '../../hooks/useWeather';
import { weatherRecommendation } from '../../services/weather';
import Kicker from '../../components/Kicker';
import Wordmark from '../../components/Wordmark';
import NearbyVenueCard from '../../components/NearbyVenueCard';
import CuratedVenueRow from '../../components/CuratedVenueRow';
import { useFavouriteVenues } from '../../supabase/hooks/useFavourites';
import { useRecentCheckIn } from '../../supabase/hooks/useRecentCheckIn';
import CheckInProofBanner from '../../components/CheckInProofBanner';
import { coachCategories, type CoachCategory } from '../../data/coachCategories';
import type { HomeStackParamList, TabParamList } from '../../navigation/types';

// Composite navigation type — lets us navigate inside HomeStack AND
// across tabs (to Coach with a prefilled prompt).
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList>,
  BottomTabNavigationProp<TabParamList>
>;

const HERO_HEIGHT = 520;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Good night';
}

/** Short, human relative-time for a booking: "Today · 18:00",
 *  "Tomorrow · 09:30" or "Sat 7 Jun · 14:00". Mirrors the iOS bookingWhen(). */
function bookingWhen(date: Date): string {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, now)) return `Today · ${time}`;
  if (sameDay(date, tomorrow)) return `Tomorrow · ${time}`;
  const day = date
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '');
  return `${day} · ${time}`;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { venues, loading } = useVenues();
  const { bookings: upcomingBookings } = useBookings(true);
  const { weather } = useWeather();
  const { savedVenueIds, toggle: toggleFavourite } = useFavouriteVenues();
  // Recent check-in → the "you're checked in" staff-proof banner (fail-soft;
  // dormant until the API sends `recentCheckIn`). Mirrors lifepass-ios Home.
  const recentCheckIn = useRecentCheckIn();
  const userCoords = useLocation();

  const greeting = getGreeting();
  const fullName: string = user?.user_metadata?.full_name ?? user?.email ?? '';
  const firstName = fullName.split(' ')[0] || 'there';
  const initial = firstName.charAt(0).toUpperCase();

  // Random hero — a fresh venue photo each time Home gains focus, preferring
  // venues that actually have an image so the hero never renders blank.
  // Mirrors the iOS pickRandomHero() (re-rolled per appear/refresh, no timer).
  const [heroVenueId, setHeroVenueId] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const withImage = venues.filter((v) => !!v.imageUrl);
      const pool = withImage.length > 0 ? withImage : venues;
      if (pool.length > 0) {
        setHeroVenueId(pool[Math.floor(Math.random() * pool.length)].id);
      }
    }, [venues]),
  );

  const hero = venues.find((v) => v.id === heroVenueId) ?? venues[0];
  // "Close by" — the 3 venues nearest the user (device fix, else Reykjavík
  // centre), excluding the hero and any venue without real coordinates. This
  // was previously just the first 3 venues, so it showed far-away spots.
  const nearby = useMemo(() => {
    const origin = userCoords ?? REYKJAVIK_CENTRE;
    return venues
      .filter((v) => v.id !== hero?.id && !!v.latitude && !!v.longitude)
      .map((v) => ({
        venue: v,
        meters: haversineMeters(origin.latitude, origin.longitude, v.latitude as number, v.longitude as number),
      }))
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 3);
  }, [venues, hero?.id, userCoords]);

  // "Picked for you" — the venues not already in hero/nearby, ranked by review
  // volume (a global popularity signal), top 4. Mirrors the iOS `popular` shelf.
  const nearbyIds = new Set(nearby.map((r) => r.venue.id));
  const curated = venues
    .filter((v) => v.id !== hero?.id && !nearbyIds.has(v.id))
    .sort((a, b) => (b.totalReviews ?? 0) - (a.totalReviews ?? 0))
    .slice(0, 4);

  // Soonest confirmed booking drives the "UPCOMING" card; null shows the
  // "No upcoming bookings" empty state with an Explore CTA (matches iOS).
  const upcomingBooking = upcomingBookings[0];

  function openVenue(venueId: string) {
    navigation.navigate('VenueDetail', { venueId });
  }

  function openAccount() {
    navigation.navigate('Account');
  }

  function openBookings() {
    navigation.navigate('Bookings');
  }

  function openExplore() {
    navigation.navigate('Explore');
  }

  function openCoach(prefilledMessage?: string) {
    navigation.navigate('Coach', {
      screen: 'CoachMain',
      params: prefilledMessage ? { prefilledMessage } : undefined,
    } as never);
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Fresh check-in: the member may be at a front desk right now, so the
          staff proof outranks the hero and takes the top slot. */}
      {recentCheckIn && <CheckInProofBanner checkIn={recentCheckIn} />}

      {/* Hero */}
      <View style={styles.heroContainer}>
        {hero ? (
          <Image source={{ uri: hero.imageUrl }} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, { backgroundColor: colors.ink2 }]} />
        )}

        {/* Scrim: a warm near-black (not navy — keeps a neutral, editorial cast
            on the photo instead of a blue hue). Clear through the top so the
            image reads naturally, darker behind the hero text, then fades into
            the cream page colour so the hero blends into the content below. */}
        <LinearGradient
          colors={[
            'rgba(26,22,18,0.18)',
            'rgba(26,22,18,0.0)',
            'rgba(26,22,18,0.30)',
            'rgba(26,22,18,0.72)',
            colors.ink,
          ]}
          locations={[0, 0.30, 0.60, 0.82, 1.0]}
          style={StyleSheet.absoluteFill}
        />

        <View style={[styles.heroInner, { paddingTop: insets.top + 12 }]}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <Wordmark height={20} color={HERO_TEXT} />

            <View style={styles.topBarRight}>
              <TouchableOpacity style={styles.avatar} onPress={openAccount}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Editorial copy */}
          <View style={styles.editorial}>
            {/* Real weather row — replaces the old static tagline */}
            {weather && (
              <View style={styles.weatherRow}>
                <Ionicons name={weather.icon} size={13} color={HERO_TEXT_2} />
                <Text style={styles.weatherText}>
                  {weather.condition} · {weather.temperature}° · {weatherRecommendation(weather)}
                </Text>
              </View>
            )}

            <Text style={styles.greetingText}>
              {greeting}, <Text style={styles.greetingName}>{firstName}.</Text>
            </Text>

            {/* UPCOMING card — shows the soonest booking, or a "No upcoming
                bookings" empty state with an Explore CTA (mirrors iOS). */}
            <View style={styles.pickupCard}>
              {upcomingBooking ? (
                <Image
                  source={{ uri: upcomingBooking.venueImageUrl || hero?.imageUrl }}
                  style={styles.pickupImage}
                />
              ) : (
                <View style={styles.pickupIconTile}>
                  <Ionicons name="calendar-outline" size={24} color={HERO_TEXT_3} />
                </View>
              )}
              <View style={styles.pickupText}>
                <Text style={styles.pickupKicker}>UPCOMING</Text>
                <Text style={styles.pickupVenue} numberOfLines={1}>
                  {upcomingBooking ? upcomingBooking.venueName : 'No upcoming bookings'}
                </Text>
                <Text style={styles.pickupSub} numberOfLines={1}>
                  {upcomingBooking ? bookingWhen(upcomingBooking.bookingTime) : 'Explore nearby'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.bookButton}
                onPress={() => (upcomingBooking ? openBookings() : openExplore())}
                activeOpacity={0.85}
              >
                <Text style={styles.bookButtonText}>
                  {upcomingBooking ? 'View' : 'Explore'} →
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Try something new — links to Coach AI.
          Lives directly under the hero so users see it first. Doesn't
          depend on venue data so it renders even while shelves are loading. */}
      <View style={styles.tryNewWrap}>
        <TryNewSection onPromptSelected={(prompt) => openCoach(prompt)} />
      </View>

      {/* Shelves */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : (
        <View style={styles.shelves}>
          {/* Near You */}
          {nearby.length > 0 && (
            <View style={styles.shelf}>
              <View style={styles.shelfHeader}>
                <View>
                  <Kicker text="Near You" />
                  <Text style={styles.shelfTitle}>Close by</Text>
                </View>
                <TouchableOpacity style={styles.allButton}>
                  <Text style={styles.allButtonText}>All →</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalScroll}
              >
                {nearby.map(({ venue, meters }) => (
                  <TouchableOpacity key={venue.id} activeOpacity={0.85} onPress={() => openVenue(venue.id)}>
                    <NearbyVenueCard venue={venue} distanceMeters={meters} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Curated */}
          {curated.length > 0 && (
            <View style={styles.shelf}>
              <View style={styles.shelfHeader}>
                <View>
                  <Kicker text="Popular" />
                  <Text style={styles.shelfTitle}>Most Popular Now</Text>
                </View>
              </View>

              <View style={styles.curatedList}>
                {curated.map((venue) => (
                  <TouchableOpacity key={venue.id} activeOpacity={0.85} onPress={() => openVenue(venue.id)}>
                    <CuratedVenueRow
                      venue={venue}
                      isFavourited={savedVenueIds.includes(venue.id)}
                      onToggleFavourite={() => toggleFavourite(venue.id)}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={{ height: 120 }} />
        </View>
      )}
    </ScrollView>
  );
}

// ─── Try-Something-New section ────────────────────────────────────────────────

// Quick-tap prompts shown in the AskCard. Each chip's `prompt` is what
// gets sent to Coach when tapped.
const ASK_CHIPS: { label: string; prompt: string }[] = [
  { label: 'Lagoon enthusiast', prompt: 'Plan a perfect spa or lagoon evening for me.' },
  { label: '30 min sweat', prompt: 'I have 30 minutes. What is a quick high-intensity workout?' },
  { label: 'After work', prompt: "It's after 6pm. What's a good way to wind down nearby?" }
];

const ASK_PLACEHOLDER = 'Find me a quiet 45-minute swim near work…';

function TryNewSection({
  onPromptSelected,
}: {
  onPromptSelected: (prompt: string) => void;
}) {
  const [input, setInput] = useState('');

  function send() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    onPromptSelected(trimmed);
  }

  return (
    <View style={trySection.container}>
      <Text style={trySection.heading}>
        Want to try{' '}
        <Text style={trySection.italic}>something new?</Text>
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={trySection.scrollContent}
      >
        {coachCategories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={trySection.card}
            onPress={() => onPromptSelected(cat.prompt)}
            activeOpacity={0.85}
          >
            <Image source={cat.image} style={trySection.cardImage} />
            <Text style={trySection.cardLabel} numberOfLines={2}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Ask card — real text input + a single row of quick-prompt chips */}
      <View style={askCard.container}>
        <View style={askCard.inputRow}>
          <TextInput
            style={askCard.input}
            value={input}
            onChangeText={setInput}
            placeholder={ASK_PLACEHOLDER}
            placeholderTextColor={colors.paper3}
            multiline
            returnKeyType="send"
            onSubmitEditing={send}
          />
          {input.trim().length > 0 && (
            <TouchableOpacity onPress={send} activeOpacity={0.8} hitSlop={8}>
              <Ionicons name="arrow-up-circle" size={28} color={colors.skyBlue} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={askCard.chipsRow}
        >
          {ASK_CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip.label}
              style={askCard.chip}
              onPress={() => onPromptSelected(chip.prompt)}
              activeOpacity={0.8}
            >
              <Text style={askCard.chipText}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const trySection = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    gap: 16,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 26,
    fontWeight: '400',
    color: colors.paper,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  // "something new?" — upright Fraunces (no italic), matching the heading.
  italic: {
    fontFamily: fonts.serif,
    color: colors.paper,
  },
  scrollContent: {
    gap: 14,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  card: {
    width: 110,
    alignItems: 'center',
    gap: 10,
  },
  cardImage: {
    width: 100,
    height: 100,
    borderRadius: 16,
    backgroundColor: colors.ink3,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.paper2,
    textAlign: 'center',
    lineHeight: 15,
  },
});

// ─── Ask-card (text input + tappable quick-prompt chips) ──────────────────────

const askCard = StyleSheet.create({
  container: {
    padding: 18,
    backgroundColor: colors.ink2,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.line2,
    gap: 14,
    marginTop: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.ink3,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.line2,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.paper,
    padding: 0,
    maxHeight: 72,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(168,216,240,0.5)',  // ~skyBlue at 50%
    backgroundColor: 'rgba(168,216,240,0.06)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.skyBlue,
    letterSpacing: -0.1,
  },
});

// The hero sits on a dark photo + gradient scrim, so its overlaid text/glass
// stays light regardless of the app's light editorial theme (the shelves below
// the hero use the normal dark-ink-on-paper tokens).
const HERO_TEXT = '#F1F5F9';
const HERO_TEXT_2 = 'rgba(241,245,249,0.72)';
const HERO_TEXT_3 = 'rgba(241,245,249,0.48)';

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1 },
  heroContainer: { height: HERO_HEIGHT },
  heroImage: { ...StyleSheet.absoluteFillObject },
  heroInner: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    // Frosted glass over the dark hero (warm neutral, not navy).
    backgroundColor: 'rgba(26, 22, 18, 0.42)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  avatarInitial: { fontSize: 15, fontWeight: '600', color: HERO_TEXT, fontStyle: 'italic' },
  editorial: { paddingBottom: 52, gap: 14 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weatherText: {
    fontSize: 11,
    fontWeight: '600',
    color: HERO_TEXT_2,
    letterSpacing: 1.0,
  },
  greetingText: {
    fontFamily: fonts.serif,
    fontSize: 36, fontWeight: '400', color: HERO_TEXT,
    letterSpacing: -1.2, lineHeight: 44,
  },
  greetingName: { fontFamily: fonts.serifItalic, color: HERO_TEXT, fontStyle: 'italic' },
  // Pickup card — glass section with thumbnail + venue info + book button.
  pickupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: 'rgba(26, 22, 18, 0.42)',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  pickupImage: {
    width: 60, height: 60,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  pickupIconTile: {
    width: 60, height: 60,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupText: { flex: 1, gap: 2 },
  pickupKicker: {
    fontSize: 9,
    fontWeight: '700',
    color: HERO_TEXT_3,
    letterSpacing: 1.0,
    marginBottom: 2,
  },
  pickupVenue: {
    fontSize: 17,
    fontWeight: '500',
    fontStyle: 'italic',
    color: HERO_TEXT,
    letterSpacing: -0.3,
  },
  pickupSub: {
    fontSize: 12,
    color: HERO_TEXT_2,
  },
  bookButton: {
    // #3F79BA at 50% — a soft light-blue pill on the dark UPCOMING card.
    backgroundColor: 'rgba(63,121,186,0.5)',
    borderRadius: 999,
    paddingHorizontal: 16,
    height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  bookButtonText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  loadingContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60,
  },
  tryNewWrap: { paddingTop: 24, paddingBottom: 8 },
  shelves: { paddingTop: 12, gap: 32 },
  shelf: { gap: 14 },
  shelfHeader: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', paddingHorizontal: 24,
  },
  shelfTitle: {
    fontFamily: fonts.serif,
    fontSize: 22, fontWeight: '400', color: colors.paper,
    letterSpacing: -0.4, marginTop: 4,
  },
  allButton: {
    backgroundColor: colors.ink2, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 0.5, borderColor: colors.line,
  },
  allButtonText: { fontSize: 12, fontWeight: '600', color: colors.paper2 },
  horizontalScroll: { paddingHorizontal: 20, gap: 12 },
  curatedList: { paddingHorizontal: 20, gap: 10 },
});
