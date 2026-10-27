/**
 * "How was your visit?" on the wire (API 0.46.0, docs/05 "Visit ratings
 * ("How was your visit?") and the App Store ask"):
 *
 *   ratingPrompt / lifetimeCheckIns        on POST /check-ins/walk-in and on a walk-in
 *                                          fulfilled by POST /bookings/payment-sessions/confirm
 *   GET  /visit-rating-prompts/current     the ask that is due now, or null
 *   POST /visit-rating-prompts/{id}/answer the stars (Idempotency-Key)
 *   POST /visit-rating-prompts/{id}/dismiss "Not now"
 *
 * THE SERVER DECIDES WHEN TO ASK (at most once a member in 30 days, never a
 * venue twice in 90, only real visits). The app schedules what the check-in
 * reserved and shows what `current` returns; it never decides any of it.
 *
 * WHAT IS FAIL-SOFT. Everything a check-in answer adds is read after the
 * check-in committed, so `ratingPrompt` and `lifetimeCheckIns` never cost the
 * member the receipt: anything unreadable is null. An accepted answer (200)
 * is never turned into "Couldn't send your rating": the rating is saved
 * whatever the body says, so its flags are read leniently too. Only the ask
 * that `current` returns is read strictly, and its caller drops a malformed
 * one (no card) rather than show a broken one.
 */
import { NotAuthenticatedError, ProblemError, TransportError, isApiError, type ApiError } from './errors';
import { apiGet, apiPost } from './client';
import { parseIsoDate, wireId } from './wire';

// ---------------------------------------------------------------------------
// Types

/** The ask a check-in reserved (`ratingPrompt`): enough to schedule the notification. */
export interface VisitRatingReservation {
  readonly id: string;
  readonly venueId: string;
  readonly venueName: string;
  /** The check-in plus an hour: when the notification fires. */
  readonly dueAt: Date;
  /** Three days after `dueAt`: the ask lapses. */
  readonly expiresAt: Date;
}

/** The ask as `current`, the answer and the dismiss return it. */
export interface VisitRatingPrompt {
  readonly id: string;
  readonly venueId: string;
  readonly venueName: string;
  /** For "Write a public review" (the venue's page). Null when the server sent none. */
  readonly venueSlug: string | null;
  readonly checkedInAt: Date | null;
  readonly dueAt: Date | null;
  readonly expiresAt: Date | null;
  readonly shownAt: Date | null;
  readonly answeredAt: Date | null;
  readonly dismissedAt: Date | null;
  /**
   * The member already wrote a review of this venue: the sheet hides the
   * comment (an answer changes that review's stars, never its words) and
   * shows the replace note instead.
   */
  readonly hasWrittenReview: boolean;
}

/** The stars, 1 to 5. */
export type Stars = 1 | 2 | 3 | 4 | 5;

/** What Send posts (the body is strict on the server: only these keys). */
export interface VisitRatingAnswerInput {
  readonly rating: Stars;
  readonly equipmentRating: Stars | null;
  readonly cleanlinessRating: Stars | null;
  /** Trimmed by the server; empty or null is no comment. Left out with a written review. */
  readonly comment: string | null;
}

/** The answer's facts for the thank-you (read leniently, see the file comment). */
export interface VisitRatingAnswerResult {
  /** The ask, now answered; null when the body could not be read. */
  readonly prompt: VisitRatingPrompt | null;
  /** 4 or 5 stars: one of the moments to ask for a Google Play rating. */
  readonly happyMoment: boolean;
  /** The member's row is a written review: no "Write a public review". */
  readonly hasWrittenReview: boolean;
}

/** The comment's ceiling, after trimming (the server's `QUICK_COMMENT_MAX_LENGTH`). */
export const VISIT_RATING_COMMENT_MAX = 500;

// ---------------------------------------------------------------------------
// Decoding

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? wireId(value) : null;
}

function nameOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function dateOrNull(value: unknown): Date | null {
  return typeof value === 'string' ? parseIsoDate(value) : null;
}

/**
 * `ratingPrompt` on a check-in answer, FAIL-SOFT: null when absent, null, or
 * anything this build cannot schedule (no id, no venue name, an unreadable
 * date). The check-in stands whatever this says.
 */
export function readRatingPrompt(value: unknown): VisitRatingReservation | null {
  if (!isObject(value)) return null;
  const id = uuidOrNull(value.id);
  const venueId = uuidOrNull(value.venueId);
  const venueName = nameOrNull(value.venueName);
  const dueAt = dateOrNull(value.dueAt);
  const expiresAt = dateOrNull(value.expiresAt);
  if (!id || !venueId || !venueName || !dueAt || !expiresAt) return null;
  return { id, venueId, venueName, dueAt, expiresAt };
}

/** `lifetimeCheckIns` (on a check-in answer and on GET /profile), FAIL-SOFT: a whole number from 0, else null. */
export function readLifetimeCheckIns(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Why an ask did not decode (the client turns it into a `DecodingError`). */
export class VisitRatingDecodeError extends Error {
  constructor(path: string) {
    super(`visit rating: unreadable ${path}`);
    this.name = 'VisitRatingDecodeError';
  }
}

/**
 * The ask, strictly where the card needs it (its id, the venue's id and
 * name): an ask without them cannot be shown or answered. The dates and
 * the slug are read softly; `hasWrittenReview` is false unless it says true.
 */
export function decodeVisitRatingPrompt(value: unknown): VisitRatingPrompt {
  if (!isObject(value)) throw new VisitRatingDecodeError('prompt');
  const id = uuidOrNull(value.id);
  if (!id) throw new VisitRatingDecodeError('prompt.id');
  const venueId = uuidOrNull(value.venueId);
  if (!venueId) throw new VisitRatingDecodeError('prompt.venueId');
  const venueName = nameOrNull(value.venueName);
  if (!venueName) throw new VisitRatingDecodeError('prompt.venueName');
  return {
    id,
    venueId,
    venueName,
    venueSlug: nameOrNull(value.venueSlug),
    checkedInAt: dateOrNull(value.checkedInAt),
    dueAt: dateOrNull(value.dueAt),
    expiresAt: dateOrNull(value.expiresAt),
    shownAt: dateOrNull(value.shownAt),
    answeredAt: dateOrNull(value.answeredAt),
    dismissedAt: dateOrNull(value.dismissedAt),
    hasWrittenReview: value.hasWrittenReview === true,
  };
}

/** `GET /visit-rating-prompts/current`'s `data`: `{ prompt }`, the ask or null. */
export function decodeCurrentVisitRatingPrompt(data: unknown): VisitRatingPrompt | null {
  if (!isObject(data)) throw new VisitRatingDecodeError('data');
  if (data.prompt === null || data.prompt === undefined) return null;
  return decodeVisitRatingPrompt(data.prompt);
}

function promptOrNull(value: unknown): VisitRatingPrompt | null {
  try {
    return decodeVisitRatingPrompt(value);
  } catch {
    return null;
  }
}

/** The answer's `data`, never throwing (the rating is saved; see the file comment). */
export function decodeVisitRatingAnswer(data: unknown): VisitRatingAnswerResult {
  const json = isObject(data) ? data : {};
  const prompt = promptOrNull(json.prompt);
  const rating = isObject(json.rating) ? json.rating : null;
  const writtenRow = rating?.kind === 'written';
  return {
    prompt,
    happyMoment: json.happyMoment === true,
    hasWrittenReview: json.hasWrittenReview === true || writtenRow || prompt?.hasWrittenReview === true,
  };
}

// ---------------------------------------------------------------------------
// Calls

function promptPath(promptId: string, action: 'answer' | 'dismiss'): string {
  return `/visit-rating-prompts/${encodeURIComponent(wireId(promptId))}/${action}`;
}

/**
 * The ask that is due now, or null. The FIRST answer that returns an ask
 * stamps it shown, so call this only when the card or the sheet is about to
 * show it. `no-store` on the server and here.
 */
export function fetchCurrentVisitRatingPrompt(signal?: AbortSignal): Promise<VisitRatingPrompt | null> {
  return apiGet('/visit-rating-prompts/current', undefined, {
    signal,
    decode: decodeCurrentVisitRatingPrompt,
  });
}

/** The exact body Send posts: the optional stars as null when unset, no comment with a written review. */
export function visitRatingAnswerBody(input: VisitRatingAnswerInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    rating: input.rating,
    equipmentRating: input.equipmentRating,
    cleanlinessRating: input.cleanlinessRating,
  };
  const comment = input.comment?.trim() ?? '';
  if (comment !== '') body.comment = comment;
  return body;
}

/**
 * Sends the stars under `idempotencyKey`: one per tap of Send, the same one
 * when that send is tried again (a replay answers the first answer).
 */
export function answerVisitRatingPrompt(
  promptId: string,
  input: VisitRatingAnswerInput,
  idempotencyKey: string,
): Promise<VisitRatingAnswerResult> {
  return apiPost(promptPath(promptId, 'answer'), visitRatingAnswerBody(input), {
    idempotencyKey,
    decode: decodeVisitRatingAnswer,
  });
}

/** "Not now". No body and no key: a repeat, or a dismiss of an answered ask, is safe. */
export async function dismissVisitRatingPrompt(promptId: string): Promise<void> {
  await apiPost(promptPath(promptId, 'dismiss'), undefined, { decode: () => undefined });
}

// ---------------------------------------------------------------------------
// What a refused answer means for the sheet

/**
 * What the sheet does with a failed Send (docs/05's error table):
 *
 * - `keepOpen`: 400 (an invalid body, a missing key or id: a client bug).
 *   The sheet stays as it is; Send can be tapped again.
 * - `closed`: 403 `review_visit_required` (the visit was voided), 404 (not
 *   this member's ask) and 409 `visit_rating_prompt_closed` (answered,
 *   dismissed or expired). The sheet closes, the notification goes, and the
 *   member is told why.
 * - `rateLimited`: 429. Send waits out `Retry-After` (seconds, when sent).
 * - `retry`: no answer, a timeout, a 5xx or a body that did not read. The
 *   member is told and may send again under the same key.
 * - `signedOut`: the session is gone; the app is on its way to sign-in.
 *
 * `messageKey` is the copy to show (visitRating.error.*).
 */
export type AnswerFailure =
  | { readonly kind: 'keepOpen'; readonly messageKey: string }
  | { readonly kind: 'closed'; readonly messageKey: string }
  | { readonly kind: 'rateLimited'; readonly messageKey: string; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'retry'; readonly messageKey: string }
  | { readonly kind: 'signedOut' };

export const VISIT_RATING_ERROR_KEYS = {
  answered: 'visitRating.error.answered',
  expired: 'visitRating.error.expired',
  dismissed: 'visitRating.error.dismissed',
  visitGone: 'visitRating.error.visitGone',
  network: 'visitRating.error.network',
} as const;

function statusOf(error: ApiError): number {
  if (error instanceof ProblemError) return error.status ?? error.httpStatus;
  return error.status ?? 0;
}

/** The sheet's reading of a failed Send (see `AnswerFailure`). */
export function answerFailure(error: unknown): AnswerFailure {
  if (error instanceof NotAuthenticatedError) return { kind: 'signedOut' };
  if (!isApiError(error) || error instanceof TransportError) {
    return { kind: 'retry', messageKey: VISIT_RATING_ERROR_KEYS.network };
  }
  const status = statusOf(error);
  if (status === 409 || error.isProblem('visit_rating_prompt_closed')) {
    const reason = error.reason;
    const messageKey =
      reason === 'answered'
        ? VISIT_RATING_ERROR_KEYS.answered
        : reason === 'expired'
          ? VISIT_RATING_ERROR_KEYS.expired
          : VISIT_RATING_ERROR_KEYS.dismissed;
    return { kind: 'closed', messageKey };
  }
  if (status === 403 || error.isProblem('review_visit_required')) {
    return { kind: 'closed', messageKey: VISIT_RATING_ERROR_KEYS.visitGone };
  }
  // Not this member's ask (or no longer one): the request is closed to them.
  if (status === 404) return { kind: 'closed', messageKey: VISIT_RATING_ERROR_KEYS.dismissed };
  if (status === 429) {
    return { kind: 'rateLimited', messageKey: VISIT_RATING_ERROR_KEYS.network, retryAfterSeconds: error.retryAfterSeconds ?? null };
  }
  if (status >= 400 && status < 500) return { kind: 'keepOpen', messageKey: VISIT_RATING_ERROR_KEYS.network };
  return { kind: 'retry', messageKey: VISIT_RATING_ERROR_KEYS.network };
}
