/**
 * The exercise dose, read one way for every screen that names it: the Plan
 * Today card and the session preview (iOS `PlanCopy.exerciseLine`,
 * Views/Plan/PlanTodayCard.swift) and the workout runner (iOS
 * `RunnerExercise.dose`, Views/Workout/WorkoutRunnerView.swift).
 *
 * One place, because a session's exercise line reading "3 × 10 · Moderate" on
 * the Today card and "3x10 moderate" in the preview sheet is the kind of
 * difference a member reads as two different apps, and because the unit a
 * block is run in decides what the runner counts.
 *
 * The runner's own target line and spoken dose ("12 reps each side") are
 * `RunnerFormat.planLine` and `RunnerFormat.dose` (src/i18n/runnerFormat.ts),
 * re-exported here so Plan and the runner import their dose words from one
 * module.
 */
import { RunnerFormat, type RunnerDoseUnit } from '../i18n/runnerFormat';
import { wholeNumberOf } from '../i18n/format';

import type { ExerciseBlockView } from './models';

export { RunnerFormat, type RunnerDoseUnit };

/** A translator: a key and its `{placeholders}`, in the account language. */
export type DoseTranslate = (key: string, params?: Readonly<Record<string, string>>) => string;

/**
 * The unit a block is run in, and its per-set target (seconds for a timed
 * set or a stopwatch row), from the one dose the server sent.
 *
 * `minutes` is `seconds` restated for every cardio and swim block, INTERVALS
 * INCLUDED. So `minutes` alone never makes a block one stopwatch row: 6 × 45 s
 * of rowing arrives as sets 6, seconds 45, minutes 1, and is six timed sets.
 * Only a block of ONE set measured in minutes is the single stopwatch row.
 */
export function blockDose(
  sets: number,
  reps: number | null | undefined,
  seconds: number | null | undefined,
  minutes: number | null | undefined,
  meters: number | null | undefined,
): { unit: RunnerDoseUnit; target: number } {
  if (meters !== null && meters !== undefined && meters > 0) return { unit: 'meters', target: meters };
  const perSet = (seconds ?? 0) > 0 ? (seconds ?? 0) : (minutes ?? 0) * 60;
  if (perSet > 0) {
    const oneStopwatchRow = sets <= 1 && (minutes ?? 0) > 0;
    return { unit: oneStopwatchRow ? 'minutes' : 'seconds', target: perSet };
  }
  return { unit: 'reps', target: Math.max(0, reps ?? 0) };
}

/** The server's load hint as a word. An unknown hint prints nothing rather than a raw key. */
export function loadWord(hint: string | null | undefined, t: DoseTranslate): string {
  switch (hint) {
    case 'bodyweight':
      return t('plan.load.bodyweight', {});
    case 'light':
      return t('plan.load.light', {});
    case 'moderate':
      return t('plan.load.moderate', {});
    case 'heavy':
      return t('plan.load.heavy', {});
    default:
      return '';
  }
}

/** Swift's `trimmingCharacters(in: " ·")`: the separator left by an empty load word goes. */
function trimSeparators(text: string): string {
  return text.replace(/^[ ·]+|[ ·]+$/g, '');
}

/**
 * The block's one dose, the way the runner will run it: "3 × 10 · Moderate",
 * "3 × 8 each side · Bodyweight", "6 × 45 s", "2 × 30 s each side",
 * "3 × 2 min", "4 × 50 m", or "20 min" for a one-set cardio block.
 *
 * "Each side" is said for timed work too: a side plank or a suitcase carry is
 * dosed per side in seconds, and "2 × 30 s" alone reads as one side held once.
 */
export function exerciseLine(
  block: Pick<ExerciseBlockView, 'sets' | 'reps' | 'seconds' | 'minutes' | 'meters' | 'perSide' | 'loadHint'>,
  t: DoseTranslate,
): string {
  const sets = Math.max(1, block.sets ?? 1);
  const count = `${sets}`;
  const perSide = block.perSide === true;
  const dose = blockDose(sets, block.reps, block.seconds, block.minutes, block.meters);
  switch (dose.unit) {
    case 'meters':
      return t('plan.exercise_line_meters', { sets: count, meters: `${dose.target}` });
    case 'minutes':
      return t(perSide ? 'plan.exercise_line_minutes_per_side' : 'plan.exercise_line_minutes', {
        minutes: `${Math.max(1, wholeNumberOf(dose.target / 60))}`,
      });
    case 'seconds':
      if (dose.target >= 60 && dose.target % 60 === 0) {
        return t(perSide ? 'plan.exercise_line_timed_minutes_per_side' : 'plan.exercise_line_timed_minutes', {
          sets: count,
          minutes: `${dose.target / 60}`,
        });
      }
      return t(perSide ? 'plan.exercise_line_timed_per_side' : 'plan.exercise_line_timed', {
        sets: count,
        seconds: `${dose.target}`,
      });
    case 'reps':
    default:
      if (dose.target <= 0) {
        // No dose at all: say how many sets rather than "3 × 0". Icelandic
        // "sett" is the same word for one and many, so the English rule picks
        // the right form in both languages.
        return t(sets === 1 ? 'runner.summary.sets.one' : 'runner.summary.sets.many', { count });
      }
      return trimSeparators(
        t(perSide ? 'plan.exercise_line_per_side' : 'plan.exercise_line', {
          sets: count,
          reps: `${dose.target}`,
          load: loadWord(block.loadHint, t),
        }),
      );
  }
}
