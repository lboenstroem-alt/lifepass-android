// @f4-stub (plan 3.0.3): "Describe what you ate", filled by MEAL-5; used by MEAL-2 (the meal page).
//
// iOS `MealDescribeSheet`: the member describes a meal in words, the server
// estimates it into a draft (OP-56, behind the `meal_describe` feature and
// its consent version). Keep the exported names and signatures; replace the
// bodies (and this marker). `DescribeHost` is mounted once by F4's tabs shell.
import type { MealSlot } from '../../../navigation/types';

export { default as DescribeHost } from './DescribeHost';

export interface DescribePrefill {
  /** Words already typed (the search field's text). */
  readonly text?: string;
  readonly slot?: MealSlot;
  /** `YYYY-MM-DD`. */
  readonly date?: string;
  /** The estimate was saved as a draft: the meal page opens it. */
  readonly onDraft: (mealId: string) => void;
  /** "Search instead": back to the search with these words. */
  readonly onSearch?: (text: string) => void;
}

/** Opens the describe sheet over whatever is showing. A no-op until MEAL-5 lands. */
export function openDescribe(prefill: DescribePrefill): void {
  void prefill;
}
