/**
 * "How was your visit?" on the wire (API 0.46.0): the check-in's fail-soft
 * `ratingPrompt` and `lifetimeCheckIns`, the ask `current` returns, the
 * answer and the dismiss as the phone sends them (checked against the
 * vendored contract), the features header on each, and what every refusal
 * means for the sheet.
 */
import { expectResponseDataValid, sampleResponse } from '@test/contract';
import { api, Reply } from '@test/server';

import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';
import {
  answerFailure,
  answerVisitRatingPrompt,
  decodeCurrentVisitRatingPrompt,
  decodeVisitRatingAnswer,
  decodeVisitRatingPrompt,
  dismissVisitRatingPrompt,
  fetchCurrentVisitRatingPrompt,
  readLifetimeCheckIns,
  readRatingPrompt,
  visitRatingAnswerBody,
} from '../visitRating';
import { DecodingError, HttpStatusError, NotAuthenticatedError, ProblemError, TransportError } from '../errors';
import { decodeProfile } from '../profile';

stubApiClientPerTest();

const PROMPT_ID = '6F1C2A4E-0000-4000-8000-000000000001';
const VENUE_ID = '3f2b8c1e-0000-4000-8000-0000000000a1';

const RESERVATION = {
  id: PROMPT_ID,
  venueId: VENUE_ID,
  venueName: 'Laugar',
  dueAt: '2026-10-27T13:05:00.000Z',
  expiresAt: '2026-10-30T13:05:00.000Z',
};

const PROMPT = {
  id: PROMPT_ID.toLowerCase(),
  venueId: VENUE_ID,
  venueName: 'Laugar',
  venueSlug: 'laugar',
  checkedInAt: '2026-10-27T12:05:00.000Z',
  dueAt: '2026-10-27T13:05:00.000Z',
  expiresAt: '2026-10-30T13:05:00.000Z',
  shownAt: '2026-10-27T13:09:41.000Z',
  answeredAt: null,
  dismissedAt: null,
  hasWrittenReview: false,
};

const answerPath = `/visit-rating-prompts/${PROMPT_ID.toLowerCase()}/answer`;
const dismissPath = `/visit-rating-prompts/${PROMPT_ID.toLowerCase()}/dismiss`;

describe('ratingPrompt on a check-in answer (fail-soft)', () => {
  it('absent or null is no ask', () => {
    expect(readRatingPrompt(undefined)).toBeNull();
    expect(readRatingPrompt(null)).toBeNull();
  });

  it('an ask is read with its id in lower case and its dates', () => {
    expect(readRatingPrompt(RESERVATION)).toEqual({
      id: PROMPT_ID.toLowerCase(),
      venueId: VENUE_ID,
      venueName: 'Laugar',
      dueAt: new Date('2026-10-27T13:05:00.000Z'),
      expiresAt: new Date('2026-10-30T13:05:00.000Z'),
    });
  });

  it('anything the phone could not schedule is no ask, never an error', () => {
    for (const broken of [
      'yes',
      [],
      { ...RESERVATION, id: 'not-a-uuid' },
      { ...RESERVATION, venueName: '  ' },
      { ...RESERVATION, dueAt: 'tomorrow' },
      { ...RESERVATION, expiresAt: null },
    ]) {
      expect(readRatingPrompt(broken)).toBeNull();
    }
  });

  it('lifetimeCheckIns: a whole number from 0, else null', () => {
    expect(readLifetimeCheckIns(5)).toBe(5);
    expect(readLifetimeCheckIns(0)).toBe(0);
    for (const broken of [null, undefined, -1, 2.5, '5', NaN]) expect(readLifetimeCheckIns(broken)).toBeNull();
  });

  it('GET /profile carries lifetimeCheckIns, fail-soft', () => {
    const base = { id: VENUE_ID, kennitalaVerified: false, marketingConsent: false };
    expect(decodeProfile({ ...base, lifetimeCheckIns: 12 }).lifetimeCheckIns).toBe(12);
    expect(decodeProfile({ ...base, lifetimeCheckIns: null }).lifetimeCheckIns).toBeNull();
    expect(decodeProfile({ ...base, lifetimeCheckIns: 'twelve' }).lifetimeCheckIns).toBeNull();
    expect(decodeProfile(base).lifetimeCheckIns).toBeNull();
  });
});

describe('GET /visit-rating-prompts/current', () => {
  it('reads the ask, and null most of the time', async () => {
    api.on('GET', '/visit-rating-prompts/current', Reply.ok({ prompt: PROMPT }));
    const prompt = await fetchCurrentVisitRatingPrompt();
    expect(prompt).toMatchObject({ id: PROMPT.id, venueName: 'Laugar', venueSlug: 'laugar', hasWrittenReview: false });
    expect(prompt?.dueAt).toEqual(new Date(PROMPT.dueAt));
    const sent = api.sent('/visit-rating-prompts/current', 'GET');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['x-lifepass-features']).toBe('visit-rating-prompts');

    api.on('GET', '/visit-rating-prompts/current', Reply.ok({ prompt: null }));
    await expect(fetchCurrentVisitRatingPrompt()).resolves.toBeNull();
  });

  it("reads the contract's own sample", async () => {
    api.on('GET', '/visit-rating-prompts/current', replyFromContract('GET', '/visit-rating-prompts/current', 200, 'full'));
    await expect(fetchCurrentVisitRatingPrompt()).resolves.not.toBeUndefined();
  });

  it('the sample this file answers with is the contract shape', () => {
    expectResponseDataValid('GET', '/visit-rating-prompts/current', 200, { prompt: PROMPT });
    expectResponseDataValid('GET', '/visit-rating-prompts/current', 200, { prompt: null });
  });

  it('hasWrittenReview is false unless the server says true', () => {
    expect(decodeVisitRatingPrompt({ ...PROMPT, hasWrittenReview: true }).hasWrittenReview).toBe(true);
    expect(decodeVisitRatingPrompt({ ...PROMPT, hasWrittenReview: 'yes' }).hasWrittenReview).toBe(false);
  });

  it('an ask without its id or venue is refused (the caller shows no card)', () => {
    expect(() => decodeCurrentVisitRatingPrompt({ prompt: { ...PROMPT, id: 7 } })).toThrow();
    expect(() => decodeCurrentVisitRatingPrompt({ prompt: { ...PROMPT, venueName: '' } })).toThrow();
    expect(() => decodeCurrentVisitRatingPrompt('nope')).toThrow();
    expect(decodeCurrentVisitRatingPrompt({})).toBeNull();
  });
});

describe('POST /visit-rating-prompts/{id}/answer', () => {
  it('sends the stars, the optional ones as null, and the key; checked against the contract', async () => {
    api.on('POST', answerPath, Reply.ok(sampleResponse('POST', '/visit-rating-prompts/{promptId}/answer', 200, 'full')));
    await answerVisitRatingPrompt(
      PROMPT_ID,
      { rating: 4, equipmentRating: 5, cleanlinessRating: null, comment: '  Spotless showers.  ' },
      'answer-key-1',
    );
    const sent = expectSentToMatchContract('POST', answerPath);
    expect(sent.body).toEqual({ rating: 4, equipmentRating: 5, cleanlinessRating: null, comment: 'Spotless showers.' });
    expect(sent.headers['idempotency-key']).toBe('answer-key-1');
    expect(sent.headers['x-lifepass-features']).toBe('visit-rating-prompts');
  });

  it('leaves the comment out when there is none (empty or a written review)', () => {
    expect(visitRatingAnswerBody({ rating: 5, equipmentRating: null, cleanlinessRating: null, comment: '   ' })).toEqual({
      rating: 5,
      equipmentRating: null,
      cleanlinessRating: null,
    });
    expect(Object.keys(visitRatingAnswerBody({ rating: 2, equipmentRating: 1, cleanlinessRating: 3, comment: null }))).toEqual([
      'rating',
      'equipmentRating',
      'cleanlinessRating',
    ]);
  });

  it('reads the thank-you facts, and never fails an accepted answer over its body', () => {
    expect(decodeVisitRatingAnswer({ prompt: PROMPT, rating: { kind: 'quick' }, happyMoment: true, hasWrittenReview: false })).toEqual({
      prompt: expect.objectContaining({ id: PROMPT.id }),
      happyMoment: true,
      hasWrittenReview: false,
    });
    expect(decodeVisitRatingAnswer({ rating: { kind: 'written' }, happyMoment: false })).toMatchObject({
      prompt: null,
      happyMoment: false,
      hasWrittenReview: true,
    });
    expect(decodeVisitRatingAnswer('???')).toEqual({ prompt: null, happyMoment: false, hasWrittenReview: false });
  });
});

describe('POST /visit-rating-prompts/{id}/dismiss', () => {
  it('sends no body and no key', async () => {
    api.on('POST', dismissPath, Reply.ok({ prompt: { ...PROMPT, dismissedAt: '2026-10-27T13:10:00.000Z' } }));
    await dismissVisitRatingPrompt(PROMPT_ID);
    const sent = expectSentToMatchContract('POST', dismissPath);
    expect(sent.rawBody ?? '').toBe('');
    expect(sent.headers['idempotency-key']).toBeUndefined();
  });
});

describe('what a refused Send means for the sheet', () => {
  const problem = (status: number, slug: string, extra: Record<string, unknown> = {}, retryAfter?: number) =>
    new ProblemError(
      { type: `https://lifepass.is/problems/${slug}`, title: slug, status, ...extra },
      status,
      retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {},
    );

  it('409 closes it with the reason it gives', () => {
    expect(answerFailure(problem(409, 'visit_rating_prompt_closed', { reason: 'answered' }))).toEqual({
      kind: 'closed',
      messageKey: 'visitRating.error.answered',
    });
    expect(answerFailure(problem(409, 'visit_rating_prompt_closed', { reason: 'expired' }))).toEqual({
      kind: 'closed',
      messageKey: 'visitRating.error.expired',
    });
    expect(answerFailure(problem(409, 'visit_rating_prompt_closed', { reason: 'dismissed' }))).toEqual({
      kind: 'closed',
      messageKey: 'visitRating.error.dismissed',
    });
    expect(answerFailure(problem(409, 'visit_rating_prompt_closed'))).toEqual({
      kind: 'closed',
      messageKey: 'visitRating.error.dismissed',
    });
  });

  it('403 (the visit was voided) and 404 (not this member’s ask) close it', () => {
    expect(answerFailure(problem(403, 'review_visit_required'))).toEqual({ kind: 'closed', messageKey: 'visitRating.error.visitGone' });
    expect(answerFailure(problem(404, 'visit_rating_prompt_not_found'))).toEqual({
      kind: 'closed',
      messageKey: 'visitRating.error.dismissed',
    });
  });

  it('400 keeps it open', () => {
    for (const slug of ['invalid-visit-rating-answer', 'idempotency_key_required', 'invalid-visit-rating-prompt-id']) {
      expect(answerFailure(problem(400, slug))).toEqual({ kind: 'keepOpen', messageKey: 'visitRating.error.network' });
    }
  });

  it('429 waits out Retry-After', () => {
    expect(answerFailure(problem(429, 'rate-limited', {}, 12))).toEqual({
      kind: 'rateLimited',
      messageKey: 'visitRating.error.network',
      retryAfterSeconds: 12,
    });
    expect(answerFailure(problem(429, 'rate-limited'))).toMatchObject({ kind: 'rateLimited', retryAfterSeconds: null });
  });

  it('no answer, a 5xx or an unreadable body: try again', () => {
    for (const error of [
      new TransportError('offline'),
      new TransportError('timeout'),
      problem(500, 'internal_error'),
      new HttpStatusError(502, '<html>'),
      new DecodingError('{}'),
      new Error('boom'),
    ]) {
      expect(answerFailure(error)).toEqual({ kind: 'retry', messageKey: 'visitRating.error.network' });
    }
  });

  it('a session that is gone is the sign-in, not a message', () => {
    expect(answerFailure(new NotAuthenticatedError())).toEqual({ kind: 'signedOut' });
  });

  it('over the wire: the problem the server sends is read the same way', async () => {
    api.on('POST', answerPath, Reply.problem(409, 'visit_rating_prompt_closed', { reason: 'expired' }));
    const failure = await answerVisitRatingPrompt(
      PROMPT_ID,
      { rating: 3, equipmentRating: null, cleanlinessRating: null, comment: null },
      'k',
    ).catch((error: unknown) => answerFailure(error));
    expect(failure).toEqual({ kind: 'closed', messageKey: 'visitRating.error.expired' });

    api.on('POST', answerPath, Reply.problem(429, 'rate-limited', {}, { 'Retry-After': '30' }));
    const limited = await answerVisitRatingPrompt(
      PROMPT_ID,
      { rating: 3, equipmentRating: null, cleanlinessRating: null, comment: null },
      'k',
    ).catch((error: unknown) => answerFailure(error));
    expect(limited).toMatchObject({ kind: 'rateLimited', retryAfterSeconds: 30 });
  });
});
