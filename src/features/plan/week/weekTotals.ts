/**
 * The week's line under the strip and the review's sessions line (iOS
 * `WeekTotalsCopy` in PlanWeekStrip.swift, API 0.35.0, `ios-ux.md` 3.8 and
 * 3.9).
 *
 * The plan's progress is always `done` of `planned`, so it can never read
 * "4 of 3". A workout logged as an extra adds to the total in front of it
 * ("4 workouts this week: 3 of 3 planned + 1 extra"), the website's words,
 * and only when the server says there was one: an older server (no
 * `extrasDone`) and a week without extras keep the plan's line as before.
 * Extras never count toward a streak; nothing here touches one.
 */
import type { WeeklyReviewView, WeekView } from '../../../health';
import type { Translator } from '../../../i18n';

export interface WeekTotalsCounts {
  readonly done: number;
  readonly planned: number;
  readonly extrasDone: number | null;
  readonly workoutsDone: number | null;
}

/**
 * The line: `plainKey` ("{done} of {planned} ...") without an extra, else
 * `extrasKey` with the week's total and its extras, each through the plural
 * rule of the language (Icelandic takes the singular for 21 too).
 */
export function weekTotalsLine(
  counts: WeekTotalsCounts,
  keys: { readonly plainKey: string; readonly extrasKey: string },
  translator: Pick<Translator, 't' | 'tp'>,
): string {
  const { t, tp } = translator;
  const params = { done: String(counts.done), planned: String(counts.planned) };
  const extras = counts.extrasDone;
  if (extras === null || extras <= 0) return t(keys.plainKey, params);
  // The server's total; the sum when it sent the extras without one. Never
  // below what the line itself adds up to.
  const total = Math.max(counts.workoutsDone ?? 0, counts.done + extras);
  return t(keys.extrasKey, {
    ...params,
    total: tp('plan.week.workouts', total),
    extras: tp('plan.week.extras', extras),
  });
}

/** The strip's line for `week` (iOS `WeekTotalsCopy.stripLine`). */
export function weekStripLine(
  week: Pick<WeekView, 'done' | 'planned' | 'extrasDone' | 'workoutsDone'>,
  translator: Pick<Translator, 't' | 'tp'>,
): string {
  return weekTotalsLine(
    { done: week.done ?? 0, planned: week.planned ?? 0, extrasDone: week.extrasDone, workoutsDone: week.workoutsDone },
    { plainKey: 'plan.week.progress', extrasKey: 'plan.week.progress_extras' },
    translator,
  );
}

/** The review's sessions line, or null when the review sends no counts (iOS `WeekTotalsCopy.reviewLine`). */
export function weekReviewLine(
  review: Pick<WeeklyReviewView, 'sessionsDone' | 'sessionsPlanned' | 'extrasDone' | 'workoutsDone'>,
  translator: Pick<Translator, 't' | 'tp'>,
): string | null {
  if (review.sessionsDone === null || review.sessionsPlanned === null) return null;
  return weekTotalsLine(
    { done: review.sessionsDone, planned: review.sessionsPlanned, extrasDone: review.extrasDone, workoutsDone: review.workoutsDone },
    { plainKey: 'review.sessions', extrasKey: 'review.sessions_extras' },
    translator,
  );
}
