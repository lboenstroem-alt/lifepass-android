/**
 * Committing a change to a SAVED meal at once (iOS R4): the item editor's
 * stored context and the meal editor's existing meal both send OP-35 with
 * every item of the meal and the `updatedAt` they loaded, then offer Undo.
 *
 * WHY EVERY ITEM. OP-35 replaces the meal's item list with what is sent: an
 * item left out is deleted, one without an id is created. So an update
 * resends the others as they were, a removal sends the rest, and Undo
 * resends the list from before with the NEW `updatedAt`.
 */
import { newIdempotencyKey } from '../../../api';
import { showToast } from '../../../components/ui';
import { translate, type Lang } from '../../../i18n';
import { track } from '../../../lib/analytics';
import { mealApi } from '../api/mealApi';
import { refreshMineFoods } from '../foodsCache/foodsCache';
import type { MealItemDraft } from '../types/draft';
import { draftInput } from '../types/draftFactory';
import type { MealRecord } from '../types/models';

import { itemsToRestore } from './itemEditorRules';

/**
 * OP-35 with these items and the meal's `updatedAt` as loaded. Resolves to
 * the meal as the server now has it; rejects with the API's error. A
 * created food changed here refreshes My foods.
 */
export async function patchMealItems(meal: MealRecord, items: readonly MealItemDraft[]): Promise<MealRecord> {
  const result = await mealApi().patchMeal(
    meal.id,
    {
      items: items.map(draftInput),
      ...(meal.updatedAt !== null ? { expectedUpdatedAt: meal.updatedAt } : {}),
    },
    newIdempotencyKey(),
  );
  refreshMineFoods();
  return result.meal;
}

export interface UndoOffer {
  /** `food.editor.updated` or `food.editor.removed`. */
  readonly messageKey: string;
  /** The meal as the change left it (its `updatedAt` is what Undo sends). */
  readonly committed: MealRecord;
  /** The items as they were before the change. */
  readonly previous: readonly MealItemDraft[];
  readonly language: Lang;
  /** The meal after Undo went through. */
  readonly onRestored: (meal: MealRecord) => void;
  /** The item editor says "changed on another device" when Undo fails; the meal editor says nothing. */
  readonly toastOnFailure: boolean;
}

/**
 * "Updated" or "Removed", with Undo, as a meal toast. The words are taken in
 * the language of the moment the change was made, as iOS looks them up then.
 */
export function offerUndo({ messageKey, committed, previous, language, onRestored, toastOnFailure }: UndoOffer): void {
  showToast(translate(messageKey, language), {
    kind: 'meal',
    action: {
      label: translate('plan.undo', language),
      onPress: () => {
        void (async () => {
          try {
            const restored = await mealApi().patchMeal(
              committed.id,
              {
                items: itemsToRestore(previous, committed).map(draftInput),
                ...(committed.updatedAt !== null ? { expectedUpdatedAt: committed.updatedAt } : {}),
              },
              newIdempotencyKey(),
            );
            onRestored(restored.meal);
            track('meal_update_undone');
          } catch {
            if (toastOnFailure) showToast(translate('health.err.changed', language), { kind: 'meal' });
          }
        })();
      },
    },
  });
}
