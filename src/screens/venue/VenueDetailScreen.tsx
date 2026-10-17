import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../../theme';
import { useVenueById, useActivities, useVenueReviews } from '../../supabase/hooks/useVenues';
import { useFavouriteVenues } from '../../supabase/hooks/useFavourites';
import Kicker from '../../components/Kicker';
import { isPremium, isBoutique, priceLabel } from '../../types/venue';
import type {
  LegacyVenue as Venue,
  LegacyActivity as Activity,
  LegacyVenueReview as VenueReview,
  LegacyOpeningHours as OpeningHours,
  LegacyOpeningHoursDay as OpeningHoursDay,
} from '../../types/venue';

const HERO_HEIGHT = 420;
const SCREEN_WIDTH = Dimensions.get('window').width;

type Props = {
  navigation: {
    goBack: () => void;
    navigate: (screen: 'BookingFlow', params: { venueId: string; activityId: string }) => void;
  };
  route: { params: { venueId: string } };
};

export default function VenueDetailScreen({ navigation, route }: Props) {
  const { venueId } = route.params;
  const insets = useSafeAreaInsets();

  const { venue, loading: venueLoading } = useVenueById(venueId);
  const { activities } = useActivities(venueId);
  const { reviews } = useVenueReviews(venueId);
  const { savedVenueIds, toggle } = useFavouriteVenues();

  const isFavourite = venue ? savedVenueIds.includes(venue.id) : false;

  // Merge loaded activities into the venue object for components that need venue.activities
  const venueWithActivities: Venue | null = useMemo(() => {
    if (!venue) return null;
    return { ...venue, activities };
  }, [venue, activities]);

  function openBooking(activityId: string) {
    if (!venue) return;
    navigation.navigate('BookingFlow', { venueId: venue.id, activityId });
  }

  if (venueLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }

  if (!venueWithActivities) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.paper3} />
        <Text style={styles.errorText}>Venue not found</Text>
        <TouchableOpacity style={styles.errorButton} onPress={navigation.goBack}>
          <Text style={styles.errorButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <HeroBlock
          venue={venueWithActivities}
          insets={insets}
          isFavourite={isFavourite}
          onBack={navigation.goBack}
          onToggleFavourite={() => toggle(venueWithActivities.id)}
        />

        <View style={styles.detailContent}>
          <MetaRow venue={venueWithActivities} />
          <Description text={venueWithActivities.description} />
          <AmenitiesBlock amenities={venueWithActivities.amenities} />
          <ActivitiesBlock venue={venueWithActivities} onBook={openBooking} />
          <OpeningHoursBlock hours={venueWithActivities.openingHours} />
          <ContactBlock venue={venueWithActivities} />
          <ReviewsBlock reviews={reviews} />
        </View>
      </ScrollView>

      <FloatingAction
        venue={venueWithActivities}
        bottom={insets.bottom + 110}
        onBook={() => venueWithActivities.activities[0] && openBooking(venueWithActivities.activities[0].id)}
      />
    </View>
  );
}

function HeroBlock({
  venue,
  insets,
  isFavourite,
  onBack,
  onToggleFavourite,
}: {
  venue: Venue;
  insets: { top: number };
  isFavourite: boolean;
  onBack: () => void;
  onToggleFavourite: () => void;
}) {
  return (
    <View style={heroStyles.container}>
      <Image source={{ uri: venue.imageUrl }} style={heroStyles.image} />

      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(15,23,42,0.35)',
          'rgba(15,23,42,0.05)',
          'rgba(15,23,42,0.70)',
          'rgba(15,23,42,0.95)',
        ]}
        locations={[0, 0.35, 0.85, 1.0]}
        style={StyleSheet.absoluteFill}
      />

      {/* Top nav */}
      <View style={[heroStyles.topNav, { paddingTop: insets.top + 8 }]}>
        <FrostedButton icon="chevron-back" onPress={onBack} />
        <View style={heroStyles.topNavRight}>
          <FrostedButton
            icon={isFavourite ? 'heart' : 'heart-outline'}
            tint={isFavourite ? colors.blueMid : HERO_TEXT}
            onPress={onToggleFavourite}
          />
          <FrostedButton icon="share-outline" onPress={() => {}} />
        </View>
      </View>

      {/* Title block */}
      <View style={heroStyles.titleBlock}>
        <Kicker
          text={
            isPremium(venue)
              ? `Premium · ${priceLabel(venue)}`
              : isBoutique(venue)
                ? priceLabel(venue)
                : 'In your plan'
          }
          color={isPremium(venue) ? HERO_SKY : HERO_TEXT_2}
        />
        <Text style={heroStyles.name}>{venue.name}</Text>
        <Text style={heroStyles.city}>{venue.city}</Text>
      </View>
    </View>
  );
}

function FrostedButton({
  icon,
  tint = HERO_TEXT,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={heroStyles.frostedButton} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={16} color={tint} />
    </TouchableOpacity>
  );
}

function MetaRow({ venue }: { venue: Venue }) {
  return (
    <View style={styles.metaRow}>
      <TouchableOpacity style={styles.ratingRow} activeOpacity={0.7}>
        {venue.averageRating > 0 ? (
          <>
            <Ionicons name="star" size={11} color={colors.skyBlue} />
            <Text style={styles.ratingValue}>{venue.averageRating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>· {venue.totalReviews} reviews</Text>
          </>
        ) : (
          <Text style={styles.ratingCount}>No reviews yet</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.directionsButton} activeOpacity={0.7}>
        <Ionicons name="navigate-outline" size={12} color={colors.paper} />
        <Text style={styles.directionsText}>Directions</Text>
      </TouchableOpacity>
    </View>
  );
}

function Description({ text }: { text: string }) {
  if (!text) return null;
  return <Text style={styles.description}>{text}</Text>;
}

function AmenitiesBlock({ amenities }: { amenities: string[] }) {
  if (amenities.length === 0) return null;
  return (
    <View style={styles.amenitiesContainer}>
      {amenities.map((a) => (
        <View key={a} style={styles.amenityChip}>
          <Text style={styles.amenityText}>{a}</Text>
        </View>
      ))}
    </View>
  );
}

function ActivitiesBlock({ venue, onBook }: { venue: Venue; onBook: (id: string) => void }) {
  if (venue.walkInsAllowed) return <WalkInCard venue={venue} />;
  if (venue.activities.length === 0) return <NoBookingsCard venue={venue} />;

  return (
    <View style={styles.section}>
      <SectionTitle title="Book a class" kicker={`${venue.activities.length} classes`} />
      <View style={styles.activitiesList}>
        {venue.activities.map((activity) => (
          <ActivityRow key={activity.id} activity={activity} onPress={() => onBook(activity.id)} />
        ))}
      </View>
    </View>
  );
}

function ActivityRow({ activity, onPress }: { activity: Activity; onPress: () => void }) {
  const isLuxury = activity.classification === 'luxury';
  return (
    <TouchableOpacity style={activityStyles.row} activeOpacity={0.7} onPress={onPress}>
      <Image source={{ uri: activity.imageUrl }} style={activityStyles.image} />
      <View style={activityStyles.info}>
        <Text style={activityStyles.name} numberOfLines={2}>{activity.name}</Text>
        <View style={activityStyles.meta}>
          <View style={activityStyles.metaItem}>
            <Ionicons name="time-outline" size={11} color={colors.paper3} />
            <Text style={activityStyles.metaText}>{activity.durationMinutes} min</Text>
          </View>
          {isLuxury && (
            <View style={activityStyles.luxuryChip}>
              <Ionicons name="sparkles" size={8} color={colors.skyBlue} />
              <Text style={activityStyles.luxuryText}>LUXURY</Text>
            </View>
          )}
        </View>
      </View>
      <View style={activityStyles.trailing}>
        <Ionicons name="chevron-forward" size={11} color={colors.paper3} />
      </View>
    </TouchableOpacity>
  );
}

function WalkInCard({ venue }: { venue: Venue }) {
  return (
    <LinearGradient
      colors={[colors.ink2, colors.ink3]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={cardStyles.container}
    >
      <View style={[cardStyles.iconCircle, { backgroundColor: colors.blueWash }]}>
        <Ionicons name="qr-code-outline" size={24} color={colors.blueMid} />
      </View>
      <Text style={cardStyles.heading}>Walk-in welcome</Text>
      <Text style={cardStyles.body}>
        Just show up and scan the venue's QR code at the door.
      </Text>
      <View style={cardStyles.costRow}>
        <View style={cardStyles.costDot} />
        <Text style={cardStyles.costText}>{priceLabel(venue)}</Text>
      </View>
    </LinearGradient>
  );
}

function NoBookingsCard({ venue }: { venue: Venue }) {
  return (
    <View style={[cardStyles.container, { backgroundColor: colors.ink2 }]}>
      <View style={[cardStyles.iconCircle, { backgroundColor: 'rgba(168,216,240,0.14)' }]}>
        <Ionicons name="calendar-outline" size={20} color={colors.skyBlue} />
      </View>
      <Text style={cardStyles.heading}>Bookings not yet available</Text>
      <Text style={cardStyles.body}>
        We're still connecting {venue.name} to the booking system. Call ahead for now.
      </Text>
    </View>
  );
}

function OpeningHoursBlock({ hours }: { hours: OpeningHours }) {
  const days: { key: keyof OpeningHours; label: string }[] = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
  ];

  return (
    <View style={styles.section}>
      <SectionTitle title="Hours" kicker="This week" />
      <View style={hoursStyles.container}>
        {days.map((d, i) => (
          <View key={d.key}>
            <HoursRow label={d.label} hours={hours[d.key]} />
            {i < days.length - 1 && <View style={hoursStyles.divider} />}
          </View>
        ))}
      </View>
    </View>
  );
}

function HoursRow({ label, hours }: { label: string; hours?: OpeningHoursDay }) {
  return (
    <View style={hoursStyles.row}>
      <Text style={hoursStyles.day}>{label}</Text>
      {hours?.closed ? (
        <Text style={hoursStyles.closed}>Closed</Text>
      ) : hours?.open && hours?.close ? (
        <Text style={hoursStyles.time}>{hours.open} – {hours.close}</Text>
      ) : (
        <Text style={hoursStyles.empty}>—</Text>
      )}
    </View>
  );
}

function ContactBlock({ venue }: { venue: Venue }) {
  return (
    <View style={styles.section}>
      <SectionTitle title="Getting there" />
      <View style={contactStyles.container}>
        {venue.address ? <ContactRow icon="location-outline" text={venue.address} /> : null}
        {venue.phone ? <ContactRow icon="call-outline" text={venue.phone} /> : null}
        {venue.specialInstructions ? (
          <ContactRow icon="information-circle-outline" text={venue.specialInstructions} />
        ) : null}
      </View>
    </View>
  );
}

function ContactRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={contactStyles.row}>
      <Ionicons name={icon} size={14} color={colors.blueMid} style={contactStyles.icon} />
      <Text style={contactStyles.text}>{text}</Text>
    </View>
  );
}

function ReviewsBlock({ reviews }: { reviews: VenueReview[] }) {
  return (
    <View style={styles.section}>
      <View style={reviewStyles.header}>
        <SectionTitle
          title="Reviews"
          kicker={reviews.length === 0 ? 'No reviews yet' : 'From members'}
        />
        <TouchableOpacity activeOpacity={0.7}>
          <Text style={reviewStyles.allButton}>
            {reviews.length === 0 ? 'Write one' : 'See all'}
          </Text>
        </TouchableOpacity>
      </View>

      {reviews.length === 0 ? (
        <View style={reviewStyles.emptyCard}>
          <Ionicons name="chatbubble-outline" size={24} color={colors.paper3} />
          <Text style={reviewStyles.emptyText}>Be the first to review</Text>
        </View>
      ) : (
        <View style={reviewStyles.list}>
          {reviews.slice(0, 2).map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </View>
      )}
    </View>
  );
}

function ReviewCard({ review }: { review: VenueReview }) {
  return (
    <View style={reviewStyles.card}>
      <View style={reviewStyles.cardHeader}>
        <View style={reviewStyles.stars}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons
              key={i}
              name={i <= review.rating ? 'star' : 'star-outline'}
              size={11}
              color={colors.skyBlue}
            />
          ))}
        </View>
        <Text style={reviewStyles.date}>
          {review.createdAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </Text>
      </View>
      <Text style={reviewStyles.comment} numberOfLines={4}>{review.comment}</Text>
    </View>
  );
}

function FloatingAction({
  venue,
  bottom,
  onBook,
}: {
  venue: Venue;
  bottom: number;
  onBook: () => void;
}) {
  // Walk-in CTA bounces to the Check-in (scanner) tab — iOS pushes CheckInView
  // from the same bar. getParent() reaches the tab navigator from this stack.
  const navigation = useNavigation();
  const onScan = () => navigation.getParent()?.navigate('CheckIn' as never);

  if (venue.walkInsAllowed) {
    return (
      <View style={[floatStyles.container, { bottom }]}>
        <TouchableOpacity
          style={floatStyles.scanBar}
          activeOpacity={0.85}
          onPress={onScan}
        >
          <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
          <Text style={floatStyles.scanText}>Scan the QR code</Text>
          <View style={{ flex: 1 }} />
          <Text style={floatStyles.scanCost}>{priceLabel(venue)}</Text>
          <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    );
  }

  if (venue.activities.length > 0) {
    const first = venue.activities[0];
    return (
      <View style={[floatStyles.container, { bottom }]}>
        <View style={floatStyles.bookBar}>
          <View>
            <Kicker text="Next class" color={colors.paper3} />
            <Text style={floatStyles.bookActivity} numberOfLines={1}>
              {first.name} · {first.durationMinutes} min
            </Text>
          </View>
          <TouchableOpacity style={floatStyles.bookButton} activeOpacity={0.85} onPress={onBook}>
            <Text style={floatStyles.bookButtonText}>Book →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

function SectionTitle({ title, kicker }: { title: string; kicker?: string }) {
  return (
    <View style={styles.sectionTitle}>
      {kicker && <Kicker text={kicker} color={colors.paper3} />}
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 220 },

  loadingContainer: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  errorText: { fontSize: 14, color: colors.paper3 },
  errorButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: 10,
  },
  errorButtonText: { color: colors.paper, fontSize: 14, fontWeight: '500' },

  detailContent: { paddingHorizontal: 20, paddingTop: 18, gap: 28 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingValue: { fontSize: 13, fontWeight: '600', color: colors.paper },
  ratingCount: { fontSize: 12, color: colors.paper3 },
  directionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.ink2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  directionsText: { fontSize: 12, fontWeight: '600', color: colors.paper },

  description: {
    fontSize: 15,
    color: colors.paper2,
    lineHeight: 22,
  },

  amenitiesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.ink3,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  amenityText: { fontSize: 12, fontWeight: '500', color: colors.paper2, letterSpacing: 0.2 },

  section: { gap: 14 },
  sectionTitle: { gap: 4 },
  sectionTitleText: {
    fontFamily: fonts.serif,
    fontSize: 22,
    fontWeight: '400',
    color: colors.paper,
    letterSpacing: -0.4,
  },
  activitiesList: { gap: 10 },
});

// The hero image + scrim is dark, so its title/chrome stays light even though
// the rest of the screen uses dark-ink-on-paper.
const HERO_TEXT = '#F1F5F9';
const HERO_TEXT_2 = 'rgba(241,245,249,0.72)';
const HERO_SKY = '#A8D8F0';

const heroStyles = StyleSheet.create({
  container: { height: HERO_HEIGHT, width: SCREEN_WIDTH },
  image: { ...StyleSheet.absoluteFillObject },
  topNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  topNavRight: { flexDirection: 'row', gap: 8 },
  frostedButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)',
    borderWidth: 1,
    borderColor: colors.line2,
  },
  titleBlock: {
    position: 'absolute',
    bottom: 20,
    left: 24,
    right: 24,
    gap: 8,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 38,
    fontWeight: '400',
    color: HERO_TEXT,
    letterSpacing: -1.2,
  },
  city: {
    fontFamily: fonts.serifItalic,
    fontSize: 20,
    fontStyle: 'italic',
    color: HERO_TEXT_2,
  },
});

const activityStyles = StyleSheet.create({
  row: {
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
  name: { fontSize: 15, fontWeight: '600', color: colors.paper },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.paper3 },
  luxuryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(168,216,240,0.12)',
    borderRadius: 999,
  },
  luxuryText: { fontSize: 10, fontWeight: '700', color: colors.skyBlue, letterSpacing: 0.4 },
  trailing: { alignItems: 'flex-end', gap: 4 },
});

const cardStyles = StyleSheet.create({
  container: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(63,121,186,0.35)',
    alignItems: 'center',
    gap: 14,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    fontWeight: '400',
    color: colors.paper,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  body: {
    fontSize: 13,
    color: colors.paper3,
    textAlign: 'center',
    lineHeight: 18,
  },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  costDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.skyBlue },
  costText: { fontSize: 13, fontWeight: '600', color: colors.skyBlue },
});

const hoursStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  day: { fontSize: 13, fontWeight: '500', color: colors.paper },
  time: { fontSize: 13, color: colors.paper2 },
  closed: { fontSize: 13, color: colors.destructive },
  empty: { fontSize: 13, color: colors.paper3 },
  divider: { height: 0.5, backgroundColor: colors.line, marginHorizontal: 16 },
});

const contactStyles = StyleSheet.create({
  container: {
    padding: 14,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { marginTop: 2 },
  text: { flex: 1, fontSize: 13, color: colors.paper },
});

const reviewStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  allButton: { fontSize: 12, fontWeight: '600', color: colors.blueMid },
  emptyCard: {
    padding: 24,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.line,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: { fontSize: 14, fontWeight: '500', color: colors.paper2 },
  list: { gap: 10 },
  card: {
    padding: 14,
    backgroundColor: colors.ink2,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.line,
    gap: 8,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stars: { flexDirection: 'row', gap: 2 },
  date: { fontSize: 11, color: colors.paper3 },
  comment: { fontSize: 13, color: colors.paper2, lineHeight: 19 },
});

const floatStyles = StyleSheet.create({
  container: { position: 'absolute', left: 20, right: 20 },
  scanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 18,
    backgroundColor: colors.blue,
    borderRadius: 16,
    shadowColor: colors.blue,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  scanText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  scanCost: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  bookBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: 'rgba(20,33,57,0.92)',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: colors.line2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  bookActivity: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.paper,
    marginTop: 2,
  },
  bookButton: {
    paddingHorizontal: 18,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
    borderRadius: 999,
    shadowColor: colors.blue,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  bookButtonText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});
