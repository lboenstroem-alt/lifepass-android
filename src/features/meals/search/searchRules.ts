/**
 * The rules of Search mode (iOS `FoodSearchMode`, ios-ux.md 15), apart from
 * the screen so they can be read and tested on their own.
 */
import { roundHalfAwayFromZero } from '../../../i18n/format';
import { displayedItem, kcalMid } from '../math/itemMath';
import type { MealItemDraft } from '../types/draft';
import { characterPrefix, trimWhitespace } from '../types/text';
import type { FoodChoice, FoodPresets, FoodSearchResult, MealEntrySource, MyFoods } from '../types/models';

/** The chips, in order (iOS `FoodSearchMode.Filter`). */
export type FoodFilter = 'all' | 'recent' | 'frequent' | 'mine' | 'meals';

export const FOOD_FILTERS: readonly FoodFilter[] = ['all', 'recent', 'frequent', 'mine', 'meals'];

export function filterTitleKey(filter: FoodFilter): string {
  return `food.filter.${filter}`;
}

/** Where a row was added from (`food_added.from`), and which source word it hides. */
export type RowOrigin = 'recent' | 'frequent' | 'mine' | 'preset' | 'search';

/** How many rows each list shows (iOS: 3 or 10 recent meals, 8 recents, 10 meals; filters 50 and 20). */
export const LIMITS = {
  recentMeals: 3,
  recentMealsAll: 10,
  recents: 8,
  presetMeals: 10,
  recentFilter: 50,
  frequentFilter: 20,
} as const;

/** The typed words, trimmed as Swift trims them. */
export function trimmedQuery(query: string): string {
  return trimWhitespace(query);
}

/** Two characters or more ask the server (iOS `trimmedQuery.count >= 2`, counted in characters). */
export function isQuerying(query: string): boolean {
  const trimmed = trimmedQuery(query);
  return trimmed.length >= 2 && characterPrefix(trimmed, 1) !== trimmed;
}

/** The debounce after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The meal-level source an add gives a new tray (iOS `source(for:from:)`):
 * the member's own lists count as recent, presets as preset, query results
 * as search. A row opened in the editor is looked up in the lists.
 */
export function entrySourceFor(
  choice: Pick<FoodChoice, 'key'>,
  from: RowOrigin | null,
  presets: FoodPresets | null,
  mine: MyFoods,
): MealEntrySource {
  switch (from) {
    case 'recent':
    case 'frequent':
    case 'mine':
      return 'recent';
    case 'preset':
      return 'preset';
    case 'search':
      return 'search';
    default:
      if (presets?.foods.some((food) => food.key === choice.key)) return 'preset';
      if (mine.recents.some((food) => food.key === choice.key) || mine.mine.some((food) => food.key === choice.key)) return 'recent';
      return 'search';
  }
}

/** `food_added.from` for a row added from the item editor (iOS `fromValue(for:)`). */
export function fromValueFor(choice: Pick<FoodChoice, 'key'>, presets: FoodPresets | null, mine: MyFoods, querying: boolean): RowOrigin {
  if (presets?.foods.some((food) => food.key === choice.key) && !querying) return 'preset';
  if (querying) return 'search';
  if (mine.mine.some((food) => food.key === choice.key)) return 'mine';
  return 'recent';
}

/** The source word (USDA, Fineli...) is hidden for the member's own foods and their history. */
export function showsSourceWord(choice: Pick<FoodChoice, 'source'>, from: RowOrigin): boolean {
  return !(choice.source === 'member' || from === 'recent' || from === 'frequent' || from === 'mine');
}

/** A row's calories: the server's for the default portion, else the item math's midpoint. */
export function rowKcal(choice: Pick<FoodChoice, 'defaultKcal'>, item: MealItemDraft): number {
  return choice.defaultKcal !== null ? roundHalfAwayFromZero(choice.defaultKcal) : kcalMid(displayedItem(item));
}

/** One section of a search's answer, with the header it shows. */
export interface ResultSection {
  readonly kind: 'mine' | 'foods' | 'meals';
  readonly headerKey: string;
}

/**
 * The answer's sections in order, empty ones left out. When nothing matched
 * every word (`closest`), the FIRST section says "Closest matches".
 */
export function resultSections(result: Pick<FoodSearchResult, 'mine' | 'foods' | 'meals' | 'closest'>): ResultSection[] {
  const first = result.mine.length > 0 ? 'mine' : result.foods.length > 0 ? 'foods' : 'meals';
  const header = (kind: ResultSection['kind'], key: string): string => (result.closest && first === kind ? 'food.search.closest' : key);
  const sections: ResultSection[] = [];
  if (result.mine.length > 0) sections.push({ kind: 'mine', headerKey: header('mine', 'food.section.yours') });
  if (result.foods.length > 0) sections.push({ kind: 'foods', headerKey: header('foods', 'food.section.foods') });
  if (result.meals.length > 0) sections.push({ kind: 'meals', headerKey: header('meals', 'food.section.meals') });
  return sections;
}
