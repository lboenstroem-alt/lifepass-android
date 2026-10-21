/**
 * The review calls (iOS VenueService.fetchVenueReviews / postReview, plus the
 * report Android adds for D5): what goes on the wire and how the answer is read.
 */
import { sampleResponse, withValue } from '@test/contract';
import { api, Reply } from '@test/server';

import { DecodingError } from '../../../../api';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../../../../api/testing';
import { decodeVenueReviews, fetchVenueReviews, postVenueReview, REPORT_REASONS, reportVenueReview } from '../api';

stubApiClientPerTest();

const VENUE = '3F2B8C1E-7D4A-4B6E-9C2F-1A2B3C4D5E6F';
const venue = VENUE.toLowerCase();
const REVIEW = 'bbbbbbbb-0000-4000-8000-000000000002';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: REVIEW,
  venueId: venue,
  rating: 4,
  title: null,
  comment: 'Warm pool, kind staff.',
  visitDate: '2026-10-01',
  isVerifiedVisit: true,
  createdAt: '2026-10-02T14:00:00.000Z',
  updatedAt: '2026-10-02T14:00:00.000Z',
  reviewer: { profileId: 'cccccccc-0000-4000-8000-000000000003', fullNameInitial: 'J', fullName: null },
  images: [],
  ...overrides,
});

describe('GET /venues/{venueId}/reviews', () => {
  it('reads the contract sample, every key, by the venue id in lower case', async () => {
    api.on('GET', '/venues/:venueId/reviews', replyFromContract('GET', `/venues/${venue}/reviews`, 200, 'full'));
    const page = await fetchVenueReviews(VENUE);
    expect(page.reviews.length).toBeGreaterThan(0);
    expect(page.reviews[0]).toMatchObject({ rating: expect.any(Number), authorInitial: expect.any(String) });
    expect(page.reviews[0].createdAt).toBeInstanceOf(Date);
    const sent = expectSentToMatchContract('GET', `/venues/${venue}/reviews`);
    expect(sent.query).toEqual({});
  });

  it('maps a row as iOS does, keeping the reviewer to an initial', () => {
    const page = decodeVenueReviews({ rows: [row()], ownReviewId: REVIEW.toUpperCase(), canWriteReview: false });
    expect(page.reviews[0]).toEqual({
      id: REVIEW,
      venueId: venue,
      rating: 4,
      comment: 'Warm pool, kind staff.',
      authorInitial: 'J',
      createdAt: new Date('2026-10-02T14:00:00.000Z'),
      reviewerProfileId: 'cccccccc-0000-4000-8000-000000000003',
    });
    expect(page.ownReviewId).toBe(REVIEW);
    expect(page.canWriteReview).toBe(false);
  });

  it('reads a missing comment, own review and write flag as absent', () => {
    const page = decodeVenueReviews({ rows: [row({ comment: null })] });
    expect(page.reviews[0].comment).toBeNull();
    expect(page.ownReviewId).toBeNull();
    expect(page.canWriteReview).toBeNull();
  });

  it('fails the read where the Swift DTO would (no rows, a bad date, no reviewer initial)', async () => {
    expect(() => decodeVenueReviews({})).toThrow();
    expect(() => decodeVenueReviews({ rows: [row({ createdAt: 'yesterday' })] })).toThrow();
    expect(() => decodeVenueReviews({ rows: [row({ reviewer: {} })] })).toThrow();
    expect(() => decodeVenueReviews({ rows: [row({ rating: '4' })] })).toThrow();
    const sample = sampleResponse('GET', `/venues/${venue}/reviews`, 200, 'full') as Record<string, unknown>;
    api.on('GET', '/venues/:venueId/reviews', Reply.ok(withValue(sample, 'rows', null)));
    await expect(fetchVenueReviews(VENUE)).rejects.toBeInstanceOf(DecodingError);
  });
});

describe('POST /venues/{venueId}/reviews', () => {
  it('sends the rating, the comment and today in UTC, with a fresh Idempotency-Key each time', async () => {
    api.on('POST', '/venues/:venueId/reviews', replyFromContract('POST', `/venues/${venue}/reviews`, 201));
    // 23:30 on 16 October in New York is already the 17th in Reykjavík (UTC).
    const now = new Date('2026-10-17T03:30:00Z');
    await postVenueReview(VENUE, { rating: 5, comment: 'A comment that is long enough to pass the fifty character rule.' }, now);
    const first = expectSentToMatchContract('POST', `/venues/${venue}/reviews`);
    expect(first.body).toEqual({
      rating: 5,
      comment: 'A comment that is long enough to pass the fifty character rule.',
      visitDate: '2026-10-17',
    });
    expect(Object.keys(first.body as object)).toEqual(['rating', 'comment', 'visitDate']);
    expect(first.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);

    await postVenueReview(VENUE, { rating: 5, comment: 'A comment that is long enough to pass the fifty character rule.' }, now);
    const second = expectSentToMatchContract('POST', `/venues/${venue}/reviews`);
    expect(second.headers['idempotency-key']).not.toBe(first.headers['idempotency-key']);
  });

  it('passes a refusal through for the sheet to word', async () => {
    api.on('POST', '/venues/:venueId/reviews', Reply.problem(409, 'review_exists'));
    await expect(postVenueReview(VENUE, { rating: 4, comment: 'x'.repeat(60) })).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('POST /venues/{venueId}/reviews/{reviewId}/report', () => {
  it.each(REPORT_REASONS)('sends the reason "%s" the contract allows', async (reason) => {
    api.on(
      'POST',
      '/venues/:venueId/reviews/:reviewId/report',
      replyFromContract('POST', `/venues/${venue}/reviews/${REVIEW}/report`),
    );
    await reportVenueReview(VENUE, REVIEW.toUpperCase(), reason);
    const sent = expectSentToMatchContract('POST', `/venues/${venue}/reviews/${REVIEW}/report`);
    expect(sent.body).toEqual({ reason });
  });

  it('reads whether the member had reported it before', async () => {
    api.on('POST', '/venues/:venueId/reviews/:reviewId/report', Reply.ok({ reported: true, alreadyReported: true }));
    await expect(reportVenueReview(VENUE, REVIEW, 'spam')).resolves.toEqual({ alreadyReported: true });
  });
});
