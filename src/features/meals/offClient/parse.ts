/**
 * Open Food Facts answers, decoded leniently: the port of iOS
 * `FoodFactsService.parse` (Services/FoodFactsService.swift,
 * api-contract.md 5.2, F11), tested by the port of OpenFoodFactsDecodeTests.
 *
 * Open Food Facts is crowd-sourced: numbers arrive as numbers or as numeric
 * strings ("30", "30.5", "30,5"), and sometimes impossible. One odd field
 * must never turn a good product into "lookup failed" (anything that is not
 * a number reads as absent), and an impossible label must never be sent (the
 * server would refuse the whole meal for it).
 */
import { parseDecimal } from '../../../i18n/format';
import { characterPrefix, trimWhitespace } from '../types/text';
import type { OFFNutrients, OFFSnapshot } from '../types/models';

/** What a barcode lookup at Open Food Facts came back with (iOS `OFFLookupOutcome`). */
export type OFFLookupOutcome =
  /** A product with usable nutrition, as the snapshot the server validates. */
  | { readonly kind: 'found'; readonly snapshot: OFFSnapshot; readonly liquid: boolean }
  /** The product exists but its energy is missing or impossible. Its name and brand still help the member create it. */
  | { readonly kind: 'noNutrition'; readonly name: string | null; readonly brand: string | null }
  /** Open Food Facts does not know the code. */
  | { readonly kind: 'notFound' }
  /** Timeout, 429, 5xx or no network: nothing is known either way. */
  | { readonly kind: 'failed' };

export const OFF_NOT_FOUND: OFFLookupOutcome = { kind: 'notFound' };
export const OFF_FAILED: OFFLookupOutcome = { kind: 'failed' };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A number from a JSON number or a numeric string, else null (a boolean is not a number). */
export function offNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseDecimal(value);
    return parsed !== null && Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegative(value: unknown): number | null {
  const number = offNumber(value);
  return number !== null && number >= 0 ? number : null;
}

/** Swift's `.rounded()`: half away from zero (the values here are never negative). */
function rounded(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function round1(value: number): number {
  return rounded(value * 10) / 10;
}

/** Swift's `.whitespacesAndNewlines` (see ../types/text.ts). */
const WHITESPACE_RUN = new RegExp('[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+');

/** Trimmed, runs of white space collapsed, null when empty. */
export function cleanedOffText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw
    .split(WHITESPACE_RUN)
    .filter((part) => part.length > 0)
    .join(' ');
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * The first entry of `brands`, trimmed, at most 80 characters, or null.
 * Swift's `split(separator: ",")` skips empty pieces, so ",Ísey" names Ísey.
 */
function firstBrand(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const first = raw.split(',').find((piece) => piece.length > 0);
  if (first === undefined) return null;
  const trimmed = trimWhitespace(first);
  return trimmed.length === 0 ? null : characterPrefix(trimmed, 80);
}

/** A serving size or quantity measured by volume ("330 ml", "1 L", "33cl"). */
export function isLiquidQuantity(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\d\s*(ml|cl|dl|l)\.?\s*$/i.test(text);
}

/**
 * Build the snapshot from an Open Food Facts answer. `barcode` is the
 * normalised code (never whatever the answer says), `language` the ACCOUNT
 * language, `now` when the phone received it.
 */
export function parseOffProduct(body: string, barcode: string, language: string, now: Date = new Date()): OFFLookupOutcome {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return OFF_FAILED;
  }
  if (!isObject(root)) return OFF_FAILED;
  const status = offNumber(root.status);
  const product = root.product;
  if (status === null || Math.trunc(status) !== 1 || !isObject(product)) return OFF_NOT_FOUND;

  // The name by the ACCOUNT language: Icelandic first for an Icelandic account, never for an English one.
  const isName = cleanedOffText(product.product_name_is);
  const plainName = cleanedOffText(product.product_name);
  const enName = cleanedOffText(product.product_name_en);
  let name: string;
  let nameLang: string;
  if (language === 'is' && isName) {
    [name, nameLang] = [isName, 'is'];
  } else if (plainName) {
    [name, nameLang] = [plainName, 'other'];
  } else if (enName) {
    [name, nameLang] = [enName, 'en'];
  } else if (isName) {
    [name, nameLang] = [isName, 'is'];
  } else {
    // No name at all: nothing the member could recognise.
    return OFF_NOT_FOUND;
  }
  const productName = characterPrefix(name, 120);
  const brand = firstBrand(product.brands);

  const nutriments = isObject(product.nutriments) ? product.nutriments : {};
  const servingSize = cleanedOffText(product.serving_size);
  const servingQuantityRaw = offNumber(product.serving_quantity);
  const servingQuantity = servingQuantityRaw !== null && servingQuantityRaw >= 1 && servingQuantityRaw <= 2000 ? servingQuantityRaw : null;

  let energyFromKj = false;
  let kcal = nonNegative(nutriments['energy-kcal_100g']);
  if (kcal === null) {
    const kj = nonNegative(nutriments.energy_100g);
    if (kj !== null) {
      kcal = rounded(kj / 4.184);
      energyFromKj = true;
    }
  }
  const per100 = (key: string): number | null => nonNegative(nutriments[`${key}_100g`]);
  let protein = per100('proteins');
  let carbs = per100('carbohydrates');
  let fat = per100('fat');

  // Only per-serving values and a serving weight: scale them to 100 g.
  if (kcal === null && servingQuantity !== null && servingQuantity > 0) {
    const grams = servingQuantity;
    let perServingKcal = nonNegative(nutriments['energy-kcal_serving']);
    if (perServingKcal === null) {
      const kj = nonNegative(nutriments.energy_serving);
      if (kj !== null) {
        perServingKcal = kj / 4.184;
        energyFromKj = true;
      }
    }
    if (perServingKcal !== null) {
      kcal = rounded((perServingKcal * 100) / grams);
      const scaled = (key: string): number | null => {
        const value = nonNegative(nutriments[`${key}_serving`]);
        return value === null ? null : round1((value * 100) / grams);
      };
      protein = protein ?? scaled('proteins');
      carbs = carbs ?? scaled('carbohydrates');
      fat = fat ?? scaled('fat');
    }
  }

  if (kcal === null) return { kind: 'noNutrition', name: productName, brand };
  // Impossible values (F11): never sent, so one bad label never gets a whole meal refused by the server.
  const macros = [protein, carbs, fat, per100('fiber'), per100('sugars'), per100('saturated-fat'), per100('salt')];
  if (kcal > 900 || macros.some((value) => (value ?? 0) > 100) || (protein ?? 0) + (carbs ?? 0) + (fat ?? 0) > 105) {
    return { kind: 'noNutrition', name: productName, brand };
  }

  const per100g: OFFNutrients = {
    kcal,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    fibreG: per100('fiber'),
    sugarsG: per100('sugars'),
    saturatedFatG: per100('saturated-fat'),
    saltG: per100('salt'),
  };
  const snapshot: OFFSnapshot = {
    barcode,
    productName,
    productNameLang: nameLang,
    brand,
    per100g,
    energyFromKj,
    servingLabel: servingSize === null ? null : characterPrefix(servingSize, 40),
    servingQuantityG: servingQuantity,
    retrievedAt: now.toISOString(),
  };
  const liquid = isLiquidQuantity(servingSize) || isLiquidQuantity(cleanedOffText(product.quantity));
  return { kind: 'found', snapshot, liquid };
}

/** Two outcomes say the same thing (the cache key and the tests). */
export function sameOutcome(a: OFFLookupOutcome, b: OFFLookupOutcome): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
