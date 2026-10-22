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
import { dismissToast, showToast, type ToastAction } from '../../../components/ui/Toast';
import { currentLanguage, translate } from '../../../i18n';
import { dayEnergy, integer, shortDay, todayServerDay } from '../../../i18n/format';
import { useHealthStore } from '../../../health/store';
import { selectHasHealthConsent, useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import type { MealRecord } from '../types/models';

export interface MealToastOptions {
  readonly action?: ToastAction;
  readonly bottomOffset?: number;
  /**
   * The meal page this toast belongs to (its model): an in-page toast
   * ("Added" with Undo, "Your unsaved items are back."), which iOS draws in
   * the page's own cover (`model.toasts`) so it leaves with the page. Omitted
   * for the app-wide ones (the save's, "Saved on this phone").
   */
  readonly page?: object;
}

/** The page whose toast is the last meal toast shown, or null for an app-wide one. */
let pageToastOwner: object | null = null;

/** A meal toast (iOS `MealToastCenter.show`): with an action, or the plain one. */
export function showMealToast(message: string, options: MealToastOptions = {}): void {
  showToast(message, { kind: 'meal', action: options.action, bottomOffset: options.bottomOffset });
  pageToastOwner = options.page ?? null;
}

/**
 * The page has closed: its own toast goes with it, as iOS's in-cover toast
 * does, so an "Added" with Undo never stays over the tab with an Undo that
 * can no longer reach the tray. A save's toast shown since (for another day
 * it is shown before the page closes) is app-wide and stays. One toast shows
 * at a time; a toast another package showed directly over the page's own is
 * about the page too, and goes with it.
 */
export function dismissPageToast(page: object): void {
  if (pageToastOwner !== page) return;
  pageToastOwner = null;
  dismissToast();
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
