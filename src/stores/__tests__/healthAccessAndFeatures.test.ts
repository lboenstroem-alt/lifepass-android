/**
 * The health access signal and the server's feature list, as the app store
 * keeps them: the access fallback of iOS ProfileHealthBlockDecodeTests and
 * the feature rules of iOS HealthStore (`noteServerFeatures`,
 * `dropServerFeature`).
 */
import { api, Reply } from '@test/server';

import { decodeProfile } from '../../api/profile';
import { decodeSubscription } from '../../api/subscriptions';
import { stubApiClientPerTest } from '../../api/testing';
import {
  accessOverrideFor,
  resolveHealthAccess,
  selectHasHealthConsent,
  selectSupportsFeedback,
  selectSupportsMealDescribe,
  selectSupportsPlanRevision,
  selectSupportsTargetWeight,
  useAppStore,
} from '../appStore';

import { freshStorePerTest, MEMBER_A, PLUS_SUBSCRIPTION, profileJSON } from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

const store = () => useAppStore.getState();

const usage = (tier: string | null, passes: unknown[] = []) => ({
  tier,
  network: null,
  pools: null,
  daily: null,
  concurrent: { open: 0, cap: null },
  topup: { available: false, prices: { gym: null, studio: null, pool: null } },
  passes,
  block: { until: null },
  strikes: { active: 0, threshold: 3 },
});
const adventurer = { id: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'adventurer', visitsLeft: 5, expiresAt: '2026-12-07T23:35:00Z' };

describe('the access signal', () => {
  it('the access fallback never promotes a dunning member to entitled', () => {
    const profile = decodeProfile(profileJSON());
    const pastDue = decodeSubscription({ ...PLUS_SUBSCRIPTION, status: 'past_due' });
    expect(resolveHealthAccess(profile, pastDue)).toBe('past_due');
  });

  it("the server's value wins; an unknown one falls back", () => {
    const pastDue = decodeSubscription({ ...PLUS_SUBSCRIPTION, status: 'past_due' });
    expect(resolveHealthAccess(decodeProfile(profileJSON({ health: { access: 'minor' } })), pastDue)).toBe('minor');
    expect(
      resolveHealthAccess(decodeProfile(profileJSON({ health: { access: 'trial_pending' } })), pastDue),
    ).toBe('past_due');
  });

  it('then a tier, then a pass, else no membership', () => {
    expect(resolveHealthAccess(decodeProfile(profileJSON({ usage: usage('plus') })), null)).toBe('entitled');
    expect(resolveHealthAccess(decodeProfile(profileJSON({ usage: usage(null, [adventurer]) })), null)).toBe('pass_only');
    expect(resolveHealthAccess(decodeProfile(profileJSON({ usage: usage(null) })), null)).toBe('not_member');
    expect(resolveHealthAccess(null, null)).toBe('not_member');
  });

  it("a 403's member pricing overrides it until a readable block answers", async () => {
    expect(accessOverrideFor('company_covered')).toBe('company_inactive');
    expect(accessOverrideFor('pass_holder')).toBe('pass_only');
    expect(accessOverrideFor(undefined)).toBe('not_member');

    api.on('GET', '/profile', Reply.ok(profileJSON({ health: { access: 'entitled' } })));
    await store().loadProfile();
    expect(store().healthAccess).toBe('entitled');
    store().applyHealthAccessOverride('company_covered');
    expect(store().healthAccess).toBe('company_inactive');
    await store().loadProfile();
    expect(store().healthAccess).toBe('entitled');

    // A profile whose block failed to read says nothing: the override stays.
    store().applyHealthAccessOverride('pass_holder');
    api.on('GET', '/profile', Reply.ok(profileJSON({ health: 'garbage' })));
    await store().loadProfile();
    expect(store().healthAccess).toBe('pass_only');
    store().clearHealthAccessOverride();
    expect(store().healthAccess).toBe('not_member');
  });

  it('follows the plan read too', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ usage: usage(null) })));
    api.on('GET', '/subscriptions', Reply.ok({ ...PLUS_SUBSCRIPTION, status: 'past_due' }));
    await store().loadProfile();
    expect(store().healthAccess).toBe('not_member');
    await store().loadSubscription();
    expect(store().healthAccess).toBe('past_due');
  });
});

describe('what the server supports', () => {
  it('a profile block carries the list; one without the key clears it', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ health: { access: 'entitled', features: ['target_weight', 'health_feedback'] } })));
    await store().loadProfile();
    expect(selectSupportsTargetWeight(store())).toBe(true);
    expect(selectSupportsFeedback(store())).toBe(true);
    expect(selectSupportsPlanRevision(store())).toBe(false);

    api.on('GET', '/profile', Reply.ok(profileJSON({ health: { access: 'entitled' } })));
    await store().loadProfile();
    expect(store().serverFeatures).toEqual([]);
  });

  it('a profile whose block failed to read says nothing either way', async () => {
    store().noteServerFeatures(['plan_revision']);
    api.on('GET', '/profile', Reply.ok(profileJSON({ health: { access: 42 } })));
    await store().loadProfile();
    expect(selectSupportsPlanRevision(store())).toBe(true);
  });

  it('last writer wins, and an answer without the list hides everything', () => {
    store().noteServerFeatures(['meal_describe', 'meal_describe', 'target_weight']);
    expect(store().serverFeatures).toEqual(['meal_describe', 'target_weight']);
    expect(selectSupportsMealDescribe(store())).toBe(true);
    store().noteServerFeatures(undefined);
    expect(store().serverFeatures).toEqual([]);
  });

  it('a 404 on one advertised route drops that flag alone', () => {
    store().noteServerFeatures(['target_weight', 'health_feedback']);
    store().dropServerFeature('health_feedback');
    expect(selectSupportsFeedback(store())).toBe(false);
    expect(selectSupportsTargetWeight(store())).toBe(true);
    store().clearServerFeatures();
    expect(store().serverFeatures).toEqual([]);
  });

  it('the list is not health data: a sign-out leaves it', async () => {
    store().noteServerFeatures(['target_weight']);
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER_A });
    await store().handleSignOut();
    expect(selectSupportsTargetWeight(store())).toBe(true);
  });
});

describe('a confirmed consent write, applied to the profile in hand', () => {
  const health = {
    access: 'entitled',
    consent: { version: '2026-09-v1', consentedAt: '2026-09-01T10:00:00Z', ageSource: 'kennitala' },
    latest: { weightKg: 72.5, heightCm: 170, measuredAt: '2026-09-14T07:30:00Z' },
    program: { id: 'p1', status: 'active', weekNo: 2, weeks: 4, summaryTitle: 'Build muscle' },
    features: ['target_weight'],
  };

  it('a withdrawal shows no health data at once, whatever the next read does', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ health })));
    await store().loadProfile();
    expect(selectHasHealthConsent(store())).toBe(true);
    store().applyHealthDataDeleted();
    expect(selectHasHealthConsent(store())).toBe(false);
    expect(store().profile?.health?.latest).toBeNull();
    expect(store().profile?.health?.program).toBeNull();
    expect(store().healthAccess).toBe('entitled');
  });

  it('a new consent shows at once, even on a profile whose block failed to read', async () => {
    api.on('GET', '/profile', Reply.ok(profileJSON({ health: 'garbage' })));
    await store().loadProfile();
    expect(store().profile?.health).toBeNull();
    store().applyHealthConsentGranted({ version: '2026-09-v1', consentedAt: null, ageSource: 'attestation' });
    expect(selectHasHealthConsent(store())).toBe(true);
    expect(store().profile?.health?.access).toBeNull();
  });

  it('with no profile in hand there is nothing to change', () => {
    store().applyHealthDataDeleted();
    store().applyHealthConsentGranted({ version: '2026-09-v1', consentedAt: null, ageSource: null });
    expect(store().profile).toBeNull();
  });
});
