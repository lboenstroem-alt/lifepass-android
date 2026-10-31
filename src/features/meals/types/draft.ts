/**
 * One item as the capture page, the tray and the editors hold it: iOS
 * `MealItemDraft` (Models/MealModels.swift).
 *
 * It carries everything the item math needs (per 100 g, per serving, the
 * photo estimate, the member's overrides) and remembers what the server had
 * for a stored item, so the editor can tell an untouched estimate (keep the
 * server's range) from one the member changed (compute a number), exactly as
 * the server will on save.
 *
 * Immutable: a change is a new object (`{ ...item, amount }`), which is what
 * a React state update wants anyway. The constructors and the wire input are
 * in ./draftFactory.ts (they need the item math, which needs this type).
 */
import { arrayOf, boolean, double, object, opt, req, soft, string, type Reader } from '../../../health/decode';
import type { ItemNutrients } from '../../../health/models';

import {
  decodeItemEstimate,
  decodeItemNutrients,
  decodeMealServing,
  decodeNutrientOverrides,
  decodeOFFSnapshot,
  decodeOffSummary,
  decodePer100g,
  decodePerServing,
} from './decode';
import {
  MealItemSourceKind,
  overridesEqual,
  servingEquals,
  type ItemEstimate,
  type MealServing,
  type NutrientOverrides,
  type OFFSnapshot,
  type OffSummary,
  type Per100g,
  type PerServing,
} from './models';

export interface MealItemDraft {
  /** Local identity for lists and the tray. Never sent. */
  readonly localId: string;
  /** The server's item id, for an item of a stored meal. */
  readonly storedId: string | null;
  readonly source: string;
  /** The server's basis for a stored item; derived from the source for a new one. */
  readonly basis: string;
  readonly label: string;
  readonly brand: string | null;
  readonly foodId: string | null;
  readonly barcode: string | null;
  /** The FULL Open Food Facts snapshot, for a new item only. */
  readonly off: OFFSnapshot | null;
  /** What a stored Open Food Facts item says about itself. */
  readonly offSummary: OffSummary | null;
  /** The `FoodChoice` key this came from, when it came from one. */
  readonly choiceKey: string | null;
  readonly serving: MealServing;
  readonly amount: number;
  readonly servingOptions: readonly MealServing[];
  readonly per100g: Per100g | null;
  readonly perServing: PerServing | null;
  readonly estimate: ItemEstimate | null;
  readonly overrides: NutrientOverrides | null;
  readonly confidence: string | null;
  readonly confirmed: boolean;
  readonly liquid: boolean;
  /**
   * A created food counted per serving, shown to the member in grams: the
   * amount stays in servings on the wire.
   */
  readonly displaysGrams: boolean;

  // What the server had, for a stored item.
  readonly storedServing: MealServing | null;
  readonly storedAmount: number | null;
  readonly storedOverrides: NutrientOverrides | null;
  readonly storedNutrients: ItemNutrients | null;
}

/** A new item has no server id. */
export function isStoredItem(item: Pick<MealItemDraft, 'storedId'>): boolean {
  return item.storedId !== null;
}

/** The member changed the amount, the serving or a number since load (always true for a new item). */
export function isChangedFromStored(item: MealItemDraft): boolean {
  if (item.storedId === null) return true;
  return (
    !servingEquals(item.serving, item.storedServing) ||
    item.amount !== item.storedAmount ||
    !overridesEqual(item.overrides, item.storedOverrides)
  );
}

/** A photo estimate the member has not touched: it keeps the server's range and its Estimate chip. */
export function isUntouchedEstimate(item: MealItemDraft): boolean {
  return item.basis === 'estimate' && !isChangedFromStored(item);
}

/** Low confidence and not yet checked: Save waits for it. */
export function itemNeedsCheck(item: Pick<MealItemDraft, 'confidence' | 'confirmed'>): boolean {
  return item.confidence === 'low' && !item.confirmed;
}

export function isLibraryItem(item: Pick<MealItemDraft, 'source'>): boolean {
  return MealItemSourceKind.isLibrary(item.source);
}

// ---------------------------------------------------------------------------
// On disk (the tray)

/**
 * A draft read back from the tray file. The draft is written as it is held
 * (JSON of the object above), so every field reads strictly; a draft that
 * does not is dropped by the tray's reader, never the whole tray.
 */
export const decodeMealItemDraft: Reader<MealItemDraft> = (value, path) => {
  const json = object(value, path);
  return {
    localId: req(json, 'localId', path, string),
    storedId: opt(json, 'storedId', path, string),
    source: req(json, 'source', path, string),
    basis: req(json, 'basis', path, string),
    label: req(json, 'label', path, string),
    brand: opt(json, 'brand', path, string),
    foodId: opt(json, 'foodId', path, string),
    barcode: opt(json, 'barcode', path, string),
    off: opt(json, 'off', path, decodeOFFSnapshot),
    offSummary: opt(json, 'offSummary', path, decodeOffSummary),
    choiceKey: opt(json, 'choiceKey', path, string),
    serving: req(json, 'serving', path, decodeMealServing),
    amount: req(json, 'amount', path, double),
    servingOptions: soft(json, 'servingOptions', path, arrayOf(decodeMealServing)) ?? [],
    per100g: opt(json, 'per100g', path, decodePer100g),
    perServing: opt(json, 'perServing', path, decodePerServing),
    estimate: opt(json, 'estimate', path, decodeItemEstimate),
    overrides: opt(json, 'overrides', path, decodeNutrientOverrides),
    confidence: opt(json, 'confidence', path, string),
    confirmed: req(json, 'confirmed', path, boolean),
    liquid: soft(json, 'liquid', path, boolean) ?? false,
    displaysGrams: soft(json, 'displaysGrams', path, boolean) ?? false,
    storedServing: opt(json, 'storedServing', path, decodeMealServing),
    storedAmount: opt(json, 'storedAmount', path, double),
    storedOverrides: opt(json, 'storedOverrides', path, decodeNutrientOverrides),
    storedNutrients: opt(json, 'storedNutrients', path, decodeItemNutrients),
  };
};
