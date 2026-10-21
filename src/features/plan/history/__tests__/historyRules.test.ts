/**
 * The history's words and grouping (iOS PlanHistory.swift), with the iOS
 * `WorkoutHistorySetLineTests` vectors ported as they are.
 */
import { decodeProgramSummary, decodeSessionHistoryItem, type PerformedSet } from '../../../../health';
import { translate, type Lang, type Params } from '../../../../i18n';
import {
  detailMetaLine,
  historyCardContent,
  isoMonday,
  planStatusKey,
  setLine,
  showsExtraKicker,
  sourceLine,
  weekGroups,
  workoutMetaLine,
  workoutRowLabel,
} from '../historyRules';

const tr = (lang: Lang) => (key: string, params?: Params) => translate(key, lang, params);
const en = tr('en');

const item = (json: Record<string, unknown>) => decodeSessionHistoryItem({ id: 'h-1', ...json }, 'item');
const set = (json: Partial<PerformedSet>): PerformedSet => ({ reps: null, seconds: null, meters: null, kg: null, done: true, ...json });

/** iOS `line(json, language:)`: set number 2. */
const line = (json: Partial<PerformedSet>, lang: Lang = 'en') => setLine(set(json), 2, tr(lang), lang);

describe('WorkoutHistorySetLineTests (iOS)', () => {
  it('a pool set is in metres, not zero reps', () => {
    expect(line({ meters: 50 })).toBe('Set 2: 50 m');
    expect(line({ meters: 50 }, 'is')).toBe('Sett 2: 50 m');
  });

  it('whole minutes read as minutes', () => {
    expect(line({ seconds: 600 })).toBe('Set 2: 10 min');
    expect(line({ seconds: 45 })).toBe('Set 2: 45 s');
  });

  it('reps keep their weight, and no dose is never zero reps', () => {
    expect(line({ reps: 10, kg: 12.5 })).toBe('Set 2: 10 reps, 12.5 kg');
    expect(line({})).toBe('Set 2');
    expect(line({ reps: 0 })).not.toContain('0 reps');
  });
});

describe('a set, in every unit', () => {
  it('reps without a weight, a plain set with a weight, and a held set of 90 s', () => {
    expect(line({ reps: 8 })).toBe('Set 2: 8 reps');
    expect(line({ kg: 20 })).toBe('Set 2, 20 kg');
    expect(line({ seconds: 90 })).toBe('Set 2: 90 s');
    expect(line({ reps: 10, kg: 12.5 }, 'is')).toBe('Sett 2: 10 endurt., 12,5 kg');
  });

  it('metres outrank seconds, seconds outrank reps', () => {
    expect(line({ meters: 25, seconds: 60, reps: 4 })).toBe('Set 2: 25 m');
    expect(line({ seconds: 120, reps: 4 })).toBe('Set 2: 2 min');
  });
});

describe('the weeks', () => {
  it('a week is named by its Monday, on the server calendar', () => {
    expect(isoMonday('2026-10-18')).toBe('2026-10-12'); // a Sunday stays in its own week
    expect(isoMonday('2026-10-12')).toBe('2026-10-12');
    expect(isoMonday('2026-10-14')).toBe('2026-10-12');
    expect(isoMonday('2027-01-01')).toBe('2026-12-28'); // across the year
    expect(isoMonday('not a day')).toBeNull();
  });

  it('groups by ISO Monday in the order the server sent them, leaving out a workout with no day', () => {
    const groups = weekGroups([
      item({ id: 'a', date: '2026-10-19' }),
      item({ id: 'b', date: '2026-10-18' }),
      item({ id: 'c', date: '2026-10-12' }),
      item({ id: 'd', date: null }),
      item({ id: 'e', date: '2026-10-05' }),
    ]);
    expect(groups.map((group) => [group.week, group.items.map((i) => i.id)])).toEqual([
      ['2026-10-19', ['a']],
      ['2026-10-12', ['b', 'c']],
      ['2026-10-05', ['e']],
    ]);
  });
});

describe('a workout', () => {
  it('the list meta: the length and the feeling, or the length alone', () => {
    expect(workoutMetaLine(item({ minutes: 40, feeling: 'ok' }), en, 'en')).toBe('40 min · Just right');
    expect(workoutMetaLine(item({ minutes: 75 }), en, 'en')).toBe('1 h 15 min');
    expect(workoutMetaLine(item({}), en, 'en')).toBe('0 min');
  });

  it('the detail meta: the day, a length when there is one, the feeling', () => {
    expect(detailMetaLine(item({ date: '2026-10-15', minutes: 40, feeling: 'hard' }), en, 'en')).toBe('Thu 15 Oct · 40 min · Hard');
    expect(detailMetaLine(item({ date: '2026-10-15', minutes: 0 }), en, 'en')).toBe('Thu 15 Oct');
  });

  it('where it was counted from: a check-in names the venue; a synced workout names no brand', () => {
    expect(sourceLine(item({ doneSource: 'check_in', checkInVenueName: 'Laugardalslaug' }), en)).toBe(
      en('plan.done_source.check_in', { venue: 'Laugardalslaug' }),
    );
    const synced = sourceLine(item({ doneSource: 'wearable' }), en);
    expect(synced).toBe(en('plan4.done_source.synced'));
    expect(synced).not.toContain('Apple');
    expect(sourceLine(item({ doneSource: 'member' }), en)).toBeNull();
  });

  it('"Extra workout" over an extra, unless the server already titled it so', () => {
    expect(showsExtraKicker(item({ isExtra: true, title: 'Gym' }), en)).toBe(true);
    expect(showsExtraKicker(item({ isExtra: true, title: en('history.workout.extra') }), en)).toBe(false);
    expect(showsExtraKicker(item({ isExtra: false, title: 'Gym' }), en)).toBe(false);
  });

  it('TalkBack hears the day, the extra, the title, the meta and the status word', () => {
    expect(workoutRowLabel(item({ date: '2026-10-15', isExtra: true, title: 'Gym', minutes: 30, status: 'done' }), en, 'en')).toBe(
      'Thu 15 Oct, Extra workout, Gym, 30 min, done',
    );
  });
});

describe('a past plan', () => {
  const plan = (json: Record<string, unknown>) => decodeProgramSummary({ id: 'p', ...json }, 'plan');

  it('Not started, Updated, Completed, or Ended early, in that order', () => {
    expect(planStatusKey(plan({ notStarted: true, revised: true, status: 'completed' }))).toBe('history.plan.not_started');
    expect(planStatusKey(plan({ revised: true, status: 'abandoned' }))).toBe('history.plan.revised');
    expect(planStatusKey(plan({ status: 'completed' }))).toBe('history.plan.completed');
    expect(planStatusKey(plan({ status: 'abandoned' }))).toBe('history.plan.ended');
  });
});

describe('the card on Plan', () => {
  it('shows with workouts or a day with a logged meal, and counts only days with meals', () => {
    expect(historyCardContent(null)).toBeNull();
    expect(historyCardContent({ workouts: [], mealDays: [{ mealCount: 0 }] })).toBeNull();
    expect(historyCardContent({ workouts: [], mealDays: [{ mealCount: 2 }, { mealCount: 0 }, { mealCount: null }] })).toEqual({
      latestWorkoutDate: null,
      loggedDays: 1,
    });
    expect(historyCardContent({ workouts: [item({ date: '2026-10-15' })], mealDays: null })).toEqual({
      latestWorkoutDate: '2026-10-15',
      loggedDays: 0,
    });
  });
});
