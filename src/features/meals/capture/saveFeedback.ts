/**
 * What the member is told after a meal is saved (iOS `MealSaveFeedback`,
 * ios-ux.md 12.3) and the app-wide meal toast (iOS `MealToastCenter.shared`).
 *
 * The save toast says where the day stands, with a way to the diary:
 *
 *   today        "Saved. About 1,460 kcal today."  (after the Today read)
 *                "Meal saved"                       (no consent, or the read failed)
 *   another day  "Meal saved to Wed 17 Sep"
 *
 * Both carry "Food diary", which switches to Plan and opens the diary on the
 * meal's date. The toasts are the UI kit's meal kind (4 s, announced to
 * TalkBack), drawn above the tab bar once the page has gone.
 */
import { showToast, type ToastAction } from '../../../components/ui';
import { currentLanguage, translate } from '../../../i18n';
import { dayEnergy, integer, shortDay, todayServerDay } from '../../../i18n/format';
import { useHealthStore } from '../../../health/store';
import { selectHasHealthConsent, useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import type { MealRecord } from '../types/models';

/** A meal toast (iOS `MealToastCenter.show`): with an action, or the plain one. */
export function showMealToast(message: string, options: { readonly action?: ToastAction; readonly bottomOffset?: number } = {}): void {
  showToast(message, { kind: 'meal', action: options.action, bottomOffset: options.bottomOffset });
}

/** "Food diary": Plan, then the diary on `date` (iOS `pendingPlanAction = .openDiary`, `pendingTab = 4`). */
export function openFoodDiary(date: string): void {
  const intents = useIntentStore.getState();
  intents.parkPlanAction({ kind: 'openDiary', date });
  intents.requestTab('Plan');
}

/** The day's eaten midpoint after a fresh Today read, or null when there is none to read. */
async function todayEatenKcal(): Promise<number | null> {
  if (!selectHasHealthConsent(useAppStore.getState())) return null;
  await useHealthStore.getState().load({ force: true });
  const totals = useHealthStore.getState().today?.meals?.totals;
  return totals ? dayEnergy(totals, null).eatenMidKcal : null;
}

/** The save toast for `meal` (iOS `MealSaveFeedback.saved`). */
export function mealSavedFeedback(meal: MealRecord): void {
  const date = meal.logDate;
  const action = (): ToastAction => ({
    label: translate('diary.title', currentLanguage()),
    onPress: () => openFoodDiary(date),
  });
  if (date !== todayServerDay()) {
    const lang = currentLanguage();
    showMealToast(translate('meal.saved_on', lang, { date: shortDay(date, lang) }), { action: action() });
    return;
  }
  void todayEatenKcal()
    .catch(() => null)
    .then((kcal) => {
      const lang = currentLanguage();
      const message =
        kcal !== null ? translate('meal.saved_total', lang, { kcal: integer(kcal, lang) }) : translate('meal.saved', lang);
      showMealToast(message, { action: action() });
    });
}
