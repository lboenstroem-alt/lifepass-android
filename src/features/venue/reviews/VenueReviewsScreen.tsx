/**
 * Route `VenueReviews` ({ venueId, venueName }): all of a venue's reviews,
 * the Android port of iOS `ReviewsPageView` (Views/Venues/VenueDetailView.swift).
 *
 * iOS opens it as a sheet from the venue page (the meta row, "Write one",
 * "See all", the empty quote card). Here it is a shared route pushed on the
 * tab's stack (plan 3.0.2); its bar keeps the iOS sheet's words: the inline
 * title "Reviews" and "Done", which closes it, as hardware back does.
 *
 *   - "Write a review", "Share your experience at {name}", always first; it
 *     opens the write sheet (root modal `WriteReview`).
 *   - No reviews: a quote, "No reviews yet" and "Share your experience to
 *     help other visitors discover {name}."
 *   - Otherwise the summary iOS computes from the loaded rows (the average to
 *     one decimal with half stars, "1 review" / "{count} reviews", bars from
 *     5 to 1), then every card.
 *   - Android adds "Report review" on each card but the member's own (D5).
 *
 * The rows are the venue page's (the shared reviews store), so nothing is
 * read again when the page opens; a review posted from the write sheet
 * reloads them and this page shows it. Opened with no rows yet (a link, or
 * a venue page whose read failed), it reads them itself, with a spinner and
 * a retry.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import type { SharedRouteProps } from '../../../navigation/types';
import { useAppStore } from '../../../stores/appStore';
import { colors } from '../../../theme';
import { QuoteGlyph, ReviewCard, ReviewSummaryCard, ReviewsHeader, WriteReviewPrompt } from './components';
import { reviewSummary, type VenueReview } from './model';
import { openReportReview } from './report';
import { useVenueReviews } from './useVenueReviews';

/** True when `review` is the member's own: never offered for reporting (the server refuses it). */
export function isOwnReview(review: VenueReview, ownReviewId: string | null, memberId: string | null): boolean {
  if (ownReviewId && review.id === ownReviewId.toLowerCase()) return true;
  return !!memberId && review.reviewerProfileId === memberId.toLowerCase();
}

export default function VenueReviewsScreen({ navigation, route }: SharedRouteProps<'VenueReviews'>) {
  const { venueId, venueName } = route.params;
  const { t } = useT();
  const insets = useSafeAreaInsets();
  // The tab bar floats over the page; outside the tabs (the shared sheet) it is the system bar.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? insets.bottom;
  const memberId = useAppStore((s) => s.userId);
  const { reviews, loaded, status, ownReviewId, reload } = useVenueReviews(venueId);
  const summary = useMemo(() => reviewSummary(reviews), [reviews]);

  const writeReview = () => navigation.navigate('WriteReview', { venueId, venueName });

  return (
    <View style={styles.page} testID="venue-reviews-screen">
      <ReviewsHeader
        title={t('venue.reviews')}
        action={t('common.done')}
        actionSide="trailing"
        onAction={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + tabBarHeight }]}>
        <WriteReviewPrompt venueName={venueName} onPress={writeReview} />

        {!loaded ? (
          status === 'failed' ? (
            <ErrorState onRetry={() => void reload()} testID="venue-reviews-error" />
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.rust} accessibilityLabel={t('venue.reviews')} />
            </View>
          )
        ) : summary === null ? (
          <View style={styles.empty} testID="venue-reviews-empty">
            <QuoteGlyph size={44} />
            <LPText serif size={20} align="center">
              {t('venue.no_reviews')}
            </LPText>
            <LPText size={14} color={colors.paper3} align="center">
              {t('venue.review_share_body', { name: venueName })}
            </LPText>
          </View>
        ) : (
          <>
            <ReviewSummaryCard summary={summary} />
            <View style={styles.list}>
              {reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  onReport={
                    isOwnReview(review, ownReviewId, memberId) ? undefined : () => openReportReview(venueId, review.id)
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { padding: 16, gap: 20 },
  loading: { paddingVertical: 32, alignItems: 'center' },
  empty: { padding: 32, gap: 12, alignItems: 'center' },
  list: { gap: 12 },
});
