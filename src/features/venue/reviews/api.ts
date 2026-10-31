/**
 * Venue reviews over the LifePass API: the Android port of iOS
 * `VenueService.fetchVenueReviews` / `postReview` (Services/VenueService.swift),
 * plus the report call iOS does not have yet (owner decision D5: Play's
 * user-generated content policy asks for one).
 *
 *   GET  /venues/{venueId}/reviews                       the first page, newest first
 *   POST /venues/{venueId}/reviews                       { rating, comment, visitDate }
 *   POST /venues/{venueId}/reviews/{reviewId}/report     { reason }
 *
 * Reviews are keyed by the venue's id, never its slug.
 *
 * THE READ. iOS reads the first page only and maps each row to its
 * `VenueReview`; it ignores the API's `summary`, `canWriteReview` and
 * `ownReviewId` (the page computes its own summary from the rows). Android
 * keeps `ownReviewId` for one thing only: "Report review" is never offered on
 * the member's own review. The decode follows the Swift DTO: `rows` is
 * required, and each row's `id`, `venueId`, `rating`, `createdAt` and
 * `reviewer.fullNameInitial` are required; `comment` may be missing or null.
 *
 * THE WRITE. The author comes from the bearer token; the body is just the
 * rating, the trimmed comment and the visit date (`yyyy-MM-dd`, today in UTC,
 * which is Reykjavík time). Every submit carries a new Idempotency-Key, as
 * iOS mints `UUID()` per call.
 */
import { apiGet, apiPost, newIdempotencyKey, parseIsoDate, wireId, type RequestOptions } from '../../../api';
import { todayServerDay } from '../../../i18n/format';
import type { VenueReview } from './model';

/** One read of a venue's reviews. */
export interface VenueReviewsPage {
  readonly reviews: readonly VenueReview[];
  /** The member's own review at this venue, when they wrote one. */
  readonly ownReviewId: string | null;
  /** The server's say on whether the member may write one (iOS reads it but does not act on it). */
  readonly canWriteReview: boolean | null;
}

/** What a member can say is wrong with a review (ReviewReportInput.reason). */
export const REPORT_REASONS = ['offensive', 'personal_information', 'not_genuine', 'spam', 'other'] as const;
export type ReviewReportReason = (typeof REPORT_REASONS)[number];

export interface ReviewReportResult {
  /** True when this member had reported the review before (nothing changed). */
  readonly alreadyReported: boolean;
}

type CallOptions = Pick<RequestOptions, 'signal'>;

const reviewsPath = (venueId: string) => `/venues/${encodeURIComponent(wireId(venueId))}/reviews`;

/** `GET /venues/{venueId}/reviews`. */
export function fetchVenueReviews(venueId: string, options: CallOptions = {}): Promise<VenueReviewsPage> {
  return apiGet<VenueReviewsPage>(reviewsPath(venueId), undefined, { ...options, decode: decodeVenueReviews });
}

export interface NewReview {
  readonly rating: number;
  /** Already trimmed (model.ts `trimComment`). */
  readonly comment: string;
  /** `yyyy-MM-dd`; default today in UTC, as iOS sends. */
  readonly visitDate?: string;
}

/** `POST /venues/{venueId}/reviews` with a fresh Idempotency-Key. */
export async function postVenueReview(venueId: string, review: NewReview, now: Date = new Date()): Promise<void> {
  await apiPost(
    reviewsPath(venueId),
    { rating: review.rating, comment: review.comment, visitDate: review.visitDate ?? todayServerDay(now) },
    { idempotencyKey: newIdempotencyKey() },
  );
}

/** `POST /venues/{venueId}/reviews/{reviewId}/report`. */
export function reportVenueReview(
  venueId: string,
  reviewId: string,
  reason: ReviewReportReason,
): Promise<ReviewReportResult> {
  return apiPost<ReviewReportResult>(
    `${reviewsPath(venueId)}/${encodeURIComponent(wireId(reviewId))}/report`,
    { reason },
    { decode: decodeReportResult },
  );
}

// MARK: - Decoding

/** Why a reviews answer did not decode; the client turns it into a `DecodingError`. */
export class ReviewsDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'ReviewsDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReviewsDecodeError(path, 'an object');
  }
  return value as Json;
}

function present(json: Json, key: string): unknown {
  const value = json[key];
  return value === null ? undefined : value;
}

function requiredString(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new ReviewsDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function requiredId(json: Json, key: string, path: string): string {
  const value = requiredString(json, key, path);
  if (!UUID.test(value)) throw new ReviewsDecodeError(`${path}.${key}`, 'a UUID');
  return value.toLowerCase();
}

function optionalId(json: Json, key: string, path: string): string | null {
  if (present(json, key) === undefined) return null;
  return requiredId(json, key, path);
}

function optionalString(json: Json, key: string, path: string): string | null {
  const value = present(json, key);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new ReviewsDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function requiredInteger(json: Json, key: string, path: string): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ReviewsDecodeError(`${path}.${key}`, 'a whole number');
  return value;
}

function decodeRow(value: unknown, path: string): VenueReview {
  const json = object(value, path);
  const createdAt = parseIsoDate(requiredString(json, 'createdAt', path));
  if (!createdAt) throw new ReviewsDecodeError(`${path}.createdAt`, 'an ISO-8601 date');
  const reviewer = object(json.reviewer, `${path}.reviewer`);
  return {
    id: requiredId(json, 'id', path),
    venueId: requiredId(json, 'venueId', path),
    rating: requiredInteger(json, 'rating', path),
    comment: optionalString(json, 'comment', path),
    authorInitial: requiredString(reviewer, 'fullNameInitial', `${path}.reviewer`),
    createdAt,
    // Not in the iOS DTO; read softly, since it only hides a menu item.
    reviewerProfileId: typeof reviewer.profileId === 'string' && UUID.test(reviewer.profileId)
      ? reviewer.profileId.toLowerCase()
      : null,
  };
}

/** The `data` of `GET /venues/{venueId}/reviews`. */
export function decodeVenueReviews(data: unknown): VenueReviewsPage {
  const json = object(data, 'reviews');
  const rows = json.rows;
  if (!Array.isArray(rows)) throw new ReviewsDecodeError('reviews.rows', 'a list');
  const canWrite = present(json, 'canWriteReview');
  if (canWrite !== undefined && typeof canWrite !== 'boolean') {
    throw new ReviewsDecodeError('reviews.canWriteReview', 'a boolean');
  }
  return {
    reviews: rows.map((row, i) => decodeRow(row, `reviews.rows[${i}]`)),
    ownReviewId: optionalId(json, 'ownReviewId', 'reviews'),
    canWriteReview: canWrite === undefined ? null : canWrite,
  };
}

function decodeReportResult(data: unknown): ReviewReportResult {
  const json = object(data, 'report');
  return { alreadyReported: json.alreadyReported === true };
}
