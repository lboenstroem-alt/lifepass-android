/**
 * "Add food" on a draft or a saved meal (iOS `MealEditorView`'s full-screen
 * `MealCaptureView(origin: .editor, mode: .search, ...)`): a second meal
 * page over this one, on Search, at the meal's slot and date, whose tray
 * button reads "Add to meal" and hands the items back here instead of saving
 * a new meal.
 *
 * Route params carry no callbacks, so the receiver is parked first and the
 * next `editor` page takes it. The page is PUSHED on the root stack: from a
 * draft inside a meal page, a `navigate('MealCapture')` would go back to the
 * page underneath (same route name) instead of opening a second one.
 *
 * INTEGRATION (MEAL-2 + MEAL-4): MEAL-2's capture/capturePages.ts has the
 * same handoff (`openMealCaptureForEditor`, `takeEditorHandoff`) and its
 * page takes it when it opens with origin `editor`. Once both are merged,
 * `openAddFoodPage` calls `openMealCaptureForEditor(options)` and this
 * file's parking spot goes.
 */
import { StackActions } from '@react-navigation/native';

import { navigationRef } from '../../../navigation/navigationRef';
import type { MealCaptureParams, MealSlot } from '../../../navigation/types';
import type { MealItemDraft } from '../types/draft';

export interface AddFoodRequest {
  readonly slot: MealSlot;
  readonly date: string;
  /** The items the member picked on the page, when they tap "Add to meal". */
  readonly onAddToMeal: (items: readonly MealItemDraft[]) => void;
}

let parked: ((items: readonly MealItemDraft[]) => void) | null = null;

/** Opens the page for more food; false when the app is not ready (nothing opened, nothing parked). */
export function openAddFoodPage(request: AddFoodRequest): boolean {
  if (!navigationRef.isReady()) return false;
  parked = request.onAddToMeal;
  const params: MealCaptureParams = { origin: 'editor', slot: request.slot, date: request.date, mode: 'search' };
  navigationRef.dispatch({ ...StackActions.push('MealCapture', params), target: navigationRef.getRootState().key });
  return true;
}

/** The parked receiver, taken once by the `editor` page that opens next. */
export function takeAddFoodHandoff(): ((items: readonly MealItemDraft[]) => void) | null {
  const receiver = parked;
  parked = null;
  return receiver;
}

/** An editor that leaves forgets a receiver nobody took. */
export function dropAddFoodHandoff(receiver: (items: readonly MealItemDraft[]) => void): void {
  if (parked === receiver) parked = null;
}
