/**
 * What the member is told after a draft is confirmed (iOS
 * `MealSaveFeedback.saved`, ios-ux.md 12.3): the day's total with a way to
 * the diary.
 *
 *   today        "Saved. About 1,460 kcal today."  (after a fresh Today read)
 *                "Meal saved"                       (no consent, or the read failed)
 *   another day  "Meal saved to Wed 17 Sep"
 *
 * Both carry "Food diary": Plan, then the diary on the meal's date.
 *
 * INTEGRATION (MEAL-2 + MEAL-4): MEAL-2's capture/saveFeedback.ts
 * (`mealSavedFeedback`) is the same port for the tray's save. Built side by
 * side, neither could import the other; once both are merged this file
 * re-exports that one.
 */
import { showToast, type ToastAction } from '../../../components/ui';
import { useHealthStore } from '../../../health/store';
import { currentLanguage, translate } from '../../../i18n';
import { dayEnergy, integer, shortDay, todayServerDay } from '../../../i18n/format';
import { selectHasHealthConsent, useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import type { MealRecord } from '../types/models';

/** "Food diary": Plan, then the diary on `date` (iOS `pendingPlanAction = .openDiary`, `pendingTab = 4`). */
export function openFoodDiary(date: string): void {
  const intents = useIntentStore.getState();
  intents.parkPlanAction({ kind: 'openDiary', date });
  intents.requestTab('Plan');
}

/** The day's eaten midpoint after a fresh Today read, or null when there is nothing to read. */
async function todayEatenKcal(): Promise<number | null> {
  if (!selectHasHealthConsent(useAppStore.getState())) return null;
  await useHealthStore.getState().load({ force: true });
  const totals = useHealthStore.getState().today?.meals?.totals;
  return totals ? dayEnergy(totals, null).eatenMidKcal : null;
}

/** The save toast for `meal`. */
export function mealSavedFeedback(meal: Pick<MealRecord, 'logDate'>): void {
  const date = meal.logDate;
  const action = (): ToastAction => ({
    label: translate('diary.title', currentLanguage()),
    onPress: () => openFoodDiary(date),
  });
  if (date !== todayServerDay()) {
    const lang = currentLanguage();
    showToast(translate('meal.saved_on', lang, { date: shortDay(date, lang) }), { kind: 'meal', action: action() });
    return;
  }
  void todayEatenKcal()
    .catch(() => null)
    .then((kcal) => {
      const lang = currentLanguage();
      const message =
        kcal !== null ? translate('meal.saved_total', lang, { kcal: integer(kcal, lang) }) : translate('meal.saved', lang);
      showToast(message, { kind: 'meal', action: action() });
    });
}
