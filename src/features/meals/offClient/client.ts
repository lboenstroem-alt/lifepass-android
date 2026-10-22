/**
 * OP-41: the barcode lookup, straight from the phone to Open Food Facts (the
 * port of iOS `FoodFactsService`, api-contract.md 5.1).
 *
 * THE SERVER NEVER CALLS OPEN FOOD FACTS. The request carries the barcode
 * (in the path), the phone's IP address and the app version in the
 * User-Agent, and nothing else: no cookie (`credentials: 'omit'`, which
 * React Native's networking honours with a cookie-less client), no account,
 * no LifePass id. The first-use card in Barcode mode says exactly that.
 * Answers live in memory for the app session (the last 50, failures never
 * kept) and are never written to disk; nothing asks the HTTP layer to cache
 * them either.
 *
 * Not through src/api: this is a third party, and none of the LifePass
 * client's headers, tokens or retries may reach it.
 */
import * as Application from 'expo-application';

import { VALID_BARCODE_LENGTHS } from '../barcode/normaliser';

import { OFF_FAILED, OFF_NOT_FOUND, parseOffProduct, type OFFLookupOutcome } from './parse';

/** The fields asked for, and no more: the lookup is small and says what it wants. */
export const OFF_FIELDS = 'code,product_name,product_name_is,product_name_en,brands,serving_size,serving_quantity,quantity,nutriments';
export const OFF_TIMEOUT_MS = 8_000;
/** Answers kept in memory for the session (iOS `NSCache.countLimit`). */
export const OFF_CACHE_LIMIT = 50;
export const OFF_HOST = 'https://world.openfoodfacts.org';

/** `LifePass-Android/<version> (support@lifepass.is)`: who is asking, as Open Food Facts asks apps to say. */
export function offUserAgent(version: string | null = Application.nativeApplicationVersion): string {
  return `LifePass-Android/${version ?? '0'} (support@lifepass.is)`;
}

/** The product read: the code in the path, the field list in the query, nothing else. */
export function offProductUrl(barcode: string): string {
  // The field list as iOS's URLComponents writes it: commas are fine in a query.
  return `${OFF_HOST}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
}

/** The seam Barcode mode calls, so a test or a fixture run can answer without the network. */
export interface FoodFactsLookup {
  lookup(barcode: string, language: string): Promise<OFFLookupOutcome>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'text'>>;

export class FoodFactsService implements FoodFactsLookup {
  private readonly cache = new Map<string, OFFLookupOutcome>();

  constructor(
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async lookup(barcode: string, language: string): Promise<OFFLookupOutcome> {
    const cacheKey = `${language}:${barcode}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Most recently used goes last, so the oldest is the one dropped.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }
    if (!VALID_BARCODE_LENGTHS.has(barcode.length) || !/^\d+$/.test(barcode)) return OFF_NOT_FOUND;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
    let outcome: OFFLookupOutcome;
    try {
      const response = await this.fetchImpl(offProductUrl(barcode), {
        method: 'GET',
        headers: {
          'User-Agent': offUserAgent(),
          Accept: 'application/json',
          // A header, not fetch's `cache` option: the polyfill would add a
          // cache-busting `_=` to the URL, which says more than it needs to.
          'Cache-Control': 'no-store',
        },
        credentials: 'omit',
        signal: controller.signal,
      });
      if (response.status === 200) {
        outcome = parseOffProduct(await response.text(), barcode, language, this.now());
      } else if (response.status === 404) {
        outcome = OFF_NOT_FOUND;
      } else {
        outcome = OFF_FAILED;
      }
    } catch {
      return OFF_FAILED;
    } finally {
      clearTimeout(timer);
    }
    if (outcome.kind !== 'failed') this.remember(cacheKey, outcome);
    return outcome;
  }

  private remember(key: string, outcome: OFFLookupOutcome): void {
    this.cache.delete(key);
    this.cache.set(key, outcome);
    while (this.cache.size > OFF_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /** Forget every answer (sign-out). */
  clear(): void {
    this.cache.clear();
  }

  /** Tests: how many answers are kept. */
  get cachedCount(): number {
    return this.cache.size;
  }
}

const shared = new FoodFactsService();
let current: FoodFactsLookup = shared;

/** The lookup Barcode mode uses (iOS `MealAPIProvider.foodFacts`). */
export function foodFacts(): FoodFactsLookup {
  return current;
}

/** Swap the lookup (tests, a fixture run); null puts the live one back. */
export function setFoodFacts(lookup: FoodFactsLookup | null): void {
  current = lookup ?? shared;
}

/** Forget the session's answers (sign-out: which products a member looked at is theirs). */
export function clearFoodFactsCache(): void {
  shared.clear();
}
