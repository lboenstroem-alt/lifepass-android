/**
 * The food diary's rules, apart from its screen: the pure half of iOS
 * `DiaryDayView` (Views/Meals/DiaryDayView.swift), so each rule is tested
 * without a network.
 *
 * - Days are server calendar days (`YYYY-MM-DD`, Reykjavík = UTC); the bar
 *   steps a day at a time and never past today.
 * - A slot shows its saved meals by time, then the meals still waiting on
 *   this phone ("Waiting to sync"), and its header sums each meal's midpoint.
 * - "Copy from yesterday" is offered only for today, on an empty slot with
 *   no meal waiting for it on the phone, when yesterday had confirmed meals
 *   in that slot, and never while the page shows the offline copy.
 * - Removing an item patches the meal with the rest (the last item asks to
 *   delete the meal instead); library and member-typed items can be undone.
 * - Offline today, the diary draws the cached Today read's meals.
 */
import { addServerDays, roundHalfAwayFromZero } from '../../../i18n/format';
import type { HealthMealsBlock, MealItemView, MealSlot, MealView } from '../../../health/models';
import { isLibraryItem, type MealItemDraft } from '../types/draft';
import { draftFromRecord, draftInput } from '../types/draftFactory';
import {
  GRAMS_SERVING,
  MealItemSourceKind,
  type MealDayRecord,
  type MealItemRecord,
  type MealPatchBody,
  type MealRecord,
  type MealServing,
} from '../types/models';
import type { MealOutboxItem } from '../outbox/rules';

/** The slots a day is drawn in, in order (iOS `MealSlot.editable`). */
export const DIARY_SLOTS: readonly Exclude<MealSlot, 'unknown'>[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];

/** The date picker reaches back a year (Barcode and Search take any of those days). */
export const DIARY_PICKER_DAYS = 365;

// ---------------------------------------------------------------------------
// Days

/** The day `delta` days from `date`, or null past today (or for a day this build cannot read). */
export function stepDay(date: string, delta: number, today: string): string | null {
  const next = addServerDays(date, delta);
  if (!next || next > today) return null;
  return next;
}

/** A picked day, never past today. */
export function clampToToday(date: string, today: string): string {
  return date > today ? today : date;
}

/** Which word the bar shows for a day (iOS `MealDateText.relative`). */
export type RelativeDay = 'today' | 'yesterday' | 'date';

export function relativeDay(date: string, today: string): RelativeDay {
  if (date === today) return 'today';
  if (addServerDays(today, -1) === date) return 'yesterday';
  return 'date';
}

/** The first and last day the picker offers. */
export function pickerRange(today: string): { first: string; last: string } {
  return { first: addServerDays(today, -DIARY_PICKER_DAYS) ?? today, last: today };
}

/** A horizontal swipe on the summary: left is the next day, right the one before. Null for a vertical drag. */
export function swipeDelta(translationX: number, translationY: number): -1 | 1 | null {
  if (Math.abs(translationX) <= Math.abs(translationY)) return null;
  return translationX < 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Slots

function loggedAtValue(meal: Pick<MealRecord, 'loggedAt'>): number {
  // A meal with no time sorts first (iOS `.distantPast`).
  return meal.loggedAt ? meal.loggedAt.getTime() : Number.NEGATIVE_INFINITY;
}

/** The day's saved meals in one slot, earliest first. */
export function slotMeals(day: Pick<MealDayRecord, 'meals'>, slot: MealSlot): MealRecord[] {
  return day.meals.filter((meal) => meal.slot === slot).sort((a, b) => loggedAtValue(a) - loggedAtValue(b));
}

/** The meals waiting on the phone for one slot. */
export function queuedInSlot(pending: readonly MealOutboxItem[], slot: MealSlot): MealOutboxItem[] {
  return pending.filter((entry) => entry.body.slot === slot);
}

/** The slot header's kcal: each meal's midpoint, rounded, summed. */
export function slotKcal(meals: readonly MealRecord[]): number {
  return meals.reduce((sum, meal) => sum + (meal.totals ? roundHalfAwayFromZero((meal.totals.kcalLow + meal.totals.kcalHigh) / 2) : 0), 0);
}

export interface CopyYesterdayContext {
  readonly isToday: boolean;
  /** The day's saved meals in this slot. */
  readonly meals: readonly MealRecord[];
  /** The page shows the cached Today read (offline). */
  readonly showingCache: boolean;
  readonly yesterday: MealDayRecord | null;
  /** Every meal waiting on the phone for the day on screen. */
  readonly pending: readonly MealOutboxItem[];
}

/**
 * Whether "Copy from yesterday" is offered for a slot. A meal waiting on the
 * phone fills the slot as much as a saved one: copying yesterday's on top of
 * it would log the slot twice.
 */
export function canCopyYesterday(slot: MealSlot, context: CopyYesterdayContext): boolean {
  if (!context.isToday || context.meals.length > 0 || context.showingCache || !context.yesterday) return false;
  if (context.pending.some((entry) => entry.body.slot === slot)) return false;
  return context.yesterday.meals.some((meal) => meal.slot === slot && meal.confirmed);
}

/** What a copy sends: yesterday's confirmed meals in the slot, earliest first. */
export function yesterdaySources(yesterday: MealDayRecord, slot: MealSlot): MealRecord[] {
  return yesterday.meals.filter((meal) => meal.slot === slot && meal.confirmed).sort((a, b) => loggedAtValue(a) - loggedAtValue(b));
}

// ---------------------------------------------------------------------------
// Drafts

/** A draft's row: a description estimate or a photo estimate, by the meal's own source. */
export function draftRowCopyKey(draft: Pick<MealRecord, 'source'>): 'diary.draft_row_text' | 'diary.draft_row' {
  return draft.source === 'text' ? 'diary.draft_row_text' : 'diary.draft_row';
}

// ---------------------------------------------------------------------------
// Removing an item

export type ItemRemoval =
  /** The last item: the whole meal goes, after "Delete this meal?". */
  | { readonly kind: 'confirmDelete' }
  | {
      readonly kind: 'patch';
      /** The meal without the item, against the `updatedAt` it was read with. */
      readonly body: MealPatchBody;
      /** Library and member-typed items come back with Undo; an estimate cannot be rebuilt. */
      readonly undoable: boolean;
      /** Every item as it was, for the Undo. */
      readonly all: readonly MealItemDraft[];
    };

export function itemRemoval(meal: MealRecord, item: MealItemDraft): ItemRemoval {
  const all = meal.items.map(draftFromRecord);
  const remaining = all.filter((candidate) => candidate.storedId !== item.storedId);
  if (remaining.length === 0) return { kind: 'confirmDelete' };
  return {
    kind: 'patch',
    body: { items: remaining.map(draftInput), ...(meal.updatedAt ? { expectedUpdatedAt: meal.updatedAt } : {}) },
    undoable: isLibraryItem(item) || MealItemSourceKind.isMemberTyped(item.source),
    all,
  };
}

/**
 * The Undo: every item back, the removed one sent as new (its stored row is
 * gone), against the meal as the removal left it.
 */
export function undoRemovalBody(all: readonly MealItemDraft[], removed: MealItemDraft, updated: Pick<MealRecord, 'updatedAt'>): MealPatchBody {
  const restored = all.map((candidate) => (candidate.storedId === removed.storedId ? { ...candidate, storedId: null } : candidate));
  return { items: restored.map(draftInput), ...(updated.updatedAt ? { expectedUpdatedAt: updated.updatedAt } : {}) };
}

// ---------------------------------------------------------------------------
// Offline: today from the cached Today read

function servingFromView(serving: MealItemView['serving']): MealServing {
  if (!serving) return GRAMS_SERVING;
  return { unit: serving.unit, label: serving.label ?? null, grams: serving.grams ?? null };
}

function itemFromView(item: MealItemView): MealItemRecord {
  return {
    id: item.id,
    source: item.source ?? 'model',
    basis: item.basis,
    label: item.label ?? '',
    brand: item.brand,
    foodId: item.foodId,
    barcode: item.barcode,
    serving: servingFromView(item.serving),
    amount: item.amount ?? 1,
    servingOptions: (item.servingOptions ?? []).map(servingFromView),
    per100g: null,
    perServing: null,
    estimate: null,
    overrides: null,
    edited: item.edited ?? [],
    confidence: item.confidence,
    confirmed: item.confirmed ?? true,
    nutrients: item.nutrients,
    liquid: item.liquid ?? false,
    off: null,
  };
}

/** A meal from the Today read (display only: no per 100 g values), for an offline diary. */
export function mealRecordFromView(view: MealView, today: string): MealRecord {
  return {
    id: view.id,
    logDate: view.logDate ?? today,
    loggedAt: view.loggedAt,
    slot: view.slot ?? 'snack',
    source: view.source,
    confirmed: view.confirmed ?? true,
    confidence: view.confidence,
    needsConfirm: view.needsConfirm ?? false,
    hasEstimate: view.hasEstimate ?? false,
    items: (view.items ?? []).map(itemFromView),
    totals: view.totals,
    createdAt: view.createdAt,
    // Never sent back: an edit from the offline copy would have nothing to match.
    updatedAt: null,
  };
}

/** Today's meals from the cached Today read, confirmed ones only; null when it holds none. */
export function cachedTodayDay(block: HealthMealsBlock | null | undefined, today: string): MealDayRecord | null {
  if (!block) return null;
  return {
    date: today,
    meals: (block.meals ?? []).filter((meal) => meal.confirmed !== false).map((meal) => mealRecordFromView(meal, today)),
    drafts: [],
    totals: block.totals,
    target: block.target,
    targetWithheld: block.targetWithheld,
    scansLeftToday: block.scansLeftToday,
    textDrafts: [],
  };
}
