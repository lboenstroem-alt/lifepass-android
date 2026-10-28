/**
 * "Add food" on a draft or a saved meal (iOS `MealEditorView`'s full-screen
 * `MealCaptureView(origin: .editor, mode: .search, ...)`): a second meal
 * page over this one, on Search, at the meal's slot and date, whose tray
 * button reads "Add to meal" and hands the items back here instead of saving
 * a new meal.
 *
 * Route params carry no callbacks, so the receiver is parked in MEAL-2's
 * editor handoff (capture/capturePages.ts) and the next `editor` page takes
 * it. The page is PUSHED on the root stack: from a draft inside a meal page,
 * a `navigate('MealCapture')` would go back to the page underneath (same
 * route name) instead of opening a second one.
 */
import { openMealCaptureForEditor, peekEditorHandoff, setEditorHandoff } from '../capture/capturePages';
import type { MealSlot } from '../../../navigation/types';
import type { MealItemDraft } from '../types/draft';

export interface AddFoodRequest {
  readonly slot: MealSlot;
  readonly date: string;
  /** The items the member picked on the page, when they tap "Add to meal". */
  readonly onAddToMeal: (items: readonly MealItemDraft[]) => void;
}

/** Opens the page for more food; false when the app is not ready (nothing opened, nothing parked). */
export function openAddFoodPage(request: AddFoodRequest): boolean {
  return openMealCaptureForEditor(request);
}

/** An editor that leaves forgets a receiver nobody took. */
export function dropAddFoodHandoff(receiver: (items: readonly MealItemDraft[]) => void): void {
  if (peekEditorHandoff() === receiver) setEditorHandoff(null);
}
