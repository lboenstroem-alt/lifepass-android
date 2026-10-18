/**
 * The food log's session hooks (src/features/meals/register.ts): a health
 * wipe forgets the queue and the lists in memory; a sign-out removes the
 * outbox, the tray and the foods cache of the member who left, even when it
 * could name nobody; an activation loads the member's queue and sends it in
 * the background.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import type { ActivationHook, SignOutCleaner } from '../../../app/signOut';
import * as localStore from '../../../health/localStore';
import { registeredHealthWipeHookIds, runHealthWipeHooks } from '../../../health/wipe';
import { setMealApi } from '../api';
import { fakeMealApi } from '../api/testing';
import { openFoodsCache, useMealFoodsCache } from '../foodsCache';
import { encodeOutboxItem, enqueueMeal, resetMealOutboxForTests, useMealOutbox } from '../outbox';
import type { MealCreateBody, MealWriteResult } from '../types';

const mockHooks: { activation: Record<string, ActivationHook>; signOut: Record<string, SignOutCleaner> } = {
  activation: {},
  signOut: {},
};

// Only this file's hooks, run on their own: the real registry would load
// every package's register file and run their hooks too.
jest.mock('../../../app/signOut', () => ({
  registerActivationHook: (id: string, hook: ActivationHook) => {
    mockHooks.activation[id] = hook;
    return () => undefined;
  },
  registerSignOutCleaner: (id: string, cleaner: SignOutCleaner) => {
    mockHooks.signOut[id] = cleaner;
    return () => undefined;
  },
}));

type RegisterModule = typeof import('../register');

/** Loaded once the mock's registry exists (an import would run before it). */
let register: RegisterModule;
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  register = require('../register') as RegisterModule;
});

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

function body(): MealCreateBody {
  return { slot: 'lunch', loggedAt: new Date(Date.UTC(2026, 8, 22, 12, 0)), logDate: '2026-09-22', source: 'quick_add', items: [] };
}

function seedMemberFiles(): void {
  const queued = encodeOutboxItem({ id: 'a', body: body(), key: 'key-a', createdAt: new Date(), state: 'pending' });
  fileSystemState.seed(`health/${MEMBER}/meal-outbox.json`, JSON.stringify([queued]));
  fileSystemState.seed(`health/${MEMBER}/tray.json`, '{}');
  fileSystemState.seed(`health/${MEMBER}/foods.json`, '{}');
}

function memberFiles(): (string | null)[] {
  return ['meal-outbox.json', 'tray.json', 'foods.json'].map((name) => fileSystemState.read(`health/${MEMBER}/${name}`));
}

beforeEach(() => {
  resetMealOutboxForTests();
});

afterEach(async () => {
  setMealApi(null);
  await localStore.settled();
});

it('registers its hooks under stable ids', () => {
  expect(Object.keys(mockHooks.signOut)).toEqual(['meals.local']);
  expect(Object.keys(mockHooks.activation)).toEqual(['meals.outbox']);
  expect(registeredHealthWipeHookIds()).toContain('meals.memory');
  expect(register.MEAL_LOCAL_FILES).toEqual(['mealOutbox', 'tray', 'foods']);
});

it('a health wipe forgets the queue and the food lists in memory', async () => {
  setMealApi(fakeMealApi({ presets: async () => ({ libraryVersion: null, foods: [], meals: [], categories: [] }), myFoods: () => Promise.reject(new Error('offline')) }));
  await openFoodsCache({ profileId: MEMBER, language: 'en' });
  await enqueueMeal(body(), 'key-1', MEMBER);
  expect(useMealOutbox.getState().items).toHaveLength(1);
  expect(useMealFoodsCache.getState().presets).not.toBeNull();

  await runHealthWipeHooks({ profileId: MEMBER, reason: 'withdrawn' });
  expect(useMealOutbox.getState().items).toEqual([]);
  expect(useMealFoodsCache.getState().presets).toBeNull();
});

it('a sign-out removes the member’s meal files and memory', async () => {
  seedMemberFiles();
  await enqueueMeal(body(), 'key-1', MEMBER);
  await mockHooks.signOut['meals.local']?.({ memberId: MEMBER });
  await localStore.settled();
  expect(memberFiles()).toEqual([null, null, null]);
  expect(useMealOutbox.getState().items).toEqual([]);
});

it('a sign-out that names nobody still removes the files of the queue that was open', async () => {
  seedMemberFiles();
  await enqueueMeal(body(), 'key-1', MEMBER);
  await mockHooks.signOut['meals.local']?.({ memberId: null });
  await localStore.settled();
  expect(memberFiles()).toEqual([null, null, null]);
});

it('an activation loads the member’s queue and sends it in the background', async () => {
  seedMemberFiles();
  const createMeal = jest.fn(async (): Promise<MealWriteResult> => ({ meal: {} as MealWriteResult['meal'], replayed: false }));
  setMealApi(fakeMealApi({ createMeal }));
  await mockHooks.activation['meals.outbox']?.({ memberId: MEMBER, trigger: 'foreground' });
  expect(createMeal).toHaveBeenCalledWith(body(), 'key-a');
  expect(useMealOutbox.getState().items).toEqual([]);
});
