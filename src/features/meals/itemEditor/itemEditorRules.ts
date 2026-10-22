/**
 * The item editor's rules, apart from its view so they can be tested alone:
 * the Android port of the logic inside iOS `FoodItemEditorSheet`
 * (Views/Meals/FoodItemEditorSheet.swift).
 *
 * The sheet is "amount first, then the numbers", MyFitnessPal style: the
 * member steps or types an amount, or taps a multiplier, and the numbers
 * follow from the item math (../math/itemMath.ts, the server's own rules).
 * Typing a number over a calculated one stores it per ONE unit of the
 * serving (an override), so it keeps scaling with the amount, and wears an
 * Edited tag with a reset beside it.
 */
import { HealthFormat, type Lang } from '../../../i18n';
import {
  applyingField,
  changingServing,
  displayedItem,
  fieldAmount,
  fieldIsGrams,
  gramsFor,
  isEstimateItem,
  isServingOnly,
  ITEM_KCAL_MAX,
  kcalMid,
  servingMenu,
  settingGramsOnServingOnlyItem,
  settingValue,
  stepFor,
} from '../math/itemMath';
import { isLibraryItem, itemNeedsCheck, type MealItemDraft } from '../types/draft';
import {
  GRAMS_SERVING,
  isGramsServing,
  MealItemSourceKind,
  overrideFor,
  type MealNutrientField,
  type MealRecord,
  type MealServing,
} from '../types/models';
import { characterPrefix, trimWhitespace } from '../types/text';

import { mealFieldText, type Translate } from './mealText';

// ---------------------------------------------------------------------------
// The pinned block's bottom edge

/**
 * Room under the pinned button (and the Open Food Facts footer), iOS
 * `FoodItemEditorSheet.pinnedBottomPadding`.
 *
 * On a phone with no bottom inset (iOS: a Home button; Android: three-button
 * navigation drawn outside the window) the footer's last line sat about 4 pt
 * from the edge. It gets 12 there; where the system already leaves an inset
 * (a gesture bar), that inset is the room and nothing is added. Without the
 * footer the button keeps its 6.
 */
export function pinnedBottomPadding(hasAttribution: boolean, bottomSafeArea: number): number {
  if (!hasAttribution) return 6;
  return Math.max(0, 12 - bottomSafeArea);
}

// ---------------------------------------------------------------------------
// Amount

/** Grams 1 to 5,000, servings 0.1 to 50: the primary button waits for a valid amount. */
export function isAmountValid(item: MealItemDraft): boolean {
  const value = fieldAmount(item);
  return fieldIsGrams(item) ? value >= 1 && value <= 5000 : value >= 0.1 && value <= 50;
}

/** The amount field's label: Grams, Millilitres or Number of servings. */
export function amountLabelKey(item: MealItemDraft): string {
  if (!fieldIsGrams(item)) return 'food.editor.amount';
  return item.liquid ? 'food.editor.amount_ml' : 'food.editor.amount_grams';
}

/** The amount field's TalkBack name (iOS reads Grams for a liquid too). */
export function amountAccessibilityKey(item: MealItemDraft): string {
  return fieldIsGrams(item) ? 'food.editor.amount_grams' : 'food.editor.amount';
}

/** The stepper: half a serving or 10 g, kept inside the field's range. */
export function steppedItem(item: MealItemDraft, direction: -1 | 1): MealItemDraft {
  const current = fieldAmount(item);
  const grams = fieldIsGrams(item);
  const minimum = grams ? 1 : 0.1;
  const maximum = grams ? 5000 : 50;
  const next = Math.min(Math.max(current + direction * stepFor(item), minimum), maximum);
  return applyingField(item, next);
}

/**
 * The amount the multipliers are relative to: what the item had when the
 * sheet opened (or when the serving last changed), so 1.5x twice is still
 * 1.5x, not 2.25x.
 */
export function baseFieldAmount(item: MealItemDraft, baseAmount: number): number {
  return fieldAmount({ ...item, amount: baseAmount });
}

/** The item at `factor` times the opening amount. */
export function multipliedItem(item: MealItemDraft, baseAmount: number, factor: number): MealItemDraft {
  return applyingField(item, baseFieldAmount(item, baseAmount) * factor);
}

/** Whether this chip is the amount on screen. */
export function isMultiplierSelected(item: MealItemDraft, baseAmount: number, factor: number): boolean {
  return Math.abs(fieldAmount(item) - baseFieldAmount(item, baseAmount) * factor) < 0.001;
}

/** "0,5x" / "1.25x". */
export function multiplierLabel(factor: number, language: Lang): string {
  return `${HealthFormat.decimal(factor, language, 2)}x`;
}

// ---------------------------------------------------------------------------
// Serving

/**
 * The serving menu: the item math's, plus grams for a per-serving created
 * food with a serving weight (shown in grams, sent in servings).
 */
export function editorServingMenu(item: MealItemDraft, language: Lang): MealServing[] {
  const options = servingMenu(item, language);
  if (isServingOnly(item) && item.serving.grams !== null && !options.some(isGramsServing)) {
    options.push(GRAMS_SERVING);
  }
  return options;
}

/** A menu entry's words: "grams" (or "ml") for grams, else the serving's own label. */
export function servingTitle(serving: MealServing, item: Pick<MealItemDraft, 'liquid'>, t: Translate): string {
  if (isGramsServing(serving)) return t(item.liquid ? 'food.serving.ml' : 'food.serving.grams');
  return serving.label ?? t('food.create.serving_default');
}

/** What the serving row shows now. A per-serving food shown in grams says "grams". */
export function currentServingTitle(item: MealItemDraft, t: Translate): string {
  if (item.displaysGrams) return t('food.serving.grams');
  return servingTitle(item.serving, item, t);
}

/**
 * The item at another serving. Grams on a per-serving-only food keep the
 * serving on the wire and count grams on screen; anything else converts the
 * amount at a constant weight. The caller takes the new amount as the
 * multipliers' base.
 */
export function pickingServing(item: MealItemDraft, serving: MealServing): MealItemDraft {
  if (isGramsServing(serving) && isServingOnly(item)) {
    const grams = gramsFor(item.serving, item.amount);
    if (grams !== null) return settingGramsOnServingOnlyItem(item, grams);
  }
  return changingServing(item, serving);
}

// ---------------------------------------------------------------------------
// Numbers

/** The row titles of the nutrition card. */
export function nutrientTitleKey(field: MealNutrientField): string {
  switch (field) {
    case 'kcal':
      return 'food.editor.calories';
    case 'protein':
      return 'food.editor.protein';
    case 'carbs':
      return 'food.editor.carbs';
    case 'fat':
      return 'food.editor.fat';
  }
}

/** What a typed number does. */
export type TypedNutrientOutcome =
  /** Not a number (yet): nothing changes, the field keeps what was typed. */
  | { readonly kind: 'ignored' }
  /** Over the limit: the item stays, the inline error says why. */
  | { readonly kind: 'tooBig'; readonly errorKey: string }
  | { readonly kind: 'applied'; readonly item: MealItemDraft };

/**
 * A number the member typed into Calories, Protein, Carbs or Fat: kcal at
 * most 10,000, a macro at most 500 per unit of amount (and never below 500).
 * Applied as an override per unit, so it scales with the amount.
 */
export function applyingTypedNutrient(item: MealItemDraft, field: MealNutrientField, text: string): TypedNutrientOutcome {
  const parsed = HealthFormat.parseDecimal(text);
  if (parsed === null || parsed < 0) return { kind: 'ignored' };
  const limit = field === 'kcal' ? ITEM_KCAL_MAX : 500 * Math.max(item.amount, 1);
  if (parsed > limit) {
    return { kind: 'tooBig', errorKey: field === 'kcal' ? 'food.create.err.kcal' : 'food.create.err.macro' };
  }
  return { kind: 'applied', item: settingValue(item, field, parsed) };
}

/** Whether the member has typed their own number for this field. */
export function isNutrientEdited(item: MealItemDraft, field: MealNutrientField): boolean {
  return overrideFor(item.overrides, field) !== null;
}

/**
 * An untouched estimate's calories show as its range with an Estimate chip
 * and a pencil, rather than a field, until the member chooses to set their
 * own number.
 */
export function showsKcalRange(item: MealItemDraft, editingCalories: boolean): boolean {
  return isEstimateItem(item) && !editingCalories && overrideFor(item.overrides, 'kcal') === null;
}

/** The five text fields of the sheet. */
export type ItemEditorField = 'amount' | 'kcal' | 'protein' | 'carbs' | 'fat' | 'name';

export type ItemEditorTexts = Readonly<Record<ItemEditorField, string>>;

/**
 * The fields show the computed numbers except the one the member is typing
 * in, so a keystroke is never overwritten under their finger (iOS
 * `syncTexts`). The kcal field keeps its text while the range shows.
 */
export function syncedTexts(
  previous: ItemEditorTexts,
  item: MealItemDraft,
  focus: ItemEditorField | null,
  editingCalories: boolean,
  language: Lang,
): ItemEditorTexts {
  const current = displayedItem(item);
  const keep = (field: ItemEditorField, next: () => string): string => (focus === field ? previous[field] : next());
  return {
    amount: keep('amount', () => mealFieldText(fieldAmount(item), language, fieldIsGrams(item) ? 0 : 2)),
    kcal:
      focus === 'kcal' || showsKcalRange(item, editingCalories) ? previous.kcal : String(kcalMid(current)),
    protein: keep('protein', () => mealFieldText(current.proteinG, language)),
    carbs: keep('carbs', () => mealFieldText(current.carbsG, language)),
    fat: keep('fat', () => mealFieldText(current.fatG, language)),
    name: keep('name', () => item.label),
  };
}

export const EMPTY_TEXTS: ItemEditorTexts = Object.freeze({
  amount: '',
  kcal: '',
  protein: '',
  carbs: '',
  fat: '',
  name: '',
});

/** The name of a member's own food or quick add, as typed: trimmed, at most 60 characters, never emptied. */
export function renamedItem(item: MealItemDraft, typed: string): MealItemDraft {
  const trimmed = trimWhitespace(typed);
  if (trimmed === '') return item;
  return { ...item, label: characterPrefix(trimmed, 60) };
}

/** The member may rename a created food or a quick add, never a library or label row. */
export function isNameEditable(item: MealItemDraft, readOnly: boolean): boolean {
  return MealItemSourceKind.isMemberTyped(item.source) && !readOnly;
}

// ---------------------------------------------------------------------------
// Buttons

/** The primary button's words: Confirm amount while a check is pending, else Add to meal or Update. */
export function primaryTitleKey(contextKind: 'new' | 'local' | 'stored', item: MealItemDraft): string {
  if (itemNeedsCheck(item)) return 'food.editor.confirm';
  return contextKind === 'new' ? 'food.editor.add' : 'food.editor.update';
}

/**
 * Whether removing this item can be undone. A library row or a number the
 * member typed comes back from Undo as it was; an Open Food Facts product or
 * a photo item cannot (its snapshot or estimate stays on the server), so it
 * asks first and gets no Undo.
 */
export function isUndoableRemoval(item: MealItemDraft): boolean {
  return isLibraryItem(item) || MealItemSourceKind.isMemberTyped(item.source);
}

/**
 * What Undo sends: the list as it was, with the NEW updatedAt. An item the
 * change removed comes back as a new one (no server id), since its row is
 * gone; the others keep their ids.
 */
export function itemsToRestore(previous: readonly MealItemDraft[], committed: Pick<MealRecord, 'items'>): MealItemDraft[] {
  return previous.map((draft) => {
    const id = draft.storedId;
    if (id !== null && committed.items.some((item) => item.id === id)) return draft;
    return { ...draft, storedId: null };
  });
}

/** The analytics event for an edit: an estimate's own, or the general one. */
export function editEvent(item: Pick<MealItemDraft, 'basis'>): 'meal_estimate_item_edited' | 'meal_item_edited' {
  return item.basis === 'estimate' ? 'meal_estimate_item_edited' : 'meal_item_edited';
}

/** The product page for the attribution link (iOS `FoodFactsService.productPage`). */
export function offProductPage(barcode: string): string {
  return `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`;
}
