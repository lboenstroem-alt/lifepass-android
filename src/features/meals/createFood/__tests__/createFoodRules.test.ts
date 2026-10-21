/**
 * "Create my food" (iOS CreateFoodSheet, ios-ux.md 14.5): the validation
 * table, empty macros as 0 per 100 g and null per serving, the serving
 * rules, the typed barcode, and both decimal separators.
 */
import { parseDecimal } from '../../../../i18n/format';
import {
  barcodeDigits,
  createFoodErrors,
  createFoodItem,
  EMPTY_CREATE_FOOD,
  isValidTypedBarcode,
  type CreateFoodFields,
} from '../createFoodRules';

const fields = (patch: Partial<CreateFoodFields>): CreateFoodFields => ({ ...EMPTY_CREATE_FOOD, name: 'Rye bread', kcal: '250', ...patch });
const make = (patch: Partial<CreateFoodFields>, scannedBarcode: string | null = null) =>
  createFoodItem(fields(patch), { scannedBarcode, defaultServingLabel: '1 serving' });

describe('validation', () => {
  it('needs a name of 1 to 60 characters', () => {
    expect(createFoodErrors(fields({ name: '   ' })).name).toBe('food.create.err.name');
    expect(createFoodErrors(fields({ name: 'a'.repeat(60) })).name).toBeNull();
    expect(createFoodErrors(fields({ name: 'a'.repeat(61) })).name).toBe('food.create.err.name');
    // Characters, not UTF-16 units: 60 flags still fit.
    expect(createFoodErrors(fields({ name: '🇮🇸'.repeat(60) })).name).toBeNull();
  });

  it('per 100 g: 0 to 900 kcal, each macro 0 to 100 and no more than 105 g together', () => {
    expect(createFoodErrors(fields({ kcal: '900' })).kcal).toBeNull();
    expect(createFoodErrors(fields({ kcal: '901' })).kcal).toBe('food.create.err.kcal_100g');
    expect(createFoodErrors(fields({ kcal: '' })).kcal).toBe('food.create.err.kcal_100g');
    expect(createFoodErrors(fields({ kcal: '-1' })).kcal).toBe('food.create.err.kcal_100g');
    expect(createFoodErrors(fields({ protein: '50', carbs: '50', fat: '5' })).macro).toBeNull();
    expect(createFoodErrors(fields({ protein: '50', carbs: '50', fat: '5.5' })).macro).toBe('food.create.err.macro_100g');
    expect(createFoodErrors(fields({ protein: '101' })).macro).toBe('food.create.err.macro_100g');
    expect(createFoodErrors(fields({ fat: 'lots' })).macro).toBe('food.create.err.macro_100g');
  });

  it('per serving: 0 to 5,000 kcal and each macro 0 to 500', () => {
    const serving = { basis: 'perServing' as const };
    expect(createFoodErrors(fields({ ...serving, kcal: '5000' })).kcal).toBeNull();
    expect(createFoodErrors(fields({ ...serving, kcal: '5001' })).kcal).toBe('food.create.err.kcal');
    expect(createFoodErrors(fields({ ...serving, protein: '500', carbs: '400' })).macro).toBeNull();
    expect(createFoodErrors(fields({ ...serving, protein: '501' })).macro).toBe('food.create.err.macro');
    expect(make({ ...serving, kcal: '5001' })).toBeNull();
  });
});

describe('the item', () => {
  it('per 100 g: an empty macro is 0, 100 g without a serving weight', () => {
    const item = make({ protein: '8,5' })!;
    expect(item).toMatchObject({ source: 'member', basis: 'member', label: 'Rye bread', brand: null, barcode: null, choiceKey: null });
    expect(item.per100g).toEqual({ kcal: 250, proteinG: 8.5, carbsG: 0, fatG: 0 });
    expect(item.perServing).toBeNull();
    expect(item.serving).toEqual({ unit: 'g', label: null, grams: null });
    expect(item.amount).toBe(100);
    expect(item.servingOptions).toEqual([{ unit: 'g', label: null, grams: null }]);
  });

  it('per 100 g with a serving weight: 1 serving, then grams', () => {
    const item = make({ servingLabel: '1 slice', servingGrams: '35' })!;
    expect(item.serving).toEqual({ unit: 'serving', label: '1 slice', grams: 35 });
    expect(item.amount).toBe(1);
    expect(item.servingOptions).toEqual([
      { unit: 'serving', label: '1 slice', grams: 35 },
      { unit: 'g', label: null, grams: null },
    ]);
  });

  it('per serving: an empty macro is null (macros incomplete), the default label "1 serving", grams optional', () => {
    const item = make({ basis: 'perServing', kcal: '320', carbs: '40' })!;
    expect(item.perServing).toEqual({ kcal: 320, proteinG: null, carbsG: 40, fatG: null });
    expect(item.per100g).toBeNull();
    expect(item.serving).toEqual({ unit: 'serving', label: '1 serving', grams: null });
    expect(make({ basis: 'perServing', servingGrams: '0.05' })!.serving.grams).toBeNull();
    expect(make({ basis: 'perServing', servingGrams: '5000' })!.serving.grams).toBe(5000);
  });

  it('keeps a scanned barcode, and a typed one only at 8, 12, 13 or 14 digits', () => {
    expect(make({}, '5690527123456')).toMatchObject({ barcode: '5690527123456', choiceKey: 'barcode:5690527123456' });
    expect(make({ typedBarcode: '5690 5271 2345 6' })).toMatchObject({ barcode: '5690527123456', choiceKey: 'barcode:5690527123456' });
    expect(make({ typedBarcode: '12345' })).toMatchObject({ barcode: null, choiceKey: null });
    expect(isValidTypedBarcode('12345678')).toBe(true);
    expect(isValidTypedBarcode('123456789')).toBe(false);
    expect(isValidTypedBarcode('1234567a')).toBe(false);
    expect(barcodeDigits('12 34-56')).toBe('123456');
  });

  it('keeps the brand when typed, and cuts the serving label to 40 characters', () => {
    const item = make({ brand: '  Myllan ', servingLabel: 'x'.repeat(50), servingGrams: '30' })!;
    expect(item.brand).toBe('Myllan');
    expect(item.serving.label).toHaveLength(40);
  });
});

describe('decimals typed either way', () => {
  it('reads 72,5 and 72.5, and refuses 7,2,5', () => {
    expect(parseDecimal('72,5')).toBe(72.5);
    expect(parseDecimal('72.5')).toBe(72.5);
    expect(parseDecimal('7,2,5')).toBeNull();
  });
});
