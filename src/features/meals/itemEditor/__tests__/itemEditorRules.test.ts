/**
 * The item editor's rules (iOS FoodItemEditorSheet) and the words every meal
 * screen shares (iOS MealText, MealDateText). The footer cases are iOS
 * `FoodItemEditorFooterTests`, vector for vector.
 */
import { translate } from '../../../../i18n';
import { displayedItem, fieldAmount, settingValue } from '../../math/itemMath';
import { draftFromRecord, quickAddDraft } from '../../types/draftFactory';
import { GRAMS_SERVING, namedServing } from '../../types/models';
import {
  applyingTypedNutrient,
  baseFieldAmount,
  currentServingTitle,
  editEvent,
  editorServingMenu,
  EMPTY_TEXTS,
  isAmountValid,
  isMultiplierSelected,
  isNameEditable,
  isUndoableRemoval,
  itemsToRestore,
  multipliedItem,
  multiplierLabel,
  offProductPage,
  pickingServing,
  pinnedBottomPadding,
  primaryTitleKey,
  renamedItem,
  showsKcalRange,
  steppedItem,
  syncedTexts,
} from '../itemEditorRules';
import { mealAmountLine, mealCountBand, mealFieldText, mealKcal, mealSourceWord, relativeMealDay } from '../mealText';

import { bananaItemJson, mealRecord, newSkyr, offItemJson, photoItemJson, skyrItemJson } from './fixtures';

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

describe('the pinned footer (FoodItemEditorFooterTests)', () => {
  it('has room on a phone with no bottom inset', () => {
    expect(pinnedBottomPadding(true, 0)).toBe(12);
  });

  it('takes the system inset as the room', () => {
    expect(pinnedBottomPadding(true, 34)).toBe(0);
    expect(pinnedBottomPadding(true, 21)).toBe(0);
  });

  it('keeps the button 6 without the attribution', () => {
    expect(pinnedBottomPadding(false, 0)).toBe(6);
    expect(pinnedBottomPadding(false, 34)).toBe(6);
  });
});

describe('the amount', () => {
  it('multipliers are relative to the opening amount: 1.5x twice stays 1.5x', () => {
    const opening = newSkyr();
    const once = multipliedItem(opening, opening.amount, 1.5);
    const twice = multipliedItem(once, opening.amount, 1.5);
    expect(once.amount).toBe(1.5);
    expect(twice.amount).toBe(1.5);
    expect(isMultiplierSelected(twice, opening.amount, 1.5)).toBe(true);
    expect(isMultiplierSelected(twice, opening.amount, 2)).toBe(false);
  });

  it('two times a cup of skyr is 211 kcal (340 g at 62 kcal per 100 g)', () => {
    const doubled = multipliedItem(newSkyr(), 1, 2);
    expect(displayedItem(newSkyr()).kcalLow).toBe(105);
    expect(displayedItem(doubled).kcalLow).toBe(211);
  });

  it('a multiplier on grams scales the grams the item opened with', () => {
    const banana = draftFromRecord(mealRecord({ items: [bananaItemJson()] }).items[0]!);
    expect(baseFieldAmount(banana, banana.amount)).toBe(120);
    expect(multipliedItem(banana, banana.amount, 0.5).amount).toBe(60);
  });

  it('steps half a serving or 10 g, and stops at the ends', () => {
    const skyr = newSkyr();
    expect(steppedItem(skyr, 1).amount).toBe(1.5);
    expect(steppedItem({ ...skyr, amount: 0.1 }, -1).amount).toBe(0.1);
    expect(steppedItem({ ...skyr, amount: 50 }, 1).amount).toBe(50);
    const grams = { ...skyr, serving: GRAMS_SERVING, amount: 5 };
    expect(steppedItem(grams, -1).amount).toBe(1);
    expect(steppedItem({ ...grams, amount: 4995 }, 1).amount).toBe(5000);
  });

  it('a stepped amount confirms a low-confidence item', () => {
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson()] }).items[0]!);
    expect(photo.confirmed).toBe(false);
    expect(steppedItem(photo, 1).confirmed).toBe(true);
  });

  it('is valid from 1 to 5,000 g or 0.1 to 50 servings', () => {
    const skyr = newSkyr();
    expect(isAmountValid({ ...skyr, amount: 0.1 })).toBe(true);
    expect(isAmountValid({ ...skyr, amount: 0.05 })).toBe(false);
    expect(isAmountValid({ ...skyr, amount: 50 })).toBe(true);
    expect(isAmountValid({ ...skyr, amount: 51 })).toBe(false);
    const grams = { ...skyr, serving: GRAMS_SERVING };
    expect(isAmountValid({ ...grams, amount: 0.5 })).toBe(false);
    expect(isAmountValid({ ...grams, amount: 1 })).toBe(true);
    expect(isAmountValid({ ...grams, amount: 5000 })).toBe(true);
    expect(isAmountValid({ ...grams, amount: 5001 })).toBe(false);
  });

  it('labels the chips in the account language', () => {
    expect(multiplierLabel(0.75, 'en')).toBe('0.75x');
    expect(multiplierLabel(0.5, 'is')).toBe('0,5x');
    expect(multiplierLabel(2, 'en')).toBe('2x');
  });
});

describe('the serving menu', () => {
  it('offers grams to a per-serving created food with a serving weight', () => {
    const created = {
      ...quickAddDraft({ label: 'Bowl', kcal: 400, protein: null, carbs: null, fat: null, servingLabel: '1 bowl' }),
      source: 'member',
      serving: namedServing('1 bowl', 350),
      servingOptions: [namedServing('1 bowl', 350)],
    };
    const menu = editorServingMenu(created, 'en');
    expect(menu[menu.length - 1]).toEqual(GRAMS_SERVING);
  });

  it('grams on a per-serving food keeps the serving on the wire and shows grams', () => {
    const created = {
      ...quickAddDraft({ label: 'Bowl', kcal: 400, protein: null, carbs: null, fat: null, servingLabel: '1 bowl' }),
      source: 'member',
      serving: namedServing('1 bowl', 350),
      servingOptions: [namedServing('1 bowl', 350)],
    };
    const picked = pickingServing(created, GRAMS_SERVING);
    expect(picked.serving).toEqual(namedServing('1 bowl', 350));
    expect(picked.displaysGrams).toBe(true);
    expect(fieldAmount(picked)).toBe(350);
    expect(currentServingTitle(picked, en)).toBe(en('food.serving.grams'));
  });

  it('a library food changes serving at the same weight', () => {
    const picked = pickingServing(newSkyr(), GRAMS_SERVING);
    expect(picked.serving).toEqual(GRAMS_SERVING);
    expect(picked.amount).toBe(170);
  });
});

describe('typed numbers', () => {
  it('stores calories per unit, so they scale with the amount', () => {
    const outcome = applyingTypedNutrient(newSkyr(), 'kcal', '170');
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.item.overrides?.kcal).toBe(170);
    expect(displayedItem({ ...outcome.item, amount: 2 }).kcalLow).toBe(340);
  });

  it('takes either decimal separator', () => {
    const outcome = applyingTypedNutrient(newSkyr(), 'protein', '12,5');
    expect(outcome.kind === 'applied' && outcome.item.overrides?.proteinG).toBe(12.5);
  });

  it('refuses kcal over 10,000 and a macro over 500 per unit of amount', () => {
    expect(applyingTypedNutrient(newSkyr(), 'kcal', '10001')).toEqual({ kind: 'tooBig', errorKey: 'food.create.err.kcal' });
    expect(applyingTypedNutrient(newSkyr(), 'kcal', '10000').kind).toBe('applied');
    expect(applyingTypedNutrient(newSkyr(), 'fat', '501')).toEqual({ kind: 'tooBig', errorKey: 'food.create.err.macro' });
    expect(applyingTypedNutrient({ ...newSkyr(), amount: 2 }, 'fat', '1000').kind).toBe('applied');
  });

  it('ignores what is not a number yet', () => {
    expect(applyingTypedNutrient(newSkyr(), 'kcal', '')).toEqual({ kind: 'ignored' });
    expect(applyingTypedNutrient(newSkyr(), 'kcal', '-')).toEqual({ kind: 'ignored' });
    expect(applyingTypedNutrient(newSkyr(), 'kcal', '-5')).toEqual({ kind: 'ignored' });
  });

  it('an untouched estimate shows its range until the member sets their own', () => {
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson()] }).items[0]!);
    expect(showsKcalRange(photo, false)).toBe(true);
    expect(showsKcalRange(photo, true)).toBe(false);
    expect(showsKcalRange(settingValue(photo, 'kcal', 450), false)).toBe(false);
    expect(showsKcalRange(newSkyr(), false)).toBe(false);
  });
});

describe('the fields follow the numbers, except the one being typed in', () => {
  it('fills every field from the item', () => {
    const texts = syncedTexts(EMPTY_TEXTS, newSkyr(), null, false, 'en');
    expect(texts).toEqual({ amount: '1', kcal: '105', protein: '18.7', carbs: '6.8', fat: '0.3', name: 'Skyr, plain' });
  });

  it('keeps the focused field as typed', () => {
    const previous = { ...EMPTY_TEXTS, amount: '1,' };
    const texts = syncedTexts(previous, { ...newSkyr(), amount: 1 }, 'amount', false, 'is');
    expect(texts.amount).toBe('1,');
    expect(texts.protein).toBe('18,7');
  });

  it('writes grams whole and servings to two decimals, without a thousands separator', () => {
    const grams = { ...newSkyr(), serving: GRAMS_SERVING, amount: 1234 };
    expect(syncedTexts(EMPTY_TEXTS, grams, null, false, 'is').amount).toBe('1234');
    expect(syncedTexts(EMPTY_TEXTS, { ...newSkyr(), amount: 1.25 }, null, false, 'is').amount).toBe('1,25');
    expect(mealFieldText(1234.5, 'en')).toBe('1234.5');
    expect(mealFieldText(1234.5, 'is')).toBe('1234,5');
  });

  it('leaves the kcal text alone while the range shows', () => {
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson()] }).items[0]!);
    expect(syncedTexts(EMPTY_TEXTS, photo, null, false, 'en').kcal).toBe('');
    expect(syncedTexts(EMPTY_TEXTS, photo, null, true, 'en').kcal).toBe('450');
  });
});

describe('names and buttons', () => {
  it('only a created food or a quick add can be renamed, never in read-only', () => {
    const quick = quickAddDraft({ label: 'Lunch', kcal: 500, protein: null, carbs: null, fat: null, servingLabel: '1 serving' });
    expect(isNameEditable(quick, false)).toBe(true);
    expect(isNameEditable(quick, true)).toBe(false);
    expect(isNameEditable(newSkyr(), false)).toBe(false);
  });

  it('a rename is trimmed, capped at 60 characters, and never empties the name', () => {
    const quick = quickAddDraft({ label: 'Lunch', kcal: 500, protein: null, carbs: null, fat: null, servingLabel: '1 serving' });
    expect(renamedItem(quick, '  Soup  ').label).toBe('Soup');
    expect(renamedItem(quick, '   ').label).toBe('Lunch');
    expect(renamedItem(quick, 'x'.repeat(70)).label).toHaveLength(60);
  });

  it('asks to confirm the amount first while a check is pending', () => {
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson()] }).items[0]!);
    expect(primaryTitleKey('local', photo)).toBe('food.editor.confirm');
    expect(primaryTitleKey('local', { ...photo, confirmed: true })).toBe('food.editor.update');
    expect(primaryTitleKey('stored', newSkyr())).toBe('food.editor.update');
    expect(primaryTitleKey('new', newSkyr())).toBe('food.editor.add');
  });

  it('a library or typed item comes back from Undo; a product or a photo item does not', () => {
    const meal = mealRecord({ items: [skyrItemJson(), offItemJson(), photoItemJson()] });
    const [skyr, off, photo] = meal.items.map(draftFromRecord);
    expect(isUndoableRemoval(skyr!)).toBe(true);
    expect(isUndoableRemoval(off!)).toBe(false);
    expect(isUndoableRemoval(photo!)).toBe(false);
    expect(isUndoableRemoval(quickAddDraft({ label: 'x', kcal: 1, protein: null, carbs: null, fat: null, servingLabel: 's' }))).toBe(true);
  });

  it('Undo keeps the ids still on the meal and sends a removed item as a new one', () => {
    const before = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const after = mealRecord({ items: [skyrItemJson()], updatedAt: '2026-10-21T08:16:00.000001+00:00' });
    const restored = itemsToRestore(before.items.map(draftFromRecord), after);
    expect(restored.map((item) => item.storedId)).toEqual(['item-skyr', null]);
    expect(restored[1]!.label).toBe('Banana');
  });

  it('an estimate has its own edit event', () => {
    const photo = draftFromRecord(mealRecord({ items: [photoItemJson()] }).items[0]!);
    expect(editEvent(photo)).toBe('meal_estimate_item_edited');
    expect(editEvent(newSkyr())).toBe('meal_item_edited');
  });

  it('links a product to its Open Food Facts page', () => {
    expect(offProductPage('5690519000011')).toBe('https://world.openfoodfacts.org/product/5690519000011');
  });
});

describe('MealText', () => {
  it('says the amount as the rows show it', () => {
    expect(mealAmountLine(newSkyr(), en, 'en')).toBe('1 cup (170 g)');
    expect(mealAmountLine({ ...newSkyr(), amount: 2 }, en, 'en')).toBe('2 x 1 cup (170 g)');
    expect(mealAmountLine({ ...newSkyr(), amount: 1.5 }, is, 'is')).toBe('1,5 x 1 cup (170 g)');
    expect(mealAmountLine({ ...newSkyr(), serving: GRAMS_SERVING, amount: 180 }, en, 'en')).toBe('180 g');
    expect(mealAmountLine({ ...newSkyr(), serving: GRAMS_SERVING, amount: 250, liquid: true }, en, 'en')).toBe('250 ml');
    expect(mealAmountLine({ ...newSkyr(), serving: namedServing('', null), amount: 1 }, en, 'en')).toBe('');
    expect(mealAmountLine({ ...newSkyr(), serving: { unit: 'serving', label: null, grams: null } }, en, 'en')).toBe(
      en('food.create.serving_default'),
    );
  });

  it('says a range with the word, never a dash', () => {
    expect(mealKcal({ kcalLow: 380, kcalHigh: 520 }, 'en')).toBe('380 to 520 kcal');
    expect(mealKcal({ kcalLow: 1420, kcalHigh: 1420 }, 'is')).toBe('1.420 kcal');
  });

  it('names where the numbers come from', () => {
    expect(mealSourceWord('lifepass_label', en)).toBe(en('food.source.label'));
    expect(mealSourceWord('member', en)).toBe(en('food.source.mine'));
    expect(mealSourceWord('quick_add', en)).toBe(en('food.quick.default_name'));
    expect(mealSourceWord('model', en)).toBe(en('health.estimate'));
  });

  it('says today, yesterday, or the short day', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    expect(relativeMealDay('2026-10-21', en, 'en', now)).toBe(en('diary.today'));
    expect(relativeMealDay('2026-10-20', en, 'en', now)).toBe(en('diary.yesterday'));
    expect(relativeMealDay('2026-10-17', en, 'en', now)).toMatch(/17/);
  });

  it('counts in words or bands, never a bare number', () => {
    expect(mealCountBand(0)).toBe('none');
    expect(mealCountBand(1)).toBe('one');
    expect(mealCountBand(3)).toBe('2-5');
    expect(mealCountBand(9)).toBe('6+');
  });
});
