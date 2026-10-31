/* eslint lifepass/no-literal-copy: "error" */
// The reviews at the foot of the venue page (iOS VenueDetailView
// `reviewsBlock` and `reviewCardSmall`): "Reviews", with "Nobody's reviewed
// yet" or "From other members" above it and "Write one" or "See all" beside
// it; a "Be the first to review" card when there are none, else the two
// newest. Every action opens the reviews page (VENUE-2's `VenueReviews`),
// where a review is read in full and written.
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { venueDate } from '../../../i18n/format';
import { useT } from '../../../i18n';
import { colors, radius } from '../../../theme';
import type { VenueReviewItem } from '../reviewsSource';
import { SectionTitle } from './shared';

/** How many reviews the page shows before "See all". */
export const INLINE_REVIEWS = 2;

export default function ReviewsBlock({
  reviews,
  onOpenReviews,
}: {
  readonly reviews: readonly VenueReviewItem[];
  readonly onOpenReviews: () => void;
}) {
  const { t } = useT();
  const empty = reviews.length === 0;
  const action = empty ? t('venue.write_one') : t('common.see_all');
  return (
    <View style={styles.block} testID="venue.reviews">
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <SectionTitle title={t('venue.reviews')} kicker={empty ? t('venue.review_empty') : t('venue.review_from')} />
        </View>
        <Pressable onPress={onOpenReviews} accessibilityRole="button" accessibilityLabel={action} hitSlop={10}>
          <LPText size={12} weight="semibold" color={colors.rust2}>
            {action}
          </LPText>
        </Pressable>
      </View>

      {empty ? (
        <Pressable
          onPress={onOpenReviews}
          accessibilityRole="button"
          accessibilityLabel={t('venue.be_first')}
          style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="format-quote-open" size={28} color={colors.paper3} />
          <LPText size={14} weight="medium" color={colors.paper2} align="center">
            {t('venue.be_first')}
          </LPText>
        </Pressable>
      ) : (
        <View style={styles.cards}>
          {reviews.slice(0, INLINE_REVIEWS).map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </View>
      )}
    </View>
  );
}

function ReviewCard({ review }: { readonly review: VenueReviewItem }) {
  const { language } = useT();
  const date = venueDate(review.createdAt, language);
  return (
    <View style={styles.card} testID={`venue.review.${review.id}`}>
      <View style={styles.cardTop}>
        <View style={styles.stars} accessible accessibilityLabel={`${review.rating}/5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons key={i} name={i <= review.rating ? 'star' : 'star-outline'} size={12} color={colors.signal} />
          ))}
        </View>
        {date ? (
          <LPText size={11} color={colors.paper3}>
            {date}
          </LPText>
        ) : null}
      </View>
      {review.comment ? (
        <LPText size={13} color={colors.paper2} numberOfLines={4} style={styles.comment}>
          {review.comment}
        </LPText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerTitle: { flexShrink: 1 },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  cards: { gap: 10 },
  card: {
    gap: 8,
    padding: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: 0.5,
    borderColor: colors.line,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stars: { flexDirection: 'row', gap: 2 },
  comment: { lineHeight: 18 },
  pressed: { opacity: 0.7 },
});
