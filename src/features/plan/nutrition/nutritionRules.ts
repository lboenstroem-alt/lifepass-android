/**
 * The food card's decisions as pure functions (iOS PlanNutritionCard.swift),
 * so which row shows for which member, the target weight line and the drafts
 * row are tested without a screen.
 *
 * EVERY NUMBER HERE IS AN ESTIMATE AND SAYS SO. A calorie target is a model
 * of a body and a photo estimate is a guess about a plate; printing either
 * like a measurement is the single most misleading thing this feature could
 * do, so the chip is permanent and the status line is never red. Being over
 * a range is information, not a failure. The eaten line, the bars and the
 * left / within / over line all come from ONE function shared with the
 * diary and the meal history (`dayEnergy`, src/i18n/format.ts).
 */
import {
  isDraftFromDescription,
  isTargetOutsideHealthyRange,
  isTargetReached,
  knownAppliesTo,
  mealSlotCopyKey,
  type HealthMealsBlock,
  type MealDraftBrief,
  type MealSlot,
  type MealView,
  type NutritionTarget,
  type TargetWeightView,
} from '../../../health';
import type { Lang, Params } from '../../../i18n';
import { decimal, integer, kcal, type CopyLine } from '../../../i18n/format';

// MARK: - The target row (`ios-ux.md` 3.10 item 1)

/**
 * What the target row says. Each branch answers a different question and
 * only one of them can be true: the day's range; the range withheld for a
 * reason (a doctor or dietitian, not the app); the details a live plan
 * needs; or the calorie goal a member without a plan can set.
 */
export type TargetRow =
  | { readonly kind: 'target'; readonly target: NutritionTarget; readonly fromGoal: boolean }
  | { readonly kind: 'withheld' }
  /** The body sheet, for the live plan's targets. */
  | { readonly kind: 'setBody'; readonly key: 'plan.nutrition.no_target_body' }
  /** The body sheet's calorie goal mode. */
  | { readonly kind: 'setGoal'; readonly key: 'plan.nutrition.no_target_body' | 'plan.nutrition.set_goal' };

export function targetRow(
  meals: Pick<HealthMealsBlock, 'target' | 'targetWithheld'> | null,
  hasLiveProgram: boolean,
  hasCalorieGoal: boolean,
): TargetRow {
  const target = meals?.target ?? null;
  if (target) return { kind: 'target', target, fromGoal: target.basis === 'goal' };
  const withheld = meals?.targetWithheld ?? null;
  if (withheld !== null && withheld !== 'unknown') return { kind: 'withheld' };
  if (hasLiveProgram) return { kind: 'setBody', key: 'plan.nutrition.no_target_body' };
  if (hasCalorieGoal) return { kind: 'setGoal', key: 'plan.nutrition.no_target_body' };
  return { kind: 'setGoal', key: 'plan.nutrition.set_goal' };
}

// MARK: - The target weight row (`SPEC` 6.5)

export type TargetWeightRow =
  | { readonly kind: 'reached' }
  | { readonly kind: 'unhealthy' }
  | { readonly kind: 'line'; readonly line: CopyLine; readonly hasEta: boolean };

/**
 * Shown only for today, and only when the target shapes something the
 * member runs (`appliesTo` a programme or a calorie goal): a stored target
 * that points the other way is not a line on their plan. The caller passes
 * null on a server without target weights.
 */
export function targetWeightRow(isToday: boolean, target: TargetWeightView | null, language: Lang): TargetWeightRow | null {
  if (!isToday || !target || knownAppliesTo(target) === null) return null;
  if (isTargetReached(target)) return { kind: 'reached' };
  if (isTargetOutsideHealthyRange(target)) return { kind: 'unhealthy' };
  const kg = decimal(target.targetWeightKg, language);
  if (!target.eta) return { kind: 'line', line: { key: 'target.line', params: { kg } }, hasEta: false };
  return {
    kind: 'line',
    line: { key: 'target.line_eta', params: { kg, low: String(target.eta.weeksLow), high: String(target.eta.weeksHigh) } },
    hasEta: true,
  };
}

// MARK: - Numbers

/**
 * Group every whole number the shared day-energy helper answered with. It
 * works in plain integers so the web panel can mirror it; the thousands
 * separator is the account's ("1.210" in Icelandic, "1,210" in English).
 */
export function groupedParams(params: Readonly<Record<string, string>>, language: Lang): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    result[name] = /^-?\d+$/.test(value) ? integer(Number(value), language) : value;
  }
  return result;
}

/** The eaten line's values: the helper's numbers grouped, plus the day's protein in whole grams. */
export function eatenParams(params: Readonly<Record<string, string>>, proteinG: number, language: Lang): Record<string, string> {
  return { ...groupedParams(params, language), protein: decimal(proteinG, language, 0) };
}

/** A meal row's energy: "640 kcal", "550 to 700 kcal" for an estimate, nothing without totals. */
export function mealEnergyText(
  meal: Pick<MealView, 'totals'>,
  t: (key: string, params?: Params) => string,
  language: Lang,
): string {
  const totals = meal.totals;
  if (!totals) return '';
  if (totals.kcalLow === totals.kcalHigh) return kcal(totals.kcalLow, language);
  return t('plan.nutrition.kcal_range', {
    low: integer(totals.kcalLow, language),
    high: integer(totals.kcalHigh, language),
  });
}

// MARK: - Meals

/** How many saved meals the card lists before "+N more meals". */
export const MEAL_ROWS_SHOWN = 4;

/** The day's saved meals: every one not marked unconfirmed (a draft waits in the drafts row). */
export function confirmedMeals(meals: Pick<HealthMealsBlock, 'meals'> | null): MealView[] {
  return (meals?.meals ?? []).filter((meal) => meal.confirmed !== false);
}

/**
 * A meal's slot kicker (`slot.*`). A meal with no slot reads as a snack, as
 * on iOS; so does a slot this build has no word for (a newer server's),
 * rather than a copy key on screen.
 */
export function mealSlotKey(slot: MealSlot | string | null): string {
  const known: readonly string[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];
  return mealSlotCopyKey((slot !== null && known.includes(slot) ? slot : 'snack') as MealSlot);
}

// MARK: - Drafts (3.10 item 4)

export interface DraftsRow {
  /** Every draft is a photo estimate (a camera icon, "photo estimate"); else a text bubble and "estimate". */
  readonly allPhotos: boolean;
  /** The plural base for the row: `plan.nutrition.drafts` or `plan.nutrition.drafts_any`. */
  readonly pluralBase: 'plan.nutrition.drafts' | 'plan.nutrition.drafts_any';
  readonly count: number;
  /** The row itself opens the newest draft. */
  readonly newestId: string;
  /** "See all" lists them, with more than one. */
  readonly showsSeeAll: boolean;
}

/**
 * The drafts row, or null with nothing waiting. "Photo estimate" while every
 * draft is one; a description estimate among them makes it plain
 * "estimate".
 */
export function draftsRow(drafts: readonly MealDraftBrief[]): DraftsRow | null {
  if (drafts.length === 0) return null;
  const allPhotos = !drafts.some(isDraftFromDescription);
  // The newest by when it was logged; the first wins a tie (Swift's `max(by:)`).
  let newest = drafts[0]!;
  for (const draft of drafts) {
    const at = draft.loggedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const best = newest.loggedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (at > best) newest = draft;
  }
  return {
    allPhotos,
    pluralBase: allPhotos ? 'plan.nutrition.drafts' : 'plan.nutrition.drafts_any',
    count: drafts.length,
    newestId: newest.id,
    showsSeeAll: drafts.length > 1,
  };
}
