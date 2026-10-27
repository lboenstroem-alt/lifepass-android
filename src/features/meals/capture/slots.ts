/**
 * Where the meal page mounts what other meal packages draw. Each slot may be
 * null (a test can stub one out), and the page works without it:
 *
 * | Slot              | Filled by | iOS                                      | Without it                          |
 * |-------------------|-----------|------------------------------------------|-------------------------------------|
 * | `PhotoMode`       | MEAL-3    | `PhotoCaptureMode(model:anchor:)`        | no Photo in the switcher            |
 * | `BarcodeMode`     | MEAL-3    | `BarcodeScanMode(model:anchor:)`         | no Barcode in the switcher          |
 * | `NewItemEditor`   | MEAL-4    | `FoodItemEditorSheet(context: .newItem)` | a row's tap adds its usual portion  |
 *
 * All three are filled. `NewItemEditor` matters most: iOS FoodSearchMode
 * opens the item editor on a row's tap (`editing = choice`) and only the plus
 * adds the usual portion in one tap, so the member can see and set the amount
 * before anything joins the tray
 * (./__tests__/MealCaptureScreen.test.tsx, "a row's tap opens the item editor").
 *
 * A camera mode gets the page's model (`useCapture(model, ...)` for the
 * slot, date and tray; `model.add`, `model.openDraft`, `model.setMode`,
 * `model.setTorchAvailable`, `model.state.torchOn`) and the header's height,
 * which it draws full bleed under (iOS `MealCaptureLayout.headerHeight`).
 */
import type { ComponentType } from 'react';

import BarcodeScanMode from '../barcode/BarcodeScanMode';
import NewItemEditorSheet from '../itemEditor/NewItemEditorSheet';
import PhotoCaptureMode from '../photo/PhotoCaptureMode';
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

/** MEAL-3: the Photo mode (../photo/PhotoCaptureMode.tsx). */
export const PhotoMode: ComponentType<CameraModeProps> | null = PhotoCaptureMode;

/** MEAL-3: the Barcode mode (../barcode/BarcodeScanMode.tsx). */
export const BarcodeMode: ComponentType<CameraModeProps> | null = BarcodeScanMode;

/** MEAL-4: the item editor for a food about to be added (../itemEditor/NewItemEditorSheet.tsx). */
export const NewItemEditor: ComponentType<NewItemEditorProps> | null = NewItemEditorSheet;
