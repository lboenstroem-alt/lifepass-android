/**
 * The save toast (iOS MealSaveFeedback): today's total after a fresh Today
 * read, "Meal saved" when there is no total to read, the date for another
 * day, and "Food diary" on every one.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { dismissToast, ToastHost } from '../../../../components/ui/Toast';
import type { HealthDay } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage } from '../../../../i18n';
import { todayServerDay } from '../../../../i18n/format';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { mealSavedFeedback } from '../saveFeedback';
import { signIn, storedMeal } from './mealFixtures';

const TODAY = todayServerDay();

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  dismissToast();
});

describe('the save toast', () => {
  it('today: the day’s total after the Today read, in the account language', async () => {
    signIn();
    const load = jest.fn(async () => {
      useHealthStore.setState({ today: { meals: { totals: { kcalLow: 1400, kcalHigh: 1520, proteinG: 90 } } } as unknown as HealthDay });
    });
    useHealthStore.setState({ load });
    setCurrentLanguage('is');
    await render(<ToastHost />);
    await act(async () => mealSavedFeedback(storedMeal(TODAY)));
    // The midpoint, rounded to 10.
    await waitFor(() => expect(screen.getByText('Vistað. Um 1.460 kcal í dag.')).toBeOnTheScreen());
    expect(load).toHaveBeenCalledWith({ force: true });
    expect(screen.getByText('Matardagbók')).toBeOnTheScreen();
  });

  it('today without consent (no Today to read): "Meal saved", and Food diary opens today’s diary', async () => {
    signIn(null);
    const load = jest.fn();
    useHealthStore.setState({ load });
    await render(<ToastHost />);
    await act(async () => mealSavedFeedback(storedMeal(TODAY)));
    await waitFor(() => expect(screen.getByText('Meal saved')).toBeOnTheScreen());
    expect(load).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByText('Food diary')));
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openDiary', date: TODAY });
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
  });

  it('another day: "Meal saved to" that day, and Food diary opens that day', async () => {
    signIn();
    await render(<ToastHost />);
    await act(async () => mealSavedFeedback(storedMeal('2026-09-17')));
    expect(screen.getByText(/^Meal saved to .*17 Sep/)).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Food diary')));
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openDiary', date: '2026-09-17' });
  });
});
