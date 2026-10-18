/**
 * The foods cache (iOS MealFoodsCache): Search draws the stored lists at
 * once and refreshes behind them, per member and per language; a failed
 * refresh keeps what is shown; a My foods removal is applied at once and put
 * back when it fails; and a wipe forgets the lists, with nothing in flight
 * landing for the member who left.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import * as localStore from '../../../../health/localStore';
import { setMealApi, type MealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { EMPTY_MY_FOODS, type FoodChoice, type FoodPresets, type MyFoods } from '../../types';
import {
  foodsCacheProfileId,
  openFoodsCache,
  refreshFoodsCache,
  refreshMineFoods,
  removeMineLocally,
  resetFoodsCacheMemory,
  restoreMine,
  useMealFoodsCache,
} from '../foodsCache';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

function food(key: string, label = key): FoodChoice {
  return {
    key,
    source: 'usda',
    basis: 'database',
    label,
    brand: null,
    foodId: `food-${key}`,
    barcode: null,
    servingOptions: [{ unit: 'g', label: null, grams: null }],
    defaultServing: { unit: 'g', label: null, grams: null },
    defaultAmount: 100,
    defaultKcal: 52,
    per100g: { kcal: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2 },
    perServing: null,
    off: null,
    offAttribution: null,
    liquid: false,
    lastUsedAt: null,
    useCount: null,
  };
}

function presets(...keys: string[]): FoodPresets {
  return { libraryVersion: '2026-10', foods: keys.map((key) => food(key)), meals: [], categories: [] };
}

function mine(...keys: string[]): MyFoods {
  return { ...EMPTY_MY_FOODS, recents: keys.map((key) => food(key)), mine: keys.map((key) => food(key)) };
}

function useApi(overrides: Partial<MealApi>): void {
  setMealApi(fakeMealApi(overrides));
}

function seedFoods(member: string, value: unknown): void {
  fileSystemState.seed(`health/${member}/foods.json`, JSON.stringify(value));
}

function stored(member: string = MEMBER): { language: string; presets: FoodPresets | null; mine: MyFoods | null } | null {
  const text = fileSystemState.read(`health/${member}/foods.json`);
  return text ? (JSON.parse(text) as { language: string; presets: FoodPresets | null; mine: MyFoods | null }) : null;
}

const state = () => useMealFoodsCache.getState();

beforeEach(() => {
  resetFoodsCacheMemory();
});

afterEach(async () => {
  setMealApi(null);
  await localStore.settled();
});

describe('opening', () => {
  it('draws the stored lists at once, then refreshes both and writes them back', async () => {
    seedFoods(MEMBER, { language: 'is', presets: presets('skyr'), mine: mine('rugbraud') });
    let answerPresets: (value: FoodPresets) => void = () => undefined;
    useApi({
      presets: () => new Promise<FoodPresets>((resolve) => (answerPresets = resolve)),
      myFoods: async () => mine('rugbraud', 'hafragrautur'),
    });
    const opening = openFoodsCache({ profileId: MEMBER, language: 'is' });
    await localStore.settled();
    await Promise.resolve();
    // On screen before the server answers.
    expect(state().presets?.foods.map((item) => item.key)).toEqual(['skyr']);
    expect(state().mine?.mine.map((item) => item.key)).toEqual(['rugbraud']);
    expect(state().isRefreshing).toBe(true);

    answerPresets(presets('skyr', 'ysa'));
    await opening;
    expect(state().presets?.foods.map((item) => item.key)).toEqual(['skyr', 'ysa']);
    expect(state().mine?.mine.map((item) => item.key)).toEqual(['rugbraud', 'hafragrautur']);
    expect(state().isRefreshing).toBe(false);
    await localStore.settled();
    expect(stored()?.language).toBe('is');
    expect(stored()?.presets?.foods.map((item) => item.key)).toEqual(['skyr', 'ysa']);
  });

  it('a stored copy in another language is not shown, and is written over in the new one', async () => {
    seedFoods(MEMBER, { language: 'en', presets: presets('apple'), mine: mine('bread') });
    let answer: (value: FoodPresets) => void = () => undefined;
    useApi({ presets: () => new Promise<FoodPresets>((resolve) => (answer = resolve)), myFoods: async () => mine('braud') });
    const opening = openFoodsCache({ profileId: MEMBER, language: 'is' });
    await localStore.settled();
    await Promise.resolve();
    expect(state().presets).toBeNull();
    expect(state().mine).toBeNull();
    answer(presets('epli'));
    await opening;
    await localStore.settled();
    expect(stored()).toEqual(expect.objectContaining({ language: 'is' }));
    expect(stored()?.presets?.foods.map((item) => item.key)).toEqual(['epli']);
  });

  it('a stored copy reads back through the same decoders, nulls and all', async () => {
    useApi({ presets: async () => presets('skyr'), myFoods: async () => mine('rugbraud') });
    await openFoodsCache({ profileId: MEMBER, language: 'is' });
    const first = { presets: state().presets, mine: state().mine };
    resetFoodsCacheMemory();
    useApi({ presets: () => Promise.reject(new Error('offline')), myFoods: () => Promise.reject(new Error('offline')) });
    await openFoodsCache({ profileId: MEMBER, language: 'is' });
    expect({ presets: state().presets, mine: state().mine }).toEqual(first);
    // Something to show: the failure is not shown as one.
    expect(state().presetsFailed).toBe(false);
    expect(state().mineFailed).toBe(false);
  });

  it('another member never sees the lists of the one before', async () => {
    seedFoods(MEMBER, { language: 'is', presets: presets('skyr'), mine: mine('mine-of-member') });
    useApi({ presets: () => Promise.reject(new Error('offline')), myFoods: () => Promise.reject(new Error('offline')) });
    await openFoodsCache({ profileId: MEMBER, language: 'is' });
    expect(state().mine?.mine.map((item) => item.key)).toEqual(['mine-of-member']);
    await openFoodsCache({ profileId: OTHER, language: 'is' });
    expect(state().mine).toBeNull();
    expect(state().presets).toBeNull();
    expect(state().presetsFailed).toBe(true);
    expect(state().mineFailed).toBe(true);
  });
});

describe('refreshing', () => {
  it('a failure keeps what is shown; with nothing to show it says so', async () => {
    useApi({ presets: async () => presets('skyr'), myFoods: () => Promise.reject(new Error('offline')) });
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    expect(state().presetsFailed).toBe(false);
    expect(state().mineFailed).toBe(true);

    useApi({ presets: () => Promise.reject(new Error('offline')), myFoods: async () => mine('a') });
    await refreshFoodsCache();
    expect(state().presets?.foods.map((item) => item.key)).toEqual(['skyr']);
    expect(state().presetsFailed).toBe(false);
    expect(state().mineFailed).toBe(false);
  });

  it('does nothing before a member opened the lists', async () => {
    const presetsCall = jest.fn(async () => presets());
    useApi({ presets: presetsCall });
    await refreshFoodsCache();
    refreshMineFoods();
    expect(presetsCall).not.toHaveBeenCalled();
    expect(foodsCacheProfileId()).toBeNull();
  });

  it('after a save, my foods alone are read again and written', async () => {
    const myFoods = jest.fn().mockResolvedValueOnce(mine('a')).mockResolvedValueOnce(mine('a', 'b'));
    useApi({ presets: async () => presets('skyr'), myFoods });
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    refreshMineFoods();
    await new Promise((resolve) => setImmediate(resolve));
    await localStore.settled();
    expect(state().mine?.mine.map((item) => item.key)).toEqual(['a', 'b']);
    expect(stored()?.mine?.mine.map((item) => item.key)).toEqual(['a', 'b']);
  });
});

describe('a My foods removal', () => {
  it('is applied at once everywhere the key appears, and put back when it fails', async () => {
    useApi({ presets: async () => presets(), myFoods: async () => mine('a', 'b') });
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    const before = state().mine ?? EMPTY_MY_FOODS;
    removeMineLocally('a');
    expect(state().mine?.mine.map((item) => item.key)).toEqual(['b']);
    expect(state().mine?.recents.map((item) => item.key)).toEqual(['b']);
    await localStore.settled();
    expect(stored()?.mine?.mine.map((item) => item.key)).toEqual(['b']);

    restoreMine(before);
    expect(state().mine).toEqual(before);
    await localStore.settled();
    expect(stored()?.mine?.mine.map((item) => item.key)).toEqual(['a', 'b']);
  });
});

describe('the wipe', () => {
  it('forgets the lists, and an answer still on its way lands nowhere', async () => {
    useApi({ presets: async () => presets('skyr'), myFoods: async () => mine('a') });
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    expect(state().mine).not.toBeNull();

    let answer: (value: MyFoods) => void = () => undefined;
    useApi({ presets: async () => presets('skyr'), myFoods: () => new Promise<MyFoods>((resolve) => (answer = resolve)) });
    const refreshing = refreshFoodsCache();
    await Promise.resolve();
    await Promise.resolve();
    await localStore.deleteProfileFolder(MEMBER);
    resetFoodsCacheMemory();
    expect(state()).toEqual({ presets: null, mine: null, presetsFailed: false, mineFailed: false, isRefreshing: false });

    answer(mine('a'));
    await refreshing;
    await localStore.settled();
    expect(state().mine).toBeNull();
    expect(stored()).toBeNull();
    expect(foodsCacheProfileId()).toBeNull();
  });
});
