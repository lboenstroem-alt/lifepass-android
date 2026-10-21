/**
 * Fail-soft decoders for the meal models: the TypeScript form of the custom
 * `init(from:)` of each type in iOS Models/MealModels.swift, read for read.
 *
 * The readers (`req`, `opt`, `soft`) are the health platform's
 * (src/health/decode.ts), which already mean what Swift means:
 *
 * - `req`: `try c.decode`: present and readable, or the whole value throws;
 * - `opt`: `try c.decodeIfPresent`: absent or null is null, present must read
 *   (a synthesized Swift decoder);
 * - `soft`: `try? c.decodeIfPresent`: absent, null or unreadable is null, and
 *   `soft(...) ?? fallback` is `(try? ...) ?? fallback`.
 *
 * A LIST NEVER BLANKS FOR ONE ROW. `lossyArrayOf` keeps every element that
 * reads and drops the rest (iOS `MealDecoding.lossyArray`): one food row the
 * app cannot read must not empty a search, a meal or a diary day.
 */
import { todayServerDay } from '../../../i18n/format';
import { HealthShapeError, arrayOf, boolean, double, enumOf, instant, integer, isObject, object, opt, req, soft, string, type Json, type Reader } from '../../../health/decode';
import {
  decodeMealDayTotals,
  decodeNutritionTarget,
  MEAL_SLOTS,
  TARGET_WITHHELD_REASONS,
  type ItemNutrients,
} from '../../../health/models';

import {
  GRAMS_SERVING,
  type BarcodeLookupResult,
  type FoodChoice,
  type FoodPresets,
  type FoodSearchResult,
  type ItemEstimate,
  type MealCreateBody,
  type MealDayRecord,
  type MealDescribeResult,
  type MealItemInput,
  type MealItemRecord,
  type MealRecord,
  type MealScanResult,
  type MealServing,
  type MealWriteResult,
  type MyFoods,
  type NutrientOverrides,
  type OffAttribution,
  type OFFNutrients,
  type OFFSnapshot,
  type OffSummary,
  type Per100g,
  type PerServing,
  type PresetCategory,
  type PresetIngredient,
  type PresetMeal,
  type PresetPerServingTotals,
  type RecentMeal,
} from './models';

export { HealthShapeError, type Reader };

// ---------------------------------------------------------------------------
// Helpers

/** A meal slot: a known value, else `unknown` (iOS `MealSlot.init(from:)`). */
export const mealSlotReader = enumOf(MEAL_SLOTS);
const targetWithheldReader = enumOf(TARGET_WITHHELD_REASONS);

/**
 * `MealDecoding.lossyArray`: the elements of `json[key]` that read, in order.
 * Absent, null or not a list is an empty list.
 */
export function lossyArrayOf<T>(json: Json, key: string, path: string, read: Reader<T>): T[] {
  const value = json[key];
  if (!Array.isArray(value)) return [];
  const result: T[] = [];
  value.forEach((element, index) => {
    try {
      result.push(read(element, `${path}.${key}[${index}]`));
    } catch {
      // One odd row is dropped; the list stands.
    }
  });
  return result;
}

/** A top-level answer: `data` must be an object (a Swift keyed container), or decoding fails. */
function root(value: unknown, path: string): Json {
  return object(value, path);
}

// ---------------------------------------------------------------------------
// Serving and nutrients

/** `MealServing.init(from:)`: every field forgiving; only a non-object throws. */
export const decodeMealServing: Reader<MealServing> = (value, path) => {
  const json = object(value, path);
  return {
    unit: soft(json, 'unit', path, string) ?? 'g',
    label: soft(json, 'label', path, string),
    grams: soft(json, 'grams', path, double),
  };
};

/** `Per100g.init(from:)`: kcal must be there; a missing macro is 0. */
export const decodePer100g: Reader<Per100g> = (value, path) => {
  const json = object(value, path);
  return {
    kcal: req(json, 'kcal', path, double),
    proteinG: soft(json, 'proteinG', path, double) ?? 0,
    carbsG: soft(json, 'carbsG', path, double) ?? 0,
    fatG: soft(json, 'fatG', path, double) ?? 0,
  };
};

/** `PerServing.init(from:)`: kcal must be there; an unknown macro stays null. */
export const decodePerServing: Reader<PerServing> = (value, path) => {
  const json = object(value, path);
  return {
    kcal: req(json, 'kcal', path, double),
    proteinG: soft(json, 'proteinG', path, double),
    carbsG: soft(json, 'carbsG', path, double),
    fatG: soft(json, 'fatG', path, double),
  };
};

/** Synthesized: every field optional, a present one must be a number. */
export const decodeNutrientOverrides: Reader<NutrientOverrides> = (value, path) => {
  const json = object(value, path);
  return {
    kcal: opt(json, 'kcal', path, double),
    proteinG: opt(json, 'proteinG', path, double),
    carbsG: opt(json, 'carbsG', path, double),
    fatG: opt(json, 'fatG', path, double),
  };
};

/** Synthesized: every field required. */
export const decodeItemEstimate: Reader<ItemEstimate> = (value, path) => {
  const json = object(value, path);
  return {
    grams: req(json, 'grams', path, double),
    kcalLow: req(json, 'kcalLow', path, double),
    kcalHigh: req(json, 'kcalHigh', path, double),
    proteinG: req(json, 'proteinG', path, double),
    carbsG: req(json, 'carbsG', path, double),
    fatG: req(json, 'fatG', path, double),
  };
};

/** The server's numbers for a stored item (iOS `ItemNutrients`, synthesized). */
export const decodeItemNutrients: Reader<ItemNutrients> = (value, path) => {
  const json = object(value, path);
  return {
    kcalLow: req(json, 'kcalLow', path, integer),
    kcalHigh: req(json, 'kcalHigh', path, integer),
    proteinG: opt(json, 'proteinG', path, double),
    carbsG: opt(json, 'carbsG', path, double),
    fatG: opt(json, 'fatG', path, double),
    grams: opt(json, 'grams', path, double),
    macrosComplete: opt(json, 'macrosComplete', path, boolean),
  };
};

// ---------------------------------------------------------------------------
// Open Food Facts

const decodeOFFNutrients: Reader<OFFNutrients> = (value, path) => {
  const json = object(value, path);
  return {
    kcal: req(json, 'kcal', path, double),
    proteinG: opt(json, 'proteinG', path, double),
    carbsG: opt(json, 'carbsG', path, double),
    fatG: opt(json, 'fatG', path, double),
    fibreG: opt(json, 'fibreG', path, double),
    sugarsG: opt(json, 'sugarsG', path, double),
    saturatedFatG: opt(json, 'saturatedFatG', path, double),
    saltG: opt(json, 'saltG', path, double),
  };
};

/** Synthesized `OFFSnapshot`. */
export const decodeOFFSnapshot: Reader<OFFSnapshot> = (value, path) => {
  const json = object(value, path);
  return {
    barcode: req(json, 'barcode', path, string),
    productName: req(json, 'productName', path, string),
    productNameLang: req(json, 'productNameLang', path, string),
    brand: opt(json, 'brand', path, string),
    per100g: req(json, 'per100g', path, decodeOFFNutrients),
    energyFromKj: req(json, 'energyFromKj', path, boolean),
    servingLabel: opt(json, 'servingLabel', path, string),
    servingQuantityG: opt(json, 'servingQuantityG', path, double),
    retrievedAt: req(json, 'retrievedAt', path, string),
  };
};

export const decodeOffAttribution: Reader<OffAttribution> = (value, path) => {
  const json = object(value, path);
  return {
    name: opt(json, 'name', path, string),
    licence: opt(json, 'licence', path, string),
    licenceUrl: opt(json, 'licenceUrl', path, string),
    productUrl: opt(json, 'productUrl', path, string),
  };
};

export const decodeOffSummary: Reader<OffSummary> = (value, path) => {
  const json = object(value, path);
  return {
    productName: opt(json, 'productName', path, string),
    brand: opt(json, 'brand', path, string),
    energyFromKj: opt(json, 'energyFromKj', path, boolean),
    labelMismatch: opt(json, 'labelMismatch', path, boolean),
    attribution: opt(json, 'attribution', path, decodeOffAttribution),
  };
};

// ---------------------------------------------------------------------------
// A stored meal

/** `MealItemRecord.init(from:)`: only the id is required; everything else has its default. */
export const decodeMealItemRecord: Reader<MealItemRecord> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    source: soft(json, 'source', path, string) ?? 'model',
    basis: soft(json, 'basis', path, string),
    label: soft(json, 'label', path, string) ?? '',
    brand: soft(json, 'brand', path, string),
    foodId: soft(json, 'foodId', path, string),
    barcode: soft(json, 'barcode', path, string),
    serving: soft(json, 'serving', path, decodeMealServing) ?? GRAMS_SERVING,
    amount: soft(json, 'amount', path, double) ?? 1,
    servingOptions: soft(json, 'servingOptions', path, arrayOf(decodeMealServing)) ?? [],
    per100g: soft(json, 'per100g', path, decodePer100g),
    perServing: soft(json, 'perServing', path, decodePerServing),
    estimate: soft(json, 'estimate', path, decodeItemEstimate),
    overrides: soft(json, 'overrides', path, decodeNutrientOverrides),
    edited: soft(json, 'edited', path, arrayOf(string)) ?? [],
    confidence: soft(json, 'confidence', path, string),
    confirmed: soft(json, 'confirmed', path, boolean) ?? true,
    nutrients: soft(json, 'nutrients', path, decodeItemNutrients),
    liquid: soft(json, 'liquid', path, boolean) ?? false,
    off: soft(json, 'off', path, decodeOffSummary),
  };
};

/**
 * `MealRecord.init(from:)`. `updatedAt` is read as the raw string and never
 * as a date: it goes back to the server byte for byte (OP-35).
 */
export const decodeMealRecord: Reader<MealRecord> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    logDate: soft(json, 'logDate', path, string) ?? todayServerDay(),
    loggedAt: soft(json, 'loggedAt', path, instant),
    slot: soft(json, 'slot', path, mealSlotReader) ?? 'snack',
    source: soft(json, 'source', path, string),
    confirmed: soft(json, 'confirmed', path, boolean) ?? true,
    confidence: soft(json, 'confidence', path, string),
    needsConfirm: soft(json, 'needsConfirm', path, boolean) ?? false,
    hasEstimate: soft(json, 'hasEstimate', path, boolean) ?? false,
    items: lossyArrayOf(json, 'items', path, decodeMealItemRecord),
    totals: soft(json, 'totals', path, decodeMealDayTotals),
    createdAt: soft(json, 'createdAt', path, instant),
    updatedAt: soft(json, 'updatedAt', path, string),
  };
};

/** OP-33's day. */
export const decodeMealDayRecord: Reader<MealDayRecord> = (value, path) => {
  const json = root(value, path);
  return {
    date: soft(json, 'date', path, string) ?? todayServerDay(),
    meals: lossyArrayOf(json, 'meals', path, decodeMealRecord),
    drafts: lossyArrayOf(json, 'drafts', path, decodeMealRecord),
    totals: soft(json, 'totals', path, decodeMealDayTotals),
    target: soft(json, 'target', path, decodeNutritionTarget),
    targetWithheld: soft(json, 'targetWithheld', path, targetWithheldReader),
    scansLeftToday: soft(json, 'scansLeftToday', path, integer),
    textDrafts: lossyArrayOf(json, 'textDrafts', path, decodeMealRecord),
  };
};

// ---------------------------------------------------------------------------
// Foods

export const decodeFoodChoice: Reader<FoodChoice> = (value, path) => {
  const json = object(value, path);
  return {
    key: req(json, 'key', path, string),
    source: req(json, 'source', path, string),
    basis: soft(json, 'basis', path, string),
    label: req(json, 'label', path, string),
    brand: soft(json, 'brand', path, string),
    foodId: soft(json, 'foodId', path, string),
    barcode: soft(json, 'barcode', path, string),
    servingOptions: soft(json, 'servingOptions', path, arrayOf(decodeMealServing)) ?? [],
    defaultServing: soft(json, 'defaultServing', path, decodeMealServing) ?? GRAMS_SERVING,
    defaultAmount: soft(json, 'defaultAmount', path, double) ?? 100,
    defaultKcal: soft(json, 'defaultKcal', path, double),
    per100g: soft(json, 'per100g', path, decodePer100g),
    perServing: soft(json, 'perServing', path, decodePerServing),
    off: soft(json, 'off', path, decodeOFFSnapshot),
    offAttribution: soft(json, 'offAttribution', path, decodeOffAttribution),
    liquid: soft(json, 'liquid', path, boolean) ?? false,
    lastUsedAt: soft(json, 'lastUsedAt', path, string),
    useCount: soft(json, 'useCount', path, integer),
  };
};

const decodePresetIngredient: Reader<PresetIngredient> = (value, path) => {
  const json = object(value, path);
  return {
    foodId: req(json, 'foodId', path, string),
    source: req(json, 'source', path, string),
    label: req(json, 'label', path, string),
    grams: req(json, 'grams', path, double),
    kcal: soft(json, 'kcal', path, double) ?? 0,
    per100g: req(json, 'per100g', path, decodePer100g),
    servingOptions: soft(json, 'servingOptions', path, arrayOf(decodeMealServing)) ?? [GRAMS_SERVING],
    liquid: soft(json, 'liquid', path, boolean) ?? false,
  };
};

const decodePresetCategory: Reader<PresetCategory> = (value, path) => {
  const json = object(value, path);
  return { id: req(json, 'id', path, string), label: req(json, 'label', path, string) };
};

const decodePresetPerServingTotals: Reader<PresetPerServingTotals> = (value, path) => {
  const json = object(value, path);
  return {
    kcal: req(json, 'kcal', path, double),
    proteinG: opt(json, 'proteinG', path, double),
    carbsG: opt(json, 'carbsG', path, double),
    fatG: opt(json, 'fatG', path, double),
  };
};

export const decodePresetMeal: Reader<PresetMeal> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    name: req(json, 'name', path, string),
    category: soft(json, 'category', path, decodePresetCategory),
    ingredients: lossyArrayOf(json, 'ingredients', path, decodePresetIngredient),
    perServing: soft(json, 'perServing', path, decodePresetPerServingTotals),
  };
};

const decodeRecentMeal: Reader<RecentMeal> = (value, path) => {
  const json = object(value, path);
  const items = lossyArrayOf(json, 'items', path, decodeFoodChoice);
  return {
    key: req(json, 'key', path, string),
    slot: soft(json, 'slot', path, mealSlotReader) ?? 'snack',
    itemCount: soft(json, 'itemCount', path, integer) ?? items.length,
    kcal: soft(json, 'kcal', path, double) ?? 0,
    items,
  };
};

export const decodeFoodPresets: Reader<FoodPresets> = (value, path) => {
  const json = root(value, path);
  return {
    libraryVersion: soft(json, 'libraryVersion', path, string),
    foods: lossyArrayOf(json, 'foods', path, decodeFoodChoice),
    meals: lossyArrayOf(json, 'meals', path, decodePresetMeal),
    categories: lossyArrayOf(json, 'categories', path, decodePresetCategory),
  };
};

export const decodeMyFoods: Reader<MyFoods> = (value, path) => {
  const json = root(value, path);
  return {
    recents: lossyArrayOf(json, 'recents', path, decodeFoodChoice),
    frequent: lossyArrayOf(json, 'frequent', path, decodeFoodChoice),
    mine: lossyArrayOf(json, 'mine', path, decodeFoodChoice),
    recentMeals: lossyArrayOf(json, 'recentMeals', path, decodeRecentMeal),
  };
};

export const decodeFoodSearchResult: Reader<FoodSearchResult> = (value, path) => {
  const json = root(value, path);
  return {
    query: soft(json, 'query', path, string),
    mine: lossyArrayOf(json, 'mine', path, decodeFoodChoice),
    foods: lossyArrayOf(json, 'foods', path, decodeFoodChoice),
    meals: lossyArrayOf(json, 'meals', path, decodePresetMeal),
    closest: soft(json, 'closest', path, boolean) ?? false,
  };
};

/** Synthesized: a food that is there must read. */
export const decodeBarcodeLookupResult: Reader<BarcodeLookupResult> = (value, path) => {
  const json = root(value, path);
  return {
    food: opt(json, 'food', path, decodeFoodChoice),
    origin: opt(json, 'origin', path, string),
  };
};

// ---------------------------------------------------------------------------
// Write answers

/** Synthesized: the meal must read. */
export const decodeMealWriteResult: Reader<MealWriteResult> = (value, path) => {
  const json = root(value, path);
  return {
    meal: req(json, 'meal', path, decodeMealRecord),
    replayed: opt(json, 'replayed', path, boolean),
  };
};

export const decodeMealScanResult: Reader<MealScanResult> = (value, path) => {
  const json = root(value, path);
  const meal = soft(json, 'meal', path, decodeMealRecord);
  return {
    meal,
    noFood: soft(json, 'noFood', path, boolean) ?? meal === null,
    needsConfirm: soft(json, 'needsConfirm', path, boolean) ?? false,
    scansLeftToday: soft(json, 'scansLeftToday', path, integer),
    replayed: soft(json, 'replayed', path, boolean),
  };
};

export const decodeMealDescribeResult: Reader<MealDescribeResult> = (value, path) => {
  const json = root(value, path);
  const meal = soft(json, 'meal', path, decodeMealRecord);
  return {
    meal,
    noFood: soft(json, 'noFood', path, boolean) ?? meal === null,
    needsConfirm: soft(json, 'needsConfirm', path, boolean) ?? false,
    describesLeftToday: soft(json, 'describesLeftToday', path, integer),
    replayed: soft(json, 'replayed', path, boolean),
  };
};

/** `{ meal }` (OP-44). */
export const decodeMealEnvelope: Reader<MealRecord> = (value, path) => req(root(value, path), 'meal', path, decodeMealRecord);

/** `{ ok: true }` answers: anything that is an object. */
export const decodeOkAnswer: Reader<void> = (value, path) => {
  root(value, path);
};

// ---------------------------------------------------------------------------
// A request body read back (the outbox's file)

/** A `MealItemInput` as ./encode.ts wrote it (synthesized Swift `Codable`). */
export const decodeMealItemInput: Reader<MealItemInput> = (value, path) => {
  const json = object(value, path);
  return {
    id: opt(json, 'id', path, string),
    source: req(json, 'source', path, string),
    label: req(json, 'label', path, string),
    brand: opt(json, 'brand', path, string),
    foodId: opt(json, 'foodId', path, string),
    barcode: opt(json, 'barcode', path, string),
    off: opt(json, 'off', path, decodeOFFSnapshot),
    serving: req(json, 'serving', path, decodeMealServing),
    amount: req(json, 'amount', path, double),
    per100g: opt(json, 'per100g', path, decodePer100g),
    perServing: opt(json, 'perServing', path, decodePerServing),
    overrides: opt(json, 'overrides', path, decodeNutrientOverrides),
    confirmed: req(json, 'confirmed', path, boolean),
  };
};

/** A `MealCreateBody` as ./encode.ts wrote it. */
export const decodeMealCreateBody: Reader<MealCreateBody> = (value, path) => {
  const json = object(value, path);
  return {
    slot: req(json, 'slot', path, string),
    loggedAt: req(json, 'loggedAt', path, instant),
    logDate: req(json, 'logDate', path, string),
    source: req(json, 'source', path, string),
    items: req(json, 'items', path, arrayOf(decodeMealItemInput)),
  };
};

/** True when `value` is a JSON object (re-exported for the stores' file readers). */
export { isObject };
