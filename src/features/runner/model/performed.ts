/**
 * What Save sends: the Android port of iOS `WorkoutDoneBody` and
 * `RunnerState.performed()` (Views/Workout/FinishWorkoutSheet.swift,
 * WorkoutRunnerView.swift).
 *
 * `sessionActionBodySchema`'s `done` branch, exactly. The server's schema is
 * strict (`additionalProperties: false`, no nulls), so every optional member
 * is OMITTED when it has no value, never sent as null.
 */
import type { Feeling } from '../../../health/models';

import { doneCount, isSwapped, tracksLoad } from './exercise';
import {
  KG_CEILING,
  MAX_PERFORMED_EXERCISES,
  MAX_SETS_PER_EXERCISE,
  MAX_STOPWATCH_MINUTES,
  unitCeiling,
  type RunnerState,
} from './types';
import { roundHalfAwayFromZero } from '../../../i18n/format';

/** One set, in the block's own unit: `reps`, `seconds` or `meters`; `kg` only when the block tracks load. */
export interface PerformedSetBody {
  readonly reps?: number;
  readonly seconds?: number;
  readonly meters?: number;
  readonly kg?: number;
  readonly done: boolean;
}

/** One exercise of `performed`. */
export interface PerformedExerciseBody {
  readonly exerciseId: string;
  /** The planned exercise, when the member swapped it for this session. */
  readonly swappedFrom?: string;
  readonly skipped: boolean;
  /** A stopwatch row's minutes (the done seconds, rounded, 1 to 300). */
  readonly minutes?: number;
  readonly sets: readonly PerformedSetBody[];
}

/** `POST /health/sessions/{id}` with a runner's `done`. */
export interface WorkoutDoneBody {
  readonly action: 'done';
  readonly minutes?: number;
  readonly feeling?: string;
  readonly performed?: readonly PerformedExerciseBody[];
  readonly clientCompletedAt?: Date;
  readonly asExtra?: boolean;
}

/** A done body with every empty member left out (Swift's `encodeIfPresent`). */
export function workoutDoneBody(options: {
  readonly minutes?: number | null;
  readonly feeling?: string | null;
  readonly performed?: readonly PerformedExerciseBody[] | null;
  readonly clientCompletedAt?: Date | null;
  readonly asExtra?: boolean | null;
}): WorkoutDoneBody {
  return {
    action: 'done',
    ...(options.minutes !== null && options.minutes !== undefined ? { minutes: options.minutes } : {}),
    ...(options.feeling !== null && options.feeling !== undefined ? { feeling: options.feeling } : {}),
    ...(options.performed !== null && options.performed !== undefined ? { performed: options.performed } : {}),
    ...(options.clientCompletedAt ? { clientCompletedAt: options.clientCompletedAt } : {}),
    ...(options.asExtra !== null && options.asExtra !== undefined ? { asExtra: options.asExtra } : {}),
  };
}

/** The same body as an extra (`asExtra: true`), every other member kept: the same moment, minutes and sets. */
export function asExtraBody(body: WorkoutDoneBody): WorkoutDoneBody {
  return { ...body, asExtra: true };
}

/**
 * `performed`, in the wire's shape and within its ceilings (20 exercises, 12
 * sets, the value limits of `performedSetSchema`).
 */
export function performed(state: RunnerState): PerformedExerciseBody[] {
  return state.exercises.slice(0, MAX_PERFORMED_EXERCISES).map((exercise) => {
    const loads = tracksLoad(exercise);
    const sets = exercise.sets.slice(0, MAX_SETS_PER_EXERCISE).map((set): PerformedSetBody => {
      const value = Math.min(unitCeiling(exercise.unit), Math.max(0, set.value));
      const kg = loads && set.kg !== null && Number.isFinite(set.kg) ? Math.min(KG_CEILING, Math.max(0, set.kg)) : null;
      const measure =
        exercise.unit === 'reps' ? { reps: value } : exercise.unit === 'meters' ? { meters: value } : { seconds: value };
      return { ...measure, ...(kg !== null ? { kg } : {}), done: set.done };
    });
    let minutes: number | null = null;
    if (exercise.unit === 'minutes') {
      const seconds = exercise.sets.filter((set) => set.done).reduce((sum, set) => sum + set.value, 0);
      if (seconds > 0) minutes = Math.min(MAX_STOPWATCH_MINUTES, Math.max(1, roundHalfAwayFromZero(seconds / 60)));
    }
    return {
      exerciseId: exercise.exerciseId,
      ...(isSwapped(exercise) ? { swappedFrom: exercise.plannedExerciseId } : {}),
      skipped: exercise.skipped && doneCount(exercise) === 0,
      ...(minutes !== null ? { minutes } : {}),
      sets,
    };
  });
}

/**
 * The body Save sends for this runner: the minutes and feeling from the
 * finish sheet, every set, the moment fixed at the first attempt, and
 * `asExtra` only when it is one. An empty `performed` is left out.
 */
export function runnerDoneBody(
  state: RunnerState,
  options: { readonly minutes: number; readonly feeling: Feeling | null; readonly asExtra: boolean },
): WorkoutDoneBody {
  const sets = performed(state);
  return workoutDoneBody({
    minutes: options.minutes,
    feeling: options.feeling && options.feeling !== 'unknown' ? options.feeling : null,
    performed: sets.length > 0 ? sets : null,
    clientCompletedAt: state.completedAt,
    asExtra: options.asExtra ? true : null,
  });
}
