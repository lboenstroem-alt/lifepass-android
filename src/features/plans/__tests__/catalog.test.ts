/**
 * The visitor passes the plans screen offers, and a pass taken off sale
 * (iOS PlansCatalogPassesTests, the catalogue half; the checkout half is in
 * purchase.test.ts).
 *
 * The Pool Day Pass went off sale on 6 October 2026: production's catalogue
 * no longer lists it, and checkout refuses its slug with `404
 * product_not_on_sale`. Once the catalogue has answered, only the passes it
 * lists get a card; the built-in list, without the passes known to be off
 * sale, is the fallback while there is no catalogue, so the pool pass never
 * shows before the catalogue answers or when it can't be read, and only the
 * catalogue listing it again brings it back.
 */
import { api, Reply, type StubReply } from '@test/server';

import { installStubApiClient, replyFromContract, stubApiClientPerTest } from '../../../api/testing';
import { iskPrefix } from '../../../i18n';
import { decodePlanCatalog, fetchPlanCatalog, passSlugs, priceIskForSlug, tierForSlug } from '../catalog';
import { currentPlanCatalog, loadPlanCatalog, resetPlanCatalog } from '../catalogStore';
import { displayName, planForSlug, VISITOR_PACKAGES, visitorPasses } from '../plans';
import { priceLabel } from '../pricing';
import { catalogue, CATALOGUE_WITHOUT_POOL, pass } from './fixtures';

stubApiClientPerTest();

beforeEach(() => resetPlanCatalog());

const serveCatalogue = (json: object | null) =>
  api.on('GET', '/catalog/plans', json ? Reply.ok(json) : Reply.problem(503, 'internal_error'));

const shown = () => visitorPasses(currentPlanCatalog()).map((p) => p.id);

/** The passes without a catalogue: the built-in list, in its order, without the pool pass. */
const FALLBACK_IDS = ['pass-explorer', 'pass-adventurer', 'pass-local', 'pass-day-gym', 'pass-day-studio'];

describe('which passes get a card', () => {
  it('production now: the pool pass is not in the catalogue, so it gets no card; packs first', async () => {
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await loadPlanCatalog();
    expect(shown()).toEqual(['pass-explorer', 'pass-adventurer', 'pass-local', 'pass-day-gym', 'pass-day-studio']);
    expect(shown()).not.toContain('pass-day-pool');
  });

  it('the pool pass never shows without a catalogue, and a missing catalogue is silent', async () => {
    expect(shown()).toEqual(FALLBACK_IDS);
    const failures: [string, StubReply][] = [
      ['503', Reply.problem(503, 'internal_error')],
      ['offline', Reply.fail()],
      ['old server, no route', Reply.problem(404, 'not_found')],
      ['unreadable answer', Reply.ok({ tiers: 'nope' })],
      ['a gateway page', Reply.raw(502, '<html><body>Bad gateway</body></html>')],
    ];
    for (const [label, reply] of failures) {
      resetPlanCatalog();
      api.on('GET', '/catalog/plans', reply);
      await expect(loadPlanCatalog()).resolves.toBeUndefined();
      expect([label, currentPlanCatalog()]).toEqual([label, null]);
      expect([label, shown()]).toEqual([label, FALLBACK_IDS]);
    }
  });

  it('a timed-out read leaves the built-in list too', async () => {
    const session = installStubApiClient({ defaultTimeoutMs: 30 });
    try {
      api.on('GET', '/catalog/plans', Reply.hang());
      await loadPlanCatalog();
      expect(currentPlanCatalog()).toBeNull();
      expect(shown()).toEqual(FALLBACK_IDS);
    } finally {
      session.restore();
    }
  });

  it('a re-read that fails keeps the catalogue on screen: one bad refresh never brings the pool pass back', async () => {
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await loadPlanCatalog();
    serveCatalogue(null);
    await loadPlanCatalog();
    expect(currentPlanCatalog()).not.toBeNull();
    expect(shown()).not.toContain('pass-day-pool');
  });

  it('a pass back on sale gets its card back, in its usual place, with its own copy', async () => {
    serveCatalogue(
      catalogue({ dayPasses: [pass('pass-day-pool', 1_490), pass('pass-day-gym', 2_990), pass('pass-day-studio', 3_490)] }),
    );
    expect(shown()).not.toContain('pass-day-pool');
    await loadPlanCatalog();
    expect(shown()).toEqual(VISITOR_PACKAGES.map((p) => p.id));
    const pool = visitorPasses(currentPlanCatalog()).find((p) => p.id === 'pass-day-pool')!;
    expect(displayName(pool, 'en')).toBe('Pool Day Pass');
    expect(displayName(pool, 'is')).toBe('Sundlaug dagspassi');
    expect(priceLabel(pool, currentPlanCatalog())).toBe(iskPrefix(1_490));
  });

  it('only passes this build knows and the catalogue sells are shown; none at all shows none', async () => {
    serveCatalogue(
      catalogue({ dayPasses: [pass('pass-day-lagoon', 9_990)], packs: [pass('pass-local', 28_900, 12, 90)] }),
    );
    await loadPlanCatalog();
    expect(shown()).toEqual(['pass-local']);

    serveCatalogue(catalogue({ dayPasses: [], packs: [] }));
    await loadPlanCatalog();
    expect(shown()).toEqual([]);
  });
});

describe('one catalogue per visit', () => {
  it('a reset forgets the catalogue, and an answer for the visit before is dropped', async () => {
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await loadPlanCatalog();
    expect(currentPlanCatalog()).not.toBeNull();
    resetPlanCatalog();
    expect(currentPlanCatalog()).toBeNull();

    api.on('GET', '/catalog/plans', Reply.delayed(20, Reply.ok(CATALOGUE_WITHOUT_POOL)));
    const late = loadPlanCatalog();
    resetPlanCatalog();
    await late;
    expect(currentPlanCatalog()).toBeNull();
  });

  it('an older, slower answer never replaces a newer one', async () => {
    api.once('GET', '/catalog/plans', Reply.delayed(40, Reply.ok(catalogue({ packs: [] }))));
    const older = loadPlanCatalog();
    api.on('GET', '/catalog/plans', Reply.ok(CATALOGUE_WITHOUT_POOL));
    await loadPlanCatalog();
    await older;
    expect(currentPlanCatalog()?.packs).toHaveLength(3);
  });
});

describe('the read', () => {
  it('asks GET /catalog/plans as the member, with nothing in the query', async () => {
    serveCatalogue(CATALOGUE_WITHOUT_POOL);
    await fetchPlanCatalog();
    const sent = api.sent('/catalog/plans', 'GET');
    expect(sent.query).toEqual({});
    expect(sent.headers.authorization).toBe('Bearer test-token');
  });

  it("reads the contract's own sample of the answer", async () => {
    api.on('GET', '/catalog/plans', replyFromContract('GET', '/catalog/plans', 200, 'full'));
    await expect(fetchPlanCatalog()).resolves.toEqual(
      expect.objectContaining({ tiers: expect.any(Array), dayPasses: expect.any(Array), packs: expect.any(Array) }),
    );
  });

  it('reads production\'s shape, members the app does not use included', () => {
    const decoded = decodePlanCatalog({
      tiers: [
        {
          slug: 'plus',
          name: 'Plus',
          priceIsk: 14_900,
          productSlug: 'plan-plus',
          networkCap: 10,
          poolCap: 15,
          dailyCap: 2,
          perVenueCap: 6,
          boutiquePerVenueCap: 2,
          concurrentCap: 3,
          popular: true,
        },
        { slug: 'legacy', name: 'Legacy', priceIsk: 1, productSlug: null, networkCap: 1, poolCap: 1, dailyCap: 1, popular: false },
      ],
      dayPasses: [{ slug: 'pass-day-gym', name: 'Gym Day Pass', priceIsk: 2_990, passType: 'day', visits: 1, validityDays: 1, category: 'gym' }],
      packs: [],
    });
    expect(decoded.tiers[0]).toEqual({
      slug: 'plus',
      name: 'Plus',
      priceIsk: 14_900,
      productSlug: 'plan-plus',
      networkCap: 10,
      poolCap: 15,
      dailyCap: 2,
      popular: true,
    });
    expect(decoded.tiers[1].productSlug).toBeNull();
    expect(decoded.dayPasses[0]).toEqual({ slug: 'pass-day-gym', name: 'Gym Day Pass', priceIsk: 2_990, visits: 1, validityDays: 1 });
  });

  it('refuses half an answer, as iOS Decodable does', () => {
    const tier = CATALOGUE_WITHOUT_POOL.tiers[0];
    expect(() => decodePlanCatalog({ ...CATALOGUE_WITHOUT_POOL, packs: undefined })).toThrow();
    expect(() => decodePlanCatalog({ ...CATALOGUE_WITHOUT_POOL, tiers: [{ ...tier, priceIsk: '14900' }] })).toThrow();
    expect(() => decodePlanCatalog({ ...CATALOGUE_WITHOUT_POOL, tiers: [{ ...tier, dailyCap: 1.5 }] })).toThrow();
    expect(() => decodePlanCatalog({ ...CATALOGUE_WITHOUT_POOL, dayPasses: [{ slug: 'pass-day-gym' }] })).toThrow();
    expect(() => decodePlanCatalog(null)).toThrow();
  });
});

describe('joining the catalogue to the cards', () => {
  const read = decodePlanCatalog(CATALOGUE_WITHOUT_POOL);

  it('prices a plan by its product slug and a pass by its slug; an unlisted one has none, never 0', () => {
    expect(priceIskForSlug(read, 'plan-plus')).toBe(14_900);
    expect(priceIskForSlug(read, 'pass-day-gym')).toBe(2_990);
    expect(priceIskForSlug(read, 'pass-local')).toBe(28_900);
    expect(priceIskForSlug(read, 'plan-base')).toBeNull();
    expect(priceIskForSlug(read, 'pass-day-pool')).toBeNull();
    expect(priceLabel(planForSlug('plan-base')!, read)).toBeNull();
    expect(priceLabel(planForSlug('plan-plus')!, null)).toBeNull();
    expect(priceLabel(planForSlug('plan-plus')!, read)).toBe('ISK 14,900');
  });

  it('takes the visit caps from the same tier row as the price', () => {
    expect(tierForSlug(read, 'plan-plus')).toEqual(expect.objectContaining({ networkCap: 8, poolCap: 6, dailyCap: 2 }));
    expect(tierForSlug(read, 'plus')).toBeNull();
    expect([...passSlugs(read)].sort()).toEqual(
      ['pass-adventurer', 'pass-day-gym', 'pass-day-studio', 'pass-explorer', 'pass-local'].sort(),
    );
  });
});
