/**
 * A canned `MealApi` for tests (and the meal packages' component tests):
 * every call not given rejects, so a test that reaches a call it did not
 * expect fails loudly instead of touching the network.
 *
 *   const createMeal = jest.fn(async () => written);
 *   setMealApi(fakeMealApi({ createMeal }));
 *
 * Never imported by app code.
 */
import type { MealApi } from './mealApi';

/** Rejects with a message naming the call, so the failure says what was unexpected. */
function unexpected(name: keyof MealApi): () => Promise<never> {
  return () => Promise.reject(new Error(`MealApi.${name} was not expected in this test`));
}

export function fakeMealApi(overrides: Partial<MealApi> = {}): MealApi {
  return {
    presets: unexpected('presets'),
    myFoods: unexpected('myFoods'),
    search: unexpected('search'),
    barcode: unexpected('barcode'),
    hideFood: unexpected('hideFood'),
    createMeal: unexpected('createMeal'),
    patchMeal: unexpected('patchMeal'),
    copyMeal: unexpected('copyMeal'),
    meal: unexpected('meal'),
    mealDay: unexpected('mealDay'),
    deleteMeal: unexpected('deleteMeal'),
    scan: unexpected('scan'),
    describe: unexpected('describe'),
    ...overrides,
  };
}
