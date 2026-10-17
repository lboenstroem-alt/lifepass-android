/**
 * A paying member stays a paying member through a bad read, and nothing that
 * depends on "has this member bought anything" is decided before the app
 * knows: the port of iOS SubscriptionStateTests.
 */
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { selectHasActiveSubscription, selectPurchaseStateKnown, useAppStore } from '../appStore';

import { freshStorePerTest, MEMBER_A, PLUS_SUBSCRIPTION, profileJSON } from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

const store = () => useAppStore.getState();

let subscriptionReply: StubReply;
beforeEach(() => {
  subscriptionReply = Reply.ok(null);
  api.on('GET', '/subscriptions', () => subscriptionReply);
  api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true })));
});

it('a failed read keeps the plan', async () => {
  subscriptionReply = Reply.ok(PLUS_SUBSCRIPTION);
  await store().loadSubscription();
  expect(selectHasActiveSubscription(store())).toBe(true);

  subscriptionReply = Reply.problem(503, 'internal_error');
  await store().loadSubscription();
  expect(selectHasActiveSubscription(store())).toBe(true);
  expect(store().subscription?.productSlug).toBe('plan-plus');

  subscriptionReply = Reply.raw(200, '<html>not json</html>');
  await store().loadSubscription();
  expect(selectHasActiveSubscription(store())).toBe(true);

  subscriptionReply = Reply.fail();
  await store().loadSubscription();
  expect(selectHasActiveSubscription(store())).toBe(true);
});

it('only a successful "no plan" clears it', async () => {
  subscriptionReply = Reply.ok(PLUS_SUBSCRIPTION);
  await store().loadSubscription();
  subscriptionReply = Reply.ok(null);
  await store().loadSubscription();
  expect(store().subscription).toBeNull();
  expect(selectHasActiveSubscription(store())).toBe(false);
});

it('the nudges wait until both reads have answered', async () => {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
  expect(selectPurchaseStateKnown(store())).toBe(false);

  await store().loadProfile();
  expect(selectPurchaseStateKnown(store())).toBe(false);

  subscriptionReply = Reply.problem(503, 'internal_error');
  await store().loadSubscription();
  expect(selectPurchaseStateKnown(store())).toBe(false);

  subscriptionReply = Reply.ok(PLUS_SUBSCRIPTION);
  await store().loadSubscription();
  expect(selectPurchaseStateKnown(store())).toBe(true);

  await store().handleSignOut();
  expect(store().subscriptionLoaded).toBe(false);
});

it('refreshCredits re-reads the profile and the plan together', async () => {
  subscriptionReply = Reply.ok(PLUS_SUBSCRIPTION);
  await store().refreshCredits();
  expect(api.sentAll('/profile', 'GET')).toHaveLength(1);
  expect(api.sentAll('/subscriptions', 'GET')).toHaveLength(1);
  expect(store().profile?.id).toBe(MEMBER_A);
  expect(store().subscription?.productSlug).toBe('plan-plus');
});

it('a failed read leaves a breadcrumb, never the member-facing state', async () => {
  subscriptionReply = Reply.problem(503, 'internal_error');
  await expect(store().loadSubscription()).resolves.toBeUndefined();
  api.on('GET', '/profile', Reply.problem(503, 'internal_error'));
  await expect(store().loadProfile()).resolves.toBeUndefined();
  expect(store().profile).toBeNull();
});
