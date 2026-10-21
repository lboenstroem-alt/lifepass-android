/**
 * The food card's rules (iOS PlanNutritionCard): the one target row that is
 * true, the target weight line (today only, a known `appliesTo`), the
 * shared day energy at its boundaries (always neutral copy), the drafts row
 * and the meal rows.
 */
import type { MealDraftBrief, MealView, NutritionTarget, TargetWeightView } from '../../../../health';
import { translate, translatePlural } from '../../../../i18n';
import { dayEnergy } from '../../../../i18n/format';
import {
  confirmedMeals,
  draftsRow,
  eatenParams,
  groupedParams,
  mealEnergyText,
  mealSlotKey,
  targetRow,
  targetWeightRow,
} from '../nutritionRules';

const TARGET: NutritionTarget = { kcalLow: 1800, kcalHigh: 2000, proteinG: 120, basis: 'program' };

const target = (patch: Partial<TargetWeightView> = {}): TargetWeightView => ({
  targetWeightKg: 72.5,
  direction: 'lose',
  setAt: null,
  reachedAt: null,
  outsideHealthyRange: false,
  appliesTo: 'program',
  eta: null,
  ...patch,
});

describe('the target row', () => {
  it('the day\'s range, from the calorie goal or not', () => {
    expect(targetRow({ target: TARGET, targetWithheld: null }, true, false)).toEqual({ kind: 'target', target: TARGET, fromGoal: false });
    expect(targetRow({ target: { ...TARGET, basis: 'goal' }, targetWithheld: null }, false, true)).toMatchObject({
      kind: 'target',
      fromGoal: true,
    });
  });

  it('a withheld range says so, whatever else is true; an unknown reason is not a reason', () => {
    expect(targetRow({ target: null, targetWithheld: 'bmi_low_lose_weight' }, true, false)).toEqual({ kind: 'withheld' });
    expect(targetRow({ target: null, targetWithheld: 'unknown' }, true, false)).toEqual({
      kind: 'setBody',
      key: 'plan.nutrition.no_target_body',
    });
  });

  it('a live plan asks for the body details; a calorie goal for them too; anyone else to set a goal', () => {
    expect(targetRow(null, true, false)).toEqual({ kind: 'setBody', key: 'plan.nutrition.no_target_body' });
    expect(targetRow(null, false, true)).toEqual({ kind: 'setGoal', key: 'plan.nutrition.no_target_body' });
    expect(targetRow(null, false, false)).toEqual({ kind: 'setGoal', key: 'plan.nutrition.set_goal' });
  });
});

describe('the target weight row', () => {
  it('is hidden off today, without a target (a server without the feature), and with an unknown appliesTo', () => {
    expect(targetWeightRow(false, target(), 'en')).toBeNull();
    expect(targetWeightRow(true, null, 'en')).toBeNull();
    expect(targetWeightRow(true, target({ appliesTo: null }), 'en')).toBeNull();
    expect(targetWeightRow(true, target({ appliesTo: 'maintenance' }), 'en')).toBeNull();
    expect(targetWeightRow(true, target({ appliesTo: 'goal' }), 'en')).not.toBeNull();
  });

  it('reached first, then outside a healthy range, then the line', () => {
    expect(targetWeightRow(true, target({ reachedAt: new Date(), outsideHealthyRange: true }), 'en')).toEqual({ kind: 'reached' });
    expect(targetWeightRow(true, target({ outsideHealthyRange: true }), 'en')).toEqual({ kind: 'unhealthy' });
    const row = targetWeightRow(true, target(), 'is');
    expect(row).toEqual({ kind: 'line', line: { key: 'target.line', params: { kg: '72,5' } }, hasEta: false });
  });

  it('with a rough estimate of the weeks', () => {
    const row = targetWeightRow(true, target({ eta: { weeksLow: 6, weeksHigh: 9 } }), 'en');
    expect(row).toMatchObject({ kind: 'line', hasEta: true });
    if (row?.kind !== 'line') throw new Error('a line');
    expect(translate(row.line.key, 'en', row.line.params)).toBe('Target 72.5 kg · about 6 to 9 weeks at this pace');
  });
});

describe('the day energy the card draws', () => {
  const totals = (kcalLow: number, kcalHigh: number, proteinG = 0) => ({ kcalLow, kcalHigh, proteinG });

  it('below, at both ends of, and above the range: left, within, over, every one of them neutral copy', () => {
    const keys = [1799, 1800, 2000, 2001, 2010].map((kcal) => dayEnergy(totals(kcal, kcal), TARGET).status?.key);
    // 1799 and 2001 round to 1800 and 2000 (every kcal figure is shown in tens).
    expect(keys).toEqual(['diary.within', 'diary.within', 'diary.within', 'diary.within', 'diary.over']);
    expect(dayEnergy(totals(1790, 1790), TARGET).status).toEqual({ key: 'diary.left', params: { kcal: '110' } });
    for (const key of ['diary.left', 'diary.within', 'diary.over']) {
      // "Over" is information, not a failure: the copy never scolds.
      expect(translate(key, 'en', { kcal: '100' })).not.toMatch(/too much|exceed|warning|!/i);
    }
  });

  it('a range from a photo estimate wears the chip; no target hides the bars and the status', () => {
    const energy = dayEnergy(totals(1400, 1700, 80), null);
    expect(energy.showsEstimateChip).toBe(true);
    expect(energy.kcalFill).toBeNull();
    expect(energy.proteinFill).toBeNull();
    expect(energy.status).toBeNull();
  });

  it('the eaten line groups the account\'s way and carries the day\'s protein in whole grams', () => {
    const energy = dayEnergy(totals(1210, 1210, 64.6), TARGET);
    expect(translate(energy.eaten.key, 'is', eatenParams(energy.eaten.params, 64.6, 'is'))).toBe('Borðað: 1.210 kcal, 65 g prótein');
    expect(translate(energy.eaten.key, 'en', eatenParams(energy.eaten.params, 64.6, 'en'))).toBe('Eaten: 1,210 kcal, 65 g protein');
    const range = dayEnergy(totals(1400, 1700, 80), null);
    expect(translate(range.eaten.key, 'en', eatenParams(range.eaten.params, 80, 'en'))).toBe('Eaten: 1,400 to 1,700 kcal, 80 g protein');
  });

  it('groups only whole numbers', () => {
    expect(groupedParams({ kcal: '1210', word: 'x', minus: '-1500' }, 'is')).toEqual({ kcal: '1.210', word: 'x', minus: '-1.500' });
  });
});

describe('the meal rows', () => {
  const meal = (patch: Partial<MealView>): MealView => ({
    id: 'm',
    logDate: null,
    loggedAt: null,
    slot: 'lunch',
    source: null,
    confirmed: true,
    confidence: null,
    needsConfirm: null,
    hasEstimate: null,
    items: null,
    totals: null,
    createdAt: null,
    updatedAt: null,
    ...patch,
  });
  const mealTotals = (kcalLow: number, kcalHigh: number) => ({
    kcalLow,
    kcalHigh,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    estimateKcalLow: null,
    estimateKcalHigh: null,
    pointKcal: null,
    memberEnteredKcal: null,
    mealCount: null,
    macrosComplete: null,
  });
  const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
  const is = (key: string, params?: Record<string, string | number>) => translate(key, 'is', params);

  it('lists every meal not marked unconfirmed', () => {
    const meals = [meal({ id: 'a' }), meal({ id: 'b', confirmed: false }), meal({ id: 'c', confirmed: null })];
    expect(confirmedMeals({ meals }).map((m) => m.id)).toEqual(['a', 'c']);
    expect(confirmedMeals(null)).toEqual([]);
  });

  it('a point, a range, or nothing', () => {
    expect(mealEnergyText(meal({ totals: mealTotals(1640, 1640) }), en, 'en')).toBe('1,640 kcal');
    expect(mealEnergyText(meal({ totals: mealTotals(550, 1700) }), is, 'is')).toBe('550 til 1.700 kcal');
    expect(mealEnergyText(meal({ totals: null }), en, 'en')).toBe('');
  });

  it('the slot kicker, a snack when there is none or the build has no word for it', () => {
    expect(mealSlotKey('breakfast')).toBe('slot.breakfast');
    expect(mealSlotKey('drink')).toBe('slot.drink');
    expect(mealSlotKey(null)).toBe('slot.snack');
    expect(mealSlotKey('unknown')).toBe('slot.snack');
    expect(mealSlotKey('brunch')).toBe('slot.snack');
  });
});

describe('the drafts row', () => {
  const draft = (id: string, loggedAt: string | null, source: string | null = 'photo'): MealDraftBrief => ({
    id,
    logDate: '2026-10-16',
    loggedAt: loggedAt ? new Date(loggedAt) : null,
    slot: 'lunch',
    itemCount: 2,
    source,
  });

  it('nothing waiting, no row', () => {
    expect(draftsRow([])).toBeNull();
  });

  it('photo estimates only: the photo wording; the newest opens; See all with more than one', () => {
    const row = draftsRow([draft('a', '2026-10-16T08:00:00Z'), draft('b', '2026-10-16T12:00:00Z'), draft('c', null)]);
    expect(row).toEqual({ allPhotos: true, pluralBase: 'plan.nutrition.drafts', count: 3, newestId: 'b', showsSeeAll: true });
    expect(draftsRow([draft('a', null)])).toMatchObject({ newestId: 'a', showsSeeAll: false });
  });

  it('a description estimate among them makes it plain "estimate"', () => {
    const row = draftsRow([draft('a', '2026-10-16T08:00:00Z'), draft('t', '2026-10-16T07:00:00Z', 'text')]);
    expect(row).toMatchObject({ allPhotos: false, pluralBase: 'plan.nutrition.drafts_any', count: 2, newestId: 'a' });
  });

  it.each([
    ['en', 1, 'plan.nutrition.drafts', '1 photo estimate waiting for review'],
    ['en', 3, 'plan.nutrition.drafts_any', '3 estimates waiting for review'],
    ['is', 21, 'plan.nutrition.drafts_any', '21 mat bíður yfirferðar'],
    ['is', 11, 'plan.nutrition.drafts', '11 möt út frá myndum bíða yfirferðar'],
  ] as const)('%s, %i: %s', (language, count, base, text) => {
    expect(translatePlural(base, count, language)).toBe(text);
  });
});
