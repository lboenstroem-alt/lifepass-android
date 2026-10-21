/**
 * The Plan & usage rules (iOS CreditsDetailView), without React: the banner,
 * the plan name, the top-up prompt's priority, the lane meters, the empty
 * states and the date.
 */
import {
  laneMeter,
  topUpPrompt,
  usageBanner,
  usageDate,
  usageEmptyState,
  usagePlanName,
} from '../usageModel';
import { passOnlyUsageJSON, subscription, usage, usageJSON } from './usageFixtures';

const NOW = new Date('2026-10-17T12:00:00Z');

describe('the banner', () => {
  it('a block whose until is still ahead is the block', () => {
    const blocked = usage(usageJSON({ block: { until: '2026-10-20T00:00:00Z' }, strikes: { active: 3, threshold: 3 } }));
    expect(usageBanner(blocked, NOW)).toEqual({ kind: 'block', until: new Date('2026-10-20T00:00:00Z') });
  });

  it('a past until is never rendered as a ban: the strikes speak instead, or nothing', () => {
    const lifted = usage(usageJSON({ block: { until: '2026-10-01T00:00:00Z' }, strikes: { active: 2, threshold: 3 } }));
    expect(usageBanner(lifted, NOW)).toEqual({ kind: 'strikes', active: 2, threshold: 3 });
    const clean = usage(usageJSON({ block: { until: '2026-10-01T00:00:00Z' } }));
    expect(usageBanner(clean, NOW)).toBeNull();
  });

  it('one strike is enough for the strikes banner; none and no usage block show nothing', () => {
    expect(usageBanner(usage(usageJSON({ strikes: { active: 1, threshold: 3 } })), NOW)).toEqual({
      kind: 'strikes',
      active: 1,
      threshold: 3,
    });
    expect(usageBanner(usage(), NOW)).toBeNull();
    expect(usageBanner(null, NOW)).toBeNull();
  });
});

describe('the plan name', () => {
  it("the live subscription's display name first", () => {
    expect(usagePlanName(subscription(), usage())).toBe('LifePass Plus');
    expect(usagePlanName(subscription({ status: 'past_due' }), usage())).toBe('LifePass Plus');
  });

  it('else the tier capitalised, else a dash', () => {
    expect(usagePlanName(null, usage())).toBe('Plus');
    expect(usagePlanName(subscription({ status: 'cancelled' }), usage(usageJSON({ tier: 'max' })))).toBe('Max');
    expect(usagePlanName(null, usage(passOnlyUsageJSON()))).toBe('—');
    expect(usagePlanName(null, null)).toBe('—');
  });
});

describe('the top-up prompt', () => {
  it('gym and studio first, when out of them and a gym price is known', () => {
    const bothOut = usage(usageJSON({ network: { used: 8, cap: 8 }, pools: { used: 4, cap: 4 } }));
    expect(topUpPrompt(bothOut)).toEqual({ key: 'usage.topup.gym', price: 'ISK 1,490' });
  });

  it('then the pool', () => {
    const poolOut = usage(usageJSON({ pools: { used: 5, cap: 4 } }));
    expect(topUpPrompt(poolOut)).toEqual({ key: 'usage.topup.pool', price: 'ISK 990' });
    const gymOutNoPrice = usage(
      usageJSON({
        network: { used: 8, cap: 8 },
        pools: { used: 4, cap: 4 },
        topup: { available: true, prices: { gym: null, studio: null, pool: 990 } },
      }),
    );
    expect(topUpPrompt(gymOutNoPrice)).toEqual({ key: 'usage.topup.pool', price: 'ISK 990' });
  });

  it('none with visits left, or with no price to quote', () => {
    expect(topUpPrompt(usage())).toBeNull();
    const noPrices = usage(
      usageJSON({ network: { used: 8, cap: 8 }, topup: { available: true, prices: { gym: null, studio: null, pool: null } } }),
    );
    expect(topUpPrompt(noPrices)).toBeNull();
  });
});

describe('a lane', () => {
  it('what is left, the limit and the bar', () => {
    expect(laneMeter(3, 8)).toEqual({ remaining: 5, atLimit: false, fraction: 3 / 8 });
    expect(laneMeter(8, 8)).toEqual({ remaining: 0, atLimit: true, fraction: 1 });
    expect(laneMeter(9, 8)).toEqual({ remaining: 0, atLimit: true, fraction: 1 });
    expect(laneMeter(0, 0)).toEqual({ remaining: 0, atLimit: true, fraction: 0 });
  });
});

describe('the empty states', () => {
  it('past due with no tier and no passes is the payment issue, not "no plan"', () => {
    const suspended = usage(passOnlyUsageJSON([]));
    expect(usageEmptyState(suspended, 0, subscription({ status: 'past_due' }))).toBe('pastDue');
    expect(usageEmptyState(suspended, 0, null)).toBe('noPlan');
    expect(usageEmptyState(null, 0, null)).toBe('noPlan');
  });

  it('a tier or a pass means neither', () => {
    expect(usageEmptyState(usage(), 0, subscription())).toBeNull();
    expect(usageEmptyState(usage(passOnlyUsageJSON()), 1, null)).toBeNull();
  });
});

describe('the date', () => {
  it('d MMM yyyy on the Reykjavik calendar, in the account language', () => {
    expect(usageDate(new Date('2026-06-01T00:00:00Z'), 'en')).toBe('1 Jun 2026');
    expect(usageDate(new Date('2026-09-05T00:00:00Z'), 'en')).toBe('5 Sept 2026');
    expect(usageDate(new Date('2026-06-01T00:00:00Z'), 'is')).toBe('1 jún. 2026');
    // 23:30 in Reykjavik is still that day, whatever zone the phone is in.
    expect(usageDate(new Date('2026-10-31T23:30:00Z'), 'en')).toBe('31 Oct 2026');
  });
});
