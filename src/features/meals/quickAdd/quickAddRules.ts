/**
 * Quick add's rules (iOS `QuickAddSheet`, ios-ux.md 15.5): calories 1 to
 * 5,000 (the error line says "between 0 and 5000", as iOS does), and a macro
 * 0 to 500 g or nothing at all. A comma or a dot both read as the decimal
 * separator.
 */
import { parseDecimal } from '../../../i18n/format';
import type { MealItemDraft } from '../types/draft';
import { quickAddDraft } from '../types/draftFactory';
import { trimWhitespace } from '../types/text';

export const QUICK_ADD_KCAL_MIN = 1;
export const QUICK_ADD_KCAL_MAX = 5000;
export const QUICK_ADD_MACRO_MAX = 500;

/** The calories typed, or null when they are not 1 to 5,000. */
export function quickAddKcal(text: string): number | null {
  const value = parseDecimal(text);
  return value !== null && value >= QUICK_ADD_KCAL_MIN && value <= QUICK_ADD_KCAL_MAX ? value : null;
}

/** A macro typed, or null when empty or not 0 to 500 (then it is simply not known). */
export function quickAddMacro(text: string): number | null {
  const value = parseDecimal(text);
  return value !== null && value >= 0 && value <= QUICK_ADD_MACRO_MAX ? value : null;
}

/**
 * The item a Quick add makes: source `quick_add`, basis member, one serving
 * named "1 serving" with no grams, the macros left empty as null. The name
 * defaults to "Quick add".
 */
export function quickAddItem(fields: {
  readonly kcal: number;
  readonly protein: string;
  readonly carbs: string;
  readonly fat: string;
  readonly name: string;
  readonly defaultName: string;
  readonly servingLabel: string;
}): MealItemDraft {
  const trimmed = trimWhitespace(fields.name);
  return quickAddDraft({
    label: trimmed === '' ? fields.defaultName : trimmed,
    kcal: fields.kcal,
    protein: quickAddMacro(fields.protein),
    carbs: quickAddMacro(fields.carbs),
    fat: quickAddMacro(fields.fat),
    servingLabel: fields.servingLabel,
  });
}
