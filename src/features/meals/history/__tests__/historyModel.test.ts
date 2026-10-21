/**
 * The meal calendar's rules (iOS MealHistoryView): window paging that stops
 * at `firstLogDate`, the month groups, the meta line, and the fill bar
 * (min(eatenMid / targetMid, 1), none without a target).
 */
import { decodeMealDaySummary, type MealDaySummary } from '../../../../health/models';
import { setCurrentLanguage, t, tp } from '../../../../i18n';
import { canLoadEarlier, dayFill, HISTORY_WINDOW_DAYS, metaLine, monthGroups, nextWindow } from '../historyModel';

function summary(date: string, extra: Record<string, unknown> = {}): MealDaySummary {
  return decodeMealDaySummary({ date, kcalLow: 1640, kcalHigh: 1640, proteinG: 92.4, mealCount: 3, ...extra }, 'day');
}

afterEach(() => setCurrentLanguage('en'));

describe('window paging', () => {
  it('reads 30 days ending today, then the 30 before the last window', () => {
    expect(HISTORY_WINDOW_DAYS).toBe(30);
    const first = nextWindow(null, '2026-10-16');
    expect(first).toEqual({ from: '2026-09-17', to: '2026-10-16' });
    expect(nextWindow(first!.from, '2026-10-16')).toEqual({ from: '2026-08-18', to: '2026-09-16' });
  });

  it('crosses a year and a leap day', () => {
    expect(nextWindow('2028-03-15', '2028-10-16')).toEqual({ from: '2028-02-14', to: '2028-03-14' });
    expect(nextWindow('2026-01-10', '2026-10-16')).toEqual({ from: '2025-12-11', to: '2026-01-09' });
  });

  it('offers Load earlier until the windows reach the first logged day', () => {
    expect(canLoadEarlier(null, null)).toBe(false); // the server named no first day
    expect(canLoadEarlier(null, '2026-09-17')).toBe(false);
    expect(canLoadEarlier('2026-01-02', null)).toBe(true);
    expect(canLoadEarlier('2026-01-02', '2026-09-17')).toBe(true);
    expect(canLoadEarlier('2026-09-17', '2026-09-17')).toBe(false);
    expect(canLoadEarlier('2026-09-20', '2026-09-17')).toBe(false);
  });
});

describe('month groups', () => {
  it('groups by month, newest month and day first, headed by the first of the month', () => {
    const groups = monthGroups([summary('2026-09-30'), summary('2026-10-02'), summary('2026-10-14'), summary('2026-09-01')], 'en');
    expect(groups.map((group) => [group.key, group.label, group.days.map((day) => day.date)])).toEqual([
      ['2026-10', '1 October', ['2026-10-14', '2026-10-02']],
      ['2026-09', '1 September', ['2026-09-30', '2026-09-01']],
    ]);
    expect(monthGroups([summary('2026-10-14')], 'is')[0]!.label).toBe('1. október');
  });
});

describe('the meta line', () => {
  it('says kcal, protein and meals, or the range, or Not logged', () => {
    expect(metaLine(summary('2026-10-14'), 'en', t, tp)).toBe('1,640 kcal · 92 g protein · 3 meals');
    expect(metaLine(summary('2026-10-14', { kcalLow: 1500, kcalHigh: 1800, mealCount: 1 }), 'en', t, tp)).toBe(
      '1,500 to 1,800 kcal · 92 g protein · 1 meal',
    );
    expect(metaLine(summary('2026-10-14', { mealCount: 0 }), 'en', t, tp)).toBe('Not logged');
    expect(metaLine(summary('2026-10-14', { kcalLow: null }), 'en', t, tp)).toBe('Not logged');
  });

  it('speaks Icelandic, with its own plural rule', () => {
    setCurrentLanguage('is');
    expect(metaLine(summary('2026-10-14', { mealCount: 21 }), 'is', t, tp)).toBe('1.640 kcal · 92 g prótein · 21 máltíð');
    expect(metaLine(summary('2026-10-14', { mealCount: 11 }), 'is', t, tp)).toBe('1.640 kcal · 92 g prótein · 11 máltíðir');
  });
});

describe('the fill bar', () => {
  const target = { kcalLow: 1800, kcalHigh: 2000, proteinG: 120 };

  it('is the eaten midpoint over the target midpoint, each to the nearest 10', () => {
    expect(dayFill(summary('2026-10-14', { kcalLow: 950, kcalHigh: 950, target }))).toBeCloseTo(950 / 1900, 4);
    expect(dayFill(summary('2026-10-14', { kcalLow: 944, kcalHigh: 944, target }))).toBeCloseTo(940 / 1900, 4);
  });

  it('never overfills', () => {
    expect(dayFill(summary('2026-10-14', { kcalLow: 4000, kcalHigh: 4000, target }))).toBe(1);
  });

  it('is absent without a target or without kcal', () => {
    expect(dayFill(summary('2026-10-14'))).toBeNull();
    expect(dayFill(summary('2026-10-14', { kcalLow: null, target }))).toBeNull();
    expect(dayFill(summary('2026-10-14', { target: { kcalLow: 0, kcalHigh: 0, proteinG: 0 } }))).toBeNull();
  });
});
