/**
 * Opening the item editor for an item of a SAVED meal from the diary (iOS
 * `FoodItemEditorSheet(item:, context: .storedItem(meal:, onCommitted:,
 * onDeleted:), offBarcode:)`), where Update and Remove commit at once.
 *
 * The editor is MEAL-4's (`src/features/meals/itemEditor/**`), so the diary
 * publishes this slot and the food log's register file fills it at app start
 * (../register.ts):
 *
 *   registerStoredItemEditor(presentStoredItemEditor);
 *
 * `presentStoredItemEditor` (itemEditor/itemEditorPresenter.ts) shows the
 * sheet through the `ItemEditorHost` that ../MealGlobalChromeHost.tsx mounts
 * over the tabs, and answers false when no host is mounted. Only then (or
 * with no opener registered at all) does a tap on an item open its meal in
 * the meal editor (route `MealEditor`), where every item can be changed or
 * removed: the member is never left with a row that does nothing. That
 * fallback is a safety net, not the shipping behaviour.
 */
import type { MealItemDraft } from '../types/draft';
import type { MealRecord } from '../types/models';

export interface StoredItemEditorRequest {
  /** The saved meal the item belongs to, as the diary read it. */
  readonly meal: MealRecord;
  /** The item, as the editor opens it (`draftFromRecord`). */
  readonly item: MealItemDraft;
  /** The Open Food Facts barcode, for the attribution footer, when the item is a product. */
  readonly offBarcode: string | null;
  /** The meal after an Update or a Remove the server took: the diary reads its day again. */
  readonly onCommitted: (meal: MealRecord) => void;
  /** The meal was deleted (its last item removed): the diary reads its day again. */
  readonly onDeleted: () => void;
}

/** Shows the editor; false when it cannot (the diary then opens the meal). */
export type StoredItemEditorOpener = (request: StoredItemEditorRequest) => boolean;

let opener: StoredItemEditorOpener | null = null;

/** ../register.ts installs the item editor here; `null` removes it. */
export function registerStoredItemEditor(next: StoredItemEditorOpener | null): void {
  opener = next;
}

/** Opens the registered editor. False when none is registered or it declined. */
export function openStoredItemEditor(request: StoredItemEditorRequest): boolean {
  return opener ? opener(request) : false;
}
