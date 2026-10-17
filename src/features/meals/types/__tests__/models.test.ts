/**
 * The meal wire models: the decode and encode cases of iOS
 * MealItemMathTests (`testUpdatedAtIsKeptExactlyAsTheServerSentIt`,
 * `testOneBadItemDoesNotEmptyTheMeal`) and MealDescribeTests (the answer,
 * the diary day's drafts, the closest flag, the text meal), plus the
 * fail-soft defaults of each `init(from:)` and what each kind of item sends.
 */
import { encodeBody } from '../../../../api/wire';
import {
  allDraftsOf,
  decodeFoodChoice,
  decodeFoodPresets,
  decodeFoodSearchResult,
  decodeMealCreateBody,
  decodeMealDayRecord,
  decodeMealDescribeResult,
  decodeMealItemRecord,
  decodeMealRecord,
  decodeMealScanResult,
  decodeMealWriteResult,
  decodeMyFoods,
  draftFromChoice,
  draftFromIngredient,
  draftFromProduct,
  draftFromRecord,
  draftInput,
  encodeItemInput,
  encodeMealCreateBody,
  encodeMealCreateBodyForDisk,
  encodeMealPatchBody,
  GRAMS_SERVING,
  isChangedFromStored,
  isMealFromDescription,
  isUntouchedEstimate,
  itemNeedsCheck,
  mealItemSummaryOf,
  myFoodsRemoving,
  namedServing,
  quickAddDraft,
  type FoodChoice,
  type MealRecord,
  type OFFSnapshot,
} from '..';

/** iOS MealDescribeTests' `mealJSON`. */
const mealJSON = {
  id: 'meal-text-1',
  logDate: '2026-10-16',
  loggedAt: '2026-10-16T12:40:00.000Z',
  slot: 'lunch',
  source: 'text',
  confirmed: false,
  confidence: 'low',
  needsConfirm: true,
  hasEstimate: true,
  items: [
    {
      id: 'item-1',
      source: 'lifepass_estimate',
      basis: 'estimate',
      label: 'Focaccia sandwich with mozzarella and pesto',
      foodId: 'focaccia-sandwich-mozzarella-pesto',
      serving: { unit: 'g' },
      amount: 175,
      servingOptions: [{ unit: 'g' }],
      per100g: { kcal: 240, proteinG: 9.8, carbsG: 20.6, fatG: 11.8 },
      estimate: { grams: 175, kcalLow: 294, kcalHigh: 546, proteinG: 17.2, carbsG: 36.1, fatG: 20.7 },
      edited: [],
      confidence: 'high',
      confirmed: true,
      liquid: false,
    },
  ],
  totals: { kcalLow: 294, kcalHigh: 546, proteinG: 17.2, carbsG: 36.1, fatG: 20.7, mealCount: 1 },
  createdAt: '2026-10-16T12:40:00.000Z',
  updatedAt: '2026-10-16T12:40:00.123Z',
};

const snapshot: OFFSnapshot = {
  barcode: '5690519000011',
  productName: 'Skyr vanilla',
  productNameLang: 'is',
  brand: 'Ísey',
  per100g: { kcal: 79, proteinG: 9.8, carbsG: 8.9, fatG: null, fibreG: null, sugarsG: 8.6, saturatedFatG: null, saltG: 0.1 },
  energyFromKj: false,
  servingLabel: null,
  servingQuantityG: 170,
  retrievedAt: '2026-10-16T08:00:00Z',
};

describe('a stored meal', () => {
  it('keeps updatedAt exactly as the server sent it (testUpdatedAtIsKeptExactlyAsTheServerSentIt)', () => {
    const meal = decodeMealRecord(
      {
        id: 'm1',
        logDate: '2026-09-22',
        loggedAt: '2026-09-22T12:00:00.123Z',
        slot: 'lunch',
        source: 'search',
        confirmed: true,
        confidence: null,
        needsConfirm: false,
        hasEstimate: false,
        items: [],
        totals: { kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        createdAt: '2026-09-22T12:00:00.123Z',
        updatedAt: '2026-09-22T12:03:04.567Z',
      },
      'meal',
    );
    expect(meal.updatedAt).toBe('2026-09-22T12:03:04.567Z');
    const encoded = encodeBody(encodeMealPatchBody({ items: [], expectedUpdatedAt: meal.updatedAt ?? undefined }));
    expect(encoded).toContain('2026-09-22T12:03:04.567Z');
  });

  it('one bad item does not empty the meal (testOneBadItemDoesNotEmptyTheMeal)', () => {
    const meal = decodeMealRecord(
      {
        id: 'm1',
        logDate: '2026-09-22',
        slot: 'lunch',
        items: [
          { id: 'a', source: 'usda', label: 'Skyr', serving: { unit: 'g' }, amount: 170, servingOptions: [{ unit: 'g' }], confirmed: true, liquid: false },
          { broken: true },
          { id: 'b', source: 'off', label: 'Vanilla skyr', serving: { unit: 'serving', label: '1 tub', grams: 200 }, amount: 1 },
        ],
      },
      'meal',
    );
    expect(meal.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('defaults every missing field the way iOS does', () => {
    const meal = decodeMealRecord({ id: 'm1', slot: 42, items: 'nope', totals: { kcalLow: 1 } }, 'meal');
    expect(meal.slot).toBe('snack');
    expect(meal.confirmed).toBe(true);
    expect(meal.needsConfirm).toBe(false);
    expect(meal.items).toEqual([]);
    expect(meal.totals).toBeNull();
    expect(meal.logDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A slot this build has never heard of is `unknown`, not snack.
    expect(decodeMealRecord({ id: 'm2', slot: 'brunch' }, 'meal').slot).toBe('unknown');

    const item = decodeMealItemRecord({ id: 'i1', serving: 'g', amount: 'two', overrides: { kcal: 'x' } }, 'item');
    expect(item).toMatchObject({ source: 'model', label: '', serving: GRAMS_SERVING, amount: 1, confirmed: true, liquid: false, overrides: null, edited: [] });
    expect(() => decodeMealItemRecord({ source: 'usda' }, 'item')).toThrow();
  });

  it('a text meal is marked and a photo meal is not (testATextMealIsMarkedAndAPhotoMealIsNot)', () => {
    const draft = decodeMealRecord(mealJSON, 'meal');
    expect(isMealFromDescription(draft)).toBe(true);
    expect(draft.confirmed).toBe(false);
    const photo: MealRecord = { ...draft, id: 'p', source: 'photo' };
    expect(isMealFromDescription(photo)).toBe(false);
    expect(mealItemSummaryOf(draft)).toBe('Focaccia sandwich with mozzarella and pesto');
  });
});

describe('the answers', () => {
  it('describe decodes as created, replayed and no food (testTheAnswerDecodesAsCreatedReplayedAndNoFood)', () => {
    const created = decodeMealDescribeResult({ meal: mealJSON, noFood: false, needsConfirm: true, describesLeftToday: 3, replayed: false }, 'r');
    expect(created.meal?.items[0]?.label).toBe('Focaccia sandwich with mozzarella and pesto');
    expect(created.meal?.items[0]?.basis).toBe('estimate');
    expect(created.noFood).toBe(false);

    const replay = decodeMealDescribeResult({ meal: mealJSON, noFood: false, needsConfirm: true, describesLeftToday: 3, replayed: true }, 'r');
    expect(replay.replayed).toBe(true);
    expect(replay.meal?.id).toBe(created.meal?.id);

    const noFood = decodeMealDescribeResult({ meal: null, noFood: true, needsConfirm: false, describesLeftToday: 2, replayed: false }, 'r');
    expect(noFood.meal).toBeNull();
    expect(noFood.noFood).toBe(true);
    expect(noFood.describesLeftToday).toBe(2);

    // A scan-shaped answer by mistake still reads, without a count.
    const scanShaped = decodeMealDescribeResult({ meal: null, noFood: true, needsConfirm: false, scansLeftToday: 5 }, 'r');
    expect(scanShaped.describesLeftToday).toBeNull();
  });

  it('a scan with no meal and no flag is no food', () => {
    const answer = decodeMealScanResult({ scansLeftToday: 4 }, 'r');
    expect(answer).toEqual({ meal: null, noFood: true, needsConfirm: false, scansLeftToday: 4, replayed: null });
  });

  it('a write needs its meal', () => {
    expect(decodeMealWriteResult({ meal: mealJSON, replayed: true }, 'w').meal.id).toBe('meal-text-1');
    expect(() => decodeMealWriteResult({ replayed: false }, 'w')).toThrow();
    expect(() => decodeMealWriteResult([], 'w')).toThrow();
  });
});

describe('the diary day', () => {
  it('reads description drafts in drafts or in a list of their own, once each (testTheDiaryDayReadsDescriptionDraftsEitherWay)', () => {
    const one = decodeMealDayRecord({ date: '2026-10-16', meals: [], drafts: [mealJSON] }, 'day');
    expect(allDraftsOf(one).map((meal) => meal.id)).toEqual(['meal-text-1']);
    expect(isMealFromDescription(allDraftsOf(one)[0])).toBe(true);

    const two = decodeMealDayRecord({ date: '2026-10-16', meals: [], drafts: [], textDrafts: [mealJSON] }, 'day');
    expect(allDraftsOf(two).map((meal) => meal.id)).toEqual(['meal-text-1']);

    const both = decodeMealDayRecord({ date: '2026-10-16', meals: [], drafts: [mealJSON], textDrafts: [mealJSON] }, 'day');
    expect(allDraftsOf(both)).toHaveLength(1);

    const older = decodeMealDayRecord({ date: '2026-10-16', meals: [], drafts: [] }, 'day');
    expect(allDraftsOf(older)).toEqual([]);
  });

  it('an odd target or total costs only itself', () => {
    const day = decodeMealDayRecord(
      { date: '2026-10-16', meals: [mealJSON], totals: 'x', target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120 }, targetWithheld: 'new_reason' },
      'day',
    );
    expect(day.meals).toHaveLength(1);
    expect(day.totals).toBeNull();
    expect(day.target?.kcalHigh).toBe(2000);
    expect(day.targetWithheld).toBe('unknown');
  });
});

describe('foods', () => {
  const choice = {
    key: 'food:skyr-plain',
    source: 'lifepass_estimate',
    basis: 'database',
    label: 'Skyr, plain',
    brand: null,
    foodId: 'skyr-plain',
    barcode: null,
    servingOptions: [{ unit: 'serving', label: '1 cup (170 g)', grams: 170 }, { unit: 'g' }],
    defaultServing: { unit: 'serving', label: '1 cup (170 g)', grams: 170 },
    defaultAmount: 1,
    defaultKcal: 107,
    per100g: { kcal: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
    perServing: null,
    off: null,
    offAttribution: null,
    liquid: false,
    lastUsedAt: null,
    useCount: null,
  };

  it('the closest flag reads and defaults off (testTheClosestFlagReadsAndDefaultsOff)', () => {
    expect(decodeFoodSearchResult({ query: 'nutella bread', mine: [], foods: [], meals: [], closest: true }, 's').closest).toBe(true);
    expect(decodeFoodSearchResult({ query: 'skyr', mine: [], foods: [], meals: [] }, 's').closest).toBe(false);
    expect(decodeFoodSearchResult({ query: 'skyr', mine: [], foods: [], meals: [], closest: 'yes' }, 's').closest).toBe(false);
  });

  it('a row that cannot be read is dropped, the list stands', () => {
    const result = decodeFoodSearchResult({ query: 'skyr', mine: [], foods: [choice, { key: 'no-label', source: 'usda' }, choice], meals: 'x' }, 's');
    expect(result.foods).toHaveLength(2);
    expect(result.meals).toEqual([]);
    const fallback = decodeFoodChoice({ key: 'k', source: 'usda', label: 'L', defaultServing: 3 }, 'c');
    expect(fallback).toMatchObject({ defaultServing: GRAMS_SERVING, defaultAmount: 100, servingOptions: [], liquid: false });
  });

  it('presets and my foods read lossily, and a removal takes the key everywhere', () => {
    const presets = decodeFoodPresets(
      {
        libraryVersion: '2026-10-v4',
        foods: [choice],
        meals: [
          {
            id: 'oats',
            name: 'Oats with berries',
            category: { id: 'breakfast', label: 'Breakfast' },
            ingredients: [
              { foodId: 'oats', source: 'usda', label: 'Oats', grams: 40, kcal: 150, per100g: { kcal: 375, proteinG: 13, carbsG: 60, fatG: 7 }, servingOptions: [{ unit: 'g' }], liquid: false },
              { foodId: 'broken' },
            ],
            perServing: { kcal: 220, proteinG: 8, carbsG: 35, fatG: 5 },
          },
        ],
        categories: [{ id: 'breakfast', label: 'Breakfast' }],
      },
      'p',
    );
    expect(presets.meals[0]?.ingredients.map((ingredient) => ingredient.foodId)).toEqual(['oats']);

    const mine = decodeMyFoods(
      {
        recents: [choice],
        frequent: [choice],
        mine: [],
        recentMeals: [{ key: 'r1', slot: 'breakfast', kcal: 107, lastLoggedAt: '2026-10-16T08:00:00Z', items: [choice] }],
      },
      'm',
    );
    expect(mine.recentMeals[0]?.itemCount).toBe(1);
    const removed = myFoodsRemoving(mine, 'food:skyr-plain');
    expect(removed.recents).toEqual([]);
    expect(removed.frequent).toEqual([]);
    expect(removed.recentMeals).toEqual([]);
  });

  it('a preset ingredient becomes grams of the recipe times the servings, at least 1 g', () => {
    const presets = decodeFoodPresets(
      {
        meals: [
          {
            id: 'tea',
            name: 'Tea',
            ingredients: [{ foodId: 'honey', source: 'usda', label: 'Honey', grams: 0.4, per100g: { kcal: 304, proteinG: 0, carbsG: 82, fatG: 0 } }],
          },
        ],
      },
      'p',
    );
    const ingredient = presets.meals[0]!.ingredients[0]!;
    expect(ingredient.servingOptions).toEqual([GRAMS_SERVING]);
    expect(draftFromIngredient(ingredient, 2).amount).toBe(1);
    expect(draftFromIngredient({ ...ingredient, grams: 41.25 }, 2)).toMatchObject({ amount: 83, basis: 'database', choiceKey: 'food:honey' });
  });

  it('a picked food is a new item at its default portion, capped by whole characters', () => {
    const long: FoodChoice = { ...decodeFoodChoice(choice, 'c'), label: `${'a'.repeat(79)}🇮🇸 skyr`, brand: '  ' };
    const draft = draftFromChoice(long);
    expect(draft.label).toBe(`${'a'.repeat(79)}🇮🇸`);
    expect(draft).toMatchObject({ storedId: null, basis: 'database', amount: 1, choiceKey: 'food:skyr-plain', confirmed: true });
    expect(isChangedFromStored(draft)).toBe(true);
    // A blank brand is not sent.
    expect(draftInput(draft).brand).toBeNull();
  });
});

describe('what each item sends', () => {
  it('an Open Food Facts product: one serving when its weight is known, barcode and snapshot on the wire', () => {
    const draft = draftFromProduct(snapshot, false);
    expect(draft.serving).toEqual(namedServing('170 g', 170));
    expect(draft.amount).toBe(1);
    expect(draft.servingOptions).toEqual([namedServing('170 g', 170), GRAMS_SERVING]);
    expect(draft.per100g).toEqual({ kcal: 79, proteinG: 9.8, carbsG: 8.9, fatG: 0 });
    const wire = encodeItemInput(draftInput(draft));
    expect(wire.barcode).toBe('5690519000011');
    expect(wire.foodId).toBeUndefined();
    expect(wire.off).toEqual({
      barcode: '5690519000011',
      productName: 'Skyr vanilla',
      productNameLang: 'is',
      brand: 'Ísey',
      per100g: { kcal: 79, proteinG: 9.8, carbsG: 8.9, sugarsG: 8.6, saltG: 0.1 },
      energyFromKj: false,
      servingQuantityG: 170,
      retrievedAt: '2026-10-16T08:00:00Z',
    });
    // Without a weight: 100 g.
    expect(draftFromProduct({ ...snapshot, servingQuantityG: null }, false)).toMatchObject({ serving: GRAMS_SERVING, amount: 100 });
  });

  it('a created food sends its barcode and per serving, or per 100 g; a quick add only per serving', () => {
    const created = draftFromChoice({
      ...decodeFoodChoice(
        { key: 'mine:x', source: 'member', label: 'Protein bar', barcode: '12345678', perServing: { kcal: 198, proteinG: 20, carbsG: null, fatG: 8 } },
        'c',
      ),
      defaultServing: namedServing('1 bar', 45),
      defaultAmount: 1,
    });
    expect(encodeItemInput(draftInput(created))).toEqual({
      source: 'member',
      label: 'Protein bar',
      barcode: '12345678',
      serving: { unit: 'serving', label: '1 bar', grams: 45 },
      amount: 1,
      perServing: { kcal: 198, proteinG: 20, carbsG: null, fatG: 8 },
      confirmed: true,
    });
    const per100 = draftFromChoice(decodeFoodChoice({ key: 'mine:y', source: 'member', label: 'Bread', per100g: { kcal: 250, proteinG: 9, carbsG: 45, fatG: 3 } }, 'c'));
    expect(draftInput(per100).per100g).toEqual({ kcal: 250, proteinG: 9, carbsG: 45, fatG: 3 });

    const quick = quickAddDraft({ label: '  ', kcal: 320, protein: null, carbs: null, fat: null, servingLabel: '' });
    expect(encodeItemInput(draftInput(quick))).toEqual({
      source: 'quick_add',
      label: '1',
      serving: { unit: 'serving', label: '1', grams: null },
      amount: 1,
      perServing: { kcal: 320, proteinG: null, carbsG: null, fatG: null },
      confirmed: true,
    });
  });

  it('a stored member-typed item resends its numbers; a stored Open Food Facts item only its barcode', () => {
    const record = decodeMealItemRecord(
      {
        id: '22222222-2222-4222-8222-222222222222',
        source: 'member',
        basis: 'member',
        label: 'Soup',
        barcode: '12345678',
        serving: { unit: 'serving', label: '1 bowl', grams: null },
        amount: 1,
        perServing: { kcal: 300, proteinG: null, carbsG: null, fatG: null },
        overrides: {},
        nutrients: { kcalLow: 300, kcalHigh: 300, proteinG: 0, carbsG: 0, fatG: 0, grams: null, macrosComplete: false },
      },
      'item',
    );
    const stored = draftFromRecord(record);
    expect(stored.overrides).toBeNull();
    expect(isChangedFromStored(stored)).toBe(false);
    expect(encodeItemInput(draftInput(stored))).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      source: 'member',
      label: 'Soup',
      barcode: '12345678',
      serving: { unit: 'serving', label: '1 bowl', grams: null },
      amount: 1,
      perServing: { kcal: 300, proteinG: null, carbsG: null, fatG: null },
      confirmed: true,
    });

    const off = draftFromRecord(
      decodeMealItemRecord({ id: '33333333-3333-4333-8333-333333333333', source: 'off', label: 'Skyr', barcode: '5690519000011', foodId: 'x', amount: 1, serving: { unit: 'g' } }, 'item'),
    );
    const wire = encodeItemInput(draftInput(off));
    expect(wire.barcode).toBe('5690519000011');
    expect(wire.foodId).toBeUndefined();
    expect(wire.off).toBeUndefined();
  });

  it('an untouched low-confidence estimate keeps its range and waits for a check', () => {
    const record = decodeMealItemRecord(
      { id: 'i', source: 'model', basis: 'estimate', label: 'Pasta', confidence: 'low', confirmed: false, amount: 250, serving: { unit: 'g' }, estimate: { grams: 250, kcalLow: 300, kcalHigh: 500, proteinG: 10, carbsG: 60, fatG: 8 } },
      'item',
    );
    const draft = draftFromRecord(record);
    expect(isUntouchedEstimate(draft)).toBe(true);
    expect(itemNeedsCheck(draft)).toBe(true);
  });
});

describe('a create body on disk', () => {
  it('round-trips with its date, its nulls and nothing else', () => {
    const body = {
      slot: 'lunch',
      loggedAt: new Date(Date.UTC(2026, 8, 22, 12, 0, 0)),
      logDate: '2026-09-22',
      source: 'quick_add',
      items: [draftInput(quickAddDraft({ label: 'Soup', kcal: 320, protein: null, carbs: 4, fat: null, servingLabel: '1 serving' }))],
    };
    const disk = JSON.parse(JSON.stringify(encodeMealCreateBodyForDisk(body)));
    expect(disk.loggedAt).toBe('2026-09-22T12:00:00Z');
    expect(decodeMealCreateBody(disk, 'body')).toEqual(body);
    // On the wire the date goes the same way.
    expect(JSON.parse(encodeBody(encodeMealCreateBody(body))).loggedAt).toBe('2026-09-22T12:00:00Z');
  });
});
