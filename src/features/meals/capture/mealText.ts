/**
 * Words and numbers every meal screen shares: the Android port of iOS
 * `MealText` (Views/Meals/FoodItemEditorSheet.swift), `MealDateText`
 * (Views/Meals/MealCaptureView.swift) and the tray bar's summary line.
 *
 * Pure: each takes the translator (`useT()`'s `t`/`tp`) and the language, so
 * a row, a sheet and a test all format the same way.
 */
import type { Lang, Params } from '../../../i18n';
import { addServerDays, decimal, grams as gramsText, integer, kcalRange, shortDay, todayServerDay } from '../../../i18n/format';
import { gramsFor } from '../math/itemMath';
import { isGramsServing, type MealDayTotals } from '../types/models';
import type { MealItemDraft } from '../types/draft';

type Translate = (key: string, params?: Params) => string;
type TranslatePlural = (base: string, count: number, params?: Params) => string;

/** "2 x 1 cup (170 g)", "180 g", "250 ml": the amount line of a row. */
export function amountLine(item: MealItemDraft, lang: Lang, t: Translate): string {
  if (isGramsServing(item.serving) || item.displaysGrams) {
    const grams = gramsFor(item.serving, item.amount) ?? item.amount;
    return gramsText(grams, lang, item.liquid);
  }
  const label = item.serving.label ?? t('food.create.serving_default');
  if (Math.abs(item.amount - 1) < 0.001) return label;
  return `${decimal(item.amount, lang, 2)} x ${label}`;
}

/** "420 kcal" or "380 to 520 kcal". */
export function kcalText(result: { readonly kcalLow: number; readonly kcalHigh: number }, lang: Lang): string {
  return kcalRange(result.kcalLow, result.kcalHigh, lang);
}

/** Where an item's numbers come from, in a word. */
export function sourceWord(source: string, t: Translate): string {
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

/** "Today", "Yesterday" or "Wed 17 Sep" (iOS `MealDateText.relative`). */
export function relativeDay(date: string, lang: Lang, t: Translate, today: string = todayServerDay()): string {
  if (date === today) return t('diary.today');
  if (addServerDays(today, -1) === date) return t('diary.yesterday');
  return shortDay(date, lang);
}

/**
 * The tray bar's line: "1 item · 420 kcal", "3 items · 380 to 520 kcal"
 * (iOS `MealTrayBar.summary`).
 */
export function traySummary(totals: Pick<MealDayTotals, 'kcalLow' | 'kcalHigh'>, count: number, lang: Lang, t: Translate, tp: TranslatePlural): string {
  const kcal =
    totals.kcalLow === totals.kcalHigh
      ? integer(totals.kcalLow, lang)
      : t('meal.kcal_range_short', { low: integer(totals.kcalLow, lang), high: integer(totals.kcalHigh, lang) });
  return tp('meal.tray.summary', count, { count: String(count), kcal });
}
