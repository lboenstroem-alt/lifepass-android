/**
 * Words and numbers every meal screen shares: the Android port of iOS
 * `MealText` (Views/Meals/FoodItemEditorSheet.swift) and `MealDateText`
 * (Views/Meals/MealCaptureView.swift).
 *
 * Pure functions of the item and the account language, so the search rows,
 * the diary, the barcode result and both editors say an amount, a range and
 * a source the same way. The translator is passed in (`t` from `useT()`), so
 * a screen re-renders in the new language the moment it changes.
 */
import { HealthFormat, type Lang, type Params } from '../../../i18n';
import { addServerDays, todayServerDay } from '../../../i18n/format';
import { countBand } from '../../../lib/analytics';
import { gramsFor, type MealItemResult } from '../math/itemMath';
import type { MealItemDraft } from '../types/draft';
import { isGramsServing } from '../types/models';

/** `t` from `useT()`. */
export type Translate = (key: string, params?: Params) => string;

/** "2 x 1 cup (170 g)", "180 g", "250 ml": the amount line of a row. */
export function mealAmountLine(item: MealItemDraft, t: Translate, language: Lang): string {
  if (isGramsServing(item.serving) || item.displaysGrams) {
    const grams = gramsFor(item.serving, item.amount) ?? item.amount;
    return HealthFormat.grams(grams, language, item.liquid);
  }
  const label = item.serving.label ?? t('food.create.serving_default');
  if (Math.abs(item.amount - 1) < 0.001) return label;
  return `${HealthFormat.decimal(item.amount, language, 2)} x ${label}`;
}

/** "420 kcal" or "380 to 520 kcal". */
export function mealKcal(result: Pick<MealItemResult, 'kcalLow' | 'kcalHigh'>, language: Lang): string {
  return HealthFormat.kcalRange(result.kcalLow, result.kcalHigh, language);
}

/** Where an item's numbers come from, in a word. */
export function mealSourceWord(source: string, t: Translate): string {
  switch (source) {
    case 'usda':
      return t('food.source.usda');
    case 'fineli':
      return t('food.source.fineli');
    case 'matvaretabellen':
      return t('food.source.matvaretabellen');
    case 'lifepass_estimate':
      return t('food.source.lifepass_estimate');
    case 'lifepass_label':
      return t('food.source.label');
    case 'off':
      return t('food.source.off');
    case 'member':
      return t('food.source.mine');
    case 'quick_add':
      return t('food.quick.default_name');
    default:
      return t('health.estimate');
  }
}

/** Grams as the rows show them: one decimal under 10 g, whole above. */
export function mealGrams(value: number, language: Lang): string {
  return HealthFormat.decimal(value, language, value < 10 ? 1 : 0);
}

/**
 * A value for a text field, in the account's number format but without the
 * thousands separator (iOS strips the grouping character and the
 * no-break space), so "1234,5" reads back through `parseDecimal`.
 */
export function mealFieldText(value: number, language: Lang, maxFractionDigits = 1): string {
  const group = language === 'is' ? '.' : ',';
  return HealthFormat.decimal(value, language, maxFractionDigits).split(' ').join('').split(group).join('');
}

/** "Today", "Yesterday" or "Wed 17 Sep" (iOS `MealDateText.relative`). */
export function relativeMealDay(date: string, t: Translate, language: Lang, now: Date = new Date()): string {
  const today = todayServerDay(now);
  if (date === today) return t('diary.today');
  if (addServerDays(today, -1) === date) return t('diary.yesterday');
  return HealthFormat.shortDay(date, language);
}

/**
 * The analytics word for a count (iOS `MealAnalytics.band`): never the
 * number itself, and the two bands the guard would read as bare numbers are
 * words.
 */
export function mealCountBand(count: number): string {
  if (count < 1) return 'none';
  if (count === 1) return 'one';
  return countBand(count);
}
