/**
 * Venue reviews: the model the screens draw, and the rules iOS applies to it
 * (Services/VenueService.swift `VenueReview`, Views/Venues/VenueDetailView.swift
 * `ReviewsPageView` and `WriteReviewSheet`). Pure functions, so the maths and
 * the submit rules are tested without a screen.
 */
import Graphemer from 'graphemer';

import { formatDateTemplate, printfFixed } from '../../../i18n/format';
import type { Lang } from '../../../i18n';

/** A review as the screens consume it (iOS `VenueReview`, adapted from the API's `VenueReviewRow`). */
export interface VenueReview {
  readonly id: string;
  readonly venueId: string;
  /** 1 to 5. */
  readonly rating: number;
  readonly comment: string | null;
  /** The reviewer's first initial: the API's privacy shape, no name or id is shown. */
  readonly authorInitial: string;
  readonly createdAt: Date;
  /**
   * The reviewer's profile id, when the API sent one. Android only uses it
   * to keep "Report review" off the member's own review.
   */
  readonly reviewerProfileId: string | null;
}

// MARK: - The summary (ReviewsPageView.reviewSummary)

export type StarRating = 1 | 2 | 3 | 4 | 5;

/** Five to one, the order the distribution bars are drawn in. */
export const STARS_DESCENDING: readonly StarRating[] = [5, 4, 3, 2, 1];

export interface ReviewSummary {
  /** The plain mean of the loaded rows' ratings. */
  readonly average: number;
  readonly count: number;
  /** How many loaded rows gave each star. */
  readonly distribution: Readonly<Record<StarRating, number>>;
}

/**
 * The summary iOS computes on the phone from the rows it loaded (it ignores
 * the API's own `summary`); null with no rows, when iOS draws no summary.
 */
export function reviewSummary(reviews: readonly Pick<VenueReview, 'rating'>[]): ReviewSummary | null {
  if (reviews.length === 0) return null;
  const distribution: Record<StarRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const review of reviews) {
    total += review.rating;
    // iOS counts `reviews.filter { $0.rating == star }`: a rating outside
    // 1 to 5 joins the mean but no bar.
    if (review.rating >= 1 && review.rating <= 5 && Number.isInteger(review.rating)) {
      distribution[review.rating as StarRating] += 1;
    }
  }
  return { average: total / reviews.length, count: reviews.length, distribution };
}

/** A bar's fill, 0 to 1 (iOS `ratingBar`: count over all rows). */
export function distributionRatio(summary: ReviewSummary, star: StarRating): number {
  return summary.count === 0 ? 0 : summary.distribution[star] / summary.count;
}

/**
 * The average as iOS prints it, `String(format: "%.1f", avg)`: one decimal
 * with a POINT in both languages ("4.5"), rounded as printf rounds.
 */
export function averageText(average: number): string {
  return printfFixed(average, 1);
}

export type StarKind = 'full' | 'half' | 'empty';

/**
 * The summary's five stars for an average (iOS: star i is full when
 * i ≤ avg, half when i − 0.5 ≤ avg, else empty), so 4.5 is four and a half
 * and 4.4 is four.
 */
export function summaryStars(average: number): StarKind[] {
  return [1, 2, 3, 4, 5].map((i) => (i <= average ? 'full' : i - 0.5 <= average ? 'half' : 'empty'));
}

/** A card's five stars for a whole rating: the first `rating` are full. */
export function ratingStars(rating: number): StarKind[] {
  return [1, 2, 3, 4, 5].map((i) => (i <= rating ? 'full' : 'empty'));
}

// MARK: - Dates

/**
 * A review's date, as iOS `Text(date, style: .date)` writes it: the long
 * date, "16 October 2026" / "16. október 2026", on the phone's own calendar.
 * In the account language, as every LifePass date is (src/i18n/format.ts).
 */
export function reviewDateText(date: Date | null, lang: Lang): string {
  return date ? formatDateTemplate(date, 'dMMMMy', lang, 'phone') : '';
}

// MARK: - Writing a review (WriteReviewSheet)

/**
 * The server refuses a comment under 50 characters (CreateReviewInput
 * `minLength: 50`); iOS mirrors it so Submit can never fire a certain 400.
 */
export const MIN_COMMENT_LENGTH = 50;

/**
 * Swift's `.whitespacesAndNewlines`: Unicode space separators, the line and
 * paragraph separators, tab to carriage return, and NEL. Written out (not
 * `\s`, not `\p{Z}`) so it means the same on Hermes as in Jest; `\s` would
 * also strip a byte-order mark, which Swift keeps.
 */
const SPACE_CLASS = '[\\t-\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]';
const EDGE_SPACE = new RegExp(`^${SPACE_CLASS}+|${SPACE_CLASS}+$`, 'g');

/** The comment as it is sent: trimmed of whitespace and newlines at both ends. */
export function trimComment(comment: string): string {
  return comment.replace(EDGE_SPACE, '');
}

const graphemes = new Graphemer();

/**
 * How many characters a member sees, as Swift's `String.count` counts them:
 * grapheme clusters, so "é" typed as e plus an accent, or an emoji with a
 * skin tone, is one. (`.length` counts UTF-16 units; Hermes has no
 * Intl.Segmenter.)
 */
export function characterCount(text: string): number {
  return graphemes.countGraphemes(text);
}

/** The trimmed comment's length (what the counter and the 50 rule read). */
export function commentLength(comment: string): number {
  return characterCount(trimComment(comment));
}

/** Under 50 trimmed characters: Submit stays off and the counter shows. */
export function isCommentTooShort(comment: string): boolean {
  return commentLength(comment) < MIN_COMMENT_LENGTH;
}

/** "12/50", shown under the field while the comment is too short. */
export function commentCounterText(comment: string): string {
  return `${commentLength(comment)}/${MIN_COMMENT_LENGTH}`;
}

/** Submit is on with a rating and 50 or more trimmed characters, and nothing in flight. */
export function canSubmitReview(rating: number, comment: string, submitting: boolean): boolean {
  return rating > 0 && !isCommentTooShort(comment) && !submitting;
}

/**
 * The guard iOS runs before sending (WriteReviewSheet.submit): the copy key
 * of the first rule broken, or null when the review may go.
 */
export function reviewGuardKey(rating: number, comment: string): string | null {
  if (rating <= 0) return 'venue.review_err_rating';
  if (isCommentTooShort(comment)) return 'venue.review_err_comment';
  return null;
}
