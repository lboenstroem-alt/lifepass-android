/**
 * The live, priced catalogue (`GET /catalog/plans`): the SAME reader that
 * backs lifepass.is/plans. The Android port of iOS `PlanCatalog` (Models/
 * Plan.swift) and `PaymentService.fetchPlanCatalog`.
 *
 * WHY THIS EXISTS. The static plan list (./plans.ts) deliberately carries no
 * ISK figure, on the old reasoning that the hosted checkout page owns the
 * price. The result was a member choosing a subscription without ever being
 * shown what it costs. Prices now come from the server so the app and the
 * website cannot disagree: a price that differs between the two would be worse
 * than the app showing none at all.
 *
 * The static list keeps owning the COPY (names, feature lines, which card is
 * "popular") because that is editorial and translated; the catalogue owns the
 * NUMBERS. They are joined on the product slug.
 *
 * The route is public on the server (choosing a plan precedes having an
 * account); the app asks it like iOS does, as the signed-in member. Callers
 * treat a failure as "no prices available" and still render the cards: a
 * member who cannot see a price is worse off than before, but a member who
 * cannot see the PLANS is worse off still.
 */
import { apiGet } from '../../api';

export interface CatalogTier {
  readonly slug: string;
  readonly name: string;
  readonly priceIsk: number;
  /**
   * The product slug a subscribe button checks out. Null when no active
   * monthly product is bound: the price still renders, but there is nothing
   * to buy.
   */
  readonly productSlug: string | null;
  readonly networkCap: number;
  readonly poolCap: number;
  readonly dailyCap: number;
  readonly popular: boolean;
}

export interface CatalogPassSku {
  readonly slug: string;
  readonly name: string;
  readonly priceIsk: number;
  readonly visits: number;
  readonly validityDays: number;
}

export interface PlanCatalog {
  readonly tiers: readonly CatalogTier[];
  readonly dayPasses: readonly CatalogPassSku[];
  readonly packs: readonly CatalogPassSku[];
}

// ---------------------------------------------------------------------------
// Decoding

/**
 * Strict, as iOS's `Decodable` is: a member that is missing or of the wrong
 * type fails the WHOLE read, so the screen falls back to no catalogue (the
 * built-in passes without those off sale, no prices) rather than drawing
 * cards from half an answer. Members the app does not read (`perVenueCap`,
 * `passType`, `category`, ...) are ignored, so a richer answer still reads.
 */
type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} is not an object`);
  }
  return value as Json;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new TypeError(`${path} is not a string`);
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`${path} is not an integer`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} is not a boolean`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} is not an array`);
  return value;
}

function decodeTier(value: unknown, path: string): CatalogTier {
  const json = object(value, path);
  const productSlug = json.productSlug;
  return {
    slug: string(json.slug, `${path}.slug`),
    name: string(json.name, `${path}.name`),
    priceIsk: integer(json.priceIsk, `${path}.priceIsk`),
    // Optional on iOS: absent or null is "nothing to buy".
    productSlug: productSlug === undefined || productSlug === null ? null : string(productSlug, `${path}.productSlug`),
    networkCap: integer(json.networkCap, `${path}.networkCap`),
    poolCap: integer(json.poolCap, `${path}.poolCap`),
    dailyCap: integer(json.dailyCap, `${path}.dailyCap`),
    popular: boolean(json.popular, `${path}.popular`),
  };
}

function decodePass(value: unknown, path: string): CatalogPassSku {
  const json = object(value, path);
  return {
    slug: string(json.slug, `${path}.slug`),
    name: string(json.name, `${path}.name`),
    priceIsk: integer(json.priceIsk, `${path}.priceIsk`),
    visits: integer(json.visits, `${path}.visits`),
    validityDays: integer(json.validityDays, `${path}.validityDays`),
  };
}

/** The envelope's `data` as a catalogue; throws on any shape iOS would refuse. */
export function decodePlanCatalog(data: unknown): PlanCatalog {
  const json = object(data, 'catalog');
  return {
    tiers: array(json.tiers, 'tiers').map((tier, i) => decodeTier(tier, `tiers[${i}]`)),
    dayPasses: array(json.dayPasses, 'dayPasses').map((pass, i) => decodePass(pass, `dayPasses[${i}]`)),
    packs: array(json.packs, 'packs').map((pass, i) => decodePass(pass, `packs[${i}]`)),
  };
}

/** `GET /catalog/plans`: the live priced catalogue. Throws the API client's errors; callers swallow them. */
export function fetchPlanCatalog(options: { signal?: AbortSignal } = {}): Promise<PlanCatalog> {
  return apiGet<PlanCatalog>('/catalog/plans', undefined, { decode: decodePlanCatalog, signal: options.signal });
}

// ---------------------------------------------------------------------------
// Reading it

/** Every pass the catalogue sells, day passes and packs alike. */
export function passSlugs(catalog: PlanCatalog): Set<string> {
  return new Set([...catalog.dayPasses, ...catalog.packs].map((pass) => pass.slug));
}

/**
 * The price (ISK) for a `plan-*` or `pass-*` slug, or null when the catalogue
 * has no entry (an unlisted SKU, or a server too old to serve this route).
 * Null must render as "no price shown", never as 0.
 */
export function priceIskForSlug(catalog: PlanCatalog, slug: string): number | null {
  const tier = catalog.tiers.find((t) => t.productSlug === slug);
  if (tier) return tier.priceIsk;
  const pass = [...catalog.dayPasses, ...catalog.packs].find((p) => p.slug === slug);
  return pass ? pass.priceIsk : null;
}

/**
 * The tier row backing a `plan-*` slug: the source of the visit-cap facts a
 * card states. The same join as `priceIskForSlug`, so a card can never show a
 * price from one tier and visit counts from another.
 */
export function tierForSlug(catalog: PlanCatalog, slug: string): CatalogTier | null {
  return catalog.tiers.find((t) => t.productSlug === slug) ?? null;
}
