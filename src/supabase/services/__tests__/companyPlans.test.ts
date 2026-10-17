/**
 * `/company-plans/*`: what the phone sends (the activation mandate with the
 * MerchantInfo versions, lower-case ids, the keys) and what it can read (the
 * context, the activation and retry answers, read as iOS's Decodable types
 * read them). The flows that use them are in
 * src/features/account/copay/__tests__.
 */
import { api, Reply } from '@test/server';

import { DecodingError } from '../../../api/errors';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../../../api/testing';
import { MerchantInfo } from '../../../config/merchantInfo';
import {
  activateCompanyPlan,
  activationBody,
  decodeCompanyPlanContext,
  endRetryEpisode,
  endRetryEpisodesExcept,
  fetchCompanyPlanContext,
  hasRetryEpisode,
  resetRetryEpisodesForTests,
  retryCopayPayment,
  retryEpisodeKey,
} from '../companyPlans';

stubApiClientPerTest();

beforeEach(() => resetRetryEpisodesForTests());

const MEMBERSHIP = 'A1B2C3D4-0000-4000-8000-00000000C0DE';
const SUBSCRIPTION = '5F0C2A6E-8A51-4E0B-9D7E-2B9A1F3C4D10';
const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';

/** A pending co-pay activation as the server writes it. */
const activationJSON = {
  membershipId: MEMBERSHIP,
  fundingModel: 'co_pay',
  companyName: 'Acme ehf.',
  productSlug: 'plan-plus',
  productName: 'Plus',
  memberPriceIsk: 14_900,
  subsidyIsk: 10_000,
  shareIsk: 4_900,
  blocked: null,
};

describe('the context', () => {
  it('reads an invitation alone', () => {
    expect(decodeCompanyPlanContext({ pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null })).toEqual({
      pendingInvite: { companyName: 'Acme ehf.' },
      pendingActivation: null,
    });
  });

  it('reads a pending activation, the membership id lower case', () => {
    const context = decodeCompanyPlanContext({ pendingInvite: null, pendingActivation: activationJSON });
    expect(context.pendingActivation).toEqual({
      membershipId: MEMBERSHIP.toLowerCase(),
      companyName: 'Acme ehf.',
      productSlug: 'plan-plus',
      productName: 'Plus',
      memberPriceIsk: 14_900,
      subsidyIsk: 10_000,
      shareIsk: 4_900,
      blocked: null,
    });
  });

  it('keeps `blocked` as the server says it', () => {
    const context = decodeCompanyPlanContext({ pendingActivation: { ...activationJSON, blocked: 'existing_subscription' } });
    expect(context.pendingActivation?.blocked).toBe('existing_subscription');
  });

  it('both members are optional, as on iOS: an empty answer is nothing to show', () => {
    expect(decodeCompanyPlanContext({})).toEqual({ pendingInvite: null, pendingActivation: null });
  });

  it('an activation iOS cannot decode fails the read (no half-drawn banner)', () => {
    const { shareIsk: _dropped, ...withoutShare } = activationJSON;
    expect(() => decodeCompanyPlanContext({ pendingActivation: withoutShare })).toThrow();
    expect(() => decodeCompanyPlanContext({ pendingActivation: { ...activationJSON, shareIsk: 4900.5 } })).toThrow();
    expect(() => decodeCompanyPlanContext({ pendingActivation: { ...activationJSON, membershipId: 'm-1' } })).toThrow();
    expect(() => decodeCompanyPlanContext({ pendingActivation: { ...activationJSON, blocked: 3 } })).toThrow();
    expect(() => decodeCompanyPlanContext({ pendingInvite: {} })).toThrow();
  });

  it('GET /company-plans/context, checked against the contract', async () => {
    api.on('GET', '/company-plans/context', replyFromContract('GET', '/company-plans/context', 200, 'full'));
    const context = await fetchCompanyPlanContext();
    expectSentToMatchContract('GET', '/company-plans/context');
    expect(context.pendingActivation).not.toBeUndefined();
  });

  it('a body that does not decode is a DecodingError', async () => {
    api.on('GET', '/company-plans/context', Reply.ok({ pendingActivation: { membershipId: 'x' } }));
    await expect(fetchCompanyPlanContext()).rejects.toBeInstanceOf(DecodingError);
  });
});

describe('activation', () => {
  it('sends the membership (lower case) and the mandate with the MerchantInfo versions', async () => {
    api.on('POST', '/company-plans/activate', Reply.ok({ kind: 'provisioned', subscriptionId: SUBSCRIPTION }, 201));
    await activateCompanyPlan(MEMBERSHIP, 'activate-key-1');
    const sent = expectSentToMatchContract('POST', '/company-plans/activate');
    const body = sent.body as { membershipId: string; terms: Record<string, string> };
    expect(Object.keys(body).sort()).toEqual(['membershipId', 'terms']);
    expect(body.membershipId).toBe(MEMBERSHIP.toLowerCase());
    expect(Object.keys(body.terms).sort()).toEqual(['acceptedAt', 'privacyVersion', 'termsVersion']);
    expect(body.terms.termsVersion).toBe(MerchantInfo.termsVersion);
    expect(body.terms.privacyVersion).toBe(MerchantInfo.privacyVersion);
    expect(body.terms.termsVersion).toBe('2026-09-v6');
    expect(body.terms.privacyVersion).toBe('2026-09-v12');
    expect(sent.headers['idempotency-key']).toBe('activate-key-1');
  });

  it('stamps the acceptance as an ISO-8601 instant without fractions, as iOS does', () => {
    const body = activationBody(MEMBERSHIP, new Date('2026-10-17T12:34:56.789Z'));
    expect(body.terms.acceptedAt).toBe('2026-10-17T12:34:56Z');
  });

  it('a fresh key per tap: a reused key would replay a Kling page that may be dead', async () => {
    api.on('POST', '/company-plans/activate', Reply.ok({ kind: 'provisioned', subscriptionId: SUBSCRIPTION }, 201));
    await activateCompanyPlan(MEMBERSHIP);
    await activateCompanyPlan(MEMBERSHIP);
    const [first, second] = api.sentAll('/company-plans/activate').map((r) => r.headers['idempotency-key']);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('provisioned needs no page', async () => {
    api.on('POST', '/company-plans/activate', Reply.ok({ kind: 'provisioned', subscriptionId: SUBSCRIPTION }, 201));
    await expect(activateCompanyPlan(MEMBERSHIP)).resolves.toEqual({ kind: 'provisioned' });
  });

  it('checkout carries the page, the share and the Kling session', async () => {
    api.on(
      'POST',
      '/company-plans/activate',
      Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 4_900, externalSessionId: SESSION }, 201),
    );
    await expect(activateCompanyPlan(MEMBERSHIP)).resolves.toEqual({
      kind: 'checkout',
      checkoutUrl: 'https://pay.kling.is/c/copay',
      shareIsk: 4_900,
      externalSessionId: SESSION,
    });
  });

  it('an older server without the session id still opens the page', async () => {
    api.on('POST', '/company-plans/activate', Reply.ok({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay' }, 201));
    const result = await activateCompanyPlan(MEMBERSHIP);
    expect(result).toEqual({ kind: 'checkout', checkoutUrl: 'https://pay.kling.is/c/copay', shareIsk: 0 });
  });

  it('a checkout with no page fails the call (iOS badServerResponse), it never opens nothing', async () => {
    api.on('POST', '/company-plans/activate', Reply.ok({ kind: 'checkout', shareIsk: 4_900 }, 201));
    await expect(activateCompanyPlan(MEMBERSHIP)).rejects.toBeInstanceOf(DecodingError);
  });
});

describe('the dunning episode', () => {
  const checkout = { checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900, externalSessionId: SESSION };

  it('sends the subscription id lower case, under the episode key', async () => {
    api.on('POST', '/company-plans/retry-payment', Reply.ok(checkout, 201));
    await expect(retryCopayPayment(SUBSCRIPTION)).resolves.toEqual(checkout);
    const sent = expectSentToMatchContract('POST', '/company-plans/retry-payment');
    expect(sent.body).toEqual({ subscriptionId: SUBSCRIPTION.toLowerCase() });
    expect(sent.headers['idempotency-key']).toBe(retryEpisodeKey(SUBSCRIPTION));
  });

  it('two taps in one episode send the same key; a cured plan starts a new one', async () => {
    api.on('POST', '/company-plans/retry-payment', Reply.ok(checkout, 201));
    await retryCopayPayment(SUBSCRIPTION);
    await retryCopayPayment(SUBSCRIPTION.toLowerCase());
    const keys = api.sentAll('/company-plans/retry-payment').map((r) => r.headers['idempotency-key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);

    endRetryEpisode(SUBSCRIPTION);
    expect(hasRetryEpisode(SUBSCRIPTION)).toBe(false);
    await retryCopayPayment(SUBSCRIPTION);
    expect(api.sentAll('/company-plans/retry-payment')[2]!.headers['idempotency-key']).not.toBe(keys[0]);
  });

  it('ends every episode but the past-due one', () => {
    const other = '7a1c2b3d-0000-4000-8000-000000000009';
    const kept = retryEpisodeKey(SUBSCRIPTION);
    retryEpisodeKey(other);
    endRetryEpisodesExcept(SUBSCRIPTION.toLowerCase());
    expect(hasRetryEpisode(other)).toBe(false);
    expect(retryEpisodeKey(SUBSCRIPTION)).toBe(kept);
    endRetryEpisodesExcept(null);
    expect(hasRetryEpisode(SUBSCRIPTION)).toBe(false);
  });

  it('a retry answer iOS cannot decode is a DecodingError', async () => {
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry' }, 201));
    await expect(retryCopayPayment(SUBSCRIPTION)).rejects.toBeInstanceOf(DecodingError);
  });

  it('an older server without the session id still opens the page', async () => {
    api.on('POST', '/company-plans/retry-payment', Reply.ok({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900 }, 201));
    await expect(retryCopayPayment(SUBSCRIPTION)).resolves.toEqual({ checkoutUrl: 'https://pay.kling.is/c/retry', shareIsk: 4_900 });
  });
});
