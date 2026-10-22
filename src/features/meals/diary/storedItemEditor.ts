/**
 * Opening the item editor for an item of a SAVED meal from the diary (iOS
 * `FoodItemEditorSheet(item:, context: .storedItem(meal:, onCommitted:,
 * onDeleted:), offBarcode:)`), where Update and Remove commit at once.
 *
 * The editor is MEAL-4's (`src/features/meals/itemEditor/**`) and lands in
 * its own package, so the diary publishes this slot and MEAL-4 fills it from
 * its register file:
 *
 *   registerStoredItemEditor((request) => { present(request); return true; });
 *
 * Until an editor is registered (or when it answers false), a tap on an item
 * opens its meal in the meal editor (route `MealEditor`), where every item
 * can be changed or removed: the member is never left with a row that does
 * nothing.
 *
 * INTEGRATION (MEAL-4 + MEAL-5, built in parallel, so neither can make this
 * call alone): MEAL-4's `presentStoredItemEditor`
 * (itemEditor/itemEditorPresenter.ts) takes exactly this request and answers
 * false with no host. Once both are merged it is registered at app start,
 *
 *   registerStoredItemEditor(presentStoredItemEditor);
 *
 * and only then does a diary item open as on iOS. The meal-editor fallback
 * is a safety net, not the shipping behaviour.
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

/** MEAL-4 installs its editor here; `null` removes it. */
export function registerStoredItemEditor(next: StoredItemEditorOpener | null): void {
  opener = next;
}

/** Opens the registered editor. False when none is registered or it declined. */
export function openStoredItemEditor(request: StoredItemEditorRequest): boolean {
  return opener ? opener(request) : false;
}
