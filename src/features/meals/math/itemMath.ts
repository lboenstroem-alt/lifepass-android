/**
 * The item calculation, the serving conversions and the slot rule: the
 * Android port of iOS Models/MealItemMath.swift.
 *
 * THE SERVER IS THE AUTHORITY AND THIS MIRRORS IT. The editor shows a number
 * the moment a member drags an amount and the server recomputes it on save;
 * if the two disagree, the number changes under the member's hand for no
 * reason they can see. So the rules here are `computeItemNutrients` in the
 * server's `health/meals.ts`, rule for rule, and the tests run the server's
 * own case table (iOS `MealItemRuleTests`).
 *
 * THE BASIS PICKS THE RULE, not the presence of a field. A photo item matched
 * to a library food carries both the library's per 100 g and its own
 * estimate range: while it is untouched its basis is `estimate` and the range
 * is what the member sees; the moment they change the amount it becomes a
 * real portion of a known food and the per 100 g gives one number.
 *
 * Rounding is Swift's `.rounded()`: to nearest, a half away from zero.
 */
import { dateFromServerDay, printfFixed, roundHalfAwayFromZero, todayServerDay } from '../../../i18n/format';
import type { MealSlot } from '../../../health/models';
import {
  GRAMS_SERVING,
  isGramsServing,
  namedServing,
  offMacrosComplete,
  overrideFor,
  perServingMacrosComplete,
  servingEquals,
  withOverride,
  type MealDayTotals,
  type MealNutrientField,
  type MealServing,
  type Per100g,
  type PerServing,
} from '../types/models';
import { isChangedFromStored, type MealItemDraft } from '../types/draft';

/** What one item comes to (iOS `MealItemMath.Result`). */
export interface MealItemResult {
  readonly kcalLow: number;
  readonly kcalHigh: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly grams: number | null;
  readonly macrosComplete: boolean;
}

export const ZERO_RESULT: MealItemResult = Object.freeze({
  kcalLow: 0,
  kcalHigh: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  grams: null,
  macrosComplete: true,
});

export function isRangeResult(result: MealItemResult): boolean {
  return result.kcalLow !== result.kcalHigh;
}

/** The middle of the range, a whole kcal. */
export function kcalMid(result: Pick<MealItemResult, 'kcalLow' | 'kcalHigh'>): number {
  return roundHalfAwayFromZero((result.kcalLow + result.kcalHigh) / 2);
}

/** Server caps: an item may not exceed 10,000 kcal, a meal 20,000. */
export const ITEM_KCAL_MAX = 10_000;
export const MEAL_KCAL_MAX = 20_000;

/** The multiplier chips of the item editor and the photo amount pill. */
export const MULTIPLIERS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ---------------------------------------------------------------------------
// Basis

/** How a NEW item's calories are produced, by where it came from. */
export function basisForNewSource(source: string): string {
  switch (source) {
    case 'off':
    case 'lifepass_label':
      return 'label';
    case 'member':
    case 'quick_add':
      return 'member';
    case 'model':
      return 'estimate';
    default:
      return 'database';
  }
}

/**
 * The basis the server WILL give this item on save: the member's calories
 * make it `member`; a changed amount on a photo item matched to the library
 * makes it `database`; an unmatched photo item stays an estimate whose range
 * scales.
 */
export function effectiveBasis(item: MealItemDraft): string {
  if (overrideFor(item.overrides, 'kcal') !== null) return 'member';
  if (
    item.basis === 'estimate' &&
    item.storedId !== null &&
    isChangedFromStored(item) &&
    item.foodId !== null &&
    item.per100g !== null
  ) {
    return 'database';
  }
  return item.basis;
}

// ---------------------------------------------------------------------------
// Grams

/** Grams for a serving and an amount, or null when the serving has no weight behind it. */
export function gramsFor(serving: MealServing, amount: number): number | null {
  if (isGramsServing(serving)) return amount;
  return serving.grams === null ? null : serving.grams * amount;
}

// ---------------------------------------------------------------------------
// Rounding (the server's)

/** kcal to whole numbers, half away from zero. */
export function roundKcal(value: number): number {
  const rounded = roundHalfAwayFromZero(value);
  return rounded === 0 ? 0 : rounded;
}

/** Item macros to a tenth of a gram. */
export function roundMacro(value: number): number {
  const rounded = roundHalfAwayFromZero(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

// ---------------------------------------------------------------------------
// One item

function per100gValue(values: Per100g, field: MealNutrientField): number {
  switch (field) {
    case 'kcal':
      return values.kcal;
    case 'protein':
      return values.proteinG;
    case 'carbs':
      return values.carbsG;
    case 'fat':
      return values.fatG;
  }
}

function perServingValue(values: PerServing, field: MealNutrientField): number | null {
  switch (field) {
    case 'kcal':
      return values.kcal;
    case 'protein':
      return values.proteinG;
    case 'carbs':
      return values.carbsG;
    case 'fat':
      return values.fatG;
  }
}

function macrosCompleteBase(item: MealItemDraft): boolean {
  if (item.off) return offMacrosComplete(item.off);
  if (item.source === 'off' && item.storedNutrients) return item.storedNutrients.macrosComplete ?? true;
  if (item.perServing && item.per100g === null) return perServingMacrosComplete(item.perServing);
  return true;
}

type Pair = readonly [number, number];

/**
 * The item's numbers by the server's rules, or null when none applies (a
 * named serving with no grams on a library item: the server refuses it).
 */
export function computeItem(item: MealItemDraft): MealItemResult | null {
  const grams = gramsFor(item.serving, item.amount);
  const basis = effectiveBasis(item);
  let macrosComplete = macrosCompleteBase(item);

  const fromEstimate = (field: MealNutrientField): Pair | null => {
    const estimate = item.estimate;
    if (!estimate) return null;
    const factor = grams === null || estimate.grams === 0 ? 1 : grams / estimate.grams;
    switch (field) {
      case 'kcal':
        return [estimate.kcalLow * factor, estimate.kcalHigh * factor];
      case 'protein':
        return [estimate.proteinG * factor, estimate.proteinG * factor];
      case 'carbs':
        return [estimate.carbsG * factor, estimate.carbsG * factor];
      case 'fat':
        return [estimate.fatG * factor, estimate.fatG * factor];
    }
  };

  const point = (field: MealNutrientField): Pair | null => {
    // Rule 1: the member's own number, stored per ONE unit.
    const override = overrideFor(item.overrides, field);
    if (override !== null) {
      const value = override * item.amount;
      return [value, value];
    }
    // Rule 4: an estimate scales its range by the grams.
    if (basis === 'estimate') return fromEstimate(field);
    // Rule 2: per 100 g at the grams counted.
    if (item.per100g && grams !== null) {
      const value = (per100gValue(item.per100g, field) * grams) / 100;
      return [value, value];
    }
    // Rule 3: per serving, counted in servings; an unknown macro is 0.
    if (item.perServing && !isGramsServing(item.serving)) {
      const raw = perServingValue(item.perServing, field);
      if (raw === null) {
        macrosComplete = false;
        return [0, 0];
      }
      const value = raw * item.amount;
      return [value, value];
    }
    return fromEstimate(field);
  };

  const kcal = point('kcal');
  if (!kcal) return null;
  const protein = point('protein') ?? [0, 0];
  const carbs = point('carbs') ?? [0, 0];
  const fat = point('fat') ?? [0, 0];
  return {
    kcalLow: roundKcal(kcal[0]),
    kcalHigh: roundKcal(kcal[1]),
    proteinG: roundMacro(protein[0]),
    carbsG: roundMacro(carbs[0]),
    fatG: roundMacro(fat[0]),
    grams,
    macrosComplete,
  };
}

/**
 * What the screens show for an item: the SERVER's numbers while a stored
 * item is untouched (after a save the editor shows what the server
 * computed), the local mirror as soon as the member changes anything.
 */
export function displayedItem(item: MealItemDraft): MealItemResult {
  if (item.storedId !== null && !isChangedFromStored(item) && item.storedNutrients) {
    const stored = item.storedNutrients;
    return {
      kcalLow: stored.kcalLow,
      kcalHigh: stored.kcalHigh,
      proteinG: stored.proteinG ?? 0,
      carbsG: stored.carbsG ?? 0,
      fatG: stored.fatG ?? 0,
      grams: stored.grams,
      macrosComplete: stored.macrosComplete ?? true,
    };
  }
  return computeItem(item) ?? ZERO_RESULT;
}

/** Whether the item still shows a range with an Estimate chip. */
export function isEstimateItem(item: MealItemDraft): boolean {
  return effectiveBasis(item) === 'estimate';
}

// ---------------------------------------------------------------------------
// A meal

/**
 * A meal's totals, the estimate part kept apart from the point part, from
 * the numbers the screens show. Meal macros are whole grams.
 */
export function mealTotals(items: readonly MealItemDraft[]): MealDayTotals {
  let point = 0;
  let memberEntered = 0;
  let estimateLow = 0;
  let estimateHigh = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let complete = true;
  for (const item of items) {
    const result = displayedItem(item);
    if (isEstimateItem(item)) {
      estimateLow += result.kcalLow;
      estimateHigh += result.kcalHigh;
    } else {
      point += result.kcalLow;
      if (effectiveBasis(item) === 'member') memberEntered += result.kcalLow;
    }
    protein += result.proteinG;
    carbs += result.carbsG;
    fat += result.fatG;
    if (!result.macrosComplete) complete = false;
  }
  return {
    kcalLow: point + estimateLow,
    kcalHigh: point + estimateHigh,
    proteinG: roundHalfAwayFromZero(protein),
    carbsG: roundHalfAwayFromZero(carbs),
    fatG: roundHalfAwayFromZero(fat),
    estimateKcalLow: estimateLow,
    estimateKcalHigh: estimateHigh,
    pointKcal: point,
    memberEnteredKcal: memberEntered,
    mealCount: 1,
    macrosComplete: complete,
  };
}

// ---------------------------------------------------------------------------
// Changing the amount and the serving

/**
 * Keep an amount inside the server's ranges (0.1 to 50 servings, 0.1 to
 * 5,000 g), rounded to what the field shows (two decimals).
 */
export function clampedAmount(amount: number, serving: MealServing): number {
  const upper = isGramsServing(serving) ? 5000 : 50;
  const value = Math.min(Math.max(amount, 0.1), upper);
  return roundHalfAwayFromZero(value * 100) / 100;
}

/**
 * A new serving keeps the gram weight constant and converts the amount, as
 * MyFitnessPal does. Without a weight on either side the amount stays.
 */
export function convertAmount(amount: number, from: MealServing, to: MealServing): number {
  const grams = gramsFor(from, amount);
  if (grams === null) return amount;
  if (isGramsServing(to)) return clampedAmount(roundHalfAwayFromZero(grams), to);
  if (to.grams === null || !(to.grams > 0)) return amount;
  return clampedAmount(grams / to.grams, to);
}

/** The same item at another serving. */
export function changingServing(item: MealItemDraft, serving: MealServing): MealItemDraft {
  return {
    ...item,
    amount: convertAmount(item.amount, item.serving, serving),
    serving,
    displaysGrams: false,
    confirmed: true,
  };
}

/** The same item at a new amount. A changed amount confirms it. */
export function changingAmount(item: MealItemDraft, amount: number): MealItemDraft {
  return { ...item, amount: clampedAmount(amount, item.serving), confirmed: true };
}

/**
 * A created food counted per serving, shown in grams: the wire keeps the
 * serving, the amount is grams / serving grams to 0.01.
 */
export function settingGramsOnServingOnlyItem(item: MealItemDraft, grams: number): MealItemDraft {
  const servingGrams = item.serving.grams;
  if (servingGrams === null || !(servingGrams > 0)) return item;
  return {
    ...item,
    amount: clampedAmount(grams / servingGrams, item.serving),
    displaysGrams: true,
    confirmed: true,
  };
}

/** Whether this item can be counted in grams at all. */
export function hasGramWeight(item: MealItemDraft): boolean {
  if (item.per100g !== null || item.estimate !== null) return true;
  return item.perServing !== null && item.serving.grams !== null;
}

/** A per-serving-only item (a created food per serving or a quick add): the server counts it in servings only. */
export function isServingOnly(item: MealItemDraft): boolean {
  return item.per100g === null && item.perServing !== null;
}

/**
 * The serving menu of the item editor: the item's own options, then the
 * current serving, then "100 g" (or "100 ml" for a liquid; plus "1 dl" for an
 * Icelandic reader), grams always last. Never grams for a per-serving-only
 * item without serving grams.
 */
export function servingMenu(item: MealItemDraft, language: string): MealServing[] {
  const options: MealServing[] = [];
  const add = (option: MealServing): void => {
    if (!options.some((existing) => servingEquals(existing, option))) options.push(option);
  };
  if (isServingOnly(item)) {
    add(item.serving);
    for (const option of item.servingOptions) {
      if (!isGramsServing(option)) add(option);
    }
    return options;
  }
  for (const option of item.servingOptions) add(option);
  add(item.serving);
  if (hasGramWeight(item)) {
    if (!options.some(isGramsServing)) options.push(GRAMS_SERVING);
    const hundredLabel = item.liquid ? '100 ml' : '100 g';
    if (!options.some((option) => option.grams === 100 && !isGramsServing(option))) {
      add(namedServing(hundredLabel, 100));
    }
    if (
      item.liquid &&
      language === 'is' &&
      !options.some((option) => (option.label ?? '').toLowerCase().includes('dl'))
    ) {
      add(namedServing('1 dl', 100));
    }
  }
  // Grams last: servings first, then 100 g, then grams.
  return [...options.filter((option) => !isGramsServing(option)), ...options.filter(isGramsServing)];
}

/** The amount as the field shows it: servings, or grams (ml) for a gram serving or a per-serving item shown in grams. */
export function fieldAmount(item: MealItemDraft): number {
  if (item.displaysGrams) {
    const grams = gramsFor(item.serving, item.amount);
    if (grams !== null) return roundHalfAwayFromZero(grams);
  }
  return item.amount;
}

/** Whether the amount field is counting grams. */
export function fieldIsGrams(item: MealItemDraft): boolean {
  return isGramsServing(item.serving) || item.displaysGrams;
}

/** The stepper's step: half a serving, or 10 g. */
export function stepFor(item: MealItemDraft): number {
  return fieldIsGrams(item) ? 10 : 0.5;
}

/** Apply a typed field value (servings or grams, as the field shows). */
export function applyingField(item: MealItemDraft, value: number): MealItemDraft {
  if (item.displaysGrams) return settingGramsOnServingOnlyItem(item, value);
  return changingAmount(item, value);
}

// ---------------------------------------------------------------------------
// The member's own numbers

/**
 * Set a number (for the amount shown) as the member typed it: stored per ONE
 * unit of the serving, so it scales with the amount afterwards. Changing the
 * calories confirms the item.
 */
export function settingValue(item: MealItemDraft, field: MealNutrientField, total: number): MealItemDraft {
  const amount = Math.max(item.amount, 0.01);
  return {
    ...item,
    overrides: withOverride(item.overrides, field, Math.max(0, total) / amount),
    confirmed: field === 'kcal' ? true : item.confirmed,
  };
}

/** Drop the member's number for one field and go back to the computed one. */
export function resettingValue(item: MealItemDraft, field: MealNutrientField): MealItemDraft {
  const overrides = withOverride(item.overrides, field, null);
  const empty = overrides.kcal === null && overrides.proteinG === null && overrides.carbsG === null && overrides.fatG === null;
  return { ...item, overrides: empty ? null : overrides };
}

/**
 * The consistency hint: the macros add up to a different number than the
 * calories by more than 25 percent AND more than 50 kcal. Returns the macro
 * kcal to show, or null.
 */
export function macroMismatchKcal(result: MealItemResult): number | null {
  const fromMacros = 4 * result.proteinG + 4 * result.carbsG + 9 * result.fatG;
  const kcal = kcalMid(result);
  const difference = Math.abs(fromMacros - kcal);
  if (!(fromMacros > 0 || kcal > 0)) return null;
  if (!(difference > 50 && difference > 0.25 * Math.max(kcal, 1))) return null;
  return roundKcal(fromMacros);
}

/** "30 g" when Open Food Facts gives a serving weight but no words for it. */
export function defaultServingLabel(grams: number): string {
  const value = grams === roundHalfAwayFromZero(grams) ? String(Math.trunc(grams)) : printfFixed(grams, 1);
  return `${value} g`;
}

// ---------------------------------------------------------------------------
// The slot rule

/**
 * 04:00 to 10:29 breakfast; 10:30 to 14:29 lunch; 14:30 to 16:59 snack;
 * 17:00 to 21:29 dinner; otherwise snack. By the PHONE's own clock: this is
 * about when the member is eating, not about Iceland's calendar. `clock`
 * exists for tests (`utc`).
 */
export function autoSlot(at: Date = new Date(), clock: 'phone' | 'utc' = 'phone'): MealSlot {
  const hour = clock === 'utc' ? at.getUTCHours() : at.getHours();
  const minute = clock === 'utc' ? at.getUTCMinutes() : at.getMinutes();
  const minutes = hour * 60 + minute;
  if (minutes >= 240 && minutes < 630) return 'breakfast';
  if (minutes >= 630 && minutes < 870) return 'lunch';
  if (minutes >= 870 && minutes < 1020) return 'snack';
  if (minutes >= 1020 && minutes < 1290) return 'dinner';
  return 'snack';
}

// ---------------------------------------------------------------------------
// When a meal was eaten

/**
 * The instant a meal on `logDate` is logged at: now for today; the same time
 * of day (hour and minute, Iceland time = UTC) on that date for another day,
 * so `loggedAt` stays on the day it belongs to (the server wants them within
 * one day).
 */
export function loggedAtFor(logDate: string, now: Date = new Date()): Date {
  if (logDate === todayServerDay(now)) return now;
  const day = dateFromServerDay(logDate);
  if (!day) return now;
  const at = new Date(day.getTime());
  at.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), 0, 0);
  return at;
}
