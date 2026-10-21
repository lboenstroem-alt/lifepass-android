/**
 * The meal page's model (iOS MealCaptureModel): the 30-day photo rule
 * (MealDescribeTests.testDescribeIsOfferedForTheLast30DaysOnly), the tray
 * and its restore within a day, and the save (OP-34): one key per Save tap,
 * reused by its retry and replaced once on `idempotency_key_reused`, the
 * offline outbox, the meal-level source, `loggedAt`, and every refusal's
 * answer.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import type { ApiError } from '../../../../api';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests } from '../../../../health/store';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { setMealApi } from '../../api';
import { fakeMealApi } from '../../api/testing';
import { resetFoodsCacheMemory } from '../../foodsCache';
import { decodeOutboxQueue, resetMealOutboxForTests, encodeOutboxItem } from '../../outbox';
import { restoreTray, saveTray } from '../../tray';
import { draftFromChoice, quickAddDraft, type MealCreateBody, type MealWriteResult } from '../../types';
import { MealCaptureModel, photoAllowed, resolveSlot, type CapturePageBindings } from '../captureModel';
import { banana, choice, MEMBER, offline, problem, signIn, storedMeal } from './mealFixtures';

jest.mock('../saveFeedback', () => ({ mealSavedFeedback: jest.fn(), showMealToast: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const feedback = require('../saveFeedback') as { mealSavedFeedback: jest.Mock; showMealToast: jest.Mock };

const TODAY = todayServerDay();
const day = (offset: number): string => addServerDays(TODAY, offset) ?? TODAY;

function page(options: Partial<ConstructorParameters<typeof MealCaptureModel>[0]> = {}): {
  model: MealCaptureModel;
  bindings: { [K in keyof CapturePageBindings]: jest.Mock };
} {
  const model = new MealCaptureModel({ origin: 'scanTab', mode: 'search', slot: { kind: 'fixed', slot: 'lunch' }, date: TODAY, ...options });
  const bindings = { close: jest.fn(), showGate: jest.fn(), askConsent: jest.fn(), openDraftRoute: jest.fn() };
  model.bind(bindings);
  return { model, bindings };
}

function answering(...answers: (ApiError | 'ok')[]): jest.Mock<Promise<MealWriteResult>, [MealCreateBody, string]> {
  const queue = [...answers];
  return jest.fn(async (body: MealCreateBody, _key: string) => {
    const next = queue.shift() ?? 'ok';
    if (next !== 'ok') throw next;
    return { meal: storedMeal(body.logDate), replayed: false };
  });
}

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetMealOutboxForTests();
  resetFoodsCacheMemory();
  signIn();
});

afterEach(async () => {
  setMealApi(null);
  setAnalyticsObserver(null);
  await localStore.settled();
});

describe('the 30-day rule (OP-32 and OP-56)', () => {
  it('offers Photo and Describe for the last 30 days only', () => {
    expect(photoAllowed(day(0))).toBe(true);
    expect(photoAllowed(day(-30))).toBe(true);
    expect(photoAllowed(day(-31))).toBe(false);
    expect(photoAllowed(day(-200))).toBe(false);
    expect(page({ date: day(-30) }).model.describeAvailable).toBe(true);
    expect(page({ date: day(-31) }).model.describeAvailable).toBe(false);
  });

  it('opens an older day in Search, and a date change away from the 30 days leaves Photo', () => {
    expect(page({ mode: 'photo', date: day(-45) }).model.state.mode).toBe('search');
    const { model } = page({ mode: 'photo', date: TODAY });
    expect(model.state.mode).toBe('photo');
    model.setDate(day(-40));
    expect(model.state.mode).toBe('search');
    model.setMode('photo');
    expect(model.state.mode).toBe('search');
  });

  it('a slot that is auto follows the phone clock; a fixed one stays', () => {
    expect(resolveSlot({ kind: 'fixed', slot: 'drink' })).toBe('drink');
    expect(resolveSlot({ kind: 'auto' }, new Date(2026, 9, 21, 8, 0))).toBe('breakfast');
    expect(resolveSlot({ kind: 'auto' }, new Date(2026, 9, 21, 12, 0))).toBe('lunch');
  });
});

describe('the tray', () => {
  it('takes its source from the first item, and Undo removes the last batch', () => {
    const { model } = page();
    model.add([draftFromChoice(choice())], 'recent');
    model.add([draftFromChoice(banana()), draftFromChoice(choice())], 'search');
    expect(model.state.tray).toHaveLength(3);
    expect(model.state.traySource).toBe('recent');
    model.undoLastAdd();
    expect(model.state.tray.map((item) => item.label)).toEqual(['Skyr, plain']);
    model.undoLastAdd();
    expect(model.state.tray).toHaveLength(1);
    model.remove(model.state.tray[0]!.localId);
    expect(model.state.traySource).toBeNull();
  });

  it('is written on every change with the slot and date, and removed when it empties', async () => {
    const { model } = page();
    model.add([draftFromChoice(choice())], 'search');
    model.setSlot('dinner');
    await localStore.settled();
    const saved = await restoreTray(MEMBER);
    expect(saved?.slot).toBe('dinner');
    expect(saved?.date).toBe(TODAY);
    expect(saved?.source).toBe('search');
    model.undoLastAdd();
    await localStore.settled();
    expect(fileSystemState.read(`health/${MEMBER}/tray.json`)).toBeFalsy();
  });

  it('comes back within a day with its slot and date (R8), Photo giving way on an old day', async () => {
    await saveTray(
      { items: [draftFromChoice(choice())], slot: 'breakfast', date: day(-40), source: 'preset', savedAt: new Date() },
      MEMBER,
    );
    const { model } = page({ mode: 'photo', slot: { kind: 'fixed', slot: 'lunch' } });
    await expect(model.restoreTray()).resolves.toBe(true);
    expect(model.state.slot).toBe('breakfast');
    expect(model.state.date).toBe(day(-40));
    expect(model.state.traySource).toBe('preset');
    expect(model.state.mode).toBe('search');
  });

  it('is not offered back once a day old, nor to a page opened from a meal editor', async () => {
    await saveTray(
      { items: [draftFromChoice(choice())], slot: 'lunch', date: TODAY, source: 'search', savedAt: new Date(Date.now() - 25 * 3_600_000) },
      MEMBER,
    );
    await expect(page().model.restoreTray()).resolves.toBe(false);
    await saveTray({ items: [draftFromChoice(choice())], slot: 'lunch', date: TODAY, source: 'search', savedAt: new Date() }, MEMBER);
    const editor = page({ origin: 'editor' }).model;
    await expect(editor.restoreTray()).resolves.toBe(false);
    editor.add([draftFromChoice(banana())], 'search');
    await localStore.settled();
    expect((await restoreTray(MEMBER))?.items.map((item) => item.label)).toEqual(['Skyr, plain']);
  });

  it('a page opened from a meal editor hands its items back instead of saving', async () => {
    const createMeal = answering();
    setMealApi(fakeMealApi({ createMeal }));
    const onAddToMeal = jest.fn();
    const { model, bindings } = page({ origin: 'editor', onAddToMeal });
    model.add([draftFromChoice(choice())], 'search');
    await model.commitTray();
    expect(onAddToMeal).toHaveBeenCalledWith([expect.objectContaining({ label: 'Skyr, plain' })]);
    expect(createMeal).not.toHaveBeenCalled();
    expect(model.state.tray).toEqual([]);
    expect(bindings.close).toHaveBeenCalledWith('empty');
  });
});

describe('Save (OP-34)', () => {
  it('sends the slot, date, source of the first item and every item, then closes and clears the tray', async () => {
    const createMeal = answering('ok');
    setMealApi(fakeMealApi({ createMeal }));
    const events: string[] = [];
    setAnalyticsObserver((event) => events.push(event));
    const { model, bindings } = page({ date: day(-2) });
    model.add([quickAddDraft({ label: 'Soup', kcal: 320, protein: null, carbs: null, fat: null, servingLabel: '1 serving' })], 'quick_add');
    model.add([draftFromChoice(choice())], 'search');
    await expect(model.commitTray()).resolves.toMatchObject({ kind: 'saved' });
    const [body, key] = createMeal.mock.calls[0]!;
    expect(body).toMatchObject({ slot: 'lunch', logDate: day(-2), source: 'quick_add' });
    expect(body.items).toHaveLength(2);
    // A past day: this time of day, on that date (the server wants them within one day).
    expect(body.loggedAt.toISOString().slice(0, 10)).toBe(day(-2));
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(model.state.tray).toEqual([]);
    expect(bindings.close).toHaveBeenCalledWith('empty');
    expect(feedback.mealSavedFeedback).toHaveBeenCalledWith(expect.objectContaining({ logDate: day(-2) }));
    expect(events).toEqual(expect.arrayContaining(['meal_logged', 'meal_tray_saved']));
    await localStore.settled();
    expect(fileSystemState.read(`health/${MEMBER}/tray.json`)).toBeFalsy();
  });

  it('logs at the time picked in the review only when it is on the meal’s date', async () => {
    const createMeal = answering('ok', 'ok');
    setMealApi(fakeMealApi({ createMeal }));
    const first = page({ date: day(-1) }).model;
    first.add([draftFromChoice(choice())], 'search');
    const picked = new Date(`${day(-1)}T07:30:00Z`);
    first.setChosenLoggedAt(picked);
    await first.save();
    expect(createMeal.mock.calls[0]![0].loggedAt).toEqual(picked);

    const second = page({ date: day(-1) }).model;
    second.add([draftFromChoice(choice())], 'search');
    second.setChosenLoggedAt(new Date(`${day(-3)}T07:30:00Z`));
    await second.save();
    expect(createMeal.mock.calls[1]![0].loggedAt.toISOString().slice(0, 10)).toBe(day(-1));
  });

  it('a consent refusal asks for consent and the retry sends the SAME key', async () => {
    expect(useAppStore.getState().healthAccess).toBe('entitled');
    const createMeal = answering(problem('health_consent_required', 409), 'ok');
    setMealApi(fakeMealApi({ createMeal }));
    const { model, bindings } = page();
    model.add([draftFromChoice(choice())], 'search');
    await expect(model.commitTray()).resolves.toEqual({ kind: 'failed' });
    expect(bindings.askConsent).toHaveBeenCalledTimes(1);
    expect(model.state.tray).toHaveLength(1);
    const retry = bindings.askConsent.mock.calls[0]![0] as () => Promise<void>;
    await retry();
    expect(createMeal).toHaveBeenCalledTimes(2);
    expect(createMeal.mock.calls[1]![1]).toBe(createMeal.mock.calls[0]![1]);
  });

  it('a new Save tap after a success mints a new key', async () => {
    const createMeal = answering('ok', 'ok');
    setMealApi(fakeMealApi({ createMeal }));
    const { model } = page();
    model.add([draftFromChoice(choice())], 'search');
    await model.save();
    model.add([draftFromChoice(banana())], 'search');
    await model.save();
    expect(createMeal.mock.calls[1]![1]).not.toBe(createMeal.mock.calls[0]![1]);
  });

  it('a key spent on another body is retried ONCE with a fresh key', async () => {
    const createMeal = answering(problem('idempotency_key_reused', 422), problem('idempotency_key_reused', 422));
    setMealApi(fakeMealApi({ createMeal }));
    const { model } = page();
    model.add([draftFromChoice(choice())], 'search');
    await expect(model.save()).resolves.toEqual({ kind: 'failed' });
    expect(createMeal).toHaveBeenCalledTimes(2);
    expect(createMeal.mock.calls[1]![1]).not.toBe(createMeal.mock.calls[0]![1]);
    expect(model.state.saveErrorKey).toBe('common.error_body');
    expect(model.state.isSaving).toBe(false);
  });

  it('offline: the meal waits in the outbox under the Save key, the member is told, and the page closes', async () => {
    const createMeal = answering(offline());
    setMealApi(fakeMealApi({ createMeal }));
    const { model, bindings } = page();
    model.add([draftFromChoice(choice())], 'search');
    await expect(model.commitTray()).resolves.toEqual({ kind: 'queued' });
    await localStore.settled();
    const queue = decodeOutboxQueue(JSON.parse(fileSystemState.read(`health/${MEMBER}/meal-outbox.json`) ?? '[]'));
    expect(queue).toHaveLength(1);
    expect(queue[0]!.key).toBe(createMeal.mock.calls[0]![1]);
    expect(feedback.showMealToast).toHaveBeenCalledWith("Saved on this phone. It will sync when you're back online.");
    expect(model.state.tray).toEqual([]);
    expect(bindings.close).toHaveBeenCalledWith('empty');
  });

  it('offline with ten waiting: the tray stays and the line says why', async () => {
    const full = Array.from({ length: 10 }, (_, index) => ({
      id: `queued-${index}`,
      body: { slot: 'lunch', loggedAt: new Date(), logDate: TODAY, source: 'search', items: [] },
      key: `key-${index}`,
      createdAt: new Date(),
      state: 'pending' as const,
    }));
    fileSystemState.seed(`health/${MEMBER}/meal-outbox.json`, JSON.stringify(full.map(encodeOutboxItem)));
    setMealApi(fakeMealApi({ createMeal: answering(offline()) }));
    const { model, bindings } = page();
    model.add([draftFromChoice(choice())], 'search');
    await expect(model.commitTray()).resolves.toEqual({ kind: 'failed' });
    expect(model.state.saveErrorKey).toBe('meal.outbox.full');
    expect(model.state.tray).toHaveLength(1);
    expect(bindings.close).not.toHaveBeenCalled();
  });

  it('a membership wall closes the page and shows the gate; a pending deletion or a rate limit says so under the tray', async () => {
    const createMeal = answering(
      problem('no_active_plan_or_pass', 403, { memberPricing: 'pass_holder' }),
      problem('account_pending_deletion', 409),
      problem('rate_limited', 429),
      problem('something_else', 500),
    );
    setMealApi(fakeMealApi({ createMeal }));
    const { model, bindings } = page();
    model.add([draftFromChoice(choice())], 'search');
    await model.save();
    expect(bindings.showGate).toHaveBeenCalledWith('pass_only');
    await model.save();
    expect(model.state.saveErrorKey).toBe('health.err.pending_deletion');
    await model.save();
    expect(model.state.saveErrorKey).toBe('health.err.rate_limited');
    await model.save();
    expect(model.state.saveErrorKey).toBe('common.error_body');
  });

  it('a minor closes the page, keeping the tray', async () => {
    setMealApi(fakeMealApi({ createMeal: answering(problem('health_minor_blocked', 403)) }));
    const { model, bindings } = page();
    model.add([draftFromChoice(choice())], 'search');
    await model.save();
    expect(bindings.close).toHaveBeenCalledWith('kept');
  });

  it('never saves twice at once, nor an empty tray', async () => {
    let release: () => void = () => undefined;
    const createMeal = jest.fn(
      (body: MealCreateBody) =>
        new Promise<MealWriteResult>((resolve) => {
          release = () => resolve({ meal: storedMeal(body.logDate), replayed: false });
        }),
    );
    setMealApi(fakeMealApi({ createMeal }));
    const { model } = page();
    await expect(model.save()).resolves.toEqual({ kind: 'failed' });
    model.add([draftFromChoice(choice())], 'search');
    const first = model.save();
    expect(model.state.isSaving).toBe(true);
    await expect(model.save()).resolves.toEqual({ kind: 'failed' });
    release();
    await first;
    expect(createMeal).toHaveBeenCalledTimes(1);
  });
});

describe('drafts', () => {
  it('a draft is kept for the editor and its route pushed', () => {
    const { model, bindings } = page();
    const meal = storedMeal(TODAY, { id: 'draft-1', confirmed: false });
    model.openDraft('draft-1', meal);
    expect(model.state.drafts['draft-1']).toBe(meal);
    expect(bindings.openDraftRoute).toHaveBeenCalledWith('draft-1');
  });
});
