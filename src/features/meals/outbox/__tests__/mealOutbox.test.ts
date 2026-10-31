/**
 * The meal outbox store: the iOS MealOutbox behaviour (the queue per member,
 * ten at most, oldest first, the flush steps, the seven-day expiry, the
 * reload after a background send for today, Plan's half of the failed-item
 * banner) and the OutboxAdoptionTests end to end: a queue whose file could
 * not be read is never written over, and a meal queued meanwhile is merged.
 */
import { File } from 'expo-file-system';
import { fileSystemState } from '@test/mocks/expoFileSystem';

import { HttpStatusError, ProblemError, TransportError, type ApiError } from '../../../../api';
import { decodeProfile, type Profile } from '../../../../api/profile';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests, useHealthStore, type HealthStore } from '../../../../health/store';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { setMealApi, type MealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { openFoodsCache, resetFoodsCacheMemory, useMealFoodsCache } from '../../foodsCache';
import { EMPTY_MY_FOODS, type FoodPresets, type MealCreateBody, type MealWriteResult } from '../../types';
import {
  activateMealOutbox,
  adoptMealQueue,
  decodeOutboxQueue,
  discardMealOutboxItem,
  encodeOutboxItem,
  enqueueMeal,
  failedMealItems,
  flushMealOutbox,
  isMealOutboxFull,
  MEAL_OUTBOX_CHANGED_TOAST,
  mealOutboxPlanSource,
  pendingMealsOn,
  resetMealOutboxForTests,
  useMealOutbox,
} from '../mealOutbox';
import type { MealOutboxItem } from '../rules';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';
const TODAY = todayServerDay();
const YESTERDAY = addServerDays(TODAY, -1) ?? TODAY;
const DAY_MS = 86_400_000;

function problem(slug: string, status: number): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

function body(logDate: string = YESTERDAY, slot = 'lunch'): MealCreateBody {
  return { slot, loggedAt: new Date(Date.UTC(2026, 8, 22, 12, 0)), logDate, source: 'quick_add', items: [] };
}

function entry(id: string, overrides: Partial<MealOutboxItem> = {}): MealOutboxItem {
  return { id, body: body(), key: `key-${id}`, createdAt: new Date(), state: 'pending', ...overrides };
}

/** The queue as it sits on disk for `member`, or null when there is no file. */
function onDisk(member: string = MEMBER): MealOutboxItem[] | null {
  const text = fileSystemState.read(`health/${member}/meal-outbox.json`);
  return text === undefined || text === null ? null : decodeOutboxQueue(JSON.parse(text));
}

function seedQueue(items: readonly MealOutboxItem[], member: string = MEMBER): void {
  fileSystemState.seed(`health/${member}/meal-outbox.json`, JSON.stringify(items.map(encodeOutboxItem)));
}

const written = (): MealWriteResult => ({ meal: {} as MealWriteResult['meal'], replayed: false });

/** `createMeal` answering each call in turn (an Error rejects). */
function createMealAnswering(...answers: (ApiError | 'ok')[]): jest.Mock<Promise<MealWriteResult>, [MealCreateBody, string]> {
  const queue = [...answers];
  return jest.fn(async (_body: MealCreateBody, _key: string) => {
    const next = queue.shift() ?? 'ok';
    if (next === 'ok') return written();
    throw next;
  });
}

function useApi(overrides: Partial<MealApi>): void {
  setMealApi(fakeMealApi(overrides));
}

function profile(health: Record<string, unknown> | null = { access: 'entitled', consent: { version: '2026-09-v1' } }): Profile {
  return decodeProfile({ id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false, ...(health ? { health } : {}) });
}

let events: { event: string; params: Record<string, unknown> }[] = [];
const original: Pick<HealthStore, 'handle' | 'load'> = {
  handle: useHealthStore.getState().handle,
  load: useHealthStore.getState().load,
};

beforeEach(() => {
  resetMealOutboxForTests();
  resetFoodsCacheMemory();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  useHealthStore.setState({ handle: original.handle, load: original.load });
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params: { ...params } }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setMealApi(null);
  await localStore.settled();
});

describe('queueing a meal', () => {
  it('keeps it in memory and on disk with its key, and reports it', async () => {
    await expect(enqueueMeal(body(), 'key-1', MEMBER)).resolves.toBe(true);
    const items = useMealOutbox.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ key: 'key-1', state: 'pending', body: body() }));
    await localStore.settled();
    expect(onDisk()?.map((item) => item.key)).toEqual(['key-1']);
    expect(events).toContainEqual({ event: 'meal_outbox_queued', params: {} });
  });

  it('takes ten at most; the eleventh is refused so the caller keeps its tray', async () => {
    for (let index = 0; index < 10; index += 1) {
      await expect(enqueueMeal(body(), `key-${index}`, MEMBER)).resolves.toBe(true);
    }
    expect(isMealOutboxFull()).toBe(true);
    await expect(enqueueMeal(body(), 'key-10', MEMBER)).resolves.toBe(false);
    await localStore.settled();
    expect(onDisk()).toHaveLength(10);
  });

  it('adds to the queue already on disk rather than starting a new one', async () => {
    seedQueue([entry('a'), entry('b')]);
    await enqueueMeal(body(), 'key-c', MEMBER);
    await localStore.settled();
    expect(onDisk()?.map((item) => item.key)).toEqual(['key-a', 'key-b', 'key-c']);
  });

  it('never mixes two accounts on one phone', async () => {
    await enqueueMeal(body(), 'key-a', MEMBER);
    await enqueueMeal(body(), 'key-b', OTHER);
    await localStore.settled();
    expect(onDisk(MEMBER)?.map((item) => item.key)).toEqual(['key-a']);
    expect(onDisk(OTHER)?.map((item) => item.key)).toEqual(['key-b']);
    expect(useMealOutbox.getState().items.map((item) => item.key)).toEqual(['key-b']);
  });

  it('lists a date’s waiting meals oldest first, and the failed ones for Plan', () => {
    const queue = [
      entry('late', { createdAt: new Date(2_000), body: body(TODAY) }),
      entry('other-day', { createdAt: new Date(500), body: body(YESTERDAY) }),
      entry('early', { createdAt: new Date(1_000), body: body(TODAY), state: 'failed' }),
    ];
    expect(pendingMealsOn(TODAY, queue).map((item) => item.id)).toEqual(['early', 'late']);
    expect(failedMealItems(queue).map((item) => item.id)).toEqual(['early']);
  });
});

describe('a queue whose file cannot be read (OutboxAdoptionTests)', () => {
  it('a meal queued meanwhile does not overwrite the queue and is merged on the next read', async () => {
    seedQueue([entry('a'), entry('b')]);
    const text = jest.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('EIO'));

    await expect(enqueueMeal(body(), 'key-c', MEMBER)).resolves.toBe(true);
    text.mockRestore();
    expect(useMealOutbox.getState().items.map((item) => item.key)).toEqual(['key-c']);
    // The file was never written over.
    await localStore.settled();
    expect(onDisk()?.map((item) => item.id)).toEqual(['a', 'b']);
    // Nothing is sent from a queue that is not this member's file yet.
    const createMeal = createMealAnswering();
    useApi({ createMeal });
    await flushMealOutbox({ foreground: true });
    expect(createMeal).not.toHaveBeenCalled();

    // Readable again: the disk queue first, then the meal queued meanwhile, written through.
    await adoptMealQueue(MEMBER);
    expect(useMealOutbox.getState().items.map((item) => item.key)).toEqual(['key-a', 'key-b', 'key-c']);
    await localStore.settled();
    const merged = onDisk() ?? [];
    expect(merged.map((item) => item.key)).toEqual(['key-a', 'key-b', 'key-c']);

    // Emptied, the queue leaves no file.
    for (const item of merged) discardMealOutboxItem(item.id);
    await localStore.settled();
    expect(onDisk()).toBeNull();
  });

  it('an activation reads it again rather than taking it for empty', async () => {
    seedQueue([entry('a')]);
    const text = jest.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('EIO'));
    await activateMealOutbox({ profileId: MEMBER });
    text.mockRestore();
    expect(useMealOutbox.getState().items).toEqual([]);
    await activateMealOutbox({ profileId: MEMBER });
    expect(useMealOutbox.getState().items.map((item) => item.id)).toEqual(['a']);
  });
});

describe('the flush', () => {
  it('sends oldest first, one at a time, each with the key minted at Save, and empties the file', async () => {
    seedQueue([entry('a', { createdAt: new Date(Date.now() - 2_000) }), entry('b', { createdAt: new Date(Date.now() - 1_000) })]);
    const createMeal = createMealAnswering('ok', 'ok');
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(createMeal.mock.calls.map((call) => call[1])).toEqual(['key-a', 'key-b']);
    expect(createMeal.mock.calls[0]?.[0]).toEqual(body());
    expect(useMealOutbox.getState().items).toEqual([]);
    await localStore.settled();
    expect(onDisk()).toBeNull();
    expect(events.filter((e) => e.event === 'meal_outbox_flushed')).toEqual([
      { event: 'meal_outbox_flushed', params: { outcome: 'sent' } },
      { event: 'meal_outbox_flushed', params: { outcome: 'sent' } },
    ]);
  });

  it('no network keeps everything and stops at the first meal', async () => {
    seedQueue([entry('a'), entry('b')]);
    const createMeal = createMealAnswering(new TransportError('offline'));
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(createMeal).toHaveBeenCalledTimes(1);
    expect(useMealOutbox.getState().items.map((item) => [item.id, item.state])).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
    ]);
  });

  it('a cancellation stops too, and keeps the meal', async () => {
    seedQueue([entry('a'), entry('b')]);
    const createMeal = createMealAnswering(new TransportError('cancelled'));
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(createMeal).toHaveBeenCalledTimes(1);
    expect(useMealOutbox.getState().items).toHaveLength(2);
  });

  it('drops what the server will never take, says something changed, and goes on', async () => {
    seedQueue([entry('a'), entry('b')]);
    const createMeal = createMealAnswering(problem('idempotency_key_reused', 409), 'ok');
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(createMeal).toHaveBeenCalledTimes(2);
    expect(useMealOutbox.getState().items).toEqual([]);
    expect(useHealthStore.getState().toastKey).toBe(MEAL_OUTBOX_CHANGED_TOAST);
  });

  it('marks a refused meal failed on disk, never sends it again, and never drops it for an edge page', async () => {
    seedQueue([entry('a'), entry('b')]);
    const createMeal = createMealAnswering(new HttpStatusError(403, '<html>'), problem('no_active_plan_or_pass', 403));
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(failedMealItems().map((item) => item.id)).toEqual(['a', 'b']);
    await localStore.settled();
    expect(onDisk()?.map((item) => item.state)).toEqual(['failed', 'failed']);
    expect(events).toContainEqual({ event: 'meal_outbox_flushed', params: { outcome: 'failed' } });

    await flushMealOutbox({ foreground: true });
    expect(createMeal).toHaveBeenCalledTimes(2);
  });

  it('a background consent refusal hands the health store a reconcile, never a sheet, and stops', async () => {
    const handle = jest.fn<ReturnType<HealthStore['handle']>, Parameters<HealthStore['handle']>>(() => 'reconciling');
    useHealthStore.setState({ handle });
    useAppStore.setState({ healthAccess: 'entitled' });
    seedQueue([entry('a'), entry('b')]);
    const refusal = problem('health_consent_required', 409);
    const createMeal = createMealAnswering(refusal);
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(handle).toHaveBeenCalledWith(refusal, { foreground: false });
    expect(createMeal).toHaveBeenCalledTimes(1);
    expect(useMealOutbox.getState().items.map((item) => item.state)).toEqual(['pending', 'pending']);
  });

  it('drops a meal queued more than seven days ago, with the changed toast', async () => {
    const now = new Date();
    seedQueue([entry('old', { createdAt: new Date(now.getTime() - 8 * DAY_MS) }), entry('new', { createdAt: new Date(now.getTime() - DAY_MS) })]);
    const createMeal = createMealAnswering(new TransportError('offline'));
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER });
    await flushMealOutbox({ foreground: false, now });
    expect(useMealOutbox.getState().items.map((item) => item.id)).toEqual(['new']);
    expect(useHealthStore.getState().toastKey).toBe(MEAL_OUTBOX_CHANGED_TOAST);
    await localStore.settled();
    expect(onDisk()?.map((item) => item.id)).toEqual(['new']);
  });

  it('after a background send for today, reads the day again so Plan and Home count it', async () => {
    const load = jest.fn<Promise<void>, Parameters<HealthStore['load']>>(async () => undefined);
    useHealthStore.setState({ load });
    const member = profile();
    useAppStore.setState({ isAuthenticated: true, profile: member, healthAccess: 'entitled' });
    seedQueue([entry('a', { body: body(TODAY) })]);
    useApi({ createMeal: createMealAnswering('ok') });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    expect(load).toHaveBeenCalledWith({ force: true, profile: member, language: useAppStore.getState().language });
  });

  it('does not read the day again for another date, for Plan’s own flush, or without consent', async () => {
    const load = jest.fn<Promise<void>, Parameters<HealthStore['load']>>(async () => undefined);
    useHealthStore.setState({ load });
    useAppStore.setState({ isAuthenticated: true, profile: profile(), healthAccess: 'entitled' });
    seedQueue([entry('a', { body: body(YESTERDAY) })]);
    useApi({ createMeal: createMealAnswering('ok', 'ok', 'ok') });
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });

    await enqueueMeal(body(TODAY), 'key-b', MEMBER);
    await flushMealOutbox({ foreground: true });

    useAppStore.setState({ profile: profile({ access: 'entitled', consent: null }) });
    await enqueueMeal(body(TODAY), 'key-c', MEMBER);
    await flushMealOutbox({ foreground: false });
    expect(load).not.toHaveBeenCalled();
    expect(useMealOutbox.getState().items).toEqual([]);
  });

  it('a sent meal refreshes the member’s own foods when the lists are open', async () => {
    const presets: FoodPresets = { libraryVersion: null, foods: [], meals: [], categories: [] };
    const myFoods = jest.fn(async () => EMPTY_MY_FOODS);
    useApi({ presets: async () => presets, myFoods, createMeal: createMealAnswering('ok') });
    await openFoodsCache({ profileId: MEMBER, language: 'en' });
    expect(myFoods).toHaveBeenCalledTimes(1);
    seedQueue([entry('a')]);
    await activateMealOutbox({ profileId: MEMBER, flushNow: true });
    await localStore.settled();
    expect(myFoods).toHaveBeenCalledTimes(2);
    expect(useMealFoodsCache.getState().mine).toEqual(EMPTY_MY_FOODS);
  });

  it('a second flush while one runs returns at once', async () => {
    seedQueue([entry('a')]);
    let answer: (value: MealWriteResult) => void = () => undefined;
    const createMeal = jest.fn(() => new Promise<MealWriteResult>((resolve) => (answer = resolve)));
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER });
    const first = flushMealOutbox({ foreground: false });
    await flushMealOutbox({ foreground: true });
    expect(createMeal).toHaveBeenCalledTimes(1);
    answer(written());
    await first;
    expect(useMealOutbox.getState().items).toEqual([]);
  });

  it('a meal on its way when the member’s data is wiped lands nowhere', async () => {
    seedQueue([entry('a'), entry('b')]);
    let answer: (value: MealWriteResult) => void = () => undefined;
    const createMeal = jest.fn(() => new Promise<MealWriteResult>((resolve) => (answer = resolve)));
    useApi({ createMeal });
    await activateMealOutbox({ profileId: MEMBER });
    const flushing = flushMealOutbox({ foreground: false });
    await localStore.deleteProfileFolder(MEMBER);
    resetMealOutboxForTests();
    answer(written());
    await flushing;
    await localStore.settled();
    expect(createMeal).toHaveBeenCalledTimes(1);
    expect(useMealOutbox.getState().items).toEqual([]);
    expect(onDisk()).toBeNull();
  });
});

describe('Plan’s half of the failed-item banner', () => {
  it('flushes as the member’s own action: a consent refusal waits for them in the banner', async () => {
    useAppStore.setState({ isAuthenticated: true, profile: profile(), healthAccess: 'entitled' });
    seedQueue([entry('a')]);
    useApi({ createMeal: createMealAnswering(problem('health_consent_required', 409)) });
    await mealOutboxPlanSource.flush();
    expect(mealOutboxPlanSource.failedItems()).toEqual([{ id: 'a', kind: 'meal' }]);
  });

  it('discards a meal, tells Plan the queue changed, and leaves a workout to its own outbox', async () => {
    seedQueue([entry('a', { state: 'failed' }), entry('b')]);
    await activateMealOutbox({ profileId: MEMBER });
    const listener = jest.fn();
    const unsubscribe = mealOutboxPlanSource.subscribe(listener);
    await mealOutboxPlanSource.discard({ id: 'b', kind: 'workout' });
    expect(useMealOutbox.getState().items).toHaveLength(2);
    await mealOutboxPlanSource.discard({ id: 'a', kind: 'meal' });
    expect(useMealOutbox.getState().items.map((item) => item.id)).toEqual(['b']);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await localStore.settled();
    expect(onDisk()?.map((item) => item.id)).toEqual(['b']);
  });
});
