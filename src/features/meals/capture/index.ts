/**
 * The meal page (MEAL-2), for the other meal packages:
 *
 * - MEAL-3 (Photo, Barcode): fill `PhotoMode` / `BarcodeMode` in ./slots.ts;
 *   a mode gets the page's `model` (`model.add(items, 'barcode')`,
 *   `model.openDraft(id, meal)`, `model.setMode('search')`,
 *   `model.setTorchAvailable(true)`, `useCapture(model, (s) => s.torchOn)`).
 *   "Create my food" for a barcode with no product is
 *   `../createFood/CreateFoodSheet` (`barcode`, `prefillName`,
 *   `prefillBrand`, `attribution`).
 * - MEAL-4 (Review, Draft, the item and meal editors): `useCaptureModel()`
 *   inside the page's stack; the tray is `useCapture(model, (s) => s.tray)`,
 *   Save is `model.commitTray()`, the review's When row is
 *   `model.setChosenLoggedAt(at)`, a draft the page holds is
 *   `model.state.drafts[mealId]` (null for a description's draft: read it).
 *   A stored meal's "Add food" is `openMealCaptureForEditor(...)`; Quick add
 *   from an editor is `../quickAdd/QuickAddSheet` with
 *   `target: { kind: 'meal', onAdd }`. Fill `NewItemEditor` in ./slots.ts.
 * - Everyone: `showMealToast`, `openFoodDiary`, `mealSavedFeedback`, and the
 *   words rows share (`amountLine`, `sourceWord`, `relativeDay`).
 */
export {
  CAPTURE_MODES,
  EDITABLE_SLOTS,
  MealCaptureModel,
  modeUsesCamera,
  pageToastOffset,
  photoAllowed,
  type CaptureCloseTray,
  type CapturePageBindings,
  type CaptureState,
  type SaveOutcome,
} from './captureModel';
export {
  capturePageFor,
  openMealCaptureForEditor,
  useCapture,
  useCaptureIfAny,
  useCaptureModel,
} from './capturePages';
export { amountLine, kcalText, relativeDay, sourceWord, traySummary } from './mealText';
export { mealSavedFeedback, openFoodDiary, showMealToast } from './saveFeedback';
export { mealCountBand } from './mealAnalytics';
export type { CameraModeProps, NewItemEditorProps } from './slots';
