/**
 * "Report this reply" on the wire (Android COACH-7): `POST /coach/reports`
 * with the bearer token and the Idempotency-Key, a body of the reply, the
 * reason, the optional note and the locale and NOTHING ELSE, and every
 * answer the route can give, read through the real client against the stub
 * server. The route is newer than the vendored 0.34.0 contract, so the
 * request is read from the stub server rather than checked against it.
 */
import { api, Reply } from '@test/server';

import {
  DecodingError,
  isValidIdempotencyKey,
  NotAuthenticatedError,
  ProblemError,
  TransportError,
} from '../../../../api';
import { stubApiClientPerTest, TEST_ACCESS_TOKEN } from '../../../../api/testing';
import { lookup } from '../../../../i18n';
import {
  COACH_REPORTS_PATH,
  decodeReplyReportReceipt,
  postReplyReport,
  REPLY_REPORT_MAX,
  REPLY_REPORT_NOTE_MAX,
  REPLY_REPORT_REASONS,
  replyReportBody,
} from '../api';
import { replyReportFailure } from '../outcome';

const session = stubApiClientPerTest();

const KEY = '7f9c2ba4-e88f-4c7a-9a1b-1d2c3e4f5a6b';
const CREATED = { id: 'f1e2d3c4-b5a6-4789-8abc-def012345678', createdAt: '2026-10-28T12:00:00.000Z' };
const en = (key: string) => lookup(key, 'en');

function created() {
  api.on('POST', COACH_REPORTS_PATH, Reply.ok(CREATED, 201));
}

describe('the body', () => {
  it('is the reply trimmed, the reason, the note trimmed and the locale, in that order', () => {
    const body = replyReportBody({
      reply: '  Skip the warm-up, it is a waste of time.\n',
      reason: 'harmful',
      note: '  Bad advice for my knee.  ',
      language: 'en',
    });
    expect(body).toEqual({
      reply: 'Skip the warm-up, it is a waste of time.',
      reason: 'harmful',
      note: 'Bad advice for my knee.',
      locale: 'en',
    });
    expect(Object.keys(body!)).toEqual(['reply', 'reason', 'note', 'locale']);
  });

  it('leaves a blank note out altogether, and asks in Icelandic for an Icelandic reader', () => {
    const body = replyReportBody({ reply: 'Svar.', reason: 'other', note: '   \n ', language: 'is' });
    expect(body).toEqual({ reply: 'Svar.', reason: 'other', locale: 'is' });
    expect(body).not.toHaveProperty('note');
    expect(replyReportBody({ reply: 'Svar.', reason: 'other', language: 'de' })!.locale).toBe('en');
  });

  it('cuts the reply to 8,000 and the note to 500 UTF-16 units, never through a character', () => {
    const reply = `${'a'.repeat(REPLY_REPORT_MAX - 1)}🙂 and more`;
    const body = replyReportBody({ reply, reason: 'offensive', note: `${'b'.repeat(REPLY_REPORT_NOTE_MAX - 1)}🙂`, language: 'en' })!;
    expect(body.reply).toBe('a'.repeat(REPLY_REPORT_MAX - 1));
    expect(body.note).toBe('b'.repeat(REPLY_REPORT_NOTE_MAX - 1));
  });

  it('is nothing for a reply with no words', () => {
    expect(replyReportBody({ reply: ' \n ', reason: 'other', language: 'en' })).toBeNull();
  });

  it('names exactly the four reasons the API takes', () => {
    expect(REPLY_REPORT_REASONS).toEqual(['offensive', 'harmful', 'inaccurate', 'other']);
  });
});

describe('POST /coach/reports', () => {
  it('sends the bearer token, the given Idempotency-Key, JSON, and only the body', async () => {
    created();
    const body = replyReportBody({ reply: 'A reply.', reason: 'inaccurate', note: 'Wrong opening hours.', language: 'en' })!;
    await expect(postReplyReport(body, { idempotencyKey: KEY })).resolves.toEqual(CREATED);

    const sent = api.sent(COACH_REPORTS_PATH, 'POST');
    expect(api.sentAll(COACH_REPORTS_PATH)).toHaveLength(1);
    expect(sent.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(sent.headers['idempotency-key']).toBe(KEY);
    expect(isValidIdempotencyKey(sent.headers['idempotency-key']!)).toBe(true);
    expect(sent.headers['content-type']).toMatch(/^application\/json/);
    expect(sent.body).toEqual({ reply: 'A reply.', reason: 'inaccurate', note: 'Wrong opening hours.', locale: 'en' });
    expect(sent.query).toEqual({});
  });

  it('reads the receipt softly: an answer it cannot read is still a report the server stored', () => {
    expect(decodeReplyReportReceipt({ id: 7 })).toEqual({ id: null, createdAt: null });
    expect(decodeReplyReportReceipt(null)).toEqual({ id: null, createdAt: null });
  });

  it('a replay of the same key answers the same report', async () => {
    created();
    const body = replyReportBody({ reply: 'A reply.', reason: 'other', language: 'en' })!;
    const first = await postReplyReport(body, { idempotencyKey: KEY });
    const second = await postReplyReport(body, { idempotencyKey: KEY });
    expect(second).toEqual(first);
    expect(api.sentAll(COACH_REPORTS_PATH).map((request) => request.headers['idempotency-key'])).toEqual([KEY, KEY]);
  });
});

describe('the answers that are not a report', () => {
  const body = () => replyReportBody({ reply: 'A reply.', reason: 'offensive', language: 'en' })!;
  const failureOf = async () => {
    try {
      await postReplyReport(body(), { idempotencyKey: KEY });
    } catch (error) {
      return error;
    }
    throw new Error('the report went through');
  };

  it('401: the session ends on the phone, and the sheet only closes', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.problem(401, 'unauthorized'));
    const error = await failureOf();
    // One refresh and one resend with the same key, as for any idempotent write.
    expect(api.sentAll(COACH_REPORTS_PATH).map((request) => request.headers['idempotency-key'])).toEqual([KEY, KEY]);
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect(session.revoked).toBe(1);
    expect(replyReportFailure(error)).toEqual({ kind: 'signedOut' });
  });

  it('a 401 whose refresh only failed for a while is not a sign-out (see the describe below)', () => {
    // Only the client's own NotAuthenticatedError ends the session; a 401 it threw as it came did not.
    const kept = new ProblemError(
      { type: 'https://lifepass.is/problems/unauthorized', title: 'unauthorized', status: 401, detail: 'Server detail.' },
      401,
    );
    expect(replyReportFailure(kept)).toEqual({ kind: 'message', message: en('error.sign_in'), keepKey: true });
    expect(replyReportFailure(new NotAuthenticatedError())).toEqual({ kind: 'signedOut' });
  });

  it('422 with field errors: the refusal fallback, never the server\'s words, and a new key next time', async () => {
    api.on(
      'POST',
      COACH_REPORTS_PATH,
      Reply.problem(422, 'validation_error', { errors: [{ field: 'reply', message: 'Too long' }] }),
    );
    const error = await failureOf();
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).details.errors).toEqual([{ field: 'reply', message: 'Too long' }]);
    expect(replyReportFailure(error)).toEqual({ kind: 'message', message: en('error.refusal_fallback'), keepKey: false });
  });

  it('429: the member has sent many reports and can try later; the key is spent', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.problem(429, 'rate-limited', {}, { 'retry-after': '3600' }));
    const error = await failureOf();
    expect(replyReportFailure(error)).toEqual({ kind: 'message', message: en('coach.report.rate_limited'), keepKey: false });
  });

  it('5xx, with or without a problem body: our failure in the usual words; the key is kept', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.problem(500, 'internal_error'));
    expect(replyReportFailure(await failureOf())).toEqual({ kind: 'message', message: en('error.server'), keepKey: true });
    api.on('POST', COACH_REPORTS_PATH, Reply.raw(502, '<html>Bad gateway</html>'));
    expect(replyReportFailure(await failureOf())).toEqual({ kind: 'message', message: en('error.server'), keepKey: true });
  });

  it('no connection: the usual retry words; the key is kept (the report may have arrived)', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.fail());
    const error = await failureOf();
    expect(error).toBeInstanceOf(TransportError);
    expect(replyReportFailure(error)).toEqual({ kind: 'message', message: en('error.network'), keepKey: true });
    expect(replyReportFailure(new TransportError('offline'))).toEqual({
      kind: 'message',
      message: en('error.offline'),
      keepKey: true,
    });
    expect(replyReportFailure(new TransportError('timeout'))).toEqual({
      kind: 'message',
      message: en('error.timeout'),
      keepKey: true,
    });
  });

  it('a cancelled call shows nothing; an envelope that did not read keeps the key', async () => {
    expect(replyReportFailure(new TransportError('cancelled'))).toEqual({ kind: 'cancelled' });
    api.on('POST', COACH_REPORTS_PATH, Reply.json(201, { nope: true }));
    const error = await failureOf();
    expect(error).toBeInstanceOf(DecodingError);
    expect(replyReportFailure(error)).toMatchObject({ kind: 'message', keepKey: true });
  });
});

describe('a 401 whose refresh only failed for a while (the auth server unreachable, a 5xx, a 429)', () => {
  const flaky = stubApiClientPerTest({
    refreshedToken: async () => {
      throw new Error('auth server unreachable');
    },
  });

  it('keeps the session, and the sheet says so in the app\'s words with the key kept (nothing was stored)', async () => {
    for (const slug of ['authentication_required', 'unauthorized']) {
      api.on('POST', COACH_REPORTS_PATH, Reply.problem(401, slug));
      const body = replyReportBody({ reply: 'A reply.', reason: 'offensive', language: 'en' })!;
      const error = await postReplyReport(body, { idempotencyKey: KEY }).then(
        () => new Error('the report went through'),
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ProblemError);
      expect(error).not.toBeInstanceOf(NotAuthenticatedError);
      expect(replyReportFailure(error)).toEqual({ kind: 'message', message: en('error.sign_in'), keepKey: true });
    }
    expect(flaky.revoked).toBe(0);
  });
});
