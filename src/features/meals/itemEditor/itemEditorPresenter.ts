/**
 * The item editor opened from code that has no sheet of its own to draw it
 * in: a diary row's item (iOS `DiaryDayView`'s `FoodItemEditorSheet(context:
 * .storedItem(...))`). `ItemEditorHost`, mounted once over the tabs, draws
 * what `presentItemEditor` asks for.
 *
 *   presentStoredItemEditor({ meal, item, offBarcode, onCommitted, onDeleted });
 *
 * NO HOST, NO SHEET: with none mounted the call answers false and changes
 * nothing, so the caller can do something else (the diary opens the meal in
 * the meal editor instead).
 *
 * WIRED: the diary's `registerStoredItemEditor(opener)`
 * (diary/storedItemEditor.ts) is given `presentStoredItemEditor` at app start
 * (src/features/meals/register.ts), and the host is mounted in the meal
 * chrome over the tabs (src/features/meals/MealGlobalChromeHost.tsx).
 */
import { create } from 'zustand';

import { registerSignOutCleaner } from '../../../app/signOut';

import type { MealItemDraft } from '../types/draft';
import type { MealRecord } from '../types/models';

import type { FoodItemEditorContext } from './FoodItemEditorSheet';

export interface ItemEditorRequest {
  readonly item: MealItemDraft;
  readonly context: FoodItemEditorContext;
  readonly detail?: string | null;
  readonly offBarcode?: string | null;
  readonly sourceWordOverride?: string | null;
  readonly readOnly?: boolean;
  readonly fromDescription?: boolean;
}

/** An item of a saved meal, as the diary asks for it. */
export interface StoredItemEditorRequest {
  readonly meal: MealRecord;
  readonly item: MealItemDraft;
  readonly offBarcode: string | null;
  readonly onCommitted: (meal: MealRecord) => void;
  readonly onDeleted: () => void;
}

interface PresenterState {
  /** The request on screen; null when the sheet is closed. */
  readonly request: ItemEditorRequest | null;
}

export const useItemEditorPresenter = create<PresenterState>()(() => ({ request: null }));

let hostsMounted = 0;

/** The host calls this when it mounts, and the answer when it unmounts. */
export function attachItemEditorHost(): () => void {
  hostsMounted += 1;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    hostsMounted -= 1;
    if (hostsMounted === 0) useItemEditorPresenter.setState({ request: null });
  };
}

/** Shows the editor over whatever is on screen; false when no host is mounted. */
export function presentItemEditor(request: ItemEditorRequest): boolean {
  if (hostsMounted === 0) return false;
  useItemEditorPresenter.setState({ request });
  return true;
}

/** The diary's request, as a stored-context editor. */
export function presentStoredItemEditor(request: StoredItemEditorRequest): boolean {
  return presentItemEditor({
    item: request.item,
    offBarcode: request.offBarcode,
    context: { kind: 'stored', meal: request.meal, onCommitted: request.onCommitted, onDeleted: request.onDeleted },
  });
}

/**
 * Closes it (the sheet's own close does this). Given the request it is
 * closing, only while that one is still on screen: a late close of an
 * earlier sheet never takes away the one opened since.
 */
export function dismissItemEditor(request?: ItemEditorRequest): void {
  if (request && useItemEditorPresenter.getState().request !== request) return;
  useItemEditorPresenter.setState({ request: null });
}

// A saved meal of the member who left is never on screen for the next one.
registerSignOutCleaner('meals.itemEditor', () => dismissItemEditor());
