/**
 * The programme overview's rules (iOS ProgramOverviewView): the selected
 * week clamps to a week the plan has, and the deload line shows only on the
 * last week. Start in a preview is the Today card's rule
 * (../../today/__tests__/todayRules.test.ts).
 */
import { decodeProgramDetail } from '../../../../health';
import { clampWeek, initialWeek, showsDeloadNote, shownWeek, sortedWeeks, weekNote } from '../overviewRules';

const detail = (json: Record<string, unknown>) => decodeProgramDetail({ id: 'p-1', ...json }, 'program');

const fourWeeks = detail({
  weekNo: 2,
  weekPlans: [
    { weekNo: 3, deload: true, note: 'Heavier now' },
    { weekNo: 1, note: '' },
    { weekNo: 4, deload: true },
    { weekNo: 2 },
  ],
});

describe('the weeks', () => {
  it('are in order', () => {
    expect(sortedWeeks(fourWeeks).map((week) => week.weekNo)).toEqual([1, 2, 3, 4]);
    expect(sortedWeeks(null)).toEqual([]);
  });

  it('open on the current week', () => {
    expect(initialWeek(fourWeeks)).toBe(2);
  });

  it('a week the plan does not have lands on the first; a plan with no weeks keeps the choice', () => {
    expect(initialWeek(detail({ weekNo: 9, weekPlans: [{ weekNo: 1 }, { weekNo: 2 }] }))).toBe(1);
    expect(initialWeek(detail({ weekNo: null, weekPlans: [{ weekNo: 1 }] }))).toBe(1);
    expect(clampWeek(3, [])).toBe(3);
    expect(clampWeek(3, [{ weekNo: 2 }, { weekNo: 3 }])).toBe(3);
  });

  it('the week drawn is the selected one, else the first', () => {
    const weeks = sortedWeeks(fourWeeks);
    expect(shownWeek(weeks, 3)?.weekNo).toBe(3);
    expect(shownWeek(weeks, 7)?.weekNo).toBe(1);
    expect(shownWeek([], 1)).toBeNull();
  });
});

describe('the notes', () => {
  const weeks = sortedWeeks(fourWeeks);

  it('the deload line shows only on the LAST week, and only when it is a deload', () => {
    expect(showsDeloadNote(weeks, shownWeek(weeks, 4))).toBe(true);
    expect(showsDeloadNote(weeks, shownWeek(weeks, 3))).toBe(false);
    expect(showsDeloadNote(weeks, shownWeek(weeks, 2))).toBe(false);
    expect(showsDeloadNote(weeks, null)).toBe(false);
  });

  it('an empty note is no note', () => {
    expect(weekNote(shownWeek(weeks, 3))).toBe('Heavier now');
    expect(weekNote(shownWeek(weeks, 1))).toBeNull();
    expect(weekNote(shownWeek(weeks, 2))).toBeNull();
  });
});
