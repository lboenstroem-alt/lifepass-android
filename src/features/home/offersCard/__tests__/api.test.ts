/**
 * The offers card's two calls on the wire, through the real client against
 * the stub server: `POST /profile/marketing-consent` with exactly
 * `{ optedIn: true, source: "app_card" }`, and `POST /profile/offers-card/
 * dismiss` with no body, each with the bearer token, a fresh Idempotency-Key
 * (so a refreshed session resends it once) and `no-store`; and every answer
 * the routes can give. The `app_card` source and the dismissal are newer
 * than the vendored 0.34.0 contract, so the request is read from the stub
 * server rather than checked against it.
 */
import { api, Reply } from '@test/server';

import { DecodingError, isProblem, isValidIdempotencyKey, NotAuthenticatedError, ProblemError } from '../../../../api';
import { stubApiClientPerTest, TEST_ACCESS_TOKEN, TEST_REFRESHED_TOKEN } from '../../../../api/testing';
import {
  APP_CARD_OPT_IN_BODY,
  decodeDismissAnswer,
  decodeOptInAnswer,
  dismissOffersCard,
  MARKETING_CONSENT_PATH,
  OFFERS_CARD_DISMISS_PATH,
  optInToOffersByEmail,
} from '../api';
import { optInFailure } from '../rules';

const session = stubApiClientPerTest();

const KEY = '0b7c9e3a-5d2f-4c1b-9a8e-6f4d3c2b1a09';

async function failureOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error('the call went through');
}

describe('POST /profile/marketing-consent from the card', () => {
  it('sends the bearer token, the key, no-store and exactly the card opt-in', async () => {
    api.on('POST', MARKETING_CONSENT_PATH, Reply.ok({ optedIn: true }));
    await expect(optInToOffersByEmail(KEY)).resolves.toBe(true);

    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(1);
    const sent = api.sent(MARKETING_CONSENT_PATH, 'POST');
    expect(sent.body).toEqual({ optedIn: true, source: 'app_card' });
    expect(Object.keys(sent.body as object)).toEqual(['optedIn', 'source']);
    expect(sent.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(sent.headers['idempotency-key']).toBe(KEY);
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['content-type']).toMatch(/^application\/json/);
    expect(sent.query).toEqual({});
  });

  it('only ever says yes, as the apps card', () => {
    expect(APP_CARD_OPT_IN_BODY).toEqual({ optedIn: true, source: 'app_card' });
    expect(Object.isFrozen(APP_CARD_OPT_IN_BODY)).toBe(true);
  });

  it('a member already opted in gets the same 200, and a repeat is just as good', async () => {
    api.on('POST', MARKETING_CONSENT_PATH, Reply.ok({ optedIn: true }));
    await optInToOffersByEmail(KEY);
    await expect(optInToOffersByEmail('5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b')).resolves.toBe(true);
    expect(api.sentAll(MARKETING_CONSENT_PATH)).toHaveLength(2);
  });

  it('a 2xx that does not say optedIn: true is not taken as done', async () => {
    api.on('POST', MARKETING_CONSENT_PATH, Reply.ok({ optedIn: false }));
    const error = await failureOf(() => optInToOffersByEmail(KEY));
    expect(error).toBeInstanceOf(DecodingError);
    expect(optInFailure(error)).toBe('failed');
    expect(() => decodeOptInAnswer(null)).toThrow();
    expect(() => decodeOptInAnswer({ optedIn: 'true' })).toThrow();
    expect(decodeOptInAnswer({ optedIn: true })).toBe(true);
  });

  it.each(['account_pending_deletion', 'account_deletion_scheduled'])(
    '409 %s: an account on its way out, the card closes without a word',
    async (slug) => {
      api.on('POST', MARKETING_CONSENT_PATH, Reply.problem(409, slug));
      const error = await failureOf(() => optInToOffersByEmail(KEY));
      expect(isProblem(error, slug)).toBe(true);
      expect(optInFailure(error)).toBe('gone');
    },
  );

  it.each([
    ['a 500', () => Reply.problem(500, 'internal_error')],
    ['a gateway page', () => Reply.raw(502, '<html>Bad gateway</html>')],
    ['a 429', () => Reply.problem(429, 'rate-limited', {}, { 'retry-after': '60' })],
    ['a 400 (a server that does not know the source)', () => Reply.problem(400, 'invalid-marketing-consent')],
    ['no connection', () => Reply.fail()],
  ])('%s: the card stays and says it could not save', async (_name, reply) => {
    api.on('POST', MARKETING_CONSENT_PATH, reply());
    expect(optInFailure(await failureOf(() => optInToOffersByEmail(KEY)))).toBe('failed');
  });

  it('a 401 is resent once with the refreshed token and the same key, and then lands', async () => {
    let calls = 0;
    api.on('POST', MARKETING_CONSENT_PATH, () => {
      calls += 1;
      return calls === 1 ? Reply.problem(401, 'unauthorized') : Reply.ok({ optedIn: true });
    });
    await expect(optInToOffersByEmail(KEY)).resolves.toBe(true);
    const sent = api.sentAll(MARKETING_CONSENT_PATH);
    expect(sent.map((request) => request.headers.authorization)).toEqual([
      `Bearer ${TEST_ACCESS_TOKEN}`,
      `Bearer ${TEST_REFRESHED_TOKEN}`,
    ]);
    expect(sent.map((request) => request.headers['idempotency-key'])).toEqual([KEY, KEY]);
    expect(sent[1]!.body).toEqual({ optedIn: true, source: 'app_card' });
    expect(session.refreshes).toBe(1);
  });

  it('a 401 after the refresh too: the session ends on the phone, and the card says nothing', async () => {
    api.on('POST', MARKETING_CONSENT_PATH, Reply.problem(401, 'unauthorized'));
    const error = await failureOf(() => optInToOffersByEmail(KEY));
    expect(error).toBeInstanceOf(NotAuthenticatedError);
    expect(session.revoked).toBe(1);
    expect(optInFailure(error)).toBe('signedOut');
  });
});

describe('POST /profile/offers-card/dismiss', () => {
  it('sends no body, the bearer token, the key and no-store', async () => {
    api.on('POST', OFFERS_CARD_DISMISS_PATH, Reply.ok({ dismissed: true }));
    await expect(dismissOffersCard(KEY)).resolves.toBe(true);

    expect(api.sentAll(OFFERS_CARD_DISMISS_PATH)).toHaveLength(1);
    const sent = api.sent(OFFERS_CARD_DISMISS_PATH, 'POST');
    expect(sent.rawBody).toBeNull();
    expect(sent.body).toBeUndefined();
    expect(sent.headers['content-type']).toBeUndefined();
    expect(sent.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(isValidIdempotencyKey(sent.headers['idempotency-key']!)).toBe(true);
    expect(sent.headers['cache-control']).toBe('no-store');
  });

  it('reads the answer softly: the card has closed whatever it says', async () => {
    expect(decodeDismissAnswer({ dismissed: true })).toBe(true);
    expect(decodeDismissAnswer({})).toBe(false);
    expect(decodeDismissAnswer(null)).toBe(false);
    api.on('POST', OFFERS_CARD_DISMISS_PATH, Reply.ok({ nope: 1 }));
    await expect(dismissOffersCard(KEY)).resolves.toBe(false);
  });

  it('502 offers_card_dismiss_failed arrives as a typed error (the card ignores it)', async () => {
    api.on('POST', OFFERS_CARD_DISMISS_PATH, Reply.problem(502, 'offers_card_dismiss_failed'));
    const error = await failureOf(() => dismissOffersCard(KEY));
    expect(error).toBeInstanceOf(ProblemError);
    expect(isProblem(error, 'offers_card_dismiss_failed')).toBe(true);
  });
});
