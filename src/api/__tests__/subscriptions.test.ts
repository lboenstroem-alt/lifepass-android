/**
 * `GET /subscriptions`: the model (iOS Models/Subscription.swift) and the
 * read, checked against the contract. What the app store does with a failed
 * read is in src/stores/__tests__/subscriptionState.test.ts.
 */
import { api, Reply } from '@test/server';

import { DecodingError } from '../errors';
import {
  decodeSubscription,
  fetchActiveSubscription,
  isSubscriptionActive,
  isSubscriptionPastDue,
  planDisplayName,
} from '../subscriptions';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

/** Recorded from `GET /subscriptions` (ids as the server writes them). */
const plus = {
  id: '5F0C2A6E-8A51-4E0B-9D7E-2B9A1F3C4D10',
  productSlug: 'plan-plus',
  productName: 'Plus',
  status: 'active',
  currentPeriodStartsAt: '2026-09-01T10:14:03.512Z',
  currentPeriodEndsAt: '2026-10-01T10:14:03.512Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
};

describe('the plan', () => {
  it('decodes, with the id lower case and the dates as instants', () => {
    const sub = decodeSubscription(plus)!;
    expect(sub.id).toBe('5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10');
    expect(sub.currentPeriodEndsAt.toISOString()).toBe('2026-10-01T10:14:03.512Z');
    expect(sub.cancelledAt).toBeNull();
  });

  it('null is no plan', () => {
    expect(decodeSubscription(null)).toBeNull();
  });

  it('a plan the app cannot read fails the read rather than reading as no plan', () => {
    expect(() => decodeSubscription({ ...plus, currentPeriodEndsAt: 'soon' })).toThrow();
    expect(() => decodeSubscription({ ...plus, cancelAtPeriodEnd: 'no' })).toThrow();
    expect(() => decodeSubscription('<html>')).toThrow();
  });

  it('active and past due both hold a plan; only past due is dunning', () => {
    const active = decodeSubscription(plus);
    const pastDue = decodeSubscription({ ...plus, status: 'past_due' });
    expect(isSubscriptionActive(active)).toBe(true);
    expect(isSubscriptionActive(pastDue)).toBe(true);
    expect(isSubscriptionPastDue(active)).toBe(false);
    expect(isSubscriptionPastDue(pastDue)).toBe(true);
    expect(isSubscriptionActive(null)).toBe(false);
  });

  it("names the plan by the API's product name, else by the v1 slug", () => {
    expect(planDisplayName({ productName: 'Plus', productSlug: 'plan-plus' })).toBe('Plus');
    expect(planDisplayName({ productName: '', productSlug: 'plan-base-annual' })).toBe('LifePass Base');
    expect(planDisplayName({ productName: '', productSlug: 'plan-plus' })).toBe('LifePass Plus');
    expect(planDisplayName({ productName: '', productSlug: 'plan-max-annual' })).toBe('LifePass Max');
    // Anything else, capitalised as Foundation does; a subscription never carries a pass slug.
    expect(planDisplayName({ productName: '', productSlug: 'plan-gold' })).toBe('Plan-Gold');
  });
});

describe('the read', () => {
  it("reads the contract's plan", async () => {
    api.on('GET', '/subscriptions', replyFromContract('GET', '/subscriptions', 200, 'full'));
    const sub = await fetchActiveSubscription();
    expect(sub === null || typeof sub.productSlug === 'string').toBe(true);
    expectSentToMatchContract('GET', '/subscriptions');
  });

  it('reads a plan and no plan', async () => {
    api.once('GET', '/subscriptions', Reply.ok(plus));
    expect((await fetchActiveSubscription())?.productSlug).toBe('plan-plus');
    api.once('GET', '/subscriptions', Reply.ok(null));
    expect(await fetchActiveSubscription()).toBeNull();
  });

  it('an HTML body is a decoding error, never "no plan"', async () => {
    api.on('GET', '/subscriptions', Reply.raw(200, '<html>not json</html>'));
    await expect(fetchActiveSubscription()).rejects.toBeInstanceOf(DecodingError);
  });
});
