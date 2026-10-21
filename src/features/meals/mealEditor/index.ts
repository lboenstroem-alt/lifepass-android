/**
 * The meal editor (MEAL-4): routes `Review` and `Draft` inside the meal page
 * and the shared route `MealEditor`, plus what the other meal packages hand
 * it:
 *
 * - the meal page's model, through `MealCaptureLink` (./captureLink.ts);
 * - a draft's photo, in memory only (`rememberDraftThumbnail`, MEAL-3);
 * - "Add food" on a draft or a saved meal opens a second meal page whose
 *   items come back here (`openAddFoodPage`, `takeAddFoodHandoff`).
 */
export { default as MealEditorView, type MealEditorMode, type MealEditorViewProps } from './MealEditorView';
export {
  attachMealCaptureLink,
  useMealCaptureLink,
  useMealCaptureState,
  type MealCaptureLink,
  type MealCaptureLinkState,
  type MealCaptureSaveOutcome,
} from './captureLink';
export { draftThumbnail, forgetDraftThumbnail, rememberDraftThumbnail } from './draftThumbnails';
export { openAddFoodPage, takeAddFoodHandoff, type AddFoodRequest } from './addFood';
export { default as QuickAddToMealSheet, type QuickAddToMealSheetProps } from './QuickAddToMealSheet';
export { mealSavedFeedback, openFoodDiary } from './saveFeedback';
export { EDITABLE_SLOTS, editableSlotOf, mergeAfterConflict, type EditableMealSlot } from './mealEditorRules';
