/**
 * Catalogues for the plans tests, in the API's JSON (the iOS tests'
 * `catalogueWithoutPool` and `pass(...)`). Prices are the catalogue seed's,
 * for the tests only.
 */
export interface PassJson {
  readonly slug: string;
  readonly name: string;
  readonly priceIsk: number;
  readonly visits: number;
  readonly validityDays: number;
}

export function pass(slug: string, priceIsk: number, visits = 1, validityDays = 1): PassJson {
  return { slug, name: slug, priceIsk, visits, validityDays };
}

export interface TierJson {
  readonly slug: string;
  readonly name: string;
  readonly priceIsk: number;
  readonly productSlug: string | null;
  readonly networkCap: number;
  readonly poolCap: number;
  readonly dailyCap: number;
  readonly popular: boolean;
}

export function tier(slug: string, priceIsk: number, caps: [number, number, number], popular = false): TierJson {
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return {
    slug,
    name,
    priceIsk,
    productSlug: `plan-${slug}`,
    networkCap: caps[0],
    poolCap: caps[1],
    dailyCap: caps[2],
    popular,
  };
}

export interface CatalogueJson {
  readonly tiers: readonly TierJson[];
  readonly dayPasses: readonly PassJson[];
  readonly packs: readonly PassJson[];
}

/**
 * The catalogue as production serves it since the Pool Day Pass went off
 * sale: no pool day pass, the passes in price order (the server's, not the
 * app's), and Plus as the only tier (iOS PlansCatalogPassesTests).
 */
export const CATALOGUE_WITHOUT_POOL: CatalogueJson = {
  tiers: [tier('plus', 14_900, [8, 6, 2], true)],
  dayPasses: [pass('pass-day-gym', 2_990), pass('pass-day-studio', 3_490)],
  packs: [pass('pass-explorer', 7_900, 3, 30), pass('pass-adventurer', 14_900, 6, 60), pass('pass-local', 28_900, 12, 90)],
};

/** All three tiers (iOS PlansScreenshotFixtures). */
export const FULL_CATALOGUE: CatalogueJson = {
  ...CATALOGUE_WITHOUT_POOL,
  tiers: [tier('base', 8_900, [5, 4, 1]), tier('plus', 14_900, [8, 6, 2], true), tier('max', 24_900, [12, 8, 2])],
};

/** `CATALOGUE_WITHOUT_POOL` with some members replaced. */
export function catalogue(overrides: Partial<CatalogueJson>): CatalogueJson {
  return { ...CATALOGUE_WITHOUT_POOL, ...overrides };
}
