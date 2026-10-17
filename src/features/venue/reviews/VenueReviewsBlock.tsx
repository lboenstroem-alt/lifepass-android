/**
 * The reviews block at the foot of the venue page (iOS VenueDetailView
 * `reviewsBlock`), for VENUE-1 to mount:
 *
 *   <VenueReviewsBlock venueId={venue.id} venueName={venue.name} />
 *
 * - The serif title "Reviews" under the kicker "Nobody's reviewed yet" (no
 *   rows) or "From other members", and on the right "Write one" (no rows)
 *   or "See all".
 * - No rows: a quote card, "Be the first to review".
 * - Rows: the two latest cards (the API answers newest first).
 * Every action opens the reviews page (iOS opens ReviewsPageView as a sheet
 * from all three; the write sheet is reached from there).
 *
 * The rows come from the shared reviews store, so a review posted from the
 * write sheet shows here too. iOS never draws this block when the reviews
 * could not be read (the whole page fails); Android keeps the venue page on a
 * failed read (VENUE-1, `Promise.allSettled`), so the block says so and
 * offers a retry rather than claiming nobody has reviewed the venue.
 */
import { StyleSheet, Pressable, View } from 'react-native';

import { Kicker, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useAppNavigation } from '../../../navigation/hooks';
import { colors, hairline, radius } from '../../../theme';
import { QuoteGlyph, ReviewCard } from './components';
import { useVenueReviews } from './useVenueReviews';

export interface VenueReviewsBlockProps {
  readonly venueId: string;
  readonly venueName: string;
  /** Opens the reviews page; default pushes `VenueReviews` on this tab's stack. */
  readonly onOpenReviews?: () => void;
}

export default function VenueReviewsBlock({ venueId, venueName, onOpenReviews }: VenueReviewsBlockProps) {
  const { t } = useT();
  const navigation = useAppNavigation();
  const { reviews, loaded, status, reload } = useVenueReviews(venueId);
  const open = onOpenReviews ?? (() => navigation.navigate('VenueReviews', { venueId, venueName }));

  const failed = !loaded && status === 'failed';
  const empty = reviews.length === 0;
  const kicker = !loaded ? null : empty ? t('venue.review_empty') : t('venue.review_from');
  const action = !loaded ? null : empty ? t('venue.write_one') : t('common.see_all');

  return (
    <View style={styles.block} testID="venue-reviews-block">
      <View style={styles.header}>
        <View style={styles.title}>
          {kicker ? <Kicker text={kicker} color={colors.paper3} /> : null}
          <LPText serif size={22} tracking={-0.4} accessibilityRole="header">
            {t('venue.reviews')}
          </LPText>
        </View>
        {action ? (
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={action} hitSlop={12}>
            <LPText size={12} weight="semibold" color={colors.rust2}>
              {action}
            </LPText>
          </Pressable>
        ) : null}
      </View>

      {failed ? (
        <View style={styles.emptyCard}>
          <LPText size={14} color={colors.paper2} align="center">
            {t('common.error_body')}
          </LPText>
          <Pressable
            onPress={() => void reload()}
            accessibilityRole="button"
            accessibilityLabel={t('health.retry')}
            hitSlop={8}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          >
            <LPText size={13} weight="semibold">
              {t('health.retry')}
            </LPText>
          </Pressable>
        </View>
      ) : !loaded ? null : empty ? (
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t('venue.be_first')}
          style={({ pressed }) => [styles.emptyCard, pressed && styles.pressed]}
        >
          <QuoteGlyph size={24} />
          <LPText size={14} weight="medium" color={colors.paper2} align="center">
            {t('venue.be_first')}
          </LPText>
        </Pressable>
      ) : (
        <View style={styles.list}>
          {reviews.slice(0, 2).map((review) => (
            <ReviewCard key={review.id} review={review} compact />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1, gap: 4 },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  retry: {
    minHeight: 36,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.line2,
  },
  list: { gap: 10 },
  pressed: { opacity: 0.7 },
});
