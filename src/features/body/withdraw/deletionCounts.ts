/**
 * What a withdrawal deleted, in the order a member would read it: the Android
 * port of iOS `HealthDeletionCounts` (Views/Health/BodyAndGoalsView.swift).
 *
 * OWNER RULING: SAY WHAT WAS DELETED. Withdrawing consent and "Delete all
 * health data" are one call (`POST /profile/health-consent { optedIn: false }`):
 * the server deletes every health row in the same transaction and answers
 * with how many of each went, and the member is shown those numbers rather
 * than a bare "done". A pure value, so the sheet is a function of the answer.
 */
import type { Translate } from '../model';

/** The server's counts, keyed by table (`deleted` on the consent answer). */
export type DeletedCounts = Readonly<Record<string, number>>;

export interface HealthDeletionCounts {
  readonly weights: number;
  readonly plans: number;
  readonly workouts: number;
  readonly reviews: number;
  readonly meals: number;
  /** Day summaries from a wearable (an iPhone's Apple Health), named neutrally on Android. */
  readonly daySummaries: number;
  readonly hadGoal: boolean;
  /**
   * Monthly feedback reports and mid-month notes. The switches row
   * (`feedbackSettings`) is not listed: it is a preference, not something
   * the member stored.
   */
  readonly feedbackReports: number;
}

/** The answer's counts mapped to what the sheet lists (a missing table is 0). */
export function deletionCounts(counts: DeletedCounts | null | undefined): HealthDeletionCounts {
  const count = (key: string): number => {
    const value = counts?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    weights: count('bodyMeasurements'),
    plans: count('coachPrograms'),
    workouts: count('coachProgramSessions'),
    reviews: count('weeklyReviews'),
    meals: count('mealLogs'),
    daySummaries: count('wearableDailyRecords'),
    hadGoal: count('nutritionSettings') > 0,
    feedbackReports: count('feedbackReports'),
  };
}

/** Nothing was stored: the sheet says so instead of listing nothing. */
export function isNothingDeleted(counts: HealthDeletionCounts): boolean {
  return (
    counts.weights === 0 &&
    counts.plans === 0 &&
    counts.workouts === 0 &&
    counts.reviews === 0 &&
    counts.meals === 0 &&
    counts.daySummaries === 0 &&
    !counts.hadGoal &&
    counts.feedbackReports === 0
  );
}

export type TranslatePlural = (base: string, count: number, params?: Readonly<Record<string, string | number>>) => string;

/**
 * The sheet's lines (iOS `DeletedEverythingSheet.lines`), each a plural in
 * the account language with the count grouped ("1.204 máltíðir"), and the
 * calorie goal last. The day summaries line is Android's own wording: iOS
 * says "from Apple Health", which nothing on Body and goals says here.
 */
export function deletionLines(
  counts: HealthDeletionCounts,
  tp: TranslatePlural,
  t: Translate,
  formatCount: (value: number) => string,
): string[] {
  const lines: string[] = [];
  const add = (base: string, count: number) => {
    if (count > 0) lines.push(tp(base, count, { count: formatCount(count) }));
  };
  add('bodygoals.deleted.weights', counts.weights);
  add('bodygoals.deleted.plans', counts.plans);
  add('bodygoals.deleted.workouts', counts.workouts);
  add('bodygoals.deleted.reviews', counts.reviews);
  add('bodygoals.deleted.meals', counts.meals);
  add('bodygoals.android.deleted.days', counts.daySummaries);
  add('bodygoals.deleted.feedback', counts.feedbackReports);
  if (counts.hadGoal) lines.push(t('bodygoals.deleted.goal'));
  return lines;
}
