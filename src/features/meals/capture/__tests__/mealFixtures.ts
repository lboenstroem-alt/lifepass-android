/**
 * Shared fixtures for MEAL-2's tests: foods, a stored meal as the server
 * answers it, problems, and a signed-in member.
 */
import { ProblemError, TransportError, type ApiError } from '../../../../api';
import { decodeProfile } from '../../../../api/profile';
import { useAppStore } from '../../../../stores/appStore';
import { decodeMealRecord } from '../../types/decode';
import type { FoodChoice, FoodPresets, MealRecord, MyFoods, PresetMeal, RecentMeal } from '../../types/models';

export const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

export function problem(slug: string, status: number, extra: Record<string, unknown> = {}): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status, ...extra }, status);
}

export const offline = (): ApiError => new TransportError('offline');

/** The health block of an entitled member who said yes to tracking. */
export const ENTITLED: Record<string, unknown> = { access: 'entitled', consent: { version: '2026-09-v1' } };

/**
 * `MEMBER` signed in, with `health` as the profile's health block (null
 * leaves it out: it did not load). The app store derives `healthAccess`
 * from it.
 */
export function signIn(health: Record<string, unknown> | null = ENTITLED): void {
  const profile = decodeProfile({
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    ...(health ? { health } : {}),
  });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile, language: 'en' });
}

export function choice(overrides: Partial<FoodChoice> = {}): FoodChoice {
  return {
    key: 'food:skyr-plain',
    source: 'matvaretabellen',
    basis: 'database',
    label: 'Skyr, plain',
    brand: null,
    foodId: 'skyr-plain',
    barcode: null,
    servingOptions: [{ unit: 'serving', label: '1 cup', grams: 170 }],
    defaultServing: { unit: 'serving', label: '1 cup', grams: 170 },
    defaultAmount: 1,
    defaultKcal: 107,
    per100g: { kcal: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
    perServing: null,
    off: null,
    offAttribution: null,
    liquid: false,
    lastUsedAt: null,
    useCount: null,
    ...overrides,
  };
}

export const banana = (): FoodChoice =>
  choice({
    key: 'food:banana',
    source: 'usda',
    label: 'Banana',
    foodId: 'banana',
    servingOptions: [{ unit: 'serving', label: '1 medium', grams: 118 }],
    defaultServing: { unit: 'serving', label: '1 medium', grams: 118 },
    defaultKcal: 105,
    per100g: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
  });

export const myOats = (): FoodChoice =>
  choice({
    key: 'mine:oats',
    source: 'member',
    basis: 'member',
    label: 'Grandma oats',
    brand: 'Home',
    foodId: null,
    servingOptions: [{ unit: 'g', label: null, grams: null }],
    defaultServing: { unit: 'g', label: null, grams: null },
    defaultAmount: 100,
    defaultKcal: 380,
    per100g: { kcal: 380, proteinG: 13, carbsG: 60, fatG: 7 },
  });

export function presetMeal(overrides: Partial<PresetMeal> = {}): PresetMeal {
  return {
    id: 'meal-skyr-bowl',
    name: 'Skyr bowl',
    category: { id: 'breakfast', label: 'Breakfast' },
    ingredients: [
      {
        foodId: 'skyr-plain',
        source: 'matvaretabellen',
        label: 'Skyr, plain',
        grams: 170,
        kcal: 107,
        per100g: { kcal: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
        servingOptions: [],
        liquid: false,
      },
      {
        foodId: 'banana',
        source: 'usda',
        label: 'Banana',
        grams: 59,
        kcal: 53,
        per100g: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
        servingOptions: [],
        liquid: false,
      },
    ],
    perServing: { kcal: 160, proteinG: 19, carbsG: 20, fatG: 0.5 },
    ...overrides,
  };
}

export function recentMeal(overrides: Partial<RecentMeal> = {}): RecentMeal {
  return { key: 'recent:1', slot: 'breakfast', itemCount: 2, kcal: 212, items: [choice(), banana()], ...overrides };
}

export function presets(overrides: Partial<FoodPresets> = {}): FoodPresets {
  return { libraryVersion: '1', foods: [choice(), banana()], meals: [presetMeal()], categories: [{ id: 'breakfast', label: 'Breakfast' }], ...overrides };
}

export function myFoods(overrides: Partial<MyFoods> = {}): MyFoods {
  return { recents: [choice()], frequent: [banana()], mine: [myOats()], recentMeals: [recentMeal()], ...overrides };
}

/** A stored meal as OP-34 answers it. */
export function storedMeal(logDate: string, overrides: Record<string, unknown> = {}): MealRecord {
  return decodeMealRecord(
    {
      id: 'meal-1',
      logDate,
      loggedAt: `${logDate}T12:00:00Z`,
      slot: 'lunch',
      source: 'search',
      confirmed: true,
      items: [],
      totals: { kcalLow: 107, kcalHigh: 107, proteinG: 19, carbsG: 7, fatG: 0, mealCount: 1, macrosComplete: true },
      updatedAt: `${logDate}T12:00:00.123Z`,
      ...overrides,
    },
    'meal',
  );
}
