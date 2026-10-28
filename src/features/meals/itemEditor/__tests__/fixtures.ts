/**
 * Meals as the server sends them, through the real decoders, for the item
 * and meal editor tests. Numbers follow the iOS UI tests' fixtures: a cup of
 * skyr (170 g at 62 kcal per 100 g) reads 105 kcal, two cups 211.
 */
import { decodeMealRecord } from '../../types/decode';
import { draftFromChoice } from '../../types/draftFactory';
import type { MealItemDraft } from '../../types/draft';
import { namedServing, type FoodChoice, type MealRecord } from '../../types/models';

export const SKYR_CUP = namedServing('1 cup (170 g)', 170);

export const SKYR_PER_100G = { kcal: 62, proteinG: 11, carbsG: 4, fatG: 0.2 };

export function skyrChoice(): FoodChoice {
  return {
    key: 'food:skyr',
    source: 'fineli',
    basis: 'database',
    label: 'Skyr, plain',
    brand: null,
    foodId: 'skyr',
    barcode: null,
    servingOptions: [SKYR_CUP],
    defaultServing: SKYR_CUP,
    defaultAmount: 1,
    defaultKcal: 105,
    per100g: SKYR_PER_100G,
    perServing: null,
    off: null,
    offAttribution: null,
    liquid: false,
    lastUsedAt: null,
    useCount: null,
  };
}

/** A new skyr item at one cup. */
export function newSkyr(): MealItemDraft {
  return draftFromChoice(skyrChoice());
}

type Json = Record<string, unknown>;

/** A stored library item (skyr, one cup). */
export function skyrItemJson(id = 'item-skyr', overrides: Json = {}): Json {
  return {
    id,
    source: 'fineli',
    basis: 'database',
    label: 'Skyr, plain',
    foodId: 'skyr',
    serving: { unit: 'serving', label: '1 cup (170 g)', grams: 170 },
    amount: 1,
    servingOptions: [{ unit: 'serving', label: '1 cup (170 g)', grams: 170 }],
    per100g: SKYR_PER_100G,
    confirmed: true,
    nutrients: { kcalLow: 105, kcalHigh: 105, proteinG: 18.7, carbsG: 6.8, fatG: 0.3, grams: 170, macrosComplete: true },
    ...overrides,
  };
}

/** A stored banana (library, 120 g). */
export function bananaItemJson(id = 'item-banana'): Json {
  return {
    id,
    source: 'usda',
    basis: 'database',
    label: 'Banana',
    foodId: 'banana',
    serving: { unit: 'g' },
    amount: 120,
    per100g: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
    confirmed: true,
    nutrients: { kcalLow: 107, kcalHigh: 107, proteinG: 1.3, carbsG: 27.4, fatG: 0.4, grams: 120, macrosComplete: true },
  };
}

/** A stored Open Food Facts product. */
export function offItemJson(id = 'item-off'): Json {
  return {
    id,
    source: 'off',
    basis: 'label',
    label: 'Hafrakex',
    brand: 'Frón',
    barcode: '5690519000011',
    serving: { unit: 'g' },
    amount: 30,
    per100g: { kcal: 450, proteinG: 8, carbsG: 65, fatG: 17 },
    confirmed: true,
    nutrients: { kcalLow: 135, kcalHigh: 135, proteinG: 2.4, carbsG: 19.5, fatG: 5.1, grams: 30, macrosComplete: true },
  };
}

/** A photo item: an untouched estimate, low confidence and not checked. */
export function photoItemJson(id = 'item-photo', overrides: Json = {}): Json {
  return {
    id,
    source: 'model',
    basis: 'estimate',
    label: 'Fish stew',
    serving: { unit: 'g' },
    amount: 300,
    estimate: { grams: 300, kcalLow: 380, kcalHigh: 520, proteinG: 30, carbsG: 25, fatG: 18 },
    confidence: 'low',
    confirmed: false,
    nutrients: { kcalLow: 380, kcalHigh: 520, proteinG: 30, carbsG: 25, fatG: 18, grams: 300, macrosComplete: true },
    ...overrides,
  };
}

export const UPDATED_AT = '2026-10-21T08:15:30.123456+00:00';

/** A saved meal through the real decoder. */
export function mealRecord(options: {
  readonly id?: string;
  readonly items: readonly Json[];
  readonly updatedAt?: string;
  readonly confirmed?: boolean;
  readonly source?: string;
  readonly logDate?: string;
  readonly slot?: string;
  readonly loggedAt?: string;
}): MealRecord {
  return decodeMealRecord(
    {
      id: options.id ?? 'meal-1',
      logDate: options.logDate ?? '2026-10-21',
      loggedAt: options.loggedAt ?? '2026-10-21T12:40:00Z',
      slot: options.slot ?? 'lunch',
      source: options.source ?? 'search',
      confirmed: options.confirmed ?? true,
      items: options.items,
      updatedAt: options.updatedAt ?? UPDATED_AT,
    },
    'meal',
  );
}
