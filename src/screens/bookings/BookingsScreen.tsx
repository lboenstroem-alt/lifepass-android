import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fonts } from '../../theme';
import { useBookings } from '../../supabase/hooks/useBookings';
import { useFavouriteVenues } from '../../supabase/hooks/useFavourites';
import { useVenues } from '../../supabase/hooks/useVenues';
import BrandedTopBar from '../../components/BrandedTopBar';
import ProfileCreditCard from '../../components/ProfileCreditCard';
import PricePill from '../../components/PricePill';
import Kicker from '../../components/Kicker';
import EmptyState from '../../components/EmptyState';
import type { Booking } from '../../types/booking';
import type { LegacyVenue as Venue } from '../../types/venue';
import type { LegacyActivity as Activity } from '../../types/venue';
import type { BookingsStackParamList } from '../../navigation/types';

type TopTab = 'bookings' | 'saved';
type BookingsSubTab = 'upcoming' | 'past';

type Nav = NativeStackNavigationProp<BookingsStackParamList>;

function whenString(date: Date): string {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((target - today) / dayMs);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  if (days === -1) return `Yesterday · ${time}`;
  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  const day = date.getDate();
  return `${weekday} ${day} · ${time}`;
}

export default function BookingsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<BookingsStackParamList, 'BookingsMain'>>();
  const [topTab, setTopTab] = useState<TopTab>('bookings');
  const [subTab, setSubTab] = useState<BookingsSubTab>('upcoming');

  // Deep-link from the Coach drawer ("Saved") — honour the requested tab
  // whenever the param changes, not just on mount.
  useEffect(() => {
    if (route.params?.initialTab) setTopTab(route.params.initialTab);
  }, [route.params?.initialTab]);

  const { bookings: upcomingBookings, loading: loadingUp } = useBookings(true);
  const { bookings: pastBookings, loading: loadingPast } = useBookings(false);
  const { savedVenues, savedVenueIds, loading: loadingFavs, toggle, refetch: refetchFavs } =
    useFavouriteVenues();
  const { venues, loading: loadingVenues } = useVenues();

  const loading = loadingUp || loadingPast || loadingFavs;

  // The hook loads favourites once on mount, but this screen stays mounted in
  // the tab navigator — so a venue saved from VenueDetail (a separate hook
  // instance) never showed up here. Refetch whenever the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      refetchFavs();
    }, [refetchFavs]),
  );

  const suggestions = useMemo(
    () => venues.filter((v) => !savedVenueIds.includes(v.id)).slice(0, 3),
    [venues, savedVenueIds],
  );

  const openVenue = (venueId: string) => navigation.navigate('VenueDetail', { venueId });

  return (
    <View style={styles.container}>
      <BrandedTopBar title="Library" subtitle="Bookings & saved" trailing="settings" />

      {/* Profile + credits card */}
      <View style={styles.profileCardWrap}>
        <ProfileCreditCard />
      </View>

      {/* Top tabs */}
      <View style={styles.topTabs}>
        <TopTabButton
          title="Bookings"
          count={upcomingBookings.length + pastBookings.length}
          active={topTab === 'bookings'}
          onPress={() => setTopTab('bookings')}
        />
        <TopTabButton
          title="Saved"
          count={savedVenues.length}
          active={topTab === 'saved'}
          onPress={() => setTopTab('saved')}
        />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : topTab === 'bookings' ? (
        <BookingsTab
          subTab={subTab}
          onSubTab={setSubTab}
          upcoming={upcomingBookings}
          past={pastBookings}
        />
      ) : (
        <SavedTab
          savedVenues={savedVenues}
          savedActivities={[]}
          suggestions={suggestions}
          openVenue={openVenue}
          onUnsave={toggle}
        />
      )}
    </View>
  );
}

function TopTabButton({
  title,
  count,
  active,
  onPress,
}: {
  title: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.topTab} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.topTabLabelRow}>
        <Text style={[styles.topTabTitle, active && styles.topTabTitleActive]}>{title}</Text>
        <Text style={styles.topTabCount}>{count}</Text>
      </View>
      <View style={[styles.topTabUnderline, active && styles.topTabUnderlineActive]} />
    </TouchableOpacity>
  );
}

function BookingsTab({
  subTab,
  onSubTab,
  upcoming,
  past,
}: {
  subTab: BookingsSubTab;
  onSubTab: (t: BookingsSubTab) => void;
  upcoming: Booking[];
  past: Booking[];
}) {
  const navigation = useNavigation<Nav>();
  const list = subTab === 'upcoming' ? upcoming : past;

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.subTabRow}>
        <SubTabChip
          title="Upcoming"
          count={upcoming.length}
          active={subTab === 'upcoming'}
          onPress={() => onSubTab('upcoming')}
        />
        <SubTabChip
          title="Past"
          count={past.length}
          active={subTab === 'past'}
          onPress={() => onSubTab('past')}
        />
      </View>

      <TouchableOpacity
        style={styles.spaCta}
        activeOpacity={0.7}
        onPress={() => navigation.getParent()?.navigate('Explore' as never)}
      >
        <View style={styles.spaIcon}>
          <Ionicons name="compass-outline" size={14} color={colors.blueMid} />
        </View>
        <View style={styles.spaText}>
          <Text style={styles.spaTitle}>Book Now</Text>
          <Text style={styles.spaSub} numberOfLines={1}>Browse venues & classes</Text>
        </View>
        <Ionicons name="chevron-forward" size={11} color={colors.paper3} />
      </TouchableOpacity>

      {list.length === 0 ? (
        <EmptyState
          icon={subTab === 'upcoming' ? 'calendar-outline' : 'time-outline'}
          message={
            subTab === 'upcoming'
              ? 'No upcoming bookings.\nExplore venues to find your next class.'
              : 'Your past bookings will show up here.'
          }
        />
      ) : subTab === 'upcoming' ? (
        <View style={styles.list}>
          {list.map((b) => (
            <UpcomingCard key={b.id} booking={b} />
          ))}
        </View>
      ) : (
        <View>
          {list.map((b, idx) => (
            <View key={b.id}>
              <PastRow booking={b} />
              {idx < list.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function SavedTab({
  savedVenues,
  savedActivities,
  suggestions,
  openVenue,
  onUnsave,
}: {
  savedVenues: Venue[];
  savedActivities: Activity[];
  suggestions: Venue[];
  openVenue: (venueId: string) => void;
  onUnsave: (venueId: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollSaved} showsVerticalScrollIndicator={false}>
      <View style={styles.savedHeader}>
        <Text style={styles.savedHeading}>Your spots</Text>
        <Kicker text={`${savedVenues.length} saved`} color={colors.paper3} />
      </View>

      {savedVenues.length === 0 ? (
        <EmptyState icon="heart-outline" message="No saved venues yet." actionLabel="Find venues" onAction={() => {}} />
      ) : (
        <View style={styles.list}>
          {savedVenues.map((v) => (
            <TouchableOpacity key={v.id} activeOpacity={0.85} onPress={() => openVenue(v.id)}>
              <SavedVenueRow venue={v} onUnsave={() => onUnsave(v.id)} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {savedActivities.length > 0 && (
        <View style={styles.section}>
          <Kicker text="Saved classes" color={colors.paper3} />
          <View style={styles.list}>
            {savedActivities.map((a) => (
              <View key={a.id} style={activityRowStyles.row}>
                <Image source={{ uri: a.imageUrl }} style={activityRowStyles.image} />
                <View style={activityRowStyles.info}>
                  <Text style={activityRowStyles.name}>{a.name}</Text>
                  <Text style={activityRowStyles.credits}>{a.durationMinutes} min</Text>
                </View>
                <Ionicons name="heart" size={14} color={colors.blueMid} />
                <Ionicons name="chevron-forward" size={12} color={colors.paper3} />
              </View>
            ))}
          </View>
        </View>
      )}

      {suggestions.length > 0 && (
        <View style={suggestStyles.container}>
          <LinearGradient
            colors={[colors.ink2, colors.ink3]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={suggestStyles.headerRow}>
            <Ionicons name="sparkles" size={12} color={colors.skyBlue} />
            <Kicker text="For you" color={colors.skyBlue} />
          </View>
          <Text style={suggestStyles.heading}>Based on your saved spots</Text>
          <View style={suggestStyles.list}>
            {suggestions.map((venue) => (
              <TouchableOpacity key={venue.id} activeOpacity={0.85} onPress={() => openVenue(venue.id)}>
                <SuggestionRow venue={venue} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function SubTabChip({
  title,
  count,
  active,
  onPress,
}: {
  title: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.subChip, active && styles.subChipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.subChipText, active && styles.subChipTextActive]}>{title}</Text>
      <Text style={[styles.subChipCount, active && styles.subChipTextActive]}>{count}</Text>
    </TouchableOpacity>
  );
}

function UpcomingCard({ booking }: { booking: Booking }) {
  return (
    <View style={cardStyles.card}>
      <Image source={{ uri: booking.venueImageUrl }} style={cardStyles.image} />
      <View style={cardStyles.info}>
        <View style={cardStyles.nameRow}>
          <Text style={cardStyles.name} numberOfLines={1}>{booking.venueName}</Text>
          {booking.isLuxury && (
            <View style={cardStyles.luxuryChip}>
              <Text style={cardStyles.luxuryChipText}>LUXURY</Text>
            </View>
          )}
        </View>
        <Text style={cardStyles.activity} numberOfLines={1}>{booking.activityName}</Text>
        <View style={cardStyles.metaRow}>
          <Text style={cardStyles.when}>{whenString(booking.bookingTime)}</Text>
          <View style={cardStyles.dot} />
          <View style={cardStyles.statusRow}>
            <View style={cardStyles.statusDot} />
            <Text style={cardStyles.status}>Confirmed</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function PastRow({ booking }: { booking: Booking }) {
  return (
    <View style={pastStyles.row}>
      <Image source={{ uri: booking.venueImageUrl }} style={pastStyles.image} />
      <View style={pastStyles.info}>
        <View style={pastStyles.nameRow}>
          <Text style={pastStyles.name} numberOfLines={1}>{booking.venueName}</Text>
          {booking.isLuxury && (
            <View style={pastStyles.luxuryChip}>
              <Text style={pastStyles.luxuryChipText}>LUXURY</Text>
            </View>
          )}
        </View>
        <Text style={pastStyles.detail} numberOfLines={1}>
          {booking.activityName} · {whenString(booking.bookingTime)}
        </Text>
      </View>
    </View>
  );
}

function SavedVenueRow({ venue, onUnsave }: { venue: Venue; onUnsave: () => void }) {
  return (
    <View style={rowStyles.row}>
      <Image source={{ uri: venue.imageUrl }} style={rowStyles.image} />
      <View style={rowStyles.info}>
        <Text style={rowStyles.name}>{venue.name}</Text>
        <Text style={rowStyles.city}>
          {venue.city} · {venue.walkInsAllowed ? 'Walk-ins welcome' : 'Pre-book required'}
        </Text>
        <View style={rowStyles.savedRow}>
          <Ionicons name="heart" size={10} color={colors.blueMid} />
          <Text style={rowStyles.savedText}>Saved</Text>
        </View>
      </View>
      <PricePill venue={venue} compact />
      {/* Unsave — filled heart in a circle, same affordance as the iOS
          saved rows. Inner touchable wins over the row's open-venue tap. */}
      <TouchableOpacity
        style={rowStyles.heartBtn}
        onPress={onUnsave}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="heart" size={14} color={colors.blueMid} />
      </TouchableOpacity>
    </View>
  );
}

function SuggestionRow({ venue }: { venue: Venue }) {
  const reason =
    venue.classification === 'luxury'
      ? 'Similar to your lagoons'
      : venue.category[0]
        ? `You liked ${venue.category[0]}`
        : 'Near your saved spots';
  return (
    <View style={suggestStyles.row}>
      <Image source={{ uri: venue.imageUrl }} style={suggestStyles.image} />
      <View style={suggestStyles.rowInfo}>
        <Text style={suggestStyles.rowName}>{venue.name}</Text>
        <Text style={suggestStyles.rowReason} numberOfLines={1}>{reason}</Text>
      </View>
      <TouchableOpacity style={suggestStyles.addButton}>
        <Ionicons name="heart-outline" size={12} color={colors.paper} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },

  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileCardWrap: { paddingTop: 14, paddingBottom: 4 },

  topTabs: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.line,
  },
  topTab: { alignItems: 'flex-start' },
  topTabLabelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingBottom: 12 },
  topTabTitle: { fontSize: 14, fontWeight: '600', color: colors.paper3 },
  topTabTitleActive: { color: colors.paper },
  topTabCount: { fontSize: 12, color: colors.paper3 },
  topTabUnderline: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent' },
  topTabUnderlineActive: { backgroundColor: colors.blue },

  scroll: { paddingTop: 14, paddingBottom: 140, gap: 16 },
  scrollSaved: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 140,
    gap: 28,
  },

  subTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  subChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.ink2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
  },
  subChipActive: { backgroundColor: colors.paper, borderColor: colors.paper },
  subChipText: { fontSize: 12.5, fontWeight: '600', color: colors.paper2, letterSpacing: -0.1 },
  subChipTextActive: { color: colors.ink },
  subChipCount: { fontSize: 11, color: colors.paper3, opacity: 0.8 },

  spaCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginHorizontal: 20,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  spaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.blueWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spaText: { flex: 1, gap: 2 },
  spaTitle: { fontSize: 14, fontWeight: '600', color: colors.paper },
  spaSub: { fontSize: 11, color: colors.paper3 },

  list: { paddingHorizontal: 20, gap: 10 },
  divider: { height: 0.5, backgroundColor: colors.line, marginHorizontal: 20 },

  savedHeader: { gap: 4, paddingHorizontal: 4 },
  savedHeading: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '400', color: colors.paper, letterSpacing: -0.4 },
  section: { gap: 12 },
});

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  image: { width: 64, height: 64, borderRadius: 10 },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 14, fontWeight: '600', color: colors.paper, flexShrink: 1 },
  luxuryChip: { backgroundColor: 'rgba(168,216,240,0.14)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  luxuryChipText: { fontSize: 9, fontWeight: '700', color: colors.skyBlue, letterSpacing: 0.6 },
  activity: { fontSize: 12, color: colors.paper3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  when: { fontSize: 12, fontWeight: '500', color: colors.paper2 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.paper4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.moss },
  status: { fontSize: 11, fontWeight: '600', color: colors.moss },
});

const pastStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  image: { width: 44, height: 44, borderRadius: 8, opacity: 0.7 },
  info: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 13.5, fontWeight: '500', color: colors.paper2, flexShrink: 1 },
  luxuryChip: { backgroundColor: 'rgba(168,216,240,0.14)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  luxuryChipText: { fontSize: 9, fontWeight: '700', color: colors.skyBlue, letterSpacing: 0.6 },
  detail: { fontSize: 11, color: colors.paper3 },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  image: { width: 72, height: 72, borderRadius: 10 },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 15, fontWeight: '600', color: colors.paper },
  city: { fontSize: 12, color: colors.paper3 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  savedText: { fontSize: 11, fontWeight: '600', color: colors.blueMid },
  heartBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink3,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const activityRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  image: { width: 56, height: 56, borderRadius: 10 },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 14, fontWeight: '600', color: colors.paper },
  credits: { fontSize: 12, color: colors.skyBlue },
});

const suggestStyles = StyleSheet.create({
  container: {
    marginHorizontal: 0,
    padding: 20,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.line,
    overflow: 'hidden',
    gap: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '400', color: colors.paper, letterSpacing: -0.4 },
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  image: { width: 48, height: 48, borderRadius: 8 },
  rowInfo: { flex: 1, gap: 1 },
  rowName: { fontSize: 13.5, fontWeight: '600', color: colors.paper },
  rowReason: { fontSize: 11, color: colors.paper3, fontStyle: 'italic' },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line2,
  },
});
