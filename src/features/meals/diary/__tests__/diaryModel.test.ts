/**
 * The diary's rules (iOS DiaryDayView): the date steps, "Copy from
 * yesterday" (`canCopyYesterday` false with a queued outbox meal in the slot
 * or while the page shows the cache), the slot order and its kcal, the
 * drafts list (photo and description drafts once each), removing an item
 * and its Undo, the offline day from the cached Today read, and the words of
 * an item row.
 */
import { decodeHealthMealsBlock } from '../../../../health/models';
import type { MealOutboxItem } from '../../outbox/rules';
import { allDraftsOf, decodeMealDayRecord, decodeMealRecord, draftFromRecord, type MealDayRecord, type MealRecord } from '../../types';
import {
  cachedTodayDay,
  canCopyYesterday,
  clampToToday,
  draftRowCopyKey,
  itemRemoval,
  pickerRange,
  queuedInSlot,
  relativeDay,
  slotKcal,
  slotMeals,
  stepDay,
  swipeDelta,
  undoRemovalBody,
  yesterdaySources,
} from '../diaryModel';
import { amountLine, itemKcalText } from '../itemText';

const TODAY = '2026-10-16';

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    source: 'usda',
    basis: 'library',
    label: `Food ${id}`,
    foodId: `food-${id}`,
    serving: { unit: 'g' },
    amount: 100,
    servingOptions: [{ unit: 'g' }],
    per100g: { kcal: 120, proteinG: 10, carbsG: 10, fatG: 4 },
    edited: [],
    confirmed: true,
    liquid: false,
    nutrients: { kcalLow: 120, kcalHigh: 120, proteinG: 10, carbsG: 10, fatG: 4, grams: 100, macrosComplete: true },
    ...extra,
  };
}

function meal(id: string, extra: Record<string, unknown> = {}): MealRecord {
  return decodeMealRecord(
    {
      id,
      logDate: TODAY,
      loggedAt: '2026-10-16T08:00:00.000Z',
      slot: 'breakfast',
      source: 'search',
      confirmed: true,
      needsConfirm: false,
      hasEstimate: false,
      items: [item(`${id}-1`)],
      totals: { kcalLow: 120, kcalHigh: 120, proteinG: 10, carbsG: 10, fatG: 4 },
      updatedAt: '2026-10-16T08:00:00.123Z',
      ...extra,
    },
    'meal',
  );
}

function dayOf(meals: MealRecord[], extra: Partial<MealDayRecord> = {}): MealDayRecord {
  return { ...decodeMealDayRecord({ date: TODAY, meals: [], drafts: [] }, 'day'), meals, ...extra };
}

function queued(slot: string, logDate = TODAY): MealOutboxItem {
  return {
    id: `q-${slot}`,
    key: 'k',
    createdAt: new Date('2026-10-16T09:00:00Z'),
    state: 'pending',
    body: {
      slot,
      logDate,
      loggedAt: new Date('2026-10-16T09:00:00Z'),
      source: 'search',
      items: [],
    },
  };
}

describe('days', () => {
  it('steps a day at a time and never past today', () => {
    expect(stepDay('2026-10-15', 1, TODAY)).toBe(TODAY);
    expect(stepDay(TODAY, 1, TODAY)).toBeNull();
    expect(stepDay(TODAY, -1, TODAY)).toBe('2026-10-15');
    expect(stepDay('2026-03-01', -1, TODAY)).toBe('2026-02-28');
    expect(stepDay('nope', -1, TODAY)).toBeNull();
  });

  it('clamps a picked day to today', () => {
    expect(clampToToday('2026-10-20', TODAY)).toBe(TODAY);
    expect(clampToToday('2026-10-01', TODAY)).toBe('2026-10-01');
  });

  it('says Today, Yesterday or the date', () => {
    expect(relativeDay(TODAY, TODAY)).toBe('today');
    expect(relativeDay('2026-10-15', TODAY)).toBe('yesterday');
    expect(relativeDay('2026-10-14', TODAY)).toBe('date');
  });

  it('offers a year back in the picker', () => {
    expect(pickerRange(TODAY)).toEqual({ first: '2025-10-16', last: TODAY });
  });

  it('reads a horizontal swipe as a day: left is the next one', () => {
    expect(swipeDelta(-80, 10)).toBe(1);
    expect(swipeDelta(80, -10)).toBe(-1);
    expect(swipeDelta(20, 60)).toBeNull();
    expect(swipeDelta(40, 40)).toBeNull();
  });
});

describe('slots', () => {
  it('lists a slot’s meals earliest first, a meal with no time first of all', () => {
    const late = meal('late', { loggedAt: '2026-10-16T09:30:00Z' });
    const early = meal('early', { loggedAt: '2026-10-16T07:15:00Z' });
    const timeless = meal('timeless', { loggedAt: null });
    const lunch = meal('lunch', { slot: 'lunch' });
    expect(slotMeals(dayOf([late, lunch, early, timeless]), 'breakfast').map((m) => m.id)).toEqual(['timeless', 'early', 'late']);
  });

  it('sums each meal’s midpoint, rounded, for the header', () => {
    const range = meal('a', { totals: { kcalLow: 294, kcalHigh: 547, proteinG: 0, carbsG: 0, fatG: 0 } });
    const point = meal('b', { totals: { kcalLow: 200, kcalHigh: 200, proteinG: 0, carbsG: 0, fatG: 0 } });
    const none = meal('c', { totals: null });
    expect(slotKcal([range, point, none])).toBe(421 + 200);
    expect(slotKcal([])).toBe(0);
  });

  it('puts each waiting meal under its own slot', () => {
    expect(queuedInSlot([queued('lunch'), queued('dinner')], 'lunch').map((q) => q.id)).toEqual(['q-lunch']);
  });
});

describe('copy from yesterday (canCopyYesterday)', () => {
  const yesterday = dayOf([meal('y1', { logDate: '2026-10-15' }), meal('y2', { logDate: '2026-10-15', slot: 'dinner', confirmed: false })], {
    date: '2026-10-15',
  });
  const base = { isToday: true, meals: [] as MealRecord[], showingCache: false, yesterday, pending: [] as MealOutboxItem[] };

  it('is offered for today’s empty slot when yesterday had a confirmed meal in it', () => {
    expect(canCopyYesterday('breakfast', base)).toBe(true);
  });

  it('is not offered for a slot yesterday had nothing confirmed in', () => {
    expect(canCopyYesterday('dinner', base)).toBe(false); // only a draft
    expect(canCopyYesterday('lunch', base)).toBe(false);
  });

  it('is not offered when the slot has a meal, or one waiting on the phone', () => {
    expect(canCopyYesterday('breakfast', { ...base, meals: [meal('m')] })).toBe(false);
    expect(canCopyYesterday('breakfast', { ...base, pending: [queued('breakfast')] })).toBe(false);
    expect(canCopyYesterday('breakfast', { ...base, pending: [queued('lunch')] })).toBe(true);
  });

  it('is not offered while the page shows the cache, on another day, or before yesterday is read', () => {
    expect(canCopyYesterday('breakfast', { ...base, showingCache: true })).toBe(false);
    expect(canCopyYesterday('breakfast', { ...base, isToday: false })).toBe(false);
    expect(canCopyYesterday('breakfast', { ...base, yesterday: null })).toBe(false);
  });

  it('copies the confirmed meals of the slot, earliest first', () => {
    const day = dayOf([
      meal('second', { loggedAt: '2026-10-15T09:00:00Z' }),
      meal('first', { loggedAt: '2026-10-15T07:00:00Z' }),
      meal('draft', { confirmed: false }),
      meal('other', { slot: 'lunch' }),
    ]);
    expect(yesterdaySources(day, 'breakfast').map((m) => m.id)).toEqual(['first', 'second']);
  });
});

describe('drafts', () => {
  it('lists photo and description drafts once each (allDrafts)', () => {
    const text = meal('t', { source: 'text', confirmed: false });
    const photo = meal('p', { source: 'photo', confirmed: false });
    const day = dayOf([], { drafts: [photo, text], textDrafts: [text] });
    expect(allDraftsOf(day).map((m) => m.id)).toEqual(['p', 't']);
  });

  it('names each draft by its own source', () => {
    expect(draftRowCopyKey({ source: 'text' })).toBe('diary.draft_row_text');
    expect(draftRowCopyKey({ source: 'photo' })).toBe('diary.draft_row');
    expect(draftRowCopyKey({ source: null })).toBe('diary.draft_row');
  });
});

describe('removing an item', () => {
  it('asks to delete the meal when it is the last item', () => {
    const only = meal('m');
    expect(itemRemoval(only, draftFromRecord(only.items[0]!))).toEqual({ kind: 'confirmDelete' });
  });

  it('patches the meal with the rest, against the updatedAt it was read with', () => {
    const two = meal('m', { items: [item('a'), item('b')] });
    const removal = itemRemoval(two, draftFromRecord(two.items[0]!));
    if (removal.kind !== 'patch') throw new Error('patch');
    expect(removal.body.items?.map((input) => input.id)).toEqual(['b']);
    expect(removal.body.expectedUpdatedAt).toBe('2026-10-16T08:00:00.123Z');
    expect(removal.undoable).toBe(true); // a library food
  });

  it('offers Undo for library and member-typed items, not for an estimate', () => {
    const mixed = meal('m', {
      items: [
        item('lib'),
        item('mine', { source: 'member', basis: 'per_serving', foodId: null, perServing: { kcal: 300, proteinG: null, carbsG: null, fatG: null }, serving: { unit: 'serving', label: '1 bowl', grams: null } }),
        item('quick', { source: 'quick_add', basis: 'per_serving', foodId: null, perServing: { kcal: 200, proteinG: null, carbsG: null, fatG: null }, serving: { unit: 'serving', label: '1 serving', grams: null } }),
        item('guess', { source: 'model', basis: 'estimate', foodId: null, estimate: { grams: 175, kcalLow: 294, kcalHigh: 546, proteinG: 17, carbsG: 36, fatG: 20 } }),
      ],
    });
    const undoable = (index: number) => {
      const removal = itemRemoval(mixed, draftFromRecord(mixed.items[index]!));
      return removal.kind === 'patch' && removal.undoable;
    };
    expect([undoable(0), undoable(1), undoable(2), undoable(3)]).toEqual([true, true, true, false]);
  });

  it('Undo sends every item back, the removed one as new, against the meal the removal left', () => {
    const two = meal('m', { items: [item('a'), item('b')] });
    const removed = draftFromRecord(two.items[0]!);
    const removal = itemRemoval(two, removed);
    if (removal.kind !== 'patch') throw new Error('patch');
    const body = undoRemovalBody(removal.all, removed, { updatedAt: '2026-10-16T08:05:00.456Z' });
    expect(body.items?.map((input) => input.id)).toEqual([null, 'b']);
    expect(body.items?.[0]?.foodId).toBe('food-a'); // a library food, sent as new
    expect(body.expectedUpdatedAt).toBe('2026-10-16T08:05:00.456Z');
  });
});

describe('offline: today from the cached Today read', () => {
  const block = decodeHealthMealsBlock(
    {
      date: TODAY,
      meals: [
        {
          id: 'saved',
          logDate: TODAY,
          loggedAt: '2026-10-16T08:00:00Z',
          slot: 'breakfast',
          source: 'search',
          confirmed: true,
          items: [{ id: 'i1', source: 'usda', label: 'Skyr', serving: { unit: 'g' }, amount: 170, nutrients: { kcalLow: 110, kcalHigh: 110 } }],
          totals: { kcalLow: 110, kcalHigh: 110, proteinG: 18, carbsG: 7, fatG: 0 },
        },
        { id: 'draft', confirmed: false, slot: 'lunch' },
        { id: 'older', slot: null },
      ],
      drafts: [],
      totals: { kcalLow: 110, kcalHigh: 110, proteinG: 18, carbsG: 7, fatG: 0 },
      target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120 },
      scansLeftToday: 4,
    },
    'meals',
  );

  it('draws the confirmed meals, no drafts, with the day’s totals and target', () => {
    const day = cachedTodayDay(block, TODAY);
    expect(day?.date).toBe(TODAY);
    expect(day?.meals.map((m) => m.id)).toEqual(['saved', 'older']);
    expect(day?.meals[1]?.slot).toBe('snack'); // a meal with no slot lands in Snack, as iOS
    expect(day?.drafts).toEqual([]);
    expect(day?.target?.kcalLow).toBe(1800);
    expect(day?.scansLeftToday).toBe(4);
    const skyr = day!.meals[0]!.items[0]!;
    expect(skyr.label).toBe('Skyr');
    expect(skyr.per100g).toBeNull(); // display only
    expect(day!.meals[0]!.updatedAt).toBeNull();
  });

  it('has nothing without a meals block', () => {
    expect(cachedTodayDay(null, TODAY)).toBeNull();
  });
});

describe('an item row', () => {
  const t = (key: string) => (key === 'food.create.serving_default' ? '1 serving' : key);

  it('says grams, ml for a drink, or the serving with its multiplier', () => {
    const grams = draftFromRecord(meal('m').items[0]!);
    expect(amountLine(grams, 'en', t)).toBe('100 g');
    const drink = draftFromRecord(meal('d', { items: [item('d', { liquid: true, amount: 250 })] }).items[0]!);
    expect(amountLine(drink, 'en', t)).toBe('250 ml');
    const cup = draftFromRecord(
      meal('c', { items: [item('c', { serving: { unit: 'serving', label: '1 cup (170 g)', grams: 170 }, amount: 2 })] }).items[0]!,
    );
    expect(amountLine(cup, 'en', t)).toBe('2 x 1 cup (170 g)');
    expect(amountLine({ ...cup, amount: 1.5 }, 'is', t)).toBe('1,5 x 1 cup (170 g)');
    expect(amountLine({ ...cup, amount: 1 }, 'en', t)).toBe('1 cup (170 g)');
    const unlabelled = { ...cup, serving: { unit: 'serving', label: null, grams: null }, amount: 1 };
    expect(amountLine(unlabelled, 'en', t)).toBe('1 serving');
  });

  it('shows the server’s numbers for an untouched item: a point or a range', () => {
    const point = draftFromRecord(meal('m').items[0]!);
    expect(itemKcalText(point, 'en')).toBe('120 kcal');
    const range = draftFromRecord(
      meal('r', { items: [item('r', { nutrients: { kcalLow: 1294, kcalHigh: 1546, proteinG: 17 } })] }).items[0]!,
    );
    expect(itemKcalText(range, 'en')).toBe('1,294 to 1,546 kcal');
    expect(itemKcalText(range, 'is')).toBe('1.294 til 1.546 kcal');
  });
});
