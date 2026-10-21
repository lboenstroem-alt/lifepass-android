/**
 * The meal and food API: what each of the 13 calls SENDS (checked against
 * the contract), what it reads back, and the rules iOS keeps for every meal
 * call: no cache, the caller's Idempotency-Key on writes and none on the two
 * read POSTs, food words and barcodes only in a body, the iOS ceilings, the
 * public presets without a session, a retried delete that already happened.
 * Includes iOS MealDescribeTests `testTheDescriptionIsAPostBodyWithAKeyAndNothingInTheURL`.
 */
import { sampleResponse } from '@test/contract';
import { api, Reply } from '@test/server';

import { apiClient, isProblem, ProblemError } from '../../../../api';
import { expectSentToMatchContract, installStubApiClient, replyFromContract, stubApiClientPerTest } from '../../../../api/testing';
import { decodeFoodPresets, decodeMealDayRecord, decodeMealWriteResult, decodeMyFoods, decodeFoodSearchResult, draftInput, quickAddDraft, type MealCreateBody } from '../../types';
import {
  BARCODE_TIMEOUT_MS,
  DESCRIBE_TIMEOUT_MS,
  liveMealApi,
  MEAL_SESSION_TIMEOUT_MS,
  MEAL_TIMEOUT_MS,
  mealApi,
  mealLocale,
  SCAN_TIMEOUT_MS,
  setMealApi,
  type MealApi,
} from '..';

stubApiClientPerTest();

const MEAL_ID = '9b2f6a2e-3c1d-4e5f-8a7b-1c2d3e4f5a6b';
const LOGGED_AT = new Date(Date.UTC(2026, 9, 16, 12, 40, 0));

const mealJSON = {
  id: MEAL_ID,
  logDate: '2026-10-16',
  loggedAt: '2026-10-16T12:40:00.000Z',
  slot: 'lunch',
  source: 'text',
  confirmed: false,
  confidence: 'low',
  needsConfirm: true,
  hasEstimate: true,
  items: [],
  totals: { kcalLow: 294, kcalHigh: 546, proteinG: 17.2, carbsG: 36.1, fatG: 20.7, mealCount: 1 },
  createdAt: '2026-10-16T12:40:00.000Z',
  updatedAt: '2026-10-16T12:40:00.123Z',
};

function createBody(): MealCreateBody {
  return {
    slot: 'lunch',
    loggedAt: LOGGED_AT,
    logDate: '2026-10-16',
    source: 'quick_add',
    items: [draftInput(quickAddDraft({ label: 'Soup', kcal: 320, protein: null, carbs: null, fat: null, servingLabel: '1 serving' }))],
  };
}

/** The ceiling each call passed to the client. */
function spyTimeouts(): { timeouts: () => (number | undefined)[]; restore: () => void } {
  const spies = (['get', 'post', 'patch', 'delete'] as const).map((verb) => jest.spyOn(apiClient, verb));
  return {
    timeouts: () =>
      spies.flatMap((spy) => spy.mock.calls.map((call) => (call[2] as { timeoutMs?: number } | undefined)?.timeoutMs)),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

describe('the describe call (MealDescribeTests)', () => {
  it('is a POST body with a key and nothing in the URL (testTheDescriptionIsAPostBodyWithAKeyAndNothingInTheURL)', async () => {
    api.on('POST', '/health/meals/describe', Reply.ok({ meal: mealJSON, noFood: false, needsConfirm: true, describesLeftToday: 14, replayed: false }, 201));
    const post = jest.spyOn(apiClient, 'post');
    const result = await liveMealApi.describe(
      { text: 'Focaccia sandwich with mozzarella and pesto', slot: 'lunch', logDate: '2026-10-16', loggedAt: LOGGED_AT, locale: 'en' },
      'key-1-describe',
    );
    expect(post.mock.calls[0][2]?.timeoutMs).toBe(DESCRIBE_TIMEOUT_MS);
    expect(DESCRIBE_TIMEOUT_MS).toBe(20_000);
    post.mockRestore();

    expect(api.requests).toHaveLength(1);
    const sent = expectSentToMatchContract('POST', '/health/meals/describe');
    expect(sent.method).toBe('POST');
    expect(sent.query).toEqual({});
    expect(sent.headers['idempotency-key']).toBe('key-1-describe');
    const body = sent.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['locale', 'logDate', 'loggedAt', 'slot', 'text']);
    expect(body).toEqual({
      text: 'Focaccia sandwich with mozzarella and pesto',
      slot: 'lunch',
      logDate: '2026-10-16',
      loggedAt: '2026-10-16T12:40:00Z',
      locale: 'en',
    });
    expect(sent.url.toLowerCase()).not.toContain('focaccia');
    expect(Object.values(sent.headers).some((value) => value.toLowerCase().includes('focaccia'))).toBe(false);

    expect(result.meal?.id).toBe(MEAL_ID);
    expect(result.meal?.source).toBe('text');
    expect(result.meal?.confirmed).toBe(false);
    expect(result.describesLeftToday).toBe(14);
    expect(result.replayed).toBe(false);
    expect(result.needsConfirm).toBe(true);
  });
});

describe('the foods', () => {
  it('presets are public: sent with a token when there is one, read without one, never cached', async () => {
    api.on('GET', '/health/foods/quick', replyFromContract('GET', '/health/foods/quick', 200, 'full'));
    const presets = await liveMealApi.presets('is');
    expect(presets.foods.length).toBeGreaterThan(0);
    let sent = expectSentToMatchContract('GET', '/health/foods/quick');
    expect(sent.query).toEqual({ locale: 'is' });
    expect(sent.headers.authorization).toBe('Bearer test-token');
    expect(sent.headers['cache-control']).toBe('no-store');

    const signedOut = installStubApiClient({ token: null });
    try {
      await liveMealApi.presets('de');
      sent = api.sent('/health/foods/quick');
      expect(sent.headers.authorization).toBeUndefined();
      expect(sent.query).toEqual({ locale: 'en' });
      expect(sent.headers['cache-control']).toBe('no-store');
    } finally {
      signedOut.restore();
    }
  });

  it('my foods ask in the account language', async () => {
    api.on('GET', '/health/foods/mine', replyFromContract('GET', '/health/foods/mine', 200, 'full'));
    const mine = await liveMealApi.myFoods('en');
    expect(mine.recents.length).toBeGreaterThan(0);
    const sent = expectSentToMatchContract('GET', '/health/foods/mine');
    expect(sent.query).toEqual({ locale: 'en' });
    expect(sent.headers['cache-control']).toBe('no-store');
  });

  it('a search is a POST whose words stay in the body, trimmed and capped at 60 characters, with no key', async () => {
    api.on('POST', '/health/foods/search', replyFromContract('POST', '/health/foods/search', 200, 'full'));
    await liveMealApi.search('   skyr með bláberjum  \n', 'is');
    let sent = expectSentToMatchContract('POST', '/health/foods/search');
    expect(sent.body).toEqual({ q: 'skyr með bláberjum', locale: 'is' });
    expect(sent.query).toEqual({});
    expect(sent.headers['idempotency-key']).toBeUndefined();
    expect(sent.url).not.toContain('skyr');

    await liveMealApi.search(`${'a'.repeat(59)}🍕🍕`, 'en');
    sent = api.sent('/health/foods/search');
    expect((sent.body as { q: string }).q).toBe(`${'a'.repeat(59)}🍕`);
  });

  it('a barcode is a POST with an 8 second ceiling and no key', async () => {
    api.on('POST', '/health/foods/barcode', replyFromContract('POST', '/health/foods/barcode', 200, 'full'));
    const timeouts = spyTimeouts();
    const result = await liveMealApi.barcode('5690519000011', 'en');
    expect(timeouts.timeouts()).toEqual([BARCODE_TIMEOUT_MS]);
    expect(BARCODE_TIMEOUT_MS).toBe(8_000);
    timeouts.restore();
    expect(result.food).not.toBeNull();
    const sent = expectSentToMatchContract('POST', '/health/foods/barcode');
    expect(sent.body).toEqual({ barcode: '5690519000011', locale: 'en' });
    expect(sent.url).not.toContain('5690519000011');
    expect(sent.headers['idempotency-key']).toBeUndefined();
  });

  it('hiding one of my foods carries the caller key', async () => {
    api.on('POST', '/health/foods/mine/hide', Reply.ok({ ok: true }));
    await liveMealApi.hideFood('food:skyr-plain', 'hide-key-123');
    const sent = expectSentToMatchContract('POST', '/health/foods/mine/hide');
    expect(sent.body).toEqual({ key: 'food:skyr-plain' });
    expect(sent.headers['idempotency-key']).toBe('hide-key-123');
  });
});

describe('the meals', () => {
  it('a new meal is posted with the caller key and the strict item shape', async () => {
    api.on('POST', '/health/meals', Reply.ok({ meal: mealJSON, replayed: false }, 201));
    const result = await liveMealApi.createMeal(createBody(), 'create-key-1');
    expect(result.meal.updatedAt).toBe('2026-10-16T12:40:00.123Z');
    const sent = expectSentToMatchContract('POST', '/health/meals');
    expect(sent.headers['idempotency-key']).toBe('create-key-1');
    expect(sent.body).toEqual({
      slot: 'lunch',
      loggedAt: '2026-10-16T12:40:00Z',
      logDate: '2026-10-16',
      source: 'quick_add',
      items: [
        {
          source: 'quick_add',
          label: 'Soup',
          serving: { unit: 'serving', label: '1 serving', grams: null },
          amount: 1,
          perServing: { kcal: 320, proteinG: null, carbsG: null, fatG: null },
          confirmed: true,
        },
      ],
    });
  });

  it('an edit sends only what changed, with updatedAt byte for byte', async () => {
    api.on('PATCH', '/health/meals/:mealId', Reply.ok({ meal: mealJSON, replayed: false }));
    await liveMealApi.patchMeal(MEAL_ID, { confirmed: true, expectedUpdatedAt: '2026-10-16T12:40:00.123Z' }, 'patch-key-1');
    const sent = expectSentToMatchContract('PATCH', `/health/meals/${MEAL_ID}`);
    expect(sent.body).toEqual({ confirmed: true, expectedUpdatedAt: '2026-10-16T12:40:00.123Z' });
    expect(sent.headers['idempotency-key']).toBe('patch-key-1');
  });

  it('a copy names the day, the time and the slot', async () => {
    api.on('POST', '/health/meals/:mealId/copy', Reply.ok({ meal: mealJSON, replayed: false }, 201));
    await liveMealApi.copyMeal(MEAL_ID, { logDate: '2026-10-17', loggedAt: LOGGED_AT, slot: 'dinner' }, 'copy-key-1');
    const sent = expectSentToMatchContract('POST', `/health/meals/${MEAL_ID}/copy`);
    expect(sent.body).toEqual({ logDate: '2026-10-17', loggedAt: '2026-10-16T12:40:00Z', slot: 'dinner' });
    expect(sent.headers['idempotency-key']).toBe('copy-key-1');
  });

  it('one meal and one day are read in the account language', async () => {
    api.on('GET', '/health/meals/:mealId', Reply.ok({ meal: mealJSON }));
    api.on('GET', '/health/meals', replyFromContract('GET', '/health/meals', 200, 'full'));
    const meal = await liveMealApi.meal(MEAL_ID, 'is');
    expect(meal.id).toBe(MEAL_ID);
    expect(expectSentToMatchContract('GET', `/health/meals/${MEAL_ID}`).query).toEqual({ locale: 'is' });
    const day = await liveMealApi.mealDay('2026-10-16', 'en');
    expect(day.meals.length).toBeGreaterThan(0);
    expect(expectSentToMatchContract('GET', '/health/meals').query).toEqual({ locale: 'en', date: '2026-10-16' });
  });

  it('a retried delete that answers 404 health_meal_not_found already happened', async () => {
    api.once('DELETE', '/health/meals/:mealId', Reply.ok({ ok: true }));
    await expect(liveMealApi.deleteMeal(MEAL_ID)).resolves.toBeUndefined();
    expectSentToMatchContract('DELETE', `/health/meals/${MEAL_ID}`);
    api.once('DELETE', '/health/meals/:mealId', Reply.problem(404, 'health-meal-not-found'));
    await expect(liveMealApi.deleteMeal(MEAL_ID)).resolves.toBeUndefined();
    api.once('DELETE', '/health/meals/:mealId', Reply.problem(409, 'health_consent_required'));
    await expect(liveMealApi.deleteMeal(MEAL_ID)).rejects.toBeInstanceOf(ProblemError);
  });

  it('a photo scan is posted once with its key and a 20 second ceiling', async () => {
    api.on('POST', '/health/meals/scan', Reply.problem(429, 'meal-scan-daily-limit'));
    const timeouts = spyTimeouts();
    const error = await liveMealApi
      .scan({ image: { mediaType: 'image/jpeg', dataBase64: 'A'.repeat(128) }, slot: 'dinner', logDate: '2026-10-16', loggedAt: LOGGED_AT }, 'scan-key-1')
      .catch((caught: unknown) => caught);
    expect(timeouts.timeouts()).toEqual([SCAN_TIMEOUT_MS]);
    timeouts.restore();
    // Never retried here, whatever the answer.
    expect(api.sentAll('/health/meals/scan')).toHaveLength(1);
    // The slug from the type URL matches in either spelling.
    expect(isProblem(error, 'meal_scan_daily_limit')).toBe(true);
    const sent = expectSentToMatchContract('POST', '/health/meals/scan');
    expect(sent.headers['idempotency-key']).toBe('scan-key-1');
    expect(Object.keys(sent.body as object).sort()).toEqual(['image', 'logDate', 'loggedAt', 'slot']);
  });

  it('uses iOS patience: 20 s for the reads and writes that name it, 30 s for the rest', async () => {
    expect(MEAL_TIMEOUT_MS).toBe(20_000);
    expect(MEAL_SESSION_TIMEOUT_MS).toBe(30_000);
    api.on('POST', '/health/meals', Reply.ok({ meal: mealJSON, replayed: false }, 201));
    api.on('GET', '/health/meals/:mealId', Reply.ok({ meal: mealJSON }));
    api.on('DELETE', '/health/meals/:mealId', Reply.ok({ ok: true }));
    api.on('POST', '/health/foods/mine/hide', Reply.ok({ ok: true }));
    const timeouts = spyTimeouts();
    await liveMealApi.createMeal(createBody(), 'create-key-2');
    await liveMealApi.meal(MEAL_ID, 'en');
    await liveMealApi.deleteMeal(MEAL_ID);
    await liveMealApi.hideFood('food:skyr-plain', 'hide-key-456');
    expect(timeouts.timeouts().sort()).toEqual([20_000, 30_000, 30_000, 30_000]);
    timeouts.restore();
  });
});

describe('the contract samples decode', () => {
  it.each(['minimal', 'full'] as const)('every %s answer reads', (mode) => {
    expect(() => decodeFoodPresets(sampleResponse('GET', '/health/foods/quick', 200, mode), 'p')).not.toThrow();
    expect(() => decodeMyFoods(sampleResponse('GET', '/health/foods/mine', 200, mode), 'm')).not.toThrow();
    expect(() => decodeFoodSearchResult(sampleResponse('POST', '/health/foods/search', 200, mode), 's')).not.toThrow();
    expect(() => decodeMealDayRecord(sampleResponse('GET', '/health/meals', 200, mode), 'd')).not.toThrow();
    expect(() => decodeMealWriteResult(sampleResponse('POST', '/health/meals', 201, mode), 'w')).not.toThrow();
  });
});

describe('the provider', () => {
  afterEach(() => setMealApi(null));

  it('swaps in a fake and puts the live one back', () => {
    expect(mealApi()).toBe(liveMealApi);
    const fake = { ...liveMealApi } as MealApi;
    setMealApi(fake);
    expect(mealApi()).toBe(fake);
    setMealApi(null);
    expect(mealApi()).toBe(liveMealApi);
  });

  it('anything that is not Icelandic asks in English', () => {
    expect(mealLocale('is')).toBe('is');
    expect(mealLocale('en')).toBe('en');
    expect(mealLocale('de')).toBe('en');
  });
});
