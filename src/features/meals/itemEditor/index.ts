/**
 * The food item editor (MEAL-4) and the words every meal screen shares.
 * The search, the barcode result, the diary and the meal editor open the
 * same sheet:
 *
 *   import { FoodItemEditorSheet, mealAmountLine } from '../itemEditor';
 *
 *   <FoodItemEditorSheet item={picked} context={{ kind: 'new', onAdd }} onClose={() => setPicked(null)} />
 */
export {
  default as FoodItemEditorSheet,
  type FoodItemEditorContext,
  type FoodItemEditorSheetProps,
} from './FoodItemEditorSheet';
export { default as MealOFFAttribution, type MealOFFAttributionProps } from './MealOFFAttribution';
export {
  mealAmountLine,
  mealCountBand,
  mealFieldText,
  mealGrams,
  mealKcal,
  mealSourceWord,
  relativeMealDay,
  type Translate,
} from './mealText';
export { isUndoableRemoval, itemsToRestore, multiplierLabel, offProductPage, pinnedBottomPadding } from './itemEditorRules';
export { offerUndo, patchMealItems, type UndoOffer } from './storedCommit';
