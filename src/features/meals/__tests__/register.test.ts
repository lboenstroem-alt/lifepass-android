/**
 * The food log's session hooks (src/features/meals/register.ts): a health
 * wipe forgets the queue and the lists in memory and leaves no meal file
 * behind, even one written while the health store's wipe was still waiting
 * on its native cleanup; a sign-out removes the outbox, the tray and the
 * foods cache of the member who left, even when it could name nobody; an
 * activation loads the member's queue and sends it in the background; and
 * the meal half of Plan's failed-item banner is installed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { fileSystemState } from '@test/mocks/expoFileSystem';

import { ProblemError, type ApiError } from '../../../api';
import { decodeProfile } from '../../../api/profile';
import type { ActivationHook, SignOutCleaner } from '../../../app/signOut';
import * as backgroundRegistry from '../../../background/registry';
import * as localStore from '../../../health/localStore';
import { resetHealthStoreForTests, useHealthStore } from '../../../health/store';
import { registeredHealthWipeHookIds, runHealthWipeHooks } from '../../../health/wipe';
import { resetAppStoreForTests, useAppStore } from '../../../stores/appStore';
import { setMealApi } from '../api';
import { fakeMealApi } from '../api/testing';
import { openFoodsCache, refreshMineFoods, useMealFoodsCache } from '../foodsCache';
import { activateMealOutbox, encodeOutboxItem, enqueueMeal, flushMealOutbox, mealOutboxPlanSource, resetMealOutboxForTests, useMealOutbox } from '../outbox';
import type { MealOutboxItem } from '../outbox';
import { saveTray } from '../tray';
import { EMPTY_MY_FOODS, type FoodPresets, type MealCreateBody, type MealWriteResult, type MyFoods } from '../types';

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
const FOLDER = `health/${MEMBER}`;

function body(): MealCreateBody {
  return { slot: 'lunch', loggedAt: new Date(Date.UTC(2026, 8, 22, 12, 0)), logDate: '2026-09-22', source: 'quick_add', items: [] };
}

function entry(id: string, state: MealOutboxItem['state'] = 'pending'): MealOutboxItem {
  return { id, body: body(), key: `key-${id}`, createdAt: new Date(), state };
}

function seedMemberFiles(queue: readonly MealOutboxItem[] = [entry('a')]): void {
  fileSystemState.seed(`${FOLDER}/meal-outbox.json`, JSON.stringify(queue.map(encodeOutboxItem)));
  fileSystemState.seed(`${FOLDER}/tray.json`, '{}');
  fileSystemState.seed(`${FOLDER}/foods.json`, '{}');
}

function memberFiles(): (string | null)[] {
  return ['meal-outbox.json', 'tray.json', 'foods.json'].map((name) => fileSystemState.read(`${FOLDER}/${name}`));
}

const PRESETS: FoodPresets = { libraryVersion: null, foods: [], meals: [], categories: [] };

function problem(slug: string, status: number): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

/** The member signed in, with consent: the server's minor refusal reaches the phone before the profile says so. */
function signedIn(): void {
  const profile = decodeProfile({
    id: MEMBER,
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: { access: 'entitled', consent: { version: '2026-09-v1' } },
  });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile, healthAccess: 'entitled' });
}

/**
 * The health store's wipe, held where it waits on its native cleanup (the
 * background task's cancel): the folder's deletion is queued, the hooks
 * have not run. Returns the release.
 */
function holdWipeBeforeHooks(): () => void {
  let release: () => void = () => undefined;
  jest.spyOn(backgroundRegistry, 'cancelBackgroundTask').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetMealOutboxForTests();
  resetAppStoreForTests();
  resetHealthStoreForTests();
});

afterEach(async () => {
  jest.restoreAllMocks();
  setMealApi(null);
  await localStore.settled();
});

it('registers its hooks under stable ids', () => {
  expect(Object.keys(mockHooks.signOut)).toEqual(['meals.local']);
  expect(Object.keys(mockHooks.activation)).toEqual(['meals.outbox']);
  expect(registeredHealthWipeHookIds()).toContain('meals.memory');
  expect(register.MEAL_LOCAL_FILES).toEqual(['mealOutbox', 'tray', 'foods']);
});

describe('a health wipe', () => {
  it('forgets the queue and the food lists in memory, and leaves no folder', async () => {
    setMealApi(fakeMealApi({ presets: async () => PRESETS, myFoods: () => Promise.reject(new Error('offline')) }));
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    await enqueueMeal(body(), 'key-1', MEMBER);
    expect(useMealOutbox.getState().items).toHaveLength(1);
    expect(useMealFoodsCache.getState().presets).not.toBeNull();

    await runHealthWipeHooks({ profileId: MEMBER, reason: 'withdrawn' });
    await localStore.settled();
    expect(useMealOutbox.getState().items).toEqual([]);
    expect(useMealFoodsCache.getState().presets).toBeNull();
    expect(fileSystemState.exists(FOLDER)).toBe(false);
  });

  it('a meal refused while the wipe waits, and a tray saved then, leave nothing on disk', async () => {
    signedIn();
    seedMemberFiles();
    let refuse: (error: ApiError) => void = () => undefined;
    setMealApi(fakeMealApi({ createMeal: () => new Promise<MealWriteResult>((_resolve, reject) => (refuse = reject)) }));
    await activateMealOutbox({ profileId: MEMBER });
    const flushing = flushMealOutbox({ foreground: false });

    const release = holdWipeBeforeHooks();
    const wiping = useHealthStore.getState().wipeLocal({ profileId: MEMBER, reason: 'minor' });
    await localStore.settled();
    expect(fileSystemState.exists(FOLDER)).toBe(false);

    // The window: the send's answer marks the meal failed and writes the
    // queue after the deletion; a tray save lands there too.
    refuse(problem('health_minor_blocked', 403));
    await flushing;
    await expect(saveTray({ items: [], slot: 'lunch', date: '2026-10-18', source: null, savedAt: new Date() }, MEMBER)).resolves.toBe(true);
    await localStore.settled();
    expect(fileSystemState.read(`${FOLDER}/meal-outbox.json`)).not.toBeNull();
    expect(fileSystemState.read(`${FOLDER}/tray.json`)).not.toBeNull();

    release();
    await wiping;
    await localStore.settled();
    expect(fileSystemState.exists(FOLDER)).toBe(false);
    expect(useMealOutbox.getState().items).toEqual([]);
  });

  it('a My foods answer that lands while the wipe waits leaves no foods file', async () => {
    let answerMine: (value: MyFoods) => void = () => undefined;
    setMealApi(fakeMealApi({ presets: async () => PRESETS, myFoods: async () => EMPTY_MY_FOODS }));
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    await localStore.settled();
    setMealApi(fakeMealApi({ myFoods: () => new Promise<MyFoods>((resolve) => (answerMine = resolve)) }));
    refreshMineFoods();

    const release = holdWipeBeforeHooks();
    const wiping = useHealthStore.getState().wipeLocal({ profileId: MEMBER, reason: 'withdrawn_elsewhere' });
    await localStore.settled();
    expect(fileSystemState.exists(FOLDER)).toBe(false);

    answerMine({ ...EMPTY_MY_FOODS });
    await nextTurn();
    await localStore.settled();
    expect(fileSystemState.read(`${FOLDER}/foods.json`)).not.toBeNull();

    release();
    await wiping;
    await localStore.settled();
    expect(fileSystemState.exists(FOLDER)).toBe(false);
    expect(useMealFoodsCache.getState().mine).toBeNull();
  });

  it('that names nobody still removes the meal files of the queue that was open', async () => {
    seedMemberFiles();
    await enqueueMeal(body(), 'key-1', MEMBER);
    await runHealthWipeHooks({ profileId: null, reason: 'signout' });
    await localStore.settled();
    expect(memberFiles()).toEqual([null, null, null]);
    expect(useMealOutbox.getState().items).toEqual([]);
  });
});

describe('a sign-out', () => {
  it('removes the member’s meal files and memory', async () => {
    seedMemberFiles();
    await enqueueMeal(body(), 'key-1', MEMBER);
    await mockHooks.signOut['meals.local']?.({ memberId: MEMBER });
    await localStore.settled();
    expect(memberFiles()).toEqual([null, null, null]);
    expect(useMealOutbox.getState().items).toEqual([]);
  });

  it('that names nobody still removes the files of the queue that was open', async () => {
    seedMemberFiles();
    await enqueueMeal(body(), 'key-1', MEMBER);
    await mockHooks.signOut['meals.local']?.({ memberId: null });
    await localStore.settled();
    expect(memberFiles()).toEqual([null, null, null]);
  });
});

it('an activation loads the member’s queue and sends it in the background', async () => {
  seedMemberFiles();
  const createMeal = jest.fn(async (): Promise<MealWriteResult> => ({ meal: {} as MealWriteResult['meal'], replayed: false }));
  setMealApi(fakeMealApi({ createMeal }));
  await mockHooks.activation['meals.outbox']?.({ memberId: MEMBER, trigger: 'foreground' });
  expect(createMeal).toHaveBeenCalledWith(body(), 'key-a');
  expect(useMealOutbox.getState().items).toEqual([]);
});

// ---------------------------------------------------------------------------
// Plan's failed-item banner (see ../register.ts)
//
// PLAN-1 owns the bridge (src/features/plan/shell/bridges.ts) and exports it
// through its feature index (the boundary rule leaves only `../plan` open);
// ../register.ts installs the meal source into it at module load.

/** The part of PLAN-1's feature index this checks. */
interface PlanFeatureIndex {
  readonly installedOutboxes?: () => readonly {
    failedItems(): readonly { readonly id: string; readonly kind: string }[];
    discard(item: { readonly id: string; readonly kind: 'workout' | 'meal' }): Promise<void>;
  }[];
}

const planBridgesOnThisBranch = existsSync(join(__dirname, '../../plan/shell/bridges.ts'));

(planBridgesOnThisBranch ? it : it.skip)('installs the meal half of Plan’s failed-item banner, which lists and discards a failed meal', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the bridge exists only once PLAN-1 is merged
  const plan = require('../../plan') as PlanFeatureIndex;
  expect(typeof plan.installedOutboxes).toBe('function');
  const source = plan.installedOutboxes?.().find((installed) => installed === mealOutboxPlanSource);
  // register.ts calls installPlanOutbox('meal', mealOutboxPlanSource).
  expect(source).toBe(mealOutboxPlanSource);
  seedMemberFiles([entry('f', 'failed')]);
  await activateMealOutbox({ profileId: MEMBER });
  expect(source?.failedItems()).toEqual([{ id: 'f', kind: 'meal' }]);
  await source?.discard({ id: 'f', kind: 'meal' });
  expect(useMealOutbox.getState().items).toEqual([]);
});
