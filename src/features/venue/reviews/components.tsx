/**
 * The pieces the review surfaces share, drawn as iOS draws them
 * (Views/Venues/VenueDetailView.swift: `reviewCardSmall`, `ReviewsPageView`
 * and its `writeReviewPrompt`, `reviewSummary`, `ratingBar`, `reviewCard`).
 *
 * TalkBack: iOS draws stars as SF Symbols, which VoiceOver reads by their
 * image names; here each row of stars is one element that says the rating
 * ("4 out of 5 stars"), and the decorative glyphs are hidden.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline, radius } from '../../../theme';
import SubRatings from '../components/SubRatings';
import {
  averageText,
  distributionRatio,
  ratingStars,
  reviewDateText,
  STARS_DESCENDING,
  summaryStars,
  type ReviewSummary,
  type StarKind,
  type StarRating,
  type VenueReview,
} from './model';

const STAR_ICON: Record<StarKind, keyof typeof Ionicons.glyphMap> = {
  full: 'star',
  half: 'star-half',
  empty: 'star-outline',
};

/** A row of five stars, spoken as one label. */
export function StarRow({
  kinds,
  size,
  label,
  color = colors.signal,
  testID,
}: {
  readonly kinds: readonly StarKind[];
  readonly size: number;
  readonly label: string;
  readonly color?: string;
  readonly testID?: string;
}) {
  return (
    <View style={styles.stars} accessible accessibilityRole="text" accessibilityLabel={label} testID={testID}>
      {kinds.map((kind, i) => (
        <Ionicons key={i} name={STAR_ICON[kind]} size={size} color={color} {...hiddenFromAccessibility} />
      ))}
    </View>
  );
}

/** iOS SF Symbol `quote.opening`. */
export function QuoteGlyph({ size }: { readonly size: number }) {
  return <MaterialCommunityIcons name="format-quote-open" size={size} color={colors.paper3} {...hiddenFromAccessibility} />;
}

/**
 * One review. `compact` is the venue page's card (iOS `reviewCardSmall`:
 * 11 pt stars, a 13 pt comment cut at four lines); otherwise the reviews
 * page's (`reviewCard`: 12 pt stars, the whole 14 pt comment, and a visit
 * rating's Equipment and Cleanliness stars when the member gave any, API
 * 0.46.0, as iOS draws them). `onReport` adds Android's "Report review"
 * button (owner decision D5).
 */
export function ReviewCard({
  review,
  compact = false,
  onReport,
}: {
  readonly review: VenueReview;
  readonly compact?: boolean;
  readonly onReport?: () => void;
}) {
  const { t, language } = useT();
  const date = reviewDateText(review.createdAt, language);
  return (
    <View style={[styles.card, compact ? styles.cardCompact : null]} testID={`review-${review.id}`}>
      <View style={styles.cardHeader}>
        <StarRow
          kinds={ratingStars(review.rating)}
          size={compact ? 11 : 12}
          label={t('venue2.a11y.rating', { count: review.rating })}
        />
        <View style={styles.cardHeaderEnd}>
          {date ? (
            <LPText size={11} color={colors.paper3}>
              {date}
            </LPText>
          ) : null}
          {onReport ? (
            <Pressable
              onPress={onReport}
              accessibilityRole="button"
              accessibilityLabel={t('venue2.report.action')}
              hitSlop={12}
              style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
              testID={`report-${review.id}`}
            >
              <Ionicons name="ellipsis-horizontal" size={14} color={colors.paper3} {...hiddenFromAccessibility} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {review.comment ? (
        <LPText
          size={compact ? 13 : 14}
          color={compact ? colors.paper2 : colors.paper}
          numberOfLines={compact ? 4 : undefined}
          style={compact ? styles.commentCompact : styles.comment}
        >
          {review.comment}
        </LPText>
      ) : null}
      {compact ? null : <ReviewSubStars review={review} />}
    </View>
  );
}

/** "Equipment ★ 4   Cleanliness ★ 5": a visit rating's sub-stars, each only when given. */
function ReviewSubStars({ review }: { readonly review: Pick<VenueReview, 'id' | 'equipmentRating' | 'cleanlinessRating'> }) {
  const { t } = useT();
  const parts = [
    review.equipmentRating !== null ? { key: 'equipment', label: t('venue.ratings.equipment'), value: review.equipmentRating } : null,
    review.cleanlinessRating !== null ? { key: 'cleanliness', label: t('venue.ratings.cleanliness'), value: review.cleanlinessRating } : null,
  ].filter((part): part is { key: string; label: string; value: number } => part !== null);
  if (parts.length === 0) return null;
  return (
    <View style={styles.subStars} testID={`review-${review.id}-substars`}>
      {parts.map((part) => (
        <View
          key={part.key}
          style={styles.subStar}
          accessible
          accessibilityRole="text"
          accessibilityLabel={t('venue.ratings.sub_value', { label: part.label, value: part.value })}
          testID={`review-${review.id}-${part.key}`}
        >
          <LPText size={11} weight="medium" color={colors.paper3}>
            {part.label}
          </LPText>
          <Ionicons name="star" size={9} color={colors.signal} {...hiddenFromAccessibility} />
          <LPText size={11} weight="medium" color={colors.paper3}>
            {String(part.value)}
          </LPText>
        </View>
      ))}
    </View>
  );
}

/** The reviews page's "Write a review" row (iOS `writeReviewPrompt`). */
export function WriteReviewPrompt({ venueName, onPress }: { readonly venueName: string; readonly onPress: () => void }) {
  const { t } = useT();
  const title = t('venue.write_review');
  const subtitle = t('venue.review_share_at', { name: venueName });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.prompt, pressed && styles.pressed]}
      testID="reviews-write-prompt"
    >
      <View style={styles.promptIcon} {...hiddenFromAccessibility}>
        <Ionicons name="create-outline" size={18} color={colors.rust2} />
      </View>
      <View style={styles.promptText}>
        <LPText size={15} weight="semibold">
          {title}
        </LPText>
        <LPText size={12} color={colors.paper3} numberOfLines={1}>
          {subtitle}
        </LPText>
      </View>
      <View style={styles.stars} {...hiddenFromAccessibility}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Ionicons key={i} name="star-outline" size={10} color={colors.paper4} />
        ))}
      </View>
    </Pressable>
  );
}

/**
 * The reviews page's summary card (iOS `reviewSummary` and `ratingBar`): the
 * average with its stars and "23 ratings" (every rating since API 0.46.0, a
 * quick visit rating included; an older server's rows read "12 reviews"), the
 * Equipment and Cleanliness averages when the server sends them, and a bar per
 * star.
 */
export function ReviewSummaryCard({ summary }: { readonly summary: ReviewSummary }) {
  const { t, tp, language } = useT();
  const average = averageText(summary.average, language);
  const count =
    summary.counts === 'ratings'
      ? tp('venue.ratings.count', summary.count)
      : summary.count === 1
        ? t('venue.reviews_one')
        : t('venue.reviews_many', { count: summary.count });
  return (
    <View style={styles.summary} testID="reviews-summary">
      <View style={styles.summaryLeft}>
        {/* Said once, by the stars below, with its meaning. */}
        <LPText serif size={36} tracking={-1} {...hiddenFromAccessibility} testID="reviews-summary-average">
          {average}
        </LPText>
        <StarRow kinds={summaryStars(summary.average)} size={12} label={t('venue2.a11y.average', { average })} />
        <LPText size={11} color={colors.paper3} testID="reviews-summary-count">
          {count}
        </LPText>
        <SubRatings
          equipment={summary.equipment}
          cleanliness={summary.cleanliness}
          align="center"
          style={styles.subRatings}
          testID="reviews-summary-subratings"
        />
      </View>
      <View style={styles.bars}>
        {STARS_DESCENDING.map((star) => (
          <RatingBar key={star} star={star} summary={summary} />
        ))}
      </View>
    </View>
  );
}

function RatingBar({ star, summary }: { readonly star: StarRating; readonly summary: ReviewSummary }) {
  const { t } = useT();
  const count = summary.distribution[star];
  const ratio = distributionRatio(summary, star);
  return (
    <View
      style={styles.barRow}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('venue2.a11y.distribution', { star, count })}
      testID={`reviews-bar-${star}`}
    >
      <LPText size={11} weight="medium" color={colors.paper3} style={styles.barStar}>
        {String(star)}
      </LPText>
      <Ionicons name="star" size={8} color={colors.signal} />
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${ratio * 100}%` }]} testID={`reviews-bar-fill-${star}`} />
      </View>
      <LPText size={11} color={colors.paper3} style={styles.barCount}>
        {String(count)}
      </LPText>
    </View>
  );
}

/**
 * The bar across the top of the reviews page and the write sheet: an inline
 * title with one text button, as iOS's navigation bar (`Done` trailing on the
 * reviews page, `Cancel` leading on the write sheet).
 */
export function ReviewsHeader({
  title,
  action,
  actionSide,
  actionColor = colors.paper,
  onAction,
}: {
  readonly title: string;
  readonly action: string;
  readonly actionSide: 'leading' | 'trailing';
  readonly actionColor?: string;
  readonly onAction: () => void;
}) {
  const insets = useSafeAreaInsets();
  const button = (
    <Pressable
      onPress={onAction}
      accessibilityRole="button"
      accessibilityLabel={action}
      hitSlop={8}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <LPText size={17} color={actionColor} numberOfLines={1}>
        {action}
      </LPText>
    </Pressable>
  );
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <View style={[styles.headerSide, styles.headerLeading]}>{actionSide === 'leading' ? button : null}</View>
        <LPText size={17} weight="semibold" align="center" numberOfLines={1} accessibilityRole="header" style={styles.headerTitle}>
          {title}
        </LPText>
        <View style={[styles.headerSide, styles.headerTrailing]}>{actionSide === 'trailing' ? button : null}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pressed: { opacity: 0.7 },

  card: {
    padding: 14,
    gap: 8,
    backgroundColor: colors.ink2,
    borderRadius: radius.field,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  cardCompact: {},
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardHeaderEnd: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  subStars: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  subStar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reportButton: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  // iOS lineSpacing 2 and 3 over the face's own line height.
  commentCompact: { lineHeight: 19 },
  comment: { lineHeight: 21 },

  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  promptIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.rust3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptText: { flex: 1, gap: 2 },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    backgroundColor: colors.ink2,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.line,
  },
  summaryLeft: { alignItems: 'center', gap: 6, flexShrink: 1 },
  subRatings: { marginTop: 4 },
  bars: { flex: 1, maxWidth: 180, marginLeft: 'auto', gap: 5 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barStar: { width: 10 },
  barTrack: { flex: 1, height: 6, borderRadius: 2, backgroundColor: colors.ink3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 2, backgroundColor: colors.signal },
  barCount: { width: 16 },

  header: { backgroundColor: colors.ink, borderBottomWidth: hairline, borderBottomColor: colors.line },
  headerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  // Room for "Hætta við" at a large font scale; the title takes what is left.
  headerSide: { minWidth: 88, maxWidth: '40%', flexShrink: 0 },
  headerLeading: { alignItems: 'flex-start' },
  headerTrailing: { alignItems: 'flex-end' },
  headerTitle: { flex: 1 },
  headerButton: { minHeight: 44, justifyContent: 'center' },
});
