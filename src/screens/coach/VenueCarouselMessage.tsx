/* eslint lifepass/no-literal-copy: "error" */
// Venue cards in the chat (iOS CoachView.swift `VenueCarouselView` and
// `VenueMiniCard`): the wizard's results and the model's resolved venue
// documents, as real venue rows. Each card has the venue's photo with a
// favourite heart, its name, "city · address", the price pill and "Book it",
// which opens the venue's page BY SLUG. The first build's "Other Ideas"
// button and category pill are gone (iOS has neither).
//
// `VenueMiniCard` is exported for the day plan's venue steps (COACH-3), which
// pass a `detailLine` (the step's distance) and their own width.
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import PricePill from '../../components/PricePill';
import { LPText, VenueImage } from '../../components/ui';
import { useFavourite } from '../../features/favourites';
import { coachPalette } from '../../features/coach/theme/palette';
import { useT } from '../../i18n';
import type { Venue } from '../../types/venue';
import { AssistantText } from './MessageBubble';

type Props = {
  intro: string;
  venues: readonly Venue[];
  onBook: (venue: Venue) => void;
  /** The intro is the model's own words: it offers "Report this reply" (./MessageBubble.tsx). */
  onReport?: () => void;
};

export default function VenueCarouselMessage({ intro, venues, onBook, onReport }: Props) {
  return (
    <View style={styles.root}>
      <AssistantText text={intro} onReport={onReport} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {venues.map((venue) => (
          <VenueMiniCard key={venue.id} venue={venue} onBook={onBook} />
        ))}
      </ScrollView>
    </View>
  );
}

/** "city · address", or nothing when the venue has neither (iOS `locationText`). */
export function venueLocationLine(venue: Pick<Venue, 'city' | 'address'>): string | null {
  const parts = [venue.city, venue.address].filter((part): part is string => !!part && part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}

type FavouriteToggle = (options?: { readonly alert?: boolean }) => Promise<void>;

export function VenueMiniCard({
  venue,
  onBook,
  detailLine,
  width = 220,
}: {
  venue: Venue;
  onBook: (venue: Venue) => void;
  /** An extra line under the location, e.g. a plan step's distance. */
  detailLine?: string | null;
  width?: number;
}) {
  const { t } = useT();
  const heart = useFavourite(venue.id);
  const location = venueLocationLine(venue);
  // The Coach's cards revert a failed heart silently, as iOS does (no
  // "Heads up" alert): VENUE-2's toggle takes `{ alert: false }` for that.
  const toggleHeart = () => {
    void (heart.toggle as FavouriteToggle)({ alert: false });
  };

  return (
    <View style={[styles.card, { width }]} testID={`coach.venue.${venue.slug}`}>
      <View>
        <VenueImage uri={venue.imageUrl} height={110} recyclingKey={venue.id} style={{ width }} />
        <Pressable
          onPress={toggleHeart}
          style={styles.heart}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t(heart.isFavourite ? 'coach.android.a11y.unfavourite' : 'coach.android.a11y.favourite')}
          accessibilityState={{ selected: heart.isFavourite }}
          testID={`coach.venue.${venue.slug}.heart`}
        >
          <Ionicons
            name={heart.isFavourite ? 'heart' : 'heart-outline'}
            size={16}
            color={heart.isFavourite ? coachPalette.accent : '#FFFFFF'}
          />
        </Pressable>
      </View>

      <View style={styles.info}>
        <LPText size={14} weight="semibold" color="#FFFFFF" numberOfLines={1}>
          {venue.name}
        </LPText>
        {location ? (
          <LPText size={12} color={coachPalette.textMeta} numberOfLines={1}>
            {location}
          </LPText>
        ) : null}
        {detailLine ? (
          <LPText size={12} weight="medium" color={coachPalette.textSecondary} numberOfLines={1}>
            {detailLine}
          </LPText>
        ) : null}
        <View style={styles.pill}>
          <PricePill venue={venue} compact />
        </View>
      </View>

      <Pressable
        onPress={() => onBook(venue)}
        style={({ pressed }) => [styles.book, pressed && styles.bookPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${t('coach.venue.book_it')}, ${venue.name}`}
        testID={`coach.venue.${venue.slug}.book`}
      >
        <LPText size={13} weight="semibold" color="#FFFFFF">
          {t('coach.venue.book_it')}
        </LPText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, alignSelf: 'stretch' },
  cards: { gap: 12, paddingVertical: 2 },
  card: {
    backgroundColor: coachPalette.tile,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: coachPalette.glassStroke,
    overflow: 'hidden',
  },
  heart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, gap: 4, alignItems: 'flex-start' },
  pill: { marginTop: 2 },
  book: {
    marginHorizontal: 10,
    marginBottom: 10,
    paddingVertical: 9,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: coachPalette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookPressed: { opacity: 0.85 },
});
