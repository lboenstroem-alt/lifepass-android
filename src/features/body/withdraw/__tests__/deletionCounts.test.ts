/**
 * What a withdrawal deleted (iOS `HealthDeletionCounts` and
 * `DeletedEverythingSheet.lines`): which server table feeds which line, the
 * order, the plurals in both languages, and "nothing was stored".
 */
import { HealthFormat, translate, translatePlural, type Lang } from '../../../../i18n';
import { deletionCounts, deletionLines, isNothingDeleted } from '../deletionCounts';

/** The answer a full account gives (the iOS screenshot fixture's counts, plus feedback). */
const FULL = {
  bodyMeasurements: 24,
  coachPrograms: 2,
  coachProgramSessions: 31,
  weeklyReviews: 6,
  mealLogs: 58,
  wearableDailyRecords: 62,
  wearableConnections: 1,
  nutritionSettings: 1,
  feedbackReports: 3,
  feedbackSettings: 1,
};

function lines(counts: Record<string, number>, lang: Lang): string[] {
  return deletionLines(
    deletionCounts(counts),
    (base, count, params) => translatePlural(base, count, lang, params),
    (key, params) => translate(key, lang, params),
    (value) => HealthFormat.integer(value, lang),
  );
}

describe('the counts map from the server tables', () => {
  it('bodyMeasurements, coachPrograms, coachProgramSessions, weeklyReviews, mealLogs, wearableDailyRecords, nutritionSettings, feedbackReports', () => {
    expect(deletionCounts(FULL)).toEqual({
      weights: 24,
      plans: 2,
      workouts: 31,
      reviews: 6,
      meals: 58,
      daySummaries: 62,
      hadGoal: true,
      feedbackReports: 3,
    });
  });

  it('a table the answer leaves out is 0; no answer at all is nothing', () => {
    expect(deletionCounts({ mealLogs: 2 })).toMatchObject({ weights: 0, meals: 2, hadGoal: false });
    expect(isNothingDeleted(deletionCounts(null))).toBe(true);
    expect(isNothingDeleted(deletionCounts({}))).toBe(true);
  });

  it('a preference or a connection alone is not something the member stored', () => {
    expect(isNothingDeleted(deletionCounts({ feedbackSettings: 1, wearableConnections: 1 }))).toBe(true);
    expect(isNothingDeleted(deletionCounts({ nutritionSettings: 1 }))).toBe(false);
    expect(isNothingDeleted(deletionCounts({ feedbackReports: 1 }))).toBe(false);
  });
});

describe('the lines', () => {
  it('in reading order, the goal last, every plural in English', () => {
    expect(lines(FULL, 'en')).toEqual([
      '24 weight entries',
      '2 plans',
      '31 workouts',
      '6 weekly reviews',
      '58 meals',
      '62 daily health summaries',
      '3 monthly feedback reports',
      'Your calorie goal',
    ]);
  });

  it('Icelandic plurals: 21 and 31 are singular, 11 is not; counts are grouped', () => {
    expect(lines({ bodyMeasurements: 21, mealLogs: 11, coachProgramSessions: 1204, wearableDailyRecords: 31 }, 'is')).toEqual([
      '21 þyngdarfærsla',
      '1.204 æfingar',
      '11 máltíðir',
      '31 daglegt heilsuyfirlit',
    ]);
  });

  it('one of each reads as one', () => {
    expect(lines({ bodyMeasurements: 1, coachPrograms: 1, wearableDailyRecords: 1 }, 'en')).toEqual([
      '1 weight entry',
      '1 plan',
      '1 daily health summary',
    ]);
  });

  it('never names Apple Health (Android says "daily health summaries")', () => {
    for (const lang of ['en', 'is'] as const) {
      expect(lines(FULL, lang).join(' ')).not.toMatch(/Apple Health/);
    }
  });
});
