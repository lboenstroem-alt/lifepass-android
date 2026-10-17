/**
 * The in-progress workout as the runner holds it and `runner.json` stores
 * it: the Android port of the types at the top of iOS
 * Views/Workout/WorkoutRunnerView.swift (`RunnerEntry` through
 * `RunnerState`).
 *
 * THE TIME RULE. A rest, a timed set and the active clock are DATES, never
 * counters. A counter stops when the app is in the background or the process
 * is killed; a date does not, so the countdown on screen, the one restored
 * after a relaunch, and the rest-over notification can never disagree.
 *
 * Every value here is immutable: the rules in ./state.ts take a state and the
 * time and return a new state, so a test can hold them to the iOS cases
 * without a device, and React sees a new object for every change.
 */
import type { RunnerDoseUnit } from '../../../i18n/runnerFormat';
import type { ExerciseAlternative, SessionView } from '../../../health';
import type { RunnerEntry } from '../../../navigation/types';

export type { RunnerDoseUnit } from '../../../i18n/runnerFormat';
export type { RunnerTimerPhase } from '../../../i18n/runnerFormat';
export type { RunnerEntry } from '../../../navigation/types';

/** Every unit a block can be dosed in, for the decoders. */
export const RUNNER_DOSE_UNITS: readonly RunnerDoseUnit[] = ['reps', 'seconds', 'minutes', 'meters'];

/** Every place a runner can be opened from. */
export const RUNNER_ENTRIES: readonly RunnerEntry[] = ['today', 'missed', 'resume'];

/**
 * One set as it will be logged. `value` is reps, seconds or metres (seconds
 * for a stopwatch row), prefilled with the target, so "Complete set" logs the
 * plan when the member changes nothing.
 */
export interface RunnerSet {
  readonly value: number;
  readonly kg: number | null;
  readonly done: boolean;
}

/** One block of the session, with what the member has done in it so far. */
export interface RunnerExercise {
  /**
   * The block's exercise as the server SHOWED it (after progression). Every
   * swap is relative to it, and `swappedFrom` names it.
   */
  readonly plannedExerciseId: string;
  readonly plannedName: string;
  readonly plannedEquipment: string | null;
  readonly plannedEquipmentLabel: string | null;
  /** The planned dose, so "Back to the planned exercise" puts the unit back as well as the name. */
  readonly plannedUnit: RunnerDoseUnit;
  readonly plannedTarget: number;
  readonly plannedPerSide: boolean;
  readonly exerciseId: string;
  readonly name: string;
  readonly equipment: string | null;
  readonly equipmentLabel: string | null;
  readonly blockNo: number;
  /** The server's pattern slug (`cardio`, `swim`, `squat`...), read for the kg column only. */
  readonly pattern: string | null;
  readonly patternLabel: string;
  /** The unit and dose ON SCREEN: the planned ones, or the alternative's after a swap. */
  readonly unit: RunnerDoseUnit;
  /** The dose per set, in `unit` (seconds for `minutes`). */
  readonly target: number;
  readonly perSide: boolean;
  readonly restSec: number;
  readonly loadHint: string | null;
  readonly plannedCues: readonly string[];
  /** The precomputed alternatives, relative to the PLANNED exercise. The runner never offers anything else. */
  readonly alternatives: readonly ExerciseAlternative[];
  readonly lastLoadKg: number | null;
  readonly sets: readonly RunnerSet[];
  /** Skipped with nothing done: `performed[].skipped = true`. */
  readonly skipped: boolean;
  /**
   * Skipped after at least one set was done: the done sets are logged as
   * done, the open ones as not done, and the exercise is not "skipped" (the
   * member did it, just not all of it).
   */
  readonly endedEarly: boolean;
  /** A cardio block's stopwatch, when the member started it. */
  readonly stopwatchStartedAt: Date | null;
}

/**
 * A timed set counting down in place.
 *
 * A HOLD DOSED EACH SIDE COUNTS DOWN ONCE PER SIDE. A side plank at "30 s
 * each side" is 30 seconds on one side, a short changeover, and 30 seconds on
 * the other; `sideSeconds` is set for such a set, and `endsAt` is the end of
 * the SECOND side. Every phase is read from dates, never from a counter.
 */
export interface RunnerTimer {
  readonly exercise: number;
  readonly set: number;
  readonly startedAt: Date;
  readonly endsAt: Date;
  /** The seconds of ONE side, for a set dosed each side; null for a hold done once (and in an older file). */
  readonly sideSeconds: number | null;
}

/** What ticking a set led to. */
export type RunnerTickOutcome =
  /** More work follows, so a rest started. */
  | { readonly kind: 'restStarted'; readonly endsAt: Date }
  /** Nothing is left anywhere: the next thing is Finish. */
  | { readonly kind: 'workoutComplete' };

/** The one full-width button at the bottom. */
export type RunnerPrimaryAction =
  /**
   * A timed set that has not started: the big button starts its countdown,
   * so a member who follows the button times the set (the countdown ticks it
   * at zero).
   */
  | { readonly kind: 'startTimer'; readonly number: number }
  | { readonly kind: 'completeSet'; readonly number: number }
  | { readonly kind: 'next' }
  | { readonly kind: 'finish' };

/** A swap the sheet can offer: an alternative, or the way back. */
export interface RunnerSwapOption {
  readonly exerciseId: string;
  readonly name: string;
  readonly equipmentLabel: string | null;
  /** `easier`, `same` or `harder`, relative to what is on screen NOW. */
  readonly level: string;
  readonly isPlanned: boolean;
  /** The dose it would run with, so the sheet can say "3 × 30 s" when a swap changes how it is measured. */
  readonly unit: RunnerDoseUnit;
  readonly target: number;
  readonly perSide: boolean;
}

/** What Undo needs to put back after a skipped exercise. */
export interface RunnerSkipUndo {
  readonly exercise: number;
  readonly previous: RunnerExercise;
  readonly previousIndex: number;
}

/** "Exercises with at least one set done, of all; and every set done." */
export interface RunnerSummary {
  readonly exercises: number;
  readonly total: number;
  readonly sets: number;
}

/**
 * Everything `runner.json` holds: the session it runs, when it started,
 * where the member is, every set, local swaps, the rest's end, the active
 * clock and the finish Idempotency-Key.
 */
export interface RunnerState {
  /** `RUNNER_STATE_VERSION`; a file of any other version is ignored rather than half-read. */
  readonly version: number;
  readonly sessionId: string;
  /** The session as it was when the runner opened, so a relaunch can resume offline and for a past date. */
  readonly session: SessionView;
  /** `today` or `missed`: which rule the save follows. Never `resume`. */
  readonly origin: RunnerEntry;
  readonly startedAt: Date;
  /** The last Iceland day this file is honoured. */
  readonly keepUntilDay: string;
  readonly exercises: readonly RunnerExercise[];
  readonly index: number;
  readonly restEndsAt: Date | null;
  readonly restTotalSeconds: number | null;
  readonly timer: RunnerTimer | null;
  /** Minted when the finish sheet first opens, reused for every retry of the same Save. */
  readonly finishKey: string | null;
  /** Fixed at the first Save attempt, so a retry, an outbox item and its conversion all carry the same moment. */
  readonly completedAt: Date | null;

  // THE ACTIVE CLOCK. Minutes are what the member TRAINED, not the wall time
  // since Start: "Finish later today" stops the clock, and time away from the
  // app counts only up to the away credit. The top bar and the finish
  // sheet's prefill both read it.

  /** Active seconds banked before the running segment. */
  readonly clockSeconds: number;
  /** When the running segment started; null while the clock is stopped. */
  readonly clockRunningSince: Date | null;
  /**
   * The clock stopped because the app left the foreground at this moment:
   * the return credits the time away, up to the limit. Null when it stopped
   * for "Finish later today" (nothing is credited).
   */
  readonly clockAwaySince: Date | null;
  /** The last moment this file was written by a live runner, so a process that died with the clock running does not count the hours since. */
  readonly lastSeenAt: Date;
}

/** 2: the active clock, per-block dose after a swap, "ended early". */
export const RUNNER_STATE_VERSION = 2;

/** The rest when the block names none. */
export const DEFAULT_REST_SECONDS = 60;

/** How far the rest's -15 and +15 move it. */
export const REST_STEP_SECONDS = 15;

/**
 * Time away from the app that still counts as workout time: a rest with the
 * phone locked, a set done with the phone in a pocket. Past it, the member
 * stopped (a call, a coffee, "later").
 */
export const AWAY_CREDIT_SECONDS = 10 * 60;

/** With a cardio stopwatch running the member is working while the phone is locked, up to the stopwatch's own ceiling. */
export const AWAY_CREDIT_STOPWATCH_SECONDS = 60 * 60;

/** The changeover between the sides of a hold done each side. */
export const TIMER_SWITCH_SECONDS = 5;

/** One tap of the kg stepper, and its ceiling. */
export const KG_STEP = 2.5;
export const KG_CEILING = 500;

/** The wire's ceilings on `performed` (`performedSetSchema`). */
export const MAX_PERFORMED_EXERCISES = 20;
export const MAX_SETS_PER_EXERCISE = 12;
export const MAX_STOPWATCH_MINUTES = 300;

/** How far one tap of `-` or `+` moves a value in `unit`. */
export function unitStep(unit: RunnerDoseUnit): number {
  switch (unit) {
    case 'reps':
      return 1;
    case 'seconds':
      return 5;
    case 'minutes':
      return 60;
    case 'meters':
      return 25;
  }
}

/** The server's ceiling for a logged value in `unit` (`performedSetSchema`). */
export function unitCeiling(unit: RunnerDoseUnit): number {
  switch (unit) {
    case 'reps':
      return 100;
    case 'seconds':
    case 'minutes':
      return 3600;
    case 'meters':
      return 2000;
  }
}
