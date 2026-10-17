// Home below the Coach section (iOS HomeView's flat-ink list): the referral
// card, "A short walk from here", the Outside card slot, "Most Popular Now",
// and the spinner or the error state while there are no venues.
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import CuratedVenueRow from '../../components/CuratedVenueRow';
import NearbyVenueCard from '../../components/NearbyVenueCard';
import { EmptyState, Kicker, LPText } from '../../components/ui';
import { useT } from '../../i18n';
import { colors, hairline } from '../../theme';
import type { Venue } from '../../types/venue';

/** Refer a friend (iOS `HomeView.referralCard`): opens Account, where the referral row shares the link. */
export function ReferralCard({ onPress }: { onPress: () => void }) {
  const { t } = useT();
  const title = t('home.refer_title');
  const sub = t('home.refer_sub');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [styles.referral, pressed && styles.pressed]}
      testID="home.referral"
    >
      <View style={styles.giftTile}>
        <Ionicons name="gift" size={18} color={colors.rust2} />
      </View>
      <View style={styles.referralText}>
        <LPText size={15} weight="semibold" color={colors.paper}>
          {title}
        </LPText>
        <LPText size={12} color={colors.paper3}>
          {sub}
        </LPText>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.paper3} />
    </Pressable>
  );
}

function ShelfHeading({ kicker, heading }: { kicker: string; heading: string }) {
  return (
    <View style={styles.headingText}>
      <Kicker text={kicker} color={colors.paper3} />
      <LPText serif size={22} tracking={-0.4} color={colors.paper} accessibilityRole="header">
        {heading}
      </LPText>
    </View>
  );
}

type NearbyProps = {
  venues: readonly Venue[];
  onOpenVenue: (venue: Venue) => void;
  /** "All →": the Explore tab. */
  onSeeAll: () => void;
};

/** "A short walk from here" (iOS `HomeView.nearbyShelf`). Hidden by the caller when empty. */
export function NearbyShelf({ venues, onOpenVenue, onSeeAll }: NearbyProps) {
  const { t } = useT();
  const all = t('common.all');
  return (
    <View style={styles.shelf} testID="home.nearby">
      <View style={styles.shelfHeader}>
        <ShelfHeading kicker={t('home.near_you')} heading={t('home.near_you.heading')} />
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={all}
          hitSlop={8}
          style={({ pressed }) => [styles.allButton, pressed && styles.pressed]}
          testID="home.nearby.all"
        >
          <LPText size={12} weight="semibold" color={colors.paper2}>
            {all}
          </LPText>
          <Ionicons name="arrow-forward" size={10} color={colors.paper2} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cards}>
        {venues.map((venue) => (
          <Pressable
            key={venue.id}
            onPress={() => onOpenVenue(venue)}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
            testID={`home.nearby.${venue.slug}`}
          >
            <NearbyVenueCard venue={venue} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

type PopularProps = {
  venues: readonly Venue[];
  onOpenVenue: (venue: Venue) => void;
};

/** "Most Popular Now" (iOS `HomeView.popularShelf`). Hidden by the caller when empty. */
export function PopularShelf({ venues, onOpenVenue }: PopularProps) {
  const { t } = useT();
  return (
    <View style={styles.shelf} testID="home.popular">
      <View style={styles.shelfHeader}>
        <ShelfHeading kicker={t('home.popular')} heading={t('home.popular.heading')} />
      </View>
      <View style={styles.rows}>
        {venues.map((venue) => (
          <Pressable
            key={venue.id}
            onPress={() => onOpenVenue(venue)}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
            testID={`home.popular.${venue.slug}`}
          >
            <CuratedVenueRow venue={venue} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type StatusProps = {
  /** No venues yet and a load in flight: the spinner. */
  loading: boolean;
  /** No venues and the last load failed: the error state with a retry. */
  failed: boolean;
  onRetry: () => void;
};

/**
 * While the shelves have nothing to show (iOS: a rust spinner under the Coach
 * section, or the "couldn't load the venues" state with "Try again"). A
 * failure says so rather than leaving empty shelves that read as LifePass
 * having no venues.
 */
export function HomeVenuesStatus({ loading, failed, onRetry }: StatusProps) {
  const { t } = useT();
  if (loading) {
    return (
      <View style={styles.spinner} testID="home.venues.loading">
        <ActivityIndicator color={colors.rust} accessibilityLabel={t('a11y.loading')} />
      </View>
    );
  }
  if (failed) {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        message={t('venues.load_failed')}
        actionLabel={t('venue.try_again')}
        onAction={onRetry}
        actionIcon="retry"
        testID="home.venues.error"
      />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  referral: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.ink2,
    borderRadius: 14,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  giftTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.ink2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referralText: { flex: 1, gap: 3 },
  shelf: { gap: 14 },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 24,
  },
  headingText: { flexShrink: 1, gap: 4 },
  allButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  cards: { gap: 12, paddingHorizontal: 20 },
  rows: { gap: 10, paddingHorizontal: 20 },
  spinner: { alignItems: 'center', paddingTop: 40 },
  pressed: { opacity: 0.85 },
});
