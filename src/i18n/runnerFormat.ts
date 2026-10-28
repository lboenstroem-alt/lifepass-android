// The workout runner's words: a port of iOS RunnerFormat
// (Views/Workout/WorkoutRunnerView.swift). Pure functions of the account
// language, so the runner screen and its rest notification (RUN-2), the swap
// and finish sheets (RUN-3) and anything else that names a set say a dose the
// same way.
//
// - A count is said in words with the Icelandic plural rule (`pluralKey`:
//   "21 endurtekning", "11 endurtekningar") and grouped in the account
//   language ("1.200 metrar").
// - A timed set of a minute or more is said in minutes ("8 minutes 20
//   seconds", "2 mínútur"), never as "500 seconds".
// - "Each side" wraps only reps and seconds: a stopwatch row or a length
//   count is never per side.
//
// Each Swift `Int` parameter is read through `wholeNumberOf`, so a fraction
// from `ms / 1000` never prints "1:05.7".
//
// Imported from this file, not from the i18n barrel (it reads the barrel's
// lookup, so the barrel cannot re-export it without a cycle):
//
//   import { RunnerFormat } from '../../i18n/runnerFormat';
//   RunnerFormat.dose('reps', 12, true, language) // "12 reps each side"
import { lookup, pluralKey, type Lang } from '.';
import { decimal, integer, roundHalfAwayFromZero, wholeNumberOf } from './format';

/** What one set of a block is counted in (iOS `RunnerDoseUnit`). */
export type RunnerDoseUnit = 'reps' | 'seconds' | 'minutes' | 'meters';

/**
 * Where a counting set is (iOS `RunnerTimer.Phase`): a hold done once, side
 * 1 or 2 of a hold done each side, the changeover between the sides, or over.
 * `remaining` is whole seconds.
 */
export type RunnerTimerPhase =
  | { readonly kind: 'single'; readonly remaining: number }
  | { readonly kind: 'side'; readonly side: number; readonly remaining: number }
  | { readonly kind: 'switching'; readonly remaining: number }
  | { readonly kind: 'ended' };

/** A translator bound to the account language (the Swift's `t: (String, [String: String]) -> String`). */
export type RunnerTranslate = (key: string, params: Readonly<Record<string, string>>) => string;

/** "1:05", "0:09", "1:00:05". */
function clock(seconds: number): string {
  const value = Math.max(0, wholeNumberOf(seconds));
  const hours = Math.trunc(value / 3600);
  const minutes = Math.trunc((value % 3600) / 60);
  const secs = value % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(secs)}` : `${minutes}:${two(secs)}`;
}

/** A plural key's form for `count`, with `{count}` grouped in the language ("1.200 metrar"). */
function counted(base: string, count: number, language: Lang): string {
  const whole = wholeNumberOf(count);
  return lookup(pluralKey(base, whole, language), language).split('{count}').join(integer(whole, language));
}

/** "1 minute 30 seconds", for TalkBack: the minutes when there are any, the seconds when there are any or nothing else. */
function spokenDuration(seconds: number, language: Lang): string {
  const whole = wholeNumberOf(seconds);
  // Swift's Int `/` and `%` truncate toward zero; so do these.
  const minutes = Math.trunc(whole / 60);
  const rest = whole % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(counted('runner.dose.minutes', minutes, language));
  if (rest > 0 || minutes === 0) parts.push(counted('runner.dose.seconds', rest, language));
  return parts.join(' ');
}

/**
 * "10 reps", "40 seconds", "2 minutes", "100 metres": one set's dose in
 * words. A timed set of a minute or more is said in minutes ("8 minutes 20
 * seconds"); a `minutes` block is counted in seconds and said in whole
 * minutes. Reps and seconds done each side read "12 reps each side".
 */
function dose(unit: RunnerDoseUnit, value: number, perSide: boolean, language: Lang): string {
  const whole = wholeNumberOf(value);
  let words: string;
  switch (unit) {
    case 'reps':
      words = counted('runner.dose.reps', whole, language);
      break;
    case 'seconds':
      words = whole >= 60 ? spokenDuration(whole, language) : counted('runner.dose.seconds', whole, language);
      break;
    case 'meters':
      words = counted('runner.dose.meters', whole, language);
      break;
    case 'minutes':
      words = counted('runner.dose.minutes', roundHalfAwayFromZero(whole / 60), language);
      break;
  }
  if (!perSide || (unit !== 'reps' && unit !== 'seconds')) return words;
  return lookup('runner.dose.per_side', language).split('{dose}').join(words);
}

/**
 * "3 × 10", "3 × 8 each side", "6 × 45 s", "2 × 30 s each side", "3 × 2 min",
 * "4 × 50 m", "20 min": a block's planned dose, with the load word after it
 * when there is one (reps and seconds only). The runner's target line and
 * the swap sheet. A timed set is written in minutes only when it is whole
 * minutes ("3 × 2 min", but "3 × 500 s").
 */
function planLine(
  unit: RunnerDoseUnit,
  target: number,
  sets: number,
  perSide: boolean,
  t: RunnerTranslate,
  load = '',
): string {
  const count = String(wholeNumberOf(sets));
  const whole = wholeNumberOf(target);
  let line: string;
  switch (unit) {
    case 'reps':
      line = t(perSide ? 'runner.exercise_line_per_side' : 'runner.exercise_line_reps', { sets: count, reps: String(whole) });
      break;
    case 'seconds':
      line =
        whole >= 60 && whole % 60 === 0
          ? t(perSide ? 'runner.exercise_line_timed_minutes_per_side' : 'runner.exercise_line_timed_minutes', {
              sets: count,
              minutes: String(whole / 60),
            })
          : t(perSide ? 'runner.exercise_line_timed_per_side' : 'runner.exercise_line_timed', {
              sets: count,
              seconds: String(whole),
            });
      break;
    case 'meters':
      line = t('runner.exercise_line_meters', { sets: count, meters: String(whole) });
      break;
    case 'minutes':
      line = t('runner.exercise_line_minutes', { minutes: String(Math.max(1, roundHalfAwayFromZero(whole / 60))) });
      break;
  }
  if (!load || (unit !== 'reps' && unit !== 'seconds')) return line;
  return t('runner.exercise_line_load', { dose: line, load });
}

/** A timed set's capsule from a minute up ("2:00"); null below, where the capsule says "45 s". */
function timerAmount(seconds: number): string | null {
  return wholeNumberOf(seconds) >= 60 ? clock(seconds) : null;
}

/**
 * The counting capsule: "25 s left"; each side, "Side 1: 25 s left",
 * "Switch sides: 4 s", "Side 2: 1:05 left".
 */
function timerTitle(phase: RunnerTimerPhase, t: RunnerTranslate): string {
  switch (phase.kind) {
    case 'single': {
      const amount = timerAmount(phase.remaining);
      return amount !== null
        ? t('runner.timer_left_clock', { time: amount })
        : t('runner.timer_left', { seconds: String(wholeNumberOf(phase.remaining)) });
    }
    case 'side': {
      const amount = timerAmount(phase.remaining);
      const side = String(phase.side);
      return amount !== null
        ? t('runner.timer_side_left_clock', { side, time: amount })
        : t('runner.timer_side_left', { side, seconds: String(wholeNumberOf(phase.remaining)) });
    }
    case 'switching':
      return t('runner.switch_sides_left', { seconds: String(wholeNumberOf(phase.remaining)) });
    case 'ended':
      return t('runner.timer_left', { seconds: '0' });
  }
}

/** The capsule for TalkBack, in words: "Side 1: 25 seconds left", "Switch sides". */
function timerSpoken(phase: RunnerTimerPhase, language: Lang, t: RunnerTranslate): string {
  switch (phase.kind) {
    case 'single':
      return t('runner.timer_left_clock', { time: spokenDuration(phase.remaining, language) });
    case 'side':
      return t('runner.timer_side_left_clock', { side: String(phase.side), time: spokenDuration(phase.remaining, language) });
    case 'switching':
      return t('runner.switch_sides', {});
    case 'ended':
      return t('runner.timer_left_clock', { time: spokenDuration(0, language) });
  }
}

/** A load in kg, one decimal at most: "12.5" / "12,5". */
function kg(value: number, language: Lang): string {
  return decimal(value, language);
}

/** The finish line's count: "1 of 4 exercises · 1 set", "3 af 21 æfingu · 21 sett". */
function summary(progress: { readonly exercises: number; readonly total: number; readonly sets: number }, language: Lang): string {
  const total = wholeNumberOf(progress.total);
  const exercises = lookup(pluralKey('runner.summary.exercises', total, language), language)
    .split('{done}')
    .join(integer(wholeNumberOf(progress.exercises), language))
    .split('{count}')
    .join(integer(total, language));
  return lookup('runner.summary', language)
    .split('{exercises}')
    .join(exercises)
    .split('{sets}')
    .join(counted('runner.summary.sets', progress.sets, language));
}

/** iOS `RunnerFormat`, under its own name so a port of the Swift reads like the Swift. */
export const RunnerFormat = {
  clock,
  counted,
  spokenDuration,
  dose,
  planLine,
  timerAmount,
  timerTitle,
  timerSpoken,
  kg,
  summary,
} as const;
