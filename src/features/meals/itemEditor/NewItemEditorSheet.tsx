/**
 * The item editor for a food the member is about to add (iOS
 * `FoodItemEditorSheet(context: .newItem)`), in the shape the meal page's
 * slot asks for (MEAL-2, capture/slots.ts `NewItemEditor`):
 *
 *   export { default as NewItemEditor } from '../itemEditor/NewItemEditorSheet';
 *
 * "Add to meal" hands the item back as the member set it, and the sheet
 * closes itself.
 */
import type { MealItemDraft } from '../types/draft';

import FoodItemEditorSheet from './FoodItemEditorSheet';

export interface NewItemEditorSheetProps {
  readonly visible: boolean;
  /** The food at its default portion (`draftFromChoice`). */
  readonly item: MealItemDraft;
  /** The Open Food Facts footer's barcode, for a product row. */
  readonly offBarcode: string | null;
  /** "Add to meal": the item as the member set it. */
  readonly onAdd: (item: MealItemDraft) => void;
  /** Cancel, back or a pan down, and after Add. */
  readonly onClose: () => void;
  /** Extra lines under the header (a barcode result's per 100 g). */
  readonly detail?: string | null;
  /** "Your food" or "From the label" for a barcode found on the server. */
  readonly sourceWordOverride?: string | null;
}

export default function NewItemEditorSheet({ visible, item, offBarcode, onAdd, onClose, detail, sourceWordOverride }: NewItemEditorSheetProps) {
  return (
    <FoodItemEditorSheet
      item={visible ? item : null}
      context={{ kind: 'new', onAdd }}
      offBarcode={offBarcode}
      detail={detail}
      sourceWordOverride={sourceWordOverride}
      onClose={onClose}
      testID="newItemEditor"
    />
  );
}
