/**
 * Where the meal page mounts what other meal packages draw. Each is null
 * until its package is wired in, and the page works without it:
 *
 * | Slot              | Filled by | iOS                                      | Without it                          |
 * |-------------------|-----------|------------------------------------------|-------------------------------------|
 * | `PhotoMode`       | MEAL-3    | `PhotoCaptureMode(model:anchor:)`        | no Photo in the switcher            |
 * | `BarcodeMode`     | MEAL-3    | `BarcodeScanMode(model:anchor:)`         | no Barcode in the switcher          |
 * | `NewItemEditor`   | MEAL-4    | `FoodItemEditorSheet(context: .newItem)` | a row's tap adds its usual portion  |
 *
 * MEAL-3 depends on MEAL-2, so it fills its two by editing this file once
 * MEAL-2 has merged (plan 3.0 rule 2). MEAL-4 does not, so its line is a
 * MERGE GATE (contract request in MEAL-2's result): without it a row's tap
 * and its plus do the same thing, which iOS never does. Replace the null
 * below with
 *
 *   export { default as NewItemEditor } from '../itemEditor/NewItemEditorSheet';
 *
 * and flip "without the item editor wired in" in
 * ./__tests__/MealCaptureScreen.test.tsx to expect the editor.
 *
 * A camera mode gets the page's model (`useCapture(model, ...)` for the
 * slot, date and tray; `model.add`, `model.openDraft`, `model.setMode`,
 * `model.setTorchAvailable`, `model.state.torchOn`) and the header's height,
 * which it draws full bleed under (iOS `MealCaptureLayout.headerHeight`).
 */
import type { ComponentType } from 'react';

import type { MealItemDraft } from '../types/draft';

import type { MealCaptureModel } from './captureModel';

export interface CameraModeProps {
  readonly model: MealCaptureModel;
  /** The page header (close row and switcher), which the camera draws under. */
  readonly headerHeight: number;
}

export interface NewItemEditorProps {
  readonly visible: boolean;
  /** The food at its default portion (`draftFromChoice`). */
  readonly item: MealItemDraft;
  /** The Open Food Facts footer's barcode, for a product row. */
  readonly offBarcode: string | null;
  /** "Add to meal": the item as the member set it. The sheet closes itself after. */
  readonly onAdd: (item: MealItemDraft) => void;
  /** Cancel, back or a pan down. */
  readonly onClose: () => void;
}

/** MEAL-3: the Photo mode. */
export const PhotoMode: ComponentType<CameraModeProps> | null = null;

/** MEAL-3: the Barcode mode. */
export const BarcodeMode: ComponentType<CameraModeProps> | null = null;

/** MEAL-4: the item editor for a food about to be added. */
export const NewItemEditor: ComponentType<NewItemEditorProps> | null = null;
