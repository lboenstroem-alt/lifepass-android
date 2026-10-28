/**
 * The words of a diary item row: the two `MealText` helpers the iOS diary
 * uses (Views/Meals/FoodItemEditorSheet.swift `MealText.amountLine` and
 * `MealText.kcal`).
 *
 * They live with the item editor on iOS; that editor is MEAL-4's here and
 * not in this build yet, so the diary keeps its own copy of the two rules
 * (the same words, so a row and the editor never disagree). When MEAL-4
 * publishes them, the diary can take them from there.
 */
import { decimal, grams, kcalRange } from '../../../i18n/format';
import type { Lang } from '../../../i18n';
import { displayedItem, gramsFor } from '../math/itemMath';
import type { MealItemDraft } from '../types/draft';
import { isGramsServing } from '../types/models';

/**
 * "2 x 1 cup (170 g)", "180 g", "250 ml": the amount line of a row. A
 * serving with no label is "1 serving" (`food.create.serving_default`).
 */
export function amountLine(item: MealItemDraft, lang: Lang, t: (key: string) => string): string {
  if (isGramsServing(item.serving) || item.displaysGrams) {
    const weight = gramsFor(item.serving, item.amount) ?? item.amount;
    return grams(weight, lang, item.liquid);
  }
  const label = item.serving.label ?? t('food.create.serving_default');
  if (Math.abs(item.amount - 1) < 0.001) return label;
  // iOS writes the multiplier with a plain "x", in both languages.
  return `${decimal(item.amount, lang, 2)} x ${label}`;
}

/** "420 kcal" or "380 to 520 kcal": what the row shows for an item. */
export function itemKcalText(item: MealItemDraft, lang: Lang): string {
  const result = displayedItem(item);
  return kcalRange(result.kcalLow, result.kcalHigh, lang);
}
