/**
 * Making a `MealItemDraft` from what the member picked, and turning one into
 * what goes on the wire: the constructors and `input()` of iOS
 * `MealItemDraft` (Models/MealModels.swift).
 *
 * WHAT EACH ITEM SENDS (`input`). A stored item sends its id, the amount and
 * serving, and the member's overrides (ALL of them: the server replaces the
 * stored overrides with what is sent, so leaving them out would wipe numbers
 * typed last week). It never resends a snapshot or library numbers: the
 * server keeps its own. A new item sends only what its source is allowed to
 * carry:
 *
 *   library (usda, fineli, matvaretabellen, lifepass_*)  foodId only
 *   off                                                   barcode + the full snapshot
 *   member (a created food)                               barcode + perServing or per100g
 *   quick_add                                             perServing
 */
import { newIdempotencyKey } from '../../../api/idempotency';
import { roundHalfAwayFromZero } from '../../../i18n/format';
import { basisForNewSource, clampedAmount, defaultServingLabel } from '../math/itemMath';

import { isLibraryItem, type MealItemDraft } from './draft';
import {
  GRAMS_SERVING,
  MealItemSourceKind,
  namedServing,
  offItemPer100g,
  overridesAreEmpty,
  type FoodChoice,
  type MealItemInput,
  type MealItemRecord,
  type MealServing,
  type OFFSnapshot,
  type PresetIngredient,
} from './models';
import { characterPrefix, trimWhitespace } from './text';

/** A fresh local id (a v4 UUID: uniqueness is all it needs). */
export function newLocalId(): string {
  return newIdempotencyKey();
}

/** Every field, with the defaults iOS's memberwise init gives a new item. */
function draft(fields: Omit<MealItemDraft, 'localId' | 'storedId' | 'displaysGrams' | 'storedServing' | 'storedAmount' | 'storedOverrides' | 'storedNutrients'> & Partial<MealItemDraft>): MealItemDraft {
  return {
    localId: newLocalId(),
    storedId: null,
    displaysGrams: false,
    storedServing: null,
    storedAmount: null,
    storedOverrides: null,
    storedNutrients: null,
    ...fields,
  };
}

/** A stored item, as the editor opens it. */
export function draftFromRecord(record: MealItemRecord): MealItemDraft {
  const overrides = overridesAreEmpty(record.overrides) ? null : record.overrides;
  return draft({
    storedId: record.id,
    source: record.source,
    basis: record.basis ?? basisForNewSource(record.source),
    label: record.label,
    brand: record.brand,
    foodId: record.foodId,
    barcode: record.barcode,
    off: null,
    offSummary: record.off,
    choiceKey: null,
    serving: record.serving,
    amount: record.amount,
    servingOptions: record.servingOptions,
    per100g: record.per100g,
    perServing: record.perServing,
    estimate: record.estimate,
    overrides,
    confidence: record.confidence,
    confirmed: record.confirmed,
    liquid: record.liquid,
    storedServing: record.serving,
    storedAmount: record.amount,
    storedOverrides: overrides,
    storedNutrients: record.nutrients,
  });
}

/** A food the member picked, at its default portion (or another amount). */
export function draftFromChoice(choice: FoodChoice, serving?: MealServing | null, amount?: number | null): MealItemDraft {
  return draft({
    source: choice.source,
    basis: basisForNewSource(choice.source),
    label: characterPrefix(choice.label, 80),
    brand: choice.brand === null ? null : characterPrefix(choice.brand, 60),
    foodId: choice.foodId,
    barcode: choice.barcode,
    off: choice.off,
    offSummary: null,
    choiceKey: choice.key,
    serving: serving ?? choice.defaultServing,
    amount: amount ?? choice.defaultAmount,
    servingOptions: choice.servingOptions,
    per100g: choice.per100g ?? (choice.off ? offItemPer100g(choice.off) : null),
    perServing: choice.perServing,
    estimate: null,
    overrides: null,
    confidence: null,
    confirmed: true,
    liquid: choice.liquid,
  });
}

/** One ingredient of a preset meal, at the recipe grams times servings (at least 1 g). */
export function draftFromIngredient(ingredient: PresetIngredient, servings: number): MealItemDraft {
  return draft({
    source: ingredient.source,
    basis: 'database',
    label: characterPrefix(ingredient.label, 80),
    brand: null,
    foodId: ingredient.foodId,
    barcode: null,
    off: null,
    offSummary: null,
    choiceKey: `food:${ingredient.foodId}`,
    serving: GRAMS_SERVING,
    amount: Math.max(1, roundHalfAwayFromZero(ingredient.grams * servings)),
    servingOptions: ingredient.servingOptions,
    per100g: ingredient.per100g,
    perServing: null,
    estimate: null,
    overrides: null,
    confidence: null,
    confirmed: true,
    liquid: ingredient.liquid,
  });
}

/** An Open Food Facts product: 1 serving when its weight is known, else 100 g. */
export function draftFromProduct(snapshot: OFFSnapshot, liquid: boolean): MealItemDraft {
  let options: MealServing[] = [GRAMS_SERVING];
  let serving: MealServing = GRAMS_SERVING;
  let amount = 100;
  if (snapshot.servingQuantityG !== null) {
    const grams = snapshot.servingQuantityG;
    const label = snapshot.servingLabel !== null ? characterPrefix(snapshot.servingLabel, 40) : defaultServingLabel(grams);
    const named = namedServing(label, grams);
    options = [named, ...options];
    serving = named;
    amount = 1;
  }
  return draft({
    source: 'off',
    basis: 'label',
    label: characterPrefix(snapshot.productName, 80),
    brand: snapshot.brand === null ? null : characterPrefix(snapshot.brand, 60),
    foodId: null,
    barcode: snapshot.barcode,
    off: snapshot,
    offSummary: null,
    choiceKey: `barcode:${snapshot.barcode}`,
    serving,
    amount,
    servingOptions: options,
    per100g: offItemPer100g(snapshot),
    perServing: null,
    estimate: null,
    overrides: null,
    confidence: null,
    confirmed: true,
    liquid,
  });
}

/** A quick add: calories (and any macros) for one serving. */
export function quickAddDraft(options: {
  readonly label: string;
  readonly kcal: number;
  readonly protein: number | null;
  readonly carbs: number | null;
  readonly fat: number | null;
  readonly servingLabel: string;
}): MealItemDraft {
  const serving = namedServing(options.servingLabel, null);
  return draft({
    source: 'quick_add',
    basis: 'member',
    label: characterPrefix(options.label, 80),
    brand: null,
    foodId: null,
    barcode: null,
    off: null,
    offSummary: null,
    choiceKey: null,
    serving,
    amount: 1,
    servingOptions: [serving],
    per100g: null,
    perServing: { kcal: options.kcal, proteinG: options.protein, carbsG: options.carbs, fatG: options.fat },
    estimate: null,
    overrides: null,
    confidence: null,
    confirmed: true,
    liquid: false,
  });
}

/** What goes on the wire for this item (see the top of this file). */
export function draftInput(item: MealItemDraft): MealItemInput {
  const label = characterPrefix(trimWhitespace(item.label), 80);
  const brand = item.brand === null || trimWhitespace(item.brand) === '' ? null : characterPrefix(item.brand, 60);
  const base: MealItemInput = {
    id: item.storedId,
    source: item.source,
    label: label === '' ? '1' : label,
    brand,
    foodId: null,
    barcode: null,
    off: null,
    serving: item.serving,
    amount: clampedAmount(item.amount, item.serving),
    per100g: null,
    perServing: null,
    overrides: overridesAreEmpty(item.overrides) ? null : item.overrides,
    confirmed: item.confirmed,
  };
  if (item.storedId !== null) {
    // Library and label rows keep their foodId so the server's source check
    // can run; barcodes ride with their Open Food Facts rows.
    let input: MealItemInput = {
      ...base,
      foodId: isLibraryItem(item) ? item.foodId : null,
      barcode: item.source === 'off' ? item.barcode : null,
    };
    if (MealItemSourceKind.isMemberTyped(item.source)) {
      // A created food or quick add carries its own numbers, and the member
      // may have changed them: resend what the item holds.
      input = {
        ...input,
        per100g: item.per100g,
        perServing: item.perServing,
        barcode: item.source === 'member' ? item.barcode : null,
      };
    }
    return input;
  }
  if (isLibraryItem(item)) return { ...base, foodId: item.foodId };
  switch (item.source) {
    case 'off':
      return { ...base, barcode: item.barcode, off: item.off };
    case 'member':
      return item.perServing !== null
        ? { ...base, barcode: item.barcode, perServing: item.perServing }
        : { ...base, barcode: item.barcode, per100g: item.per100g };
    case 'quick_add':
      return { ...base, perServing: item.perServing };
    default:
      return base;
  }
}
