/**
 * Every meal and food operation the app calls, behind one interface: the
 * Android port of iOS Services/MealService.swift (`MealAPI`, `LiveMealAPI`,
 * `MealAPIProvider`).
 *
 * WHY AN INTERFACE. The food log is used by people standing at a counter
 * with a plate going cold, so its screens have to be checked with real
 * content in them. Tests (and a development fixture run) swap in canned
 * answers with `setMealApi`, and every screen still renders through the real
 * decoders and the real item math. A release build only ever has `liveMealApi`.
 *
 * Rules this layer keeps for everyone:
 * - nothing here is cached: every member call goes out with `Cache-Control:
 *   no-store` (src/api/client.ts), and the public presets ask for it too, as
 *   iOS sends all meal traffic on a session with no disk cache;
 * - every WRITE takes an Idempotency-Key the CALLER minted once per member
 *   action; the two read POSTs (search, barcode) take none;
 * - food words and barcodes travel in a POST body, never in a URL;
 * - the scan and the describe (the paid model calls) are never retried here:
 *   a retry is the member's tap, with the same key;
 * - `?locale=` (or `locale` in the body) is the ACCOUNT language, `is` or
 *   `en`.
 *
 * Patience, as iOS sets it: 20 s (`HealthNetwork.defaultTimeout`) for the
 * reads and writes that name it, 8 s for a barcode, 20 s for the scan and the
 * describe, and the health session's 30 s for the rest.
 */
import { API_TIMEOUTS, apiDelete, apiGet, apiPatch, apiPost, isProblem } from '../../../api';
import { HEALTH_READ_TIMEOUT_MS, HEALTH_SESSION_TIMEOUT_MS } from '../../../health/api';
import {
  decodeBarcodeLookupResult,
  decodeFoodPresets,
  decodeFoodSearchResult,
  decodeMealDayRecord,
  decodeMealDescribeResult,
  decodeMealEnvelope,
  decodeMealScanResult,
  decodeMealWriteResult,
  decodeMyFoods,
  decodeOkAnswer,
} from '../types/decode';
import {
  encodeMealCopyBody,
  encodeMealCreateBody,
  encodeMealDescribeBody,
  encodeMealPatchBody,
  encodeMealScanBody,
} from '../types/encode';
import type {
  BarcodeLookupResult,
  FoodPresets,
  FoodSearchResult,
  MealCopyBody,
  MealCreateBody,
  MealDayRecord,
  MealDescribeBody,
  MealDescribeResult,
  MealPatchBody,
  MealRecord,
  MealScanBody,
  MealScanResult,
  MealWriteResult,
  MyFoods,
} from '../types/models';
import { characterPrefix, trimWhitespace } from '../types/text';

/** `HealthNetwork.defaultTimeout`: 20 s. */
export const MEAL_TIMEOUT_MS = HEALTH_READ_TIMEOUT_MS;
/** The health session's default: 30 s (hide, read one meal, delete). */
export const MEAL_SESSION_TIMEOUT_MS = HEALTH_SESSION_TIMEOUT_MS;
/** `MealService.barcode`: 8 s, a member holding a pack up to the camera. */
export const BARCODE_TIMEOUT_MS = API_TIMEOUTS.barcode;
/** `HealthNetwork.scanTimeout`: 20 s. */
export const SCAN_TIMEOUT_MS = API_TIMEOUTS.mealScan;
/** `HealthNetwork.describeTimeout`: 20 s. */
export const DESCRIBE_TIMEOUT_MS = API_TIMEOUTS.mealDescribe;

/** The longest search the server takes (`FoodSearchBody.q`, 60). */
export const SEARCH_QUERY_MAX = 60;

/** A caller's cancellation, for a read a screen may abandon (a search superseded by the next keystroke). */
export interface MealCallOptions {
  readonly signal?: AbortSignal;
}

/** Every meal and food call (iOS `MealAPI`). `language` is the account language. */
export interface MealApi {
  /** OP-39. Public library content: sent with a token when there is one, without one otherwise. */
  presets(language: string, options?: MealCallOptions): Promise<FoodPresets>;
  /** OP-40. */
  myFoods(language: string, options?: MealCallOptions): Promise<MyFoods>;
  /** OP-38. A read over POST so the typed words never sit in a URL. */
  search(query: string, language: string, options?: MealCallOptions): Promise<FoodSearchResult>;
  /** OP-31. */
  barcode(code: string, language: string, options?: MealCallOptions): Promise<BarcodeLookupResult>;
  /** OP-45. */
  hideFood(key: string, idempotencyKey: string): Promise<void>;
  /** OP-34. */
  createMeal(body: MealCreateBody, idempotencyKey: string): Promise<MealWriteResult>;
  /** OP-35. */
  patchMeal(id: string, body: MealPatchBody, idempotencyKey: string): Promise<MealWriteResult>;
  /** OP-46. */
  copyMeal(id: string, body: MealCopyBody, idempotencyKey: string): Promise<MealWriteResult>;
  /** OP-44. */
  meal(id: string, language: string, options?: MealCallOptions): Promise<MealRecord>;
  /** OP-33. */
  mealDay(date: string, language: string, options?: MealCallOptions): Promise<MealDayRecord>;
  /** OP-37. A retried delete that answers 404 already happened. */
  deleteMeal(id: string): Promise<void>;
  /** OP-32. The paid photo call: 20 s, never retried here. */
  scan(body: MealScanBody, idempotencyKey: string): Promise<MealScanResult>;
  /** OP-56. Called only while the server advertises `meal_describe`. Never retried here; the words are never logged. */
  describe(body: MealDescribeBody, idempotencyKey: string): Promise<MealDescribeResult>;
}

/** `is` or `en`: anything that is not Icelandic asks in English. */
export function mealLocale(language: string): 'is' | 'en' {
  return language === 'is' ? 'is' : 'en';
}

function segment(id: string): string {
  return encodeURIComponent(id);
}

/** The app's implementation, on the shared API client. */
export const liveMealApi: MealApi = {
  presets(language, options) {
    return apiGet('/health/foods/quick', { locale: mealLocale(language) }, {
      auth: 'optional',
      cache: 'no-store',
      timeoutMs: MEAL_TIMEOUT_MS,
      signal: options?.signal,
      decode: (data) => decodeFoodPresets(data, 'presets'),
    });
  },

  myFoods(language, options) {
    return apiGet('/health/foods/mine', { locale: mealLocale(language) }, {
      timeoutMs: MEAL_TIMEOUT_MS,
      signal: options?.signal,
      decode: (data) => decodeMyFoods(data, 'myFoods'),
    });
  },

  search(query, language, options) {
    return apiPost(
      '/health/foods/search',
      { q: characterPrefix(trimWhitespace(query), SEARCH_QUERY_MAX), locale: mealLocale(language) },
      {
        timeoutMs: MEAL_TIMEOUT_MS,
        signal: options?.signal,
        decode: (data) => decodeFoodSearchResult(data, 'search'),
      },
    );
  },

  barcode(code, language, options) {
    return apiPost(
      '/health/foods/barcode',
      { barcode: code, locale: mealLocale(language) },
      {
        timeoutMs: BARCODE_TIMEOUT_MS,
        signal: options?.signal,
        decode: (data) => decodeBarcodeLookupResult(data, 'barcode'),
      },
    );
  },

  hideFood(key, idempotencyKey) {
    return apiPost('/health/foods/mine/hide', { key }, {
      idempotencyKey,
      timeoutMs: MEAL_SESSION_TIMEOUT_MS,
      decode: (data) => decodeOkAnswer(data, 'hide'),
    });
  },

  createMeal(body, idempotencyKey) {
    return apiPost('/health/meals', encodeMealCreateBody(body), {
      idempotencyKey,
      timeoutMs: MEAL_TIMEOUT_MS,
      decode: (data) => decodeMealWriteResult(data, 'mealWrite'),
    });
  },

  patchMeal(id, body, idempotencyKey) {
    return apiPatch(`/health/meals/${segment(id)}`, encodeMealPatchBody(body), {
      idempotencyKey,
      timeoutMs: MEAL_TIMEOUT_MS,
      decode: (data) => decodeMealWriteResult(data, 'mealWrite'),
    });
  },

  copyMeal(id, body, idempotencyKey) {
    return apiPost(`/health/meals/${segment(id)}/copy`, encodeMealCopyBody(body), {
      idempotencyKey,
      timeoutMs: MEAL_TIMEOUT_MS,
      decode: (data) => decodeMealWriteResult(data, 'mealWrite'),
    });
  },

  meal(id, language, options) {
    return apiGet(`/health/meals/${segment(id)}`, { locale: mealLocale(language) }, {
      timeoutMs: MEAL_SESSION_TIMEOUT_MS,
      signal: options?.signal,
      decode: (data) => decodeMealEnvelope(data, 'meal'),
    });
  },

  mealDay(date, language, options) {
    return apiGet('/health/meals', { locale: mealLocale(language), date }, {
      timeoutMs: MEAL_TIMEOUT_MS,
      signal: options?.signal,
      decode: (data) => decodeMealDayRecord(data, 'mealDay'),
    });
  },

  async deleteMeal(id) {
    try {
      await apiDelete(`/health/meals/${segment(id)}`, undefined, {
        timeoutMs: MEAL_SESSION_TIMEOUT_MS,
        decode: (data) => decodeOkAnswer(data, 'delete'),
      });
    } catch (error) {
      // A retried delete whose first attempt went through: already done.
      if (isProblem(error, 'health_meal_not_found')) return;
      throw error;
    }
  },

  scan(body, idempotencyKey) {
    return apiPost('/health/meals/scan', encodeMealScanBody(body), {
      idempotencyKey,
      timeoutMs: SCAN_TIMEOUT_MS,
      decode: (data) => decodeMealScanResult(data, 'scan'),
    });
  },

  describe(body, idempotencyKey) {
    return apiPost('/health/meals/describe', encodeMealDescribeBody(body), {
      idempotencyKey,
      timeoutMs: DESCRIBE_TIMEOUT_MS,
      decode: (data) => decodeMealDescribeResult(data, 'describe'),
    });
  },
};

let current: MealApi = liveMealApi;

/** The implementation the screens and stores use (iOS `MealAPIProvider.api`). */
export function mealApi(): MealApi {
  return current;
}

/**
 * Swaps the implementation (tests, a development fixture run), before any
 * screen reads it. `null` puts the live one back.
 */
export function setMealApi(api: MealApi | null): void {
  current = api ?? liveMealApi;
}
