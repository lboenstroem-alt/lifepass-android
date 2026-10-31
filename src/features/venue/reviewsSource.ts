/**
 * `GET /venues/{venueId}/reviews`, as the venue page reads it: the Android
 * port of iOS `VenueService.fetchVenueReviews` and its `VenueReviewsResponse`
 * (Services/VenueService.swift).
 *
 * Reviews are VENUE-2's feature (src/features/venue/reviews/**: the reviews
 * page, writing and reporting a review). The page itself only needs the rows
 * for its inline block, and loads them beside the walk-in preview the way
 * iOS's VenueDetailViewModel does; this file is the one place that reads
 * them, so moving onto a hook VENUE-2 publishes is a change here only.
 *
 * Decoded as iOS decodes it: `rows` is required and each row's `id`,
 * `venueId`, `rating`, `createdAt` and `reviewer.fullNameInitial` must be
 * there with the right type (else the read fails, and the page says so);
 * `comment` may be missing. The summary, `canWriteReview` and `ownReviewId`
 * are not read (iOS ignores them too). Keyed by the venue's UUID, never its
 * slug.
 */
import { apiGet, type RequestOptions } from '../../api/client';
import { parseIsoDate, wireId } from '../../api/wire';

/** A review as the page's inline block draws it (iOS `VenueReview`). */
export interface VenueReviewItem {
  readonly id: string;
  readonly venueId: string;
  /** 1 to 5. */
  readonly rating: number;
  /** Null when the member wrote none. */
  readonly comment: string | null;
  /** The reviewer's first initial (the API never names other members). */
  readonly authorInitial: string;
  readonly createdAt: Date;
}

/** Why the answer did not decode; the client turns it into a `DecodingError`. */
export class VenueReviewsDecodeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: expected ${expected}`);
    this.name = 'VenueReviewsDecodeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VenueReviewsDecodeError(path, 'an object');
  }
  return value as Json;
}

function string(json: Json, key: string, path: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw new VenueReviewsDecodeError(`${path}.${key}`, 'a string');
  return value;
}

function uuid(json: Json, key: string, path: string): string {
  const value = string(json, key, path);
  if (!UUID.test(value)) throw new VenueReviewsDecodeError(`${path}.${key}`, 'a UUID');
  return value.toLowerCase();
}

function decodeRow(raw: unknown, path: string): VenueReviewItem {
  const row = object(raw, path);
  const rating = row.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating)) {
    throw new VenueReviewsDecodeError(`${path}.rating`, 'an integer');
  }
  const comment = row.comment;
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    throw new VenueReviewsDecodeError(`${path}.comment`, 'a string');
  }
  const createdAt = parseIsoDate(string(row, 'createdAt', path));
  if (!createdAt) throw new VenueReviewsDecodeError(`${path}.createdAt`, 'an ISO-8601 date');
  const reviewer = object(row.reviewer, `${path}.reviewer`);
  return {
    id: uuid(row, 'id', path),
    venueId: uuid(row, 'venueId', path),
    rating,
    comment: typeof comment === 'string' ? comment : null,
    authorInitial: string(reviewer, 'fullNameInitial', `${path}.reviewer`),
    createdAt,
  };
}

/** The reviews answer's rows, in the server's order (newest first). */
export function decodeVenueReviews(raw: unknown): VenueReviewItem[] {
  const json = object(raw, 'reviews');
  if (!Array.isArray(json.rows)) throw new VenueReviewsDecodeError('reviews.rows', 'a list');
  return json.rows.map((row, index) => decodeRow(row, `reviews.rows[${index}]`));
}

/** `GET /venues/{venueId}/reviews`. */
export async function loadVenueReviews(
  venueId: string,
  options: Pick<RequestOptions, 'signal'> = {},
): Promise<VenueReviewItem[]> {
  return apiGet<VenueReviewItem[]>(`/venues/${wireId(venueId)}/reviews`, undefined, {
    ...options,
    decode: decodeVenueReviews,
  });
}
