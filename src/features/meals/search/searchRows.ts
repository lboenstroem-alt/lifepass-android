/**
 * What Search mode lists, as a flat list of rows (iOS `FoodSearchMode`'s
 * List sections, ios-ux.md 15). Pure, so the order and the limits are
 * tested without drawing anything.
 *
 * Nothing typed (the chip decides):
 *   All       Recent meals (3, or 10 after See all) · Recent (8, See all
 *             to the Recent chip) · the quick buttons (Describe a meal while
 *             offered, Quick add calories, Create my food) · Common foods ·
 *             Meals (10, See all to the Meals chip). Six placeholder rows
 *             while nothing is known; an error row with Try again when the
 *             presets failed with nothing to show.
 *   Recent    up to 50, or "Foods you log show up here."
 *   Frequent  up to 20, or the same line
 *   My foods  every one, removable, or "Foods you create show up here."
 *   Meals     every preset meal, grouped by category
 * Two characters or more typed: the server's answer (Your foods, Foods,
 * Meals; "Closest matches" over the first when nothing matched every word,
 * with "Describe it instead" under them), or "No matches for “…”" with
 * Describe it instead, Quick add and Create my food; the offline or error
 * line; placeholders until the first answer.
 */
import type { FoodChoice, FoodPresets, FoodSearchResult, MyFoods, PresetMeal, RecentMeal } from '../types/models';
import { isSearchResultEmpty } from '../types/models';

import { LIMITS, resultSections, type FoodFilter, type RowOrigin } from './searchRules';

export type SearchRow =
  | { readonly kind: 'header'; readonly key: string; readonly titleKey: string | null; readonly title: string | null; readonly seeAll: 'recentMeals' | 'recent' | 'meals' | null }
  | { readonly kind: 'food'; readonly key: string; readonly choice: FoodChoice; readonly from: RowOrigin; readonly removable: boolean; readonly dimmed: boolean }
  | { readonly kind: 'recentMeal'; readonly key: string; readonly meal: RecentMeal }
  | { readonly kind: 'preset'; readonly key: string; readonly meal: PresetMeal; readonly dimmed: boolean }
  | { readonly kind: 'quick'; readonly key: string; readonly offersDescribe: boolean }
  | { readonly kind: 'describeInstead'; readonly key: string; readonly entry: 'empty_search' | 'closest' }
  | { readonly kind: 'line'; readonly key: string; readonly textKey: string; readonly params?: Readonly<Record<string, string>> }
  | { readonly kind: 'error'; readonly key: string; readonly retry: 'cache' | 'search' }
  | { readonly kind: 'skeleton'; readonly key: string };

export interface SearchRowsInput {
  readonly query: string;
  readonly querying: boolean;
  readonly filter: FoodFilter;
  readonly presets: FoodPresets | null;
  /** Null until the member's lists are known. */
  readonly mine: MyFoods | null;
  readonly presetsFailed: boolean;
  readonly showAllRecentMeals: boolean;
  readonly results: FoodSearchResult | null;
  readonly searching: boolean;
  readonly searchErrorKey: string | null;
  /** The server advertises Describe and the day is within 30 days. */
  readonly describeOn: boolean;
  /** A My foods removal could not reach the server. */
  readonly removingOffline: boolean;
}

const EMPTY_MINE: MyFoods = { recents: [], frequent: [], mine: [], recentMeals: [] };

function foods(list: readonly FoodChoice[], from: RowOrigin, prefix: string, options: { removable?: boolean; dimmed?: boolean } = {}): SearchRow[] {
  return list.map((choice, index) => ({
    kind: 'food' as const,
    key: `${prefix}:${choice.key}:${index}`,
    choice,
    from,
    removable: options.removable ?? false,
    dimmed: options.dimmed ?? false,
  }));
}

function presetsOf(list: readonly PresetMeal[], prefix: string, dimmed = false): SearchRow[] {
  return list.map((meal, index) => ({ kind: 'preset' as const, key: `${prefix}:${meal.id}:${index}`, meal, dimmed }));
}

function header(key: string, titleKey: string, seeAll: 'recentMeals' | 'recent' | 'meals' | null = null): SearchRow {
  return { kind: 'header', key: `h:${key}`, titleKey, title: null, seeAll };
}

function skeleton(): SearchRow[] {
  return [{ kind: 'skeleton', key: 'skeleton' }];
}

function allRows(input: SearchRowsInput): SearchRow[] {
  const { presets } = input;
  if (presets === null && input.mine === null) {
    return input.presetsFailed ? [{ kind: 'error', key: 'error', retry: 'cache' }] : skeleton();
  }
  const mine = input.mine ?? EMPTY_MINE;
  const rows: SearchRow[] = [];
  if (mine.recentMeals.length > 0) {
    const limit = input.showAllRecentMeals ? LIMITS.recentMealsAll : LIMITS.recentMeals;
    const seeAll = mine.recentMeals.length > LIMITS.recentMeals && !input.showAllRecentMeals;
    rows.push(header('recentMeals', 'food.section.recent_meals', seeAll ? 'recentMeals' : null));
    mine.recentMeals.slice(0, limit).forEach((meal, index) => rows.push({ kind: 'recentMeal', key: `rm:${meal.key}:${index}`, meal }));
  }
  if (mine.recents.length > 0) {
    rows.push(header('recent', 'food.section.recent', mine.recents.length > LIMITS.recents ? 'recent' : null));
    rows.push(...foods(mine.recents.slice(0, LIMITS.recents), 'recent', 'r'));
  }
  rows.push({ kind: 'quick', key: 'quick', offersDescribe: true });
  if (presets) {
    if (presets.foods.length > 0) {
      rows.push(header('common', 'food.section.common'));
      rows.push(...foods(presets.foods, 'preset', 'p'));
    }
    if (presets.meals.length > 0) {
      rows.push(header('meals', 'food.section.meals', presets.meals.length > LIMITS.presetMeals ? 'meals' : null));
      rows.push(...presetsOf(presets.meals.slice(0, LIMITS.presetMeals), 'pm'));
    }
  } else if (input.presetsFailed) {
    rows.push({ kind: 'error', key: 'error', retry: 'cache' });
  }
  return rows;
}

function choiceList(list: readonly FoodChoice[], from: RowOrigin, emptyKey: string): SearchRow[] {
  return list.length === 0 ? [{ kind: 'line', key: 'empty', textKey: emptyKey }] : foods(list, from, from);
}

function myFoodsRows(input: SearchRowsInput): SearchRow[] {
  const mine = input.mine ?? EMPTY_MINE;
  if (mine.mine.length === 0) return [{ kind: 'line', key: 'empty', textKey: 'food.mine.empty' }];
  const rows: SearchRow[] = [];
  if (input.removingOffline) rows.push({ kind: 'line', key: 'offline', textKey: 'health.offline.action_hint' });
  rows.push(...foods(mine.mine, 'mine', 'mine', { removable: true }));
  return rows;
}

function presetMealRows(input: SearchRowsInput): SearchRow[] {
  const { presets } = input;
  if (!presets) return skeleton();
  const rows: SearchRow[] = [];
  if (presets.categories.length === 0) {
    if (presets.meals.length > 0) {
      rows.push(header('meals', 'food.section.meals'));
      rows.push(...presetsOf(presets.meals, 'all'));
    }
    return rows;
  }
  for (const category of presets.categories) {
    const meals = presets.meals.filter((meal) => meal.category?.id === category.id);
    if (meals.length === 0) continue;
    rows.push({ kind: 'header', key: `h:cat:${category.id}`, titleKey: null, title: category.label, seeAll: null });
    rows.push(...presetsOf(meals, `cat:${category.id}`));
  }
  return rows;
}

function queryRows(input: SearchRowsInput): SearchRow[] {
  const { results, searchErrorKey } = input;
  if (searchErrorKey !== null && results === null) {
    const rows: SearchRow[] = [{ kind: 'line', key: 'searchError', textKey: searchErrorKey }];
    if (searchErrorKey === 'common.error_body') rows.push({ kind: 'error', key: 'retrySearch', retry: 'search' });
    return rows;
  }
  if (!results) return skeleton();
  if (isSearchResultEmpty(results) && !input.searching) {
    const rows: SearchRow[] = [{ kind: 'line', key: 'noMatch', textKey: 'food.search.empty', params: { query: input.query } }];
    if (input.describeOn) rows.push({ kind: 'describeInstead', key: 'describe', entry: 'empty_search' });
    rows.push({ kind: 'quick', key: 'quick', offersDescribe: false });
    return rows;
  }
  const dimmed = input.searching;
  const rows: SearchRow[] = [];
  for (const section of resultSections(results)) {
    rows.push(header(`result:${section.kind}`, section.headerKey));
    if (section.kind === 'mine') rows.push(...foods(results.mine, 'search', 'qm', { dimmed }));
    if (section.kind === 'foods') rows.push(...foods(results.foods, 'search', 'qf', { dimmed }));
    if (section.kind === 'meals') rows.push(...presetsOf(results.meals, 'qp', dimmed));
  }
  if (results.closest && input.describeOn && !input.searching) rows.push({ kind: 'describeInstead', key: 'describe', entry: 'closest' });
  return rows;
}

/** Every row Search shows for `input`, in order. */
export function searchRows(input: SearchRowsInput): SearchRow[] {
  if (input.querying) return queryRows(input);
  switch (input.filter) {
    case 'all':
      return allRows(input);
    case 'recent':
      return choiceList((input.mine ?? EMPTY_MINE).recents.slice(0, LIMITS.recentFilter), 'recent', 'food.recent.empty');
    case 'frequent':
      return choiceList((input.mine ?? EMPTY_MINE).frequent.slice(0, LIMITS.frequentFilter), 'frequent', 'food.recent.empty');
    case 'mine':
      return myFoodsRows(input);
    case 'meals':
      return presetMealRows(input);
  }
}
