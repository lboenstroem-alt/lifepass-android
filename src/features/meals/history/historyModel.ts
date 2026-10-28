/**
 * The meal calendar's rules (iOS `MealHistoryView`, Views/Plan/PlanHistory.swift):
 *
 * - Days load in windows of 30 (`GET /health/meals/days?from&to`, which takes
 *   at most 31): the first ends today, each "Load earlier" ends the day
 *   before the last one began.
 * - "Load earlier" shows until the window reaches the member's first logged
 *   day (`firstLogDate`); then "That's the start of your food log."
 * - Days are grouped by month, newest first, a card per month.
 * - A row's meta line is "{kcal} kcal · {protein} g protein · {n} meals" (or
 *   its range form), or "Not logged"; a thin bar shows the eaten midpoint
 *   against the target's, when the day had a target.
 */
import type { MealDaySummary } from '../../../health/models';
import { addServerDays, decimal, integer, longDay, round10 } from '../../../i18n/format';
import type { Lang, Params } from '../../../i18n';

/** Days per read. */
export const HISTORY_WINDOW_DAYS = 30;

/** The next window to read: ending today first, then the day before the last window began. */
export function nextWindow(loadedFrom: string | null, today: string): { from: string; to: string } | null {
  const to = loadedFrom ? addServerDays(loadedFrom, -1) : today;
  if (!to) return null;
  const from = addServerDays(to, -(HISTORY_WINDOW_DAYS - 1));
  if (!from) return null;
  return { from, to };
}

/**
 * Whether "Load earlier" is offered: the server named a first logged day and
 * the windows read so far have not reached it.
 */
export function canLoadEarlier(firstLogDate: string | null, loadedFrom: string | null): boolean {
  if (firstLogDate === null) return false;
  if (loadedFrom === null) return true;
  return loadedFrom > firstLogDate;
}

export interface MonthGroup {
  /** `YYYY-MM`. */
  readonly key: string;
  /** The month's header, as iOS writes it: the first of the month ("1 October"). */
  readonly label: string;
  readonly days: readonly MealDaySummary[];
}

/** Days grouped by month, newest month and newest day first. */
export function monthGroups(days: readonly MealDaySummary[], lang: Lang): MonthGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, MealDaySummary[]>();
  for (const day of [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    const key = day.date.slice(0, 7);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(day);
  }
  return order.map((key) => ({ key, label: longDay(`${key}-01`, lang), days: buckets.get(key) ?? [] }));
}

type Translate = (key: string, params?: Params) => string;
type TranslatePlural = (base: string, count: number, params?: Params) => string;

/** "1,640 kcal · 92 g protein · 3 meals", the range form, or "Not logged". */
export function metaLine(day: MealDaySummary, lang: Lang, t: Translate, tp: TranslatePlural): string {
  const count = day.mealCount ?? 0;
  if (day.kcalLow === null || day.kcalHigh === null || count <= 0) return t('plan.nutrition.not_logged');
  const meals = tp('history.meal.count', count);
  const protein = decimal(day.proteinG ?? 0, lang, 0);
  if (day.kcalLow === day.kcalHigh) {
    return t('history.meal.meta', { kcal: integer(day.kcalLow, lang), protein, meals });
  }
  return t('history.meal.meta_range', {
    low: integer(day.kcalLow, lang),
    high: integer(day.kcalHigh, lang),
    protein,
    meals,
  });
}

/** The bar: the eaten midpoint over the target's (each rounded to 10), at most 1; null without a target. */
export function dayFill(day: MealDaySummary): number | null {
  const target = day.target;
  if (!target || day.kcalLow === null || day.kcalHigh === null) return null;
  const eaten = round10((day.kcalLow + day.kcalHigh) / 2);
  const targetMid = round10((target.kcalLow + target.kcalHigh) / 2);
  if (targetMid <= 0) return null;
  return Math.min(eaten / targetMid, 1);
}

