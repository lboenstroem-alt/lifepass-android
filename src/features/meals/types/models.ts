/**
 * The food log's models at editing level: the Android port of iOS
 * Models/MealModels.swift.
 *
 * The READ shapes Plan draws (`MealView`, `MealDayTotals`, `MealDaySummary`,
 * `MealSlot`, `ItemNutrients`) live with the health platform
 * (src/health/models.ts). This file holds what the food log needs to EDIT and
 * SAVE a meal: the full item as the server stores it (per 100 g, per serving,
 * the photo estimate, the member's overrides), the foods a search answers
 * with, and the request bodies. The editable item (`MealItemDraft`) is in
 * ./draft.ts, the decoders in ./decode.ts, the wire encoders in ./encode.ts.
 *
 * Every optional value is `null`, never `undefined`, so a model written to
 * disk (the outbox, the tray, the foods cache) reads back equal.
 *
 * TWO WIRE DETAILS THAT BITE (they are why ./encode.ts exists):
 *
 * 1. `updatedAt` stays a STRING. OP-35 compares `expectedUpdatedAt` with the
 *    row at millisecond precision, and the app's request encoder writes
 *    dates without fractional seconds (src/api/wire.ts `toWireDate`). A meal
 *    read into a `Date` and sent back would never match its own row, and
 *    every edit would answer 409.
 * 2. A serving in grams is `{ "unit": "g" }` and nothing else, while a
 *    serving in servings MUST carry `grams`, as `null` when unknown: the
 *    schema is a strict object with a nullable (not optional) field. The
 *    same for the per-serving macros.
 */
import type {
  ItemNutrients,
  MealDayTotals,
  MealSlot,
  NutritionTarget,
  TargetWithheldReason,
} from '../../../health/models';

export type { ItemNutrients, MealDayTotals, MealSlot, NutritionTarget, TargetWithheldReason };

// ---------------------------------------------------------------------------
// Sources and bases

/** Where an item's numbers come from (iOS `MealItemSourceKind`). */
export const MealItemSourceKind = {
  /** foods.json: the server takes the numbers from its own table by `foodId`. */
  library: ['usda', 'fineli', 'matvaretabellen', 'lifepass_estimate', 'lifepass_label'] as readonly string[],

  isLibrary(source: string): boolean {
    return MealItemSourceKind.library.includes(source);
  },

  /** The member typed these numbers: a created food or a quick add. */
  isMemberTyped(source: string): boolean {
    return source === 'member' || source === 'quick_add';
  },
} as const;

// ---------------------------------------------------------------------------
// Serving

/** One way of counting an item: grams, or a named serving with its weight. */
export interface MealServing {
  /** `g` or `serving`. */
  readonly unit: string;
  readonly label: string | null;
  readonly grams: number | null;
}

/** The grams serving (iOS `MealServing.grams`). */
export const GRAMS_SERVING: MealServing = Object.freeze({ unit: 'g', label: null, grams: null });

/** A named serving (iOS `MealServing(serving:grams:)`). */
export function namedServing(label: string, grams: number | null): MealServing {
  return { unit: 'serving', label, grams };
}

export function isGramsServing(serving: MealServing): boolean {
  return serving.unit === 'g';
}

/** Swift's synthesized `==` on `MealServing`: unit, label and grams. */
export function servingEquals(a: MealServing | null | undefined, b: MealServing | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.unit === b.unit && a.label === b.label && a.grams === b.grams;
}

// ---------------------------------------------------------------------------
// Nutrients

/** Values per 100 g (library foods, label foods, created foods). */
export interface Per100g {
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
}

/**
 * Values per ONE serving, typed by the member. An unknown macro is null on
 * the wire (counted as 0, `macrosComplete: false`), and the key must be there.
 */
export interface PerServing {
  readonly kcal: number;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
}

export function perServingMacrosComplete(values: PerServing): boolean {
  return values.proteinG !== null && values.carbsG !== null && values.fatG !== null;
}

/** The four numbers an item carries (iOS `MealNutrientField`). */
export type MealNutrientField = 'kcal' | 'protein' | 'carbs' | 'fat';

export const MEAL_NUTRIENT_FIELDS: readonly MealNutrientField[] = ['kcal', 'protein', 'carbs', 'fat'];

/** The name the server lists in `edited`. */
export function nutrientWireName(field: MealNutrientField): 'kcal' | 'proteinG' | 'carbsG' | 'fatG' {
  switch (field) {
    case 'kcal':
      return 'kcal';
    case 'protein':
      return 'proteinG';
    case 'carbs':
      return 'carbsG';
    case 'fat':
      return 'fatG';
  }
}

/**
 * The member's own numbers, per ONE unit of the selected serving (one
 * serving, or one gram). Only the fields they changed are set.
 */
export interface NutrientOverrides {
  readonly kcal: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
}

export const NO_OVERRIDES: NutrientOverrides = Object.freeze({ kcal: null, proteinG: null, carbsG: null, fatG: null });

export function overridesAreEmpty(overrides: NutrientOverrides | null | undefined): boolean {
  return !overrides || (overrides.kcal === null && overrides.proteinG === null && overrides.carbsG === null && overrides.fatG === null);
}

/** iOS compares `(overrides ?? NutrientOverrides())`: a missing set equals an empty one. */
export function overridesEqual(a: NutrientOverrides | null | undefined, b: NutrientOverrides | null | undefined): boolean {
  const left = a ?? NO_OVERRIDES;
  const right = b ?? NO_OVERRIDES;
  return left.kcal === right.kcal && left.proteinG === right.proteinG && left.carbsG === right.carbsG && left.fatG === right.fatG;
}

/** The override for one field (iOS `NutrientOverrides[field]`). */
export function overrideFor(overrides: NutrientOverrides | null | undefined, field: MealNutrientField): number | null {
  if (!overrides) return null;
  return overrides[nutrientWireName(field)];
}

/** The same overrides with one field set (or cleared with null). */
export function withOverride(
  overrides: NutrientOverrides | null | undefined,
  field: MealNutrientField,
  value: number | null,
): NutrientOverrides {
  return { ...(overrides ?? NO_OVERRIDES), [nutrientWireName(field)]: value };
}

/** A photo estimate as the server stored it: a kcal range and point macros for `grams`. */
export interface ItemEstimate {
  readonly grams: number;
  readonly kcalLow: number;
  readonly kcalHigh: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
}

// ---------------------------------------------------------------------------
// Open Food Facts

export interface OFFNutrients {
  readonly kcal: number;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly fibreG: number | null;
  readonly sugarsG: number | null;
  readonly saturatedFatG: number | null;
  readonly saltG: number | null;
}

/**
 * The snapshot the phone builds from an Open Food Facts product
 * (`offSnapshotSchema`). Sent whole with a NEW item, never with a stored one.
 */
export interface OFFSnapshot {
  readonly barcode: string;
  readonly productName: string;
  /** `is`, `en` or `other`. */
  readonly productNameLang: string;
  readonly brand: string | null;
  readonly per100g: OFFNutrients;
  readonly energyFromKj: boolean;
  readonly servingLabel: string | null;
  readonly servingQuantityG: number | null;
  /** ISO 8601, when the phone received it. */
  readonly retrievedAt: string;
}

export function offMacrosComplete(snapshot: OFFSnapshot): boolean {
  const values = snapshot.per100g;
  return values.proteinG !== null && values.carbsG !== null && values.fatG !== null;
}

/**
 * The item math's per 100 g: a missing macro counts 0 (and the item says its
 * macros are incomplete), exactly as the server stores it.
 */
export function offItemPer100g(snapshot: OFFSnapshot): Per100g {
  const values = snapshot.per100g;
  return {
    kcal: values.kcal,
    proteinG: values.proteinG ?? 0,
    carbsG: values.carbsG ?? 0,
    fatG: values.fatG ?? 0,
  };
}

/** Built by the server on every read; the phone never supplies it. */
export interface OffAttribution {
  readonly name: string | null;
  readonly licence: string | null;
  readonly licenceUrl: string | null;
  readonly productUrl: string | null;
}

/** What a stored Open Food Facts item says about itself on read. */
export interface OffSummary {
  readonly productName: string | null;
  readonly brand: string | null;
  readonly energyFromKj: boolean | null;
  readonly labelMismatch: boolean | null;
  readonly attribution: OffAttribution | null;
}

// ---------------------------------------------------------------------------
// A stored meal, in full

/** `MealItemView` as the server sends it, with every field the editor needs. */
export interface MealItemRecord {
  readonly id: string;
  readonly source: string;
  readonly basis: string | null;
  readonly label: string;
  readonly brand: string | null;
  readonly foodId: string | null;
  readonly barcode: string | null;
  readonly serving: MealServing;
  readonly amount: number;
  readonly servingOptions: readonly MealServing[];
  readonly per100g: Per100g | null;
  readonly perServing: PerServing | null;
  readonly estimate: ItemEstimate | null;
  readonly overrides: NutrientOverrides | null;
  readonly edited: readonly string[];
  readonly confidence: string | null;
  readonly confirmed: boolean;
  readonly nutrients: ItemNutrients | null;
  readonly liquid: boolean;
  readonly off: OffSummary | null;
}

/** One meal as OP-33, OP-34, OP-35, OP-44 and OP-46 answer with it. */
export interface MealRecord {
  readonly id: string;
  readonly logDate: string;
  readonly loggedAt: Date | null;
  readonly slot: MealSlot;
  readonly source: string | null;
  readonly confirmed: boolean;
  readonly confidence: string | null;
  readonly needsConfirm: boolean;
  readonly hasEstimate: boolean;
  readonly items: readonly MealItemRecord[];
  readonly totals: MealDayTotals | null;
  readonly createdAt: Date | null;
  /** Kept EXACTLY as the server wrote it (see the top of this file). */
  readonly updatedAt: string | null;
}

/** "Skyr, banana, oats" for a one-line row. */
export function mealItemSummaryOf(meal: Pick<MealRecord, 'items'>): string {
  return meal.items
    .map((item) => item.label)
    .filter((label) => label !== '')
    .join(', ');
}

/** An estimate (a photo or a description) still waiting for the member. */
export function isDraftMeal(meal: Pick<MealRecord, 'confirmed'>): boolean {
  return !meal.confirmed;
}

/** Made from a description the member typed or dictated (OP-56). */
export function isMealFromDescription(meal: Pick<MealRecord, 'source'>): boolean {
  return meal.source === 'text';
}

/** OP-33: one day of meals, drafts included as full meals. */
export interface MealDayRecord {
  readonly date: string;
  readonly meals: readonly MealRecord[];
  readonly drafts: readonly MealRecord[];
  readonly totals: MealDayTotals | null;
  readonly target: NutritionTarget | null;
  readonly targetWithheld: TargetWithheldReason | null;
  readonly scansLeftToday: number | null;
  /**
   * Description drafts filed on `date`. The website lists them here, apart
   * from `drafts`, which stays photo only so 2.5.5's diary never labels one a
   * photo estimate. Read together with `drafts`, once each (`allDrafts`);
   * empty on an older server.
   */
  readonly textDrafts: readonly MealRecord[];
}

/** Every draft of the day, photo and description, once each. The row copy follows each meal's own `source`. */
export function allDraftsOf(day: Pick<MealDayRecord, 'drafts' | 'textDrafts'>): MealRecord[] {
  const seen = new Set<string>();
  return [...day.drafts, ...day.textDrafts].filter((meal) => {
    if (seen.has(meal.id)) return false;
    seen.add(meal.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Foods

/**
 * A food the member can add in one tap (`FoodChoice`): a library row, one of
 * their recents, a created food, or an Open Food Facts product they logged.
 */
export interface FoodChoice {
  readonly key: string;
  readonly source: string;
  readonly basis: string | null;
  readonly label: string;
  readonly brand: string | null;
  readonly foodId: string | null;
  readonly barcode: string | null;
  readonly servingOptions: readonly MealServing[];
  readonly defaultServing: MealServing;
  readonly defaultAmount: number;
  readonly defaultKcal: number | null;
  readonly per100g: Per100g | null;
  readonly perServing: PerServing | null;
  /** The stored snapshot: sent back unchanged when the member adds this food again as a NEW item. */
  readonly off: OFFSnapshot | null;
  readonly offAttribution: OffAttribution | null;
  readonly liquid: boolean;
  readonly lastUsedAt: string | null;
  readonly useCount: number | null;
}

/** One ingredient of a preset meal: always a library food, counted in grams. */
export interface PresetIngredient {
  readonly foodId: string;
  readonly source: string;
  readonly label: string;
  readonly grams: number;
  readonly kcal: number;
  readonly per100g: Per100g;
  readonly servingOptions: readonly MealServing[];
  readonly liquid: boolean;
}

export interface PresetCategory {
  readonly id: string;
  readonly label: string;
}

export interface PresetPerServingTotals {
  readonly kcal: number;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
}

export interface PresetMeal {
  readonly id: string;
  readonly name: string;
  readonly category: PresetCategory | null;
  readonly ingredients: readonly PresetIngredient[];
  readonly perServing: PresetPerServingTotals | null;
}

/** A meal the member logged recently, ready to add again in one tap. */
export interface RecentMeal {
  readonly key: string;
  readonly slot: MealSlot;
  readonly itemCount: number;
  readonly kcal: number;
  readonly items: readonly FoodChoice[];
}

/** OP-39: common foods and preset meals (public library content). */
export interface FoodPresets {
  readonly libraryVersion: string | null;
  readonly foods: readonly FoodChoice[];
  readonly meals: readonly PresetMeal[];
  readonly categories: readonly PresetCategory[];
}

/** OP-40: the member's own recents, frequent, created foods and recent meals. */
export interface MyFoods {
  readonly recents: readonly FoodChoice[];
  readonly frequent: readonly FoodChoice[];
  readonly mine: readonly FoodChoice[];
  readonly recentMeals: readonly RecentMeal[];
}

export const EMPTY_MY_FOODS: MyFoods = Object.freeze({ recents: [], frequent: [], mine: [], recentMeals: [] });

/** The same lists with one key gone (a My foods removal, applied at once). */
export function myFoodsRemoving(foods: MyFoods, key: string): MyFoods {
  return {
    recents: foods.recents.filter((food) => food.key !== key),
    frequent: foods.frequent.filter((food) => food.key !== key),
    mine: foods.mine.filter((food) => food.key !== key),
    recentMeals: foods.recentMeals.filter((meal) => !meal.items.some((food) => food.key === key)),
  };
}

/** OP-38. */
export interface FoodSearchResult {
  readonly query: string | null;
  readonly mine: readonly FoodChoice[];
  readonly foods: readonly FoodChoice[];
  readonly meals: readonly PresetMeal[];
  /**
   * True when nothing matched every word and these are the closest matches on
   * some of them (2026-10 search). Absent, so false, on an older server.
   */
  readonly closest: boolean;
}

export function isSearchResultEmpty(result: Pick<FoodSearchResult, 'mine' | 'foods' | 'meals'>): boolean {
  return result.mine.length === 0 && result.foods.length === 0 && result.meals.length === 0;
}

/** OP-31: the member's own food with that barcode, or a staff label row. */
export interface BarcodeLookupResult {
  readonly food: FoodChoice | null;
  /** `mine` or `library`. */
  readonly origin: string | null;
}

/** OP-34, OP-35, OP-46. */
export interface MealWriteResult {
  readonly meal: MealRecord;
  readonly replayed: boolean | null;
}

/** OP-32. */
export interface MealScanResult {
  readonly meal: MealRecord | null;
  readonly noFood: boolean;
  readonly needsConfirm: boolean;
  readonly scansLeftToday: number | null;
  readonly replayed: boolean | null;
}

/**
 * OP-56, `POST /health/meals/describe`: the same answer as a photo scan, with
 * `describesLeftToday` in place of `scansLeftToday`.
 *
 *   201 `{ meal, noFood: false, needsConfirm, describesLeftToday, replayed: false }`
 *   200 the same with `replayed: true` (this key already bought an estimate)
 *   200 `{ meal: null, noFood: true, ... }` when the words named no food
 */
export interface MealDescribeResult {
  readonly meal: MealRecord | null;
  readonly noFood: boolean;
  readonly needsConfirm: boolean;
  readonly describesLeftToday: number | null;
  readonly replayed: boolean | null;
}

// ---------------------------------------------------------------------------
// Request bodies

/** One item of a meal body (`mealItemInputSchema`). A null field is not sent. */
export interface MealItemInput {
  readonly id: string | null;
  readonly source: string;
  readonly label: string;
  readonly brand: string | null;
  readonly foodId: string | null;
  readonly barcode: string | null;
  readonly off: OFFSnapshot | null;
  readonly serving: MealServing;
  readonly amount: number;
  readonly per100g: Per100g | null;
  readonly perServing: PerServing | null;
  readonly overrides: NutrientOverrides | null;
  readonly confirmed: boolean;
}

/** Where the member found the first item of a new meal: OP-34's meal-level `source`. */
export type MealEntrySource = 'barcode' | 'search' | 'recent' | 'preset' | 'quick_add' | 'manual';

export const MEAL_ENTRY_SOURCES: readonly MealEntrySource[] = ['barcode', 'search', 'recent', 'preset', 'quick_add', 'manual'];

/** The slot the capture page opens with: `auto` resolves by the local clock when the page opens. */
export type MealSlotChoice = { readonly kind: 'auto' } | { readonly kind: 'fixed'; readonly slot: MealSlot };

/** OP-34. */
export interface MealCreateBody {
  readonly slot: string;
  readonly loggedAt: Date;
  readonly logDate: string;
  /** A `MealEntrySource`. */
  readonly source: string;
  readonly items: readonly MealItemInput[];
}

/** OP-35. Only what changes is sent: a field left out is not sent. */
export interface MealPatchBody {
  readonly slot?: string;
  readonly loggedAt?: Date;
  readonly logDate?: string;
  readonly items?: readonly MealItemInput[];
  /** Only ever `true` (the schema's `const`): confirming a draft. */
  readonly confirmed?: boolean;
  /** The meal's `updatedAt` exactly as it was read. */
  readonly expectedUpdatedAt?: string;
}

/** OP-46. */
export interface MealCopyBody {
  readonly logDate: string;
  readonly loggedAt: Date;
  readonly slot: string;
}

/** OP-32. */
export interface MealScanBody {
  readonly image: { readonly mediaType: 'image/jpeg'; readonly dataBase64: string };
  readonly slot: string;
  readonly logDate: string;
  readonly loggedAt: Date;
}

/**
 * OP-56. A strict object on the server: exactly these five keys. The words
 * travel in this body and nowhere else: never a URL, a header or a log.
 */
export interface MealDescribeBody {
  /** Already cleaned, 2 to 280 UTF-16 units (MEAL-5's text rules). */
  readonly text: string;
  readonly slot: string;
  readonly logDate: string;
  readonly loggedAt: Date;
  /** `en` or `is`: the language the item names come back in. */
  readonly locale: string;
}
