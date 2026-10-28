/**
 * "Create my food" validation and the item it makes (iOS `CreateFoodSheet`,
 * Views/Meals/BarcodeResultSheet.swift, ios-ux.md 14.5), ported rule for rule:
 *
 *                 per 100 g                         per serving
 *   name          1 to 60 characters ("Give it a name.")
 *   kcal          0 to 900                          0 to 5,000
 *   each macro    0 to 100, together <= 105 g       0 to 500
 *   empty macro   sent as 0                         sent as null (macros incomplete)
 *   serving       label (default "1 serving", 40 characters) and grams 0.1 to 5,000, optional
 *
 * Per 100 g with a serving weight, the item opens at 1 serving with grams as
 * the other option; without one at 100 g. A typed barcode is kept only when
 * it is 8, 12, 13 or 14 digits (spaces allowed while typing). A comma or a
 * dot both read as the decimal separator.
 */
import { parseDecimal } from '../../../i18n/format';
import type { MealItemDraft } from '../types/draft';
import { newLocalId } from '../types/draftFactory';
import { GRAMS_SERVING, namedServing, type MealServing, type Per100g, type PerServing } from '../types/models';
import { characterPrefix, trimWhitespace } from '../types/text';

export type CreateFoodBasis = 'per100g' | 'perServing';

export interface CreateFoodFields {
  readonly name: string;
  readonly brand: string;
  readonly typedBarcode: string;
  readonly basis: CreateFoodBasis;
  readonly kcal: string;
  readonly protein: string;
  readonly carbs: string;
  readonly fat: string;
  readonly servingLabel: string;
  readonly servingGrams: string;
}

export const EMPTY_CREATE_FOOD: CreateFoodFields = {
  name: '',
  brand: '',
  typedBarcode: '',
  basis: 'per100g',
  kcal: '',
  protein: '',
  carbs: '',
  fat: '',
  servingLabel: '',
  servingGrams: '',
};

export const NAME_MAX = 60;
const SERVING_LABEL_MAX = 40;

/** The lengths `barcodeSchema` accepts (iOS `BarcodeNormaliser.validLengths`). */
const BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

/** Digits only (iOS `BarcodeNormaliser.digits`). */
export function barcodeDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

/** Only digits (spaces allowed while typing), 8, 12, 13 or 14 of them (iOS `isValidTyped`). */
export function isValidTypedBarcode(raw: string): boolean {
  const trimmed = raw.replace(/ /g, '');
  return trimmed !== '' && /^[0-9]+$/.test(trimmed) && BARCODE_LENGTHS.has(trimmed.length);
}

/** A field that may be empty: its number, and whether what was typed reads as one. */
export function optionalValue(text: string): { readonly value: number | null; readonly valid: boolean } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null, valid: true };
  const value = parseDecimal(trimmed);
  return value === null ? { value: null, valid: false } : { value, valid: true };
}

function trimmedName(fields: Pick<CreateFoodFields, 'name'>): string {
  return trimWhitespace(fields.name);
}

/** Empty, or longer than 60 characters. */
export function nameError(fields: Pick<CreateFoodFields, 'name'>): boolean {
  const name = trimmedName(fields);
  return name === '' || characterPrefix(name, NAME_MAX) !== name;
}

/** Not a number, or out of range for the basis. */
export function kcalError(fields: Pick<CreateFoodFields, 'kcal' | 'basis'>): boolean {
  const value = parseDecimal(fields.kcal);
  if (value === null) return true;
  const max = fields.basis === 'per100g' ? 900 : 5000;
  return value < 0 || value > max;
}

/** A macro that does not read, is out of range, or (per 100 g) makes more than 105 g together. */
export function macroError(fields: Pick<CreateFoodFields, 'protein' | 'carbs' | 'fat' | 'basis'>): boolean {
  const values = [optionalValue(fields.protein), optionalValue(fields.carbs), optionalValue(fields.fat)];
  if (values.some((entry) => !entry.valid)) return true;
  const numbers = values.map((entry) => entry.value).filter((value): value is number => value !== null);
  if (fields.basis === 'per100g') {
    return numbers.some((value) => value < 0 || value > 100) || numbers.reduce((sum, value) => sum + value, 0) > 105;
  }
  return numbers.some((value) => value < 0 || value > 500);
}

/** The serving weight, when typed and 0.1 to 5,000 g. */
export function servingGramsValue(text: string): number | null {
  const value = parseDecimal(text);
  return value !== null && value >= 0.1 && value <= 5000 ? value : null;
}

/** The error copy key under each field, when the member has tried to add. */
export function createFoodErrors(fields: CreateFoodFields): {
  readonly name: string | null;
  readonly kcal: string | null;
  readonly macro: string | null;
} {
  const per100g = fields.basis === 'per100g';
  return {
    name: nameError(fields) ? 'food.create.err.name' : null,
    kcal: kcalError(fields) ? (per100g ? 'food.create.err.kcal_100g' : 'food.create.err.kcal') : null,
    macro: macroError(fields) ? (per100g ? 'food.create.err.macro_100g' : 'food.create.err.macro') : null,
  };
}

/**
 * The item "Add to meal" makes: source and basis `member`, the barcode as
 * `choiceKey` (`barcode:<code>`) when there is one. Null while any field is
 * wrong. Nothing is sent until the meal is saved.
 */
export function createFoodItem(
  fields: CreateFoodFields,
  options: { readonly scannedBarcode: string | null; readonly defaultServingLabel: string },
): MealItemDraft | null {
  if (nameError(fields) || kcalError(fields) || macroError(fields)) return null;
  const kcal = parseDecimal(fields.kcal);
  if (kcal === null) return null;
  const label = trimWhitespace(fields.servingLabel);
  const servingName = characterPrefix(label === '' ? options.defaultServingLabel : label, SERVING_LABEL_MAX);
  const code = options.scannedBarcode ?? (isValidTypedBarcode(fields.typedBarcode) ? barcodeDigits(fields.typedBarcode) : null);
  const brand = trimWhitespace(fields.brand);
  const grams = servingGramsValue(fields.servingGrams);
  const serving = namedServing(servingName, grams);

  let measure: { serving: MealServing; amount: number; servingOptions: MealServing[]; per100g: Per100g | null; perServing: PerServing | null };
  if (fields.basis === 'per100g') {
    // An empty macro is sent as 0 here (the note says so).
    const per100g: Per100g = {
      kcal,
      proteinG: optionalValue(fields.protein).value ?? 0,
      carbsG: optionalValue(fields.carbs).value ?? 0,
      fatG: optionalValue(fields.fat).value ?? 0,
    };
    const hasServingWeight = grams !== null;
    measure = {
      serving: hasServingWeight ? serving : GRAMS_SERVING,
      amount: hasServingWeight ? 1 : 100,
      servingOptions: hasServingWeight ? [serving, GRAMS_SERVING] : [GRAMS_SERVING],
      per100g,
      perServing: null,
    };
  } else {
    // An empty macro is sent as null: counted as 0, and the meal says its
    // macros are incomplete.
    measure = {
      serving,
      amount: 1,
      servingOptions: [serving],
      per100g: null,
      perServing: {
        kcal,
        proteinG: optionalValue(fields.protein).value,
        carbsG: optionalValue(fields.carbs).value,
        fatG: optionalValue(fields.fat).value,
      },
    };
  }

  return {
    localId: newLocalId(),
    storedId: null,
    source: 'member',
    basis: 'member',
    label: trimmedName(fields),
    brand: brand === '' ? null : brand,
    foodId: null,
    barcode: code,
    off: null,
    offSummary: null,
    choiceKey: code !== null ? `barcode:${code}` : null,
    ...measure,
    estimate: null,
    overrides: null,
    confidence: null,
    confirmed: true,
    liquid: false,
    displaysGrams: false,
    storedServing: null,
    storedAmount: null,
    storedOverrides: null,
    storedNutrients: null,
  };
}
