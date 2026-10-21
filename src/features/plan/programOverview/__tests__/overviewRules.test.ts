/**
 * The programme overview's rules (iOS ProgramOverviewView): the selected
 * week clamps to a week the plan has, the deload line shows only on the last
 * week, and Start is offered only for today's planned session a member may
 * run.
 */
import { decodeProgramDetail } from '../../../../health';
import { canStartFromOverview, clampWeek, initialWeek, showsDeloadNote, shownWeek, sortedWeeks, weekNote } from '../overviewRules';

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

describe('Start from a previewed day', () => {
  const today = '2026-10-21';
  const context = { readOnly: false, programPaused: false, today, hasPending: false };
  const session = { kind: 'strength' as const, scheduledFor: today, status: 'planned' as const };

  it("today's planned strength, cardio or mobility session may start", () => {
    expect(canStartFromOverview(session, context)).toBe(true);
    expect(canStartFromOverview({ ...session, kind: 'cardio' }, context)).toBe(true);
    expect(canStartFromOverview({ ...session, kind: 'mobility' }, context)).toBe(true);
    expect(canStartFromOverview({ ...session, status: null }, context)).toBe(true);
  });

  it('not a swim, a class or a rest day', () => {
    expect(canStartFromOverview({ ...session, kind: 'swim' }, context)).toBe(false);
    expect(canStartFromOverview({ ...session, kind: 'class' }, context)).toBe(false);
    expect(canStartFromOverview({ ...session, kind: null }, context)).toBe(false);
  });

  it('not another day, nor a session already done', () => {
    expect(canStartFromOverview({ ...session, scheduledFor: '2026-10-22' }, context)).toBe(false);
    expect(canStartFromOverview({ ...session, status: 'done' }, context)).toBe(false);
  });

  it('not read only, not on a paused plan, not with the workout waiting to sync', () => {
    expect(canStartFromOverview(session, { ...context, readOnly: true })).toBe(false);
    expect(canStartFromOverview(session, { ...context, programPaused: true })).toBe(false);
    expect(canStartFromOverview(session, { ...context, hasPending: true })).toBe(false);
  });
});
