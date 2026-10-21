/**
 * The save toast after "Copy from yesterday": iOS `MealSaveFeedback.saved`
 * (Views/Meals/MealCaptureView.swift), the day's total with a way to the
 * diary. The capture page's own save toast is MEAL-2's; the diary's copy
 * says the same words.
 *
 * Today: Plan's Today read is reloaded first (Home's row and Plan read the
 * same day), and the toast says the day's total ("Saved. About 1,240 kcal
 * today."), or "Meal saved" when the read has no meals block. Another day:
 * "Meal saved to Wed 14 Oct".
 */
import { showToast } from '../../../components/ui';
import { useHealthStore } from '../../../health';
import { translate, type Lang } from '../../../i18n';
import { dayEnergy, integer, shortDay, todayServerDay } from '../../../i18n/format';
import { selectHasHealthConsent, useAppStore } from '../../../stores/appStore';
import type { MealRecord } from '../types/models';

export async function showMealSavedToast(meal: Pick<MealRecord, 'logDate'>, lang: Lang, onOpenDiary: (date: string) => void): Promise<void> {
  const date = meal.logDate;
  const action = { label: translate('diary.title', lang), onPress: () => onOpenDiary(date) };
  if (date !== todayServerDay()) {
    showToast(translate('meal.saved_on', lang, { date: shortDay(date, lang) }), { kind: 'meal', action });
    return;
  }
  let kcal: number | null = null;
  if (selectHasHealthConsent(useAppStore.getState())) {
    await useHealthStore.getState().load({ force: true });
    const totals = useHealthStore.getState().today?.meals?.totals;
    if (totals) kcal = dayEnergy(totals, null).eatenMidKcal;
  }
  const message = kcal !== null ? translate('meal.saved_total', lang, { kcal: integer(kcal, lang) }) : translate('meal.saved', lang);
  showToast(message, { kind: 'meal', action });
}
