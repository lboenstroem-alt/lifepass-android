/**
 * A preset meal's servings (iOS `PresetMealSheet`, ios-ux.md 15.3): 0.5 to 4
 * in halves; each ingredient goes in at its recipe grams times the servings,
 * rounded, at least 1 g (`draftFromIngredient`), counted from the food table.
 */
import type { MealItemDraft } from '../types/draft';
import { draftFromIngredient } from '../types/draftFactory';
import type { PresetMeal } from '../types/models';

export const SERVINGS_MIN = 0.5;
export const SERVINGS_MAX = 4;
export const SERVINGS_STEP = 0.5;

/** One step up or down, inside 0.5 to 4. */
export function stepServings(servings: number, direction: 1 | -1): number {
  return Math.min(SERVINGS_MAX, Math.max(SERVINGS_MIN, servings + direction * SERVINGS_STEP));
}

/** The items the meal adds at `servings`. */
export function presetItems(meal: PresetMeal, servings: number): MealItemDraft[] {
  return meal.ingredients.map((ingredient) => draftFromIngredient(ingredient, servings));
}
