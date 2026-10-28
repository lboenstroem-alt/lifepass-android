/**
 * The meal editor's rules, apart from its view: the Android port of the
 * logic inside iOS `MealEditorView` (Views/Meals/MealEditorView.swift,
 * ios-ux.md 13 and 16).
 *
 * Three kinds of meal come through the one editor:
 * - `new`       the capture page's tray, reviewed before its first save;
 * - `draft`     an estimate the server saved from a photo or a description,
 *               which the member checks and confirms (nothing is ever
 *               regenerated: they correct the amounts, Save confirms it);
 * - `existing`  a meal in the diary: every change commits at once.
 */
import { HealthFormat, type Lang } from '../../../i18n';
import { round10, todayServerDay } from '../../../i18n/format';
import type { HealthMealsBlock } from '../../../health/models';
import type { MealSlot as EditableMealSlot } from '../../../navigation/types';
import { isEstimateItem, mealTotals } from '../math/itemMath';
import { isChangedFromStored, itemNeedsCheck, type MealItemDraft } from '../types/draft';
import { draftFromRecord, draftInput } from '../types/draftFactory';
import { isMealFromDescription, type MealDayTotals, type MealPatchBody, type MealRecord, type MealSlot } from '../types/models';

import { relativeMealDay, type Translate } from '../itemEditor/mealText';

export type MealEditorKind = 'new' | 'draft' | 'existing';

/** Where the editor's meal comes from (iOS `MealEditorView.Mode`, by its case). */
export type MealEditorSource = 'tray' | 'draft' | 'stored';

export type { EditableMealSlot };

/** The five slots a member can pick, in the diary's order (iOS `MealSlot.editable`). */
export const EDITABLE_SLOTS: readonly EditableMealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];

/** A meal's slot as a page can open on it: a slot the server named that the app does not know is a snack. */
export function editableSlotOf(slot: MealSlot): EditableMealSlot {
  return (EDITABLE_SLOTS as readonly string[]).includes(slot) ? (slot as EditableMealSlot) : 'snack';
}

/** A stored meal opens as a draft until it is confirmed. */
export function editorKind(source: MealEditorSource, record: Pick<MealRecord, 'confirmed'> | null): MealEditorKind {
  switch (source) {
    case 'tray':
      return 'new';
    case 'draft':
      return 'draft';
    case 'stored':
      return (record?.confirmed ?? true) ? 'existing' : 'draft';
  }
}

/** Items still waiting for "Check the amount". */
export function uncheckedCount(items: readonly MealItemDraft[]): number {
  return items.filter(itemNeedsCheck).length;
}

/** Whether any item still shows a range (the totals wear an Estimate chip and the footer the accuracy note). */
export function hasRange(items: readonly MealItemDraft[]): boolean {
  return items.some(isEstimateItem);
}

/** Save waits for at least one item and every check done; read-only never saves. */
export function canSave(items: readonly MealItemDraft[], readOnly: boolean): boolean {
  return items.length > 0 && uncheckedCount(items) === 0 && !readOnly;
}

/**
 * The line over Save: why it waits, if it does. `tp` picks the Icelandic
 * plural by its own rule ("Athugaðu 21 vöru").
 */
export function saveHelper(
  items: readonly MealItemDraft[],
  readOnly: boolean,
  t: Translate,
  tp: (base: string, count: number) => string,
): string | null {
  if (readOnly) return t('bodygoals.need_membership');
  if (items.length === 0) return t('meal.editor.no_items');
  const unchecked = uncheckedCount(items);
  if (unchecked > 0) return tp('meal.editor.check_first', unchecked);
  return null;
}

/** The accuracy note: a description's own words, or the photo's. */
export function accuracyKey(record: Pick<MealRecord, 'source'> | null): string {
  return record && isMealFromDescription(record) ? 'meal.describe.accuracy' : 'meal.estimate.accuracy';
}

/** The draft's banner: "Estimated from your description" or "from your photo". */
export function estimateBannerKey(record: Pick<MealRecord, 'source'> | null): string {
  return record && isMealFromDescription(record) ? 'meal.describe.banner' : 'meal.estimate.banner';
}

/** The meal's totals from the numbers the rows show. */
export function editorTotals(items: readonly MealItemDraft[]): MealDayTotals {
  return mealTotals(items);
}

/**
 * "With this meal: about 1,450 kcal of 1,800 to 2,000 today", when the meal
 * is for today and the day has a target (16.3 item 8): the other confirmed
 * meals of the day at their midpoints, plus this one, to the nearest ten.
 */
export function dayLine(options: {
  readonly logDate: string;
  readonly meals: HealthMealsBlock | null | undefined;
  readonly recordId: string | null;
  readonly totals: Pick<MealDayTotals, 'kcalLow' | 'kcalHigh'>;
  readonly t: Translate;
  readonly language: Lang;
  readonly now?: Date;
}): string | null {
  const { logDate, meals, recordId, totals, t, language, now } = options;
  if (logDate !== todayServerDay(now)) return null;
  const target = meals?.target;
  if (!meals || !target) return null;
  const others = (meals.meals ?? []).filter((meal) => meal.confirmed !== false && meal.id !== recordId);
  const otherMid = others.reduce((sum, meal) => (meal.totals ? sum + (meal.totals.kcalLow + meal.totals.kcalHigh) / 2 : sum), 0);
  const eaten = round10(otherMid + (totals.kcalLow + totals.kcalHigh) / 2);
  return t('meal.editor.day_line', {
    eaten: HealthFormat.integer(eaten, language),
    low: HealthFormat.integer(target.kcalLow, language),
    high: HealthFormat.integer(target.kcalHigh, language),
  });
}

/** "Today, 12:40": the When row, the time on the phone's own clock. */
export function whenText(logDate: string, loggedAt: Date, t: Translate, language: Lang, now?: Date): string {
  return `${relativeMealDay(logDate, t, language, now)}, ${HealthFormat.time(loggedAt)}`;
}

/** A meal is never logged in the future: a picked time after now is now. */
export function clampedLoggedAt(instant: Date, now: Date = new Date()): Date {
  return instant.getTime() > now.getTime() ? now : instant;
}

/** "Amounts look right": every unchecked item is confirmed as it stands. */
export function confirmingAll(items: readonly MealItemDraft[]): MealItemDraft[] {
  return items.map((item) => (itemNeedsCheck(item) ? { ...item, confirmed: true } : item));
}

/**
 * OP-35 that confirms a draft (13.4): `confirmed: true`, every item, the
 * slot and time, and the draft's `updatedAt` exactly as it was loaded.
 */
export function draftConfirmBody(options: {
  readonly slot: MealSlot;
  readonly loggedAt: Date;
  readonly logDate: string;
  readonly items: readonly MealItemDraft[];
  readonly record: Pick<MealRecord, 'updatedAt'>;
}): MealPatchBody {
  return {
    slot: options.slot,
    loggedAt: options.loggedAt,
    logDate: options.logDate,
    items: options.items.map(draftInput),
    confirmed: true,
    ...(options.record.updatedAt !== null ? { expectedUpdatedAt: options.record.updatedAt } : {}),
  };
}

/**
 * After `meal_changed` or `meal_needs_confirmation`, the meal as the server
 * now has it, with the member's edits kept: an item still on the meal keeps
 * what the member did to it (and learns what the server now stores, so it
 * still knows whether it was changed); an item the member added is kept; an
 * item the member never touched comes as the server has it. For
 * `meal_needs_confirmation`, an untouched low-confidence item asks to be
 * checked again.
 */
export function mergeAfterConflict(
  draftItems: readonly MealItemDraft[],
  reloaded: Pick<MealRecord, 'items'>,
  needsConfirmation: boolean,
): MealItemDraft[] {
  const edits = new Map<string, MealItemDraft>();
  for (const item of draftItems) {
    if (item.storedId !== null) edits.set(item.storedId, item);
  }
  const added = draftItems.filter((item) => item.storedId === null);
  const merged = [
    ...reloaded.items.map((stored) => {
      const fresh = draftFromRecord(stored);
      const mine = edits.get(stored.id);
      if (!mine) return fresh;
      return {
        ...mine,
        storedServing: fresh.storedServing,
        storedAmount: fresh.storedAmount,
        storedOverrides: fresh.storedOverrides,
        storedNutrients: fresh.storedNutrients,
      };
    }),
    ...added,
  ];
  if (!needsConfirmation) return merged;
  return merged.map((item) => (item.confidence === 'low' && !isChangedFromStored(item) ? { ...item, confirmed: false } : item));
}

/** Whether the amount pill (grams and the multiplier popover) shows on a draft's row. */
export function showsAmountPill(item: Pick<MealItemDraft, 'basis' | 'confidence'>, kind: MealEditorKind, readOnly: boolean): boolean {
  return kind === 'draft' && !readOnly && (item.basis === 'estimate' || item.confidence !== null);
}

/** Quick add's calories as typed, when they are a whole meal's worth (1 to 5,000). */
export function quickAddKcal(text: string): number | null {
  const value = HealthFormat.parseDecimal(text);
  return value !== null && value >= 1 && value <= 5000 ? value : null;
}

/** A quick add macro as typed, when it is 0 to 500 g; anything else is unknown. */
export function quickAddMacro(text: string): number | null {
  const value = HealthFormat.parseDecimal(text);
  return value !== null && value >= 0 && value <= 500 ? value : null;
}
