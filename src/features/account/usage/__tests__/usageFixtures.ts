/**
 * `GET /profile`'s `usage` block and `GET /subscriptions` as the server sends
 * them, read through the app's own decoders, for the Plan & usage tests.
 */
import { decodeUsage, type Usage } from '../../../../api/profile';
import { decodeSubscription, type Subscription } from '../../../../api/subscriptions';

type Json = Record<string, unknown>;

export const PASS_ID = '9b1c2d3e-0000-4000-8000-000000000001';
export const PASS_ID_2 = '9b1c2d3e-0000-4000-8000-000000000002';

/** A Plus member mid-period: 3 of 8 gym visits, 1 of 4 pool visits, 0 of 2 today, 1 of 3 open bookings. */
export function usageJSON(overrides: Json = {}): Json {
  return {
    tier: 'plus',
    network: { used: 3, cap: 8, resetsAt: '2026-11-01T00:00:00.000Z' },
    pools: { used: 1, cap: 4, resetsAt: '2026-11-01T00:00:00.000Z' },
    daily: { used: 0, cap: 2 },
    concurrent: { open: 1, cap: 3 },
    topup: { available: false, prices: { gym: 1490, studio: 1990, pool: 990 } },
    passes: [],
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
    ...overrides,
  };
}

/** A pass-only member: no tier, no lanes, one Adventurer pass. */
export function passOnlyUsageJSON(passes: Json[] = [adventurerPass()]): Json {
  return usageJSON({
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes,
  });
}

export function adventurerPass(overrides: Json = {}): Json {
  return { id: PASS_ID, type: 'adventurer', visitsLeft: 5, expiresAt: '2026-12-31T23:59:59.000Z', ...overrides };
}

export function usage(json: Json = usageJSON()): Usage {
  return decodeUsage(json);
}

export const PLUS_SUBSCRIPTION_JSON = {
  id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
  productSlug: 'plan-plus',
  productName: 'LifePass Plus',
  status: 'active',
  currentPeriodStartsAt: '2026-10-01T00:00:00.000Z',
  currentPeriodEndsAt: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
};

export function subscription(overrides: Json = {}): Subscription {
  return decodeSubscription({ ...PLUS_SUBSCRIPTION_JSON, ...overrides })!;
}
