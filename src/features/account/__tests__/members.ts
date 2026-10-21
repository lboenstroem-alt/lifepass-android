/**
 * The member the Account tests sign in: `GET /profile` and `GET /subscriptions`
 * JSON as the API sends it, read into the app store through the real
 * decoders. Kept apart from ./harness.tsx so a test of the screen's logic
 * does not load the screen.
 */
import { decodeProfile } from '../../../api/profile';
import { decodeSubscription } from '../../../api/subscriptions';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { resetCompanyContext } from '../companyContext';

export const MEMBER_ID = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

export const LANES = {
  tier: 'plus',
  network: { used: 3, cap: 8, resetsAt: '2026-11-01T00:00:00.000Z' },
  pools: { used: 2, cap: 4, resetsAt: '2026-11-01T00:00:00.000Z' },
};

export const ADVENTURER = {
  id: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d',
  type: 'adventurer',
  visitsLeft: 5,
  expiresAt: '2026-12-07T23:35:00.000Z',
};

/** `GET /profile`'s usage block: no tier, no lanes, no passes unless given. */
export function usageJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: [],
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
    ...extra,
  };
}

/** `GET /profile`'s data. */
export function profileJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEMBER_ID,
    email: 'anna@example.com',
    fullName: 'Anna Jónsdóttir',
    locale: 'en',
    kennitalaVerified: false,
    marketingConsent: false,
    usage: usageJSON(),
    ...extra,
  };
}

/** `GET /subscriptions`' data for a Plus member. */
export function subscriptionJSON(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
    productSlug: 'plan-plus',
    productName: 'Plus',
    status: 'active',
    currentPeriodStartsAt: '2026-09-01T10:14:03.512Z',
    currentPeriodEndsAt: '2026-10-01T10:14:03.512Z',
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    ...extra,
  };
}

/** A fresh launch with this member signed in and read; the app store derives the language from the profile. */
export function signedInAs(profile: Record<string, unknown>, subscription: Record<string, unknown> | null = null): void {
  resetAppStoreForTests();
  resetCompanyContext();
  useAppStore.setState({
    isLoading: false,
    isAuthenticated: true,
    userId: MEMBER_ID,
    profile: decodeProfile(profile),
    subscription: decodeSubscription(subscription),
    subscriptionLoaded: true,
  });
}

/** The subscriber the screen tests use most: Plus, with lanes. */
export function signedInAsSubscriber(extra: Record<string, unknown> = {}): void {
  signedInAs(profileJSON({ usage: usageJSON(LANES), ...extra }), subscriptionJSON());
}
