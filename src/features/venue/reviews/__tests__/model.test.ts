/**
 * The reviews page's summary maths and the write sheet's rules, as iOS
 * ReviewsPageView and WriteReviewSheet compute them.
 */
import {
  averageText,
  canSubmitReview,
  characterCount,
  commentCounterText,
  commentLength,
  distributionRatio,
  isCommentTooShort,
  MIN_COMMENT_LENGTH,
  ratingStars,
  reviewDateText,
  reviewGuardKey,
  reviewSummary,
  summaryStars,
  trimComment,
} from '../model';

const rated = (...ratings: number[]) => ratings.map((rating) => ({ rating }));

describe('the summary', () => {
  it('is the mean of the loaded rows, with a bar per star', () => {
    const summary = reviewSummary(rated(5, 5, 4, 3, 5, 1))!;
    expect(summary.count).toBe(6);
    expect(summary.average).toBeCloseTo(23 / 6);
    expect(summary.distribution).toEqual({ 5: 3, 4: 1, 3: 1, 2: 0, 1: 1 });
    expect(distributionRatio(summary, 5)).toBe(0.5);
    expect(distributionRatio(summary, 2)).toBe(0);
  });

  it('is nothing with no rows (iOS draws no summary)', () => {
    expect(reviewSummary([])).toBeNull();
  });

  it('prints one decimal with a point in both languages, rounded as printf rounds', () => {
    expect(averageText(23 / 6)).toBe('3.8');
    expect(averageText(4.25)).toBe('4.2'); // an exact tie goes to even
    expect(averageText(4.75)).toBe('4.8');
    expect(averageText(5)).toBe('5.0');
  });

  it('draws half stars: full at i <= avg, half at i - 0.5 <= avg', () => {
    expect(summaryStars(4.5)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(summaryStars(4.4)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(summaryStars(3.6)).toEqual(['full', 'full', 'full', 'half', 'empty']);
    expect(summaryStars(1)).toEqual(['full', 'empty', 'empty', 'empty', 'empty']);
    expect(summaryStars(5)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });

  it('a card shows whole stars for its rating', () => {
    expect(ratingStars(3)).toEqual(['full', 'full', 'full', 'empty', 'empty']);
  });
});

describe('the comment', () => {
  const fifty = 'x'.repeat(MIN_COMMENT_LENGTH);

  it('is trimmed of whitespace and newlines at both ends, as Swift trims', () => {
    expect(trimComment('  \n\tGreat pool\u00A0\u2028 ')).toBe('Great pool');
    // A byte-order mark is not whitespace to Swift.
    expect(trimComment('\uFEFFhi')).toBe('\uFEFFhi');
    expect(trimComment('inner  space kept')).toBe('inner  space kept');
  });

  it('counts characters as Swift does (grapheme clusters, not UTF-16 units)', () => {
    expect(characterCount('e\u0301')).toBe(1);
    expect(characterCount('\u{1F44D}\u{1F3FD}')).toBe(1);
    expect(characterCount('Þórsmörk')).toBe(8);
  });

  it('is too short under 50 trimmed characters', () => {
    expect(isCommentTooShort(fifty)).toBe(false);
    expect(isCommentTooShort(`  ${'x'.repeat(49)}  `)).toBe(true);
    expect(isCommentTooShort(`${'x'.repeat(49)}\u{1F44D}\u{1F3FD}`)).toBe(false);
    expect(commentLength(`   ${fifty}\n\n`)).toBe(50);
  });

  it('shows the counter "{n}/50"', () => {
    expect(commentCounterText('  Lovely spa  ')).toBe('10/50');
    expect(commentCounterText('')).toBe('0/50');
  });
});

describe('Submit', () => {
  const ok = 'The pool was warm, the staff kind and the sauna spotless today.';

  it('is off with no rating, under 50 trimmed characters, or while sending', () => {
    expect(canSubmitReview(0, ok, false)).toBe(false);
    expect(canSubmitReview(4, 'Too short', false)).toBe(false);
    expect(canSubmitReview(4, ok, true)).toBe(false);
    expect(canSubmitReview(4, ok, false)).toBe(true);
  });

  it('guards the rating first, then the comment, with the iOS copy keys', () => {
    expect(reviewGuardKey(0, 'short')).toBe('venue.review_err_rating');
    expect(reviewGuardKey(3, 'short')).toBe('venue.review_err_comment');
    expect(reviewGuardKey(3, ok)).toBeNull();
  });
});

describe('dates', () => {
  it('writes the long date in the account language', () => {
    const date = new Date('2026-10-16T12:00:00Z');
    expect(reviewDateText(date, 'en')).toBe('16 October 2026');
    expect(reviewDateText(date, 'is')).toBe('16. október 2026');
    expect(reviewDateText(null, 'en')).toBe('');
  });
});
