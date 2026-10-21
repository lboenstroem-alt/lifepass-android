/**
 * The meal editor's rules (iOS MealEditorView): which kind of meal, when
 * Save may run and what the line over it says, the day line, the draft's
 * confirm body, and the merge after a meal changed elsewhere.
 */
import { decodeHealthDay } from '../../../../health/models';
import { translate, translatePlural } from '../../../../i18n';
import { settingValue } from '../../math/itemMath';
import { draftFromRecord, quickAddDraft } from '../../types/draftFactory';
import { mealRecord, newSkyr, photoItemJson, skyrItemJson, bananaItemJson, UPDATED_AT } from '../../itemEditor/__tests__/fixtures';
import {
  accuracyKey,
  canSave,
  clampedLoggedAt,
  confirmingAll,
  dayLine,
  draftConfirmBody,
  editableSlotOf,
  editorKind,
  estimateBannerKey,
  quickAddKcal,
  quickAddMacro,
  hasRange,
  mergeAfterConflict,
  saveHelper,
  showsAmountPill,
  uncheckedCount,
  whenText,
} from '../mealEditorRules';
import { clampToRange, combineDayAndTime, whenRangeStart } from '../whenPicker';

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);
const enP = (base: string, count: number) => translatePlural(base, count, 'en');
const isP = (base: string, count: number) => translatePlural(base, count, 'is');

const photo = () => draftFromRecord(mealRecord({ items: [photoItemJson()], confirmed: false }).items[0]!);

describe('the kind of meal', () => {
  it('a tray is new, a handed draft a draft, and a stored meal a draft until it is confirmed', () => {
    expect(editorKind('tray', null)).toBe('new');
    expect(editorKind('draft', { confirmed: false })).toBe('draft');
    expect(editorKind('stored', { confirmed: false })).toBe('draft');
    expect(editorKind('stored', { confirmed: true })).toBe('existing');
    // Before the read: the title says Edit meal, as iOS (`record?.confirmed ?? true`).
    expect(editorKind('stored', null)).toBe('existing');
  });

  it('a description draft has its own banner and accuracy note', () => {
    expect(estimateBannerKey({ source: 'text' })).toBe('meal.describe.banner');
    expect(accuracyKey({ source: 'text' })).toBe('meal.describe.accuracy');
    expect(estimateBannerKey({ source: 'photo' })).toBe('meal.estimate.banner');
    expect(accuracyKey(null)).toBe('meal.estimate.accuracy');
  });
});

describe('Save', () => {
  it('waits while an item is unchecked, and the line says how many (plural keys)', () => {
    const items = [photo(), newSkyr()];
    expect(uncheckedCount(items)).toBe(1);
    expect(canSave(items, false)).toBe(false);
    expect(saveHelper(items, false, en, enP)).toBe('Check 1 item before saving');
    const three = [photo(), photo(), photo()];
    expect(saveHelper(three, false, en, enP)).toBe('Check 3 items before saving');
    // Icelandic 21 is singular.
    expect(saveHelper(Array.from({ length: 21 }, photo), false, is, isP)).toBe(is('meal.editor.check_first.one', { count: 21 }));
    expect(saveHelper(Array.from({ length: 11 }, photo), false, is, isP)).toBe(is('meal.editor.check_first.many', { count: 11 }));
  });

  it('needs at least one item', () => {
    expect(canSave([], false)).toBe(false);
    expect(saveHelper([], false, en, enP)).toBe(en('meal.editor.no_items'));
  });

  it('never saves read-only, and says why', () => {
    expect(canSave([newSkyr()], true)).toBe(false);
    expect(saveHelper([newSkyr()], true, en, enP)).toBe(en('bodygoals.need_membership'));
  });

  it('is ready once every item is checked', () => {
    const items = confirmingAll([photo(), newSkyr()]);
    expect(uncheckedCount(items)).toBe(0);
    expect(canSave(items, false)).toBe(true);
    expect(saveHelper(items, false, en, enP)).toBeNull();
  });

  it('an untouched estimate keeps the range and its chip', () => {
    expect(hasRange([photo()])).toBe(true);
    expect(hasRange([newSkyr()])).toBe(false);
  });
});

describe('the day line', () => {
  const day = decodeHealthDay(
    {
      date: '2026-10-21',
      meals: {
        date: '2026-10-21',
        meals: [
          { id: 'breakfast', confirmed: true, totals: { kcalLow: 400, kcalHigh: 500, proteinG: 20, carbsG: 40, fatG: 10 } },
          { id: 'draft', confirmed: false, totals: { kcalLow: 900, kcalHigh: 900, proteinG: 20, carbsG: 40, fatG: 10 } },
          { id: 'meal-1', confirmed: true, totals: { kcalLow: 300, kcalHigh: 300, proteinG: 20, carbsG: 40, fatG: 10 } },
        ],
        target: { kcalLow: 1800, kcalHigh: 2000, proteinG: 120 },
      },
    },
  );
  const now = new Date('2026-10-21T12:00:00Z');

  it('adds this meal to the other confirmed meals, to the nearest ten', () => {
    // 450 (breakfast midpoint) + 211 (this meal), the draft and the meal's own old row left out.
    const line = dayLine({ logDate: '2026-10-21', meals: day.meals, recordId: 'meal-1', totals: { kcalLow: 211, kcalHigh: 211 }, t: en, language: 'en', now });
    expect(line).toBe(en('meal.editor.day_line', { eaten: '660', low: '1,800', high: '2,000' }));
  });

  it('is only for today, and only with a target', () => {
    expect(dayLine({ logDate: '2026-10-20', meals: day.meals, recordId: null, totals: { kcalLow: 1, kcalHigh: 1 }, t: en, language: 'en', now })).toBeNull();
    expect(
      dayLine({ logDate: '2026-10-21', meals: { ...day.meals!, target: null }, recordId: null, totals: { kcalLow: 1, kcalHigh: 1 }, t: en, language: 'en', now }),
    ).toBeNull();
  });
});

describe('a draft is confirmed with OP-35 (13.4)', () => {
  it('sends confirmed, every item, the slot and time, and the updatedAt exactly as loaded', () => {
    const meal = mealRecord({ items: [photoItemJson(), skyrItemJson()], confirmed: false, source: 'photo' });
    const items = confirmingAll(meal.items.map(draftFromRecord));
    const loggedAt = new Date('2026-10-21T12:40:00Z');
    const body = draftConfirmBody({ slot: 'dinner', loggedAt, logDate: '2026-10-21', items, record: meal });
    expect(body.confirmed).toBe(true);
    expect(body.expectedUpdatedAt).toBe(UPDATED_AT);
    expect(body.slot).toBe('dinner');
    expect(body.loggedAt).toBe(loggedAt);
    expect(body.logDate).toBe('2026-10-21');
    expect(body.items?.map((item) => [item.id, item.confirmed])).toEqual([
      ['item-photo', true],
      ['item-skyr', true],
    ]);
  });
});

describe('a meal changed elsewhere (meal_changed, meal_needs_confirmation)', () => {
  const NEXT = '2026-10-21T09:00:00.5+00:00';

  it('keeps the member’s edits by stored id and appends the items they added', () => {
    const loaded = mealRecord({ items: [skyrItemJson(), bananaItemJson()] });
    const [skyr, banana] = loaded.items.map(draftFromRecord);
    const added = quickAddDraft({ label: 'Juice', kcal: 120, protein: null, carbs: null, fat: null, servingLabel: '1 glass' });
    const mine = [{ ...skyr!, amount: 2 }, banana!, added];
    const reloaded = mealRecord({
      items: [skyrItemJson('item-skyr', { amount: 3, nutrients: { kcalLow: 316, kcalHigh: 316 } }), bananaItemJson()],
      updatedAt: NEXT,
    });
    const merged = mergeAfterConflict(mine, reloaded, false);
    expect(merged.map((item) => [item.storedId, item.amount])).toEqual([
      ['item-skyr', 2],
      ['item-banana', 120],
      [null, 1],
    ]);
    // The edited item learns what the server now stores, so it still reads as changed.
    expect(merged[0]!.storedAmount).toBe(3);
    expect(merged[2]!.label).toBe('Juice');
  });

  it('takes an item the member never had as the server sends it', () => {
    const loaded = mealRecord({ items: [skyrItemJson()] });
    const reloaded = mealRecord({ items: [skyrItemJson(), bananaItemJson()], updatedAt: NEXT });
    const merged = mergeAfterConflict(loaded.items.map(draftFromRecord), reloaded, false);
    expect(merged.map((item) => item.storedId)).toEqual(['item-skyr', 'item-banana']);
  });

  it('needs confirmation: an untouched low-confidence item asks to be checked again; a changed one does not', () => {
    const loaded = mealRecord({ items: [photoItemJson('a'), photoItemJson('b')], confirmed: false });
    const [a, b] = confirmingAll(loaded.items.map(draftFromRecord));
    const touched = settingValue(b!, 'kcal', 400);
    const reloaded = mealRecord({ items: [photoItemJson('a'), photoItemJson('b')], confirmed: false, updatedAt: NEXT });
    const merged = mergeAfterConflict([a!, touched], reloaded, true);
    expect(merged.map((item) => item.confirmed)).toEqual([false, true]);
    expect(mergeAfterConflict([a!, touched], reloaded, false).map((item) => item.confirmed)).toEqual([true, true]);
  });
});

describe('the When row', () => {
  it('reads "Today, 12:40", the time on the phone’s clock', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    const lunch = new Date('2026-10-21T12:40:00Z');
    const pad = (value: number) => String(value).padStart(2, '0');
    const phoneTime = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    expect(whenText('2026-10-21', lunch, en, 'en', now)).toBe(`${en('diary.today')}, ${phoneTime(lunch)}`);
    const breakfast = new Date('2026-10-20T08:05:00Z');
    expect(whenText('2026-10-20', breakfast, en, 'en', now)).toBe(`${en('diary.yesterday')}, ${phoneTime(breakfast)}`);
  });

  it('never logs a meal in the future', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(clampedLoggedAt(new Date('2026-10-21T13:00:00Z'), now)).toBe(now);
    const earlier = new Date('2026-10-21T11:00:00Z');
    expect(clampedLoggedAt(earlier, now)).toBe(earlier);
  });

  it('reaches back 30 days for a new meal or a draft, a year for a saved one', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(whenRangeStart(false, now).toISOString()).toBe('2026-09-21T12:00:00.000Z');
    expect(whenRangeStart(true, now).toISOString()).toBe('2025-10-21T12:00:00.000Z');
    expect(clampToRange(new Date('2026-01-01T00:00:00Z'), whenRangeStart(false, now), now).toISOString()).toBe('2026-09-21T12:00:00.000Z');
  });

  it('puts the picked time on the picked day, on the phone’s calendar', () => {
    const combined = combineDayAndTime(new Date(2026, 9, 19, 9, 0), new Date(2026, 9, 21, 18, 25, 30));
    expect([combined.getFullYear(), combined.getMonth(), combined.getDate(), combined.getHours(), combined.getMinutes(), combined.getSeconds()]).toEqual([
      2026, 9, 19, 18, 25, 0,
    ]);
  });
});

describe('small rules', () => {
  it('a slot the app does not know opens the page as a snack', () => {
    expect(editableSlotOf('dinner')).toBe('dinner');
    expect(editableSlotOf('unknown')).toBe('snack');
  });

  it('the amount pill is for a draft’s estimated items only', () => {
    expect(showsAmountPill(photo(), 'draft', false)).toBe(true);
    expect(showsAmountPill(photo(), 'draft', true)).toBe(false);
    expect(showsAmountPill(photo(), 'existing', false)).toBe(false);
    expect(showsAmountPill(newSkyr(), 'draft', false)).toBe(false);
  });

  it('quick add takes calories 1 to 5,000 and macros 0 to 500', () => {
    expect(quickAddKcal('0')).toBeNull();
    expect(quickAddKcal('1')).toBe(1);
    expect(quickAddKcal('5000')).toBe(5000);
    expect(quickAddKcal('5001')).toBeNull();
    expect(quickAddKcal('350,5')).toBe(350.5);
    expect(quickAddMacro('')).toBeNull();
    expect(quickAddMacro('0')).toBe(0);
    expect(quickAddMacro('501')).toBeNull();
  });
});
