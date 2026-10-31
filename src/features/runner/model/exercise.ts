/**
 * One block of the session as the runner runs it: the Android port of iOS
 * `RunnerExercise` (Views/Workout/WorkoutRunnerView.swift). How a server
 * block becomes rows of sets, which unit it is counted in, when the kg column
 * shows, and how an alternative would be dosed.
 */
import { blockDose } from '../../../health/doseCopy';
import { restSecondsResolved, type ExerciseAlternative, type ExerciseBlockView } from '../../../health/models';

import { MAX_SETS_PER_EXERCISE, unitCeiling, type RunnerDoseUnit, type RunnerExercise } from './types';

/** Swapped away from the planned exercise. */
export function isSwapped(exercise: RunnerExercise): boolean {
  return exercise.exerciseId !== exercise.plannedExerciseId;
}

/** Nothing more will be done here: skipped, or the rest of it skipped. */
export function isClosed(exercise: RunnerExercise): boolean {
  return exercise.skipped || exercise.endedEarly;
}

/** Cues belong to the planned exercise; a swap shows none rather than the wrong ones. At most three. */
export function cuesOf(exercise: RunnerExercise): readonly string[] {
  return isSwapped(exercise) ? [] : exercise.plannedCues.slice(0, 3);
}

/**
 * The kg column: hidden for bodyweight, pool and outdoor equipment, for
 * cardio and swim work (a rowing interval has no load), and for blocks
 * measured in minutes or metres.
 */
export function tracksLoad(exercise: Pick<RunnerExercise, 'unit' | 'pattern' | 'equipment' | 'loadHint'>): boolean {
  if (exercise.unit !== 'reps' && exercise.unit !== 'seconds') return false;
  if (exercise.pattern !== null && (exercise.pattern === 'cardio' || exercise.pattern === 'swim')) return false;
  if (exercise.equipment !== null) {
    return !['bodyweight', 'pool', 'outdoor'].includes(exercise.equipment);
  }
  return exercise.loadHint !== 'bodyweight';
}

export function doneCount(exercise: RunnerExercise): number {
  return exercise.sets.filter((set) => set.done).length;
}

export function isComplete(exercise: RunnerExercise): boolean {
  return isClosed(exercise) || exercise.sets.every((set) => set.done);
}

/** The first set not done yet, or null when there is none or the exercise is closed. */
export function nextOpenSet(exercise: RunnerExercise): number | null {
  if (isClosed(exercise)) return null;
  const index = exercise.sets.findIndex((set) => !set.done);
  return index >= 0 ? index : null;
}

/**
 * The unit a block is run in, from the one dose the server sent.
 *
 * `minutes` is `seconds` restated for every cardio and swim block, INTERVALS
 * INCLUDED. So `minutes` alone never makes a block one stopwatch row: 6 x 45 s
 * of rowing arrives as sets 6, seconds 45, minutes 1, and is six timed sets.
 * Only a block of ONE set measured in minutes is the single stopwatch row.
 * (The rule itself lives in src/health/doseCopy.ts, so Plan reads a block
 * the same way.)
 */
export function exerciseDose(
  sets: number,
  reps: number | null,
  seconds: number | null,
  minutes: number | null,
  meters: number | null,
): { readonly unit: RunnerDoseUnit; readonly target: number } {
  return blockDose(sets, reps, seconds, minutes, meters);
}

/**
 * The runner's row for a server block, or null for a block with no exercise
 * id (nothing the server would accept in `performed`).
 */
export function exerciseFromBlock(block: ExerciseBlockView, index: number): RunnerExercise | null {
  const exerciseId = block.exerciseId;
  if (!exerciseId) return null;
  // Everything keeps the server's set count, within the wire's ceiling of
  // 12; a block measured in minutes is one row.
  const serverSets = Math.min(MAX_SETS_PER_EXERCISE, Math.max(1, block.sets ?? 1));
  const dose = exerciseDose(serverSets, block.reps, block.seconds, block.minutes, block.meters);
  const count = dose.unit === 'minutes' ? 1 : serverSets;
  const target = Math.min(unitCeiling(dose.unit), dose.target);
  // Reps and timed work can be each side (a lunge, a side plank); a
  // stopwatch row or a length count never is.
  const perSide = (dose.unit === 'reps' || dose.unit === 'seconds') && (block.perSide ?? false);
  const base = {
    plannedExerciseId: exerciseId,
    plannedName: block.name ?? '',
    plannedEquipment: block.equipment,
    plannedEquipmentLabel: block.equipmentLabel,
    plannedUnit: dose.unit,
    plannedTarget: target,
    plannedPerSide: perSide,
    exerciseId,
    name: block.name ?? '',
    equipment: block.equipment,
    equipmentLabel: block.equipmentLabel,
    blockNo: block.blockNo ?? index + 1,
    pattern: block.pattern,
    patternLabel: block.patternLabel ?? '',
    unit: dose.unit,
    target,
    perSide,
    restSec: restSecondsResolved(block) ?? 0,
    loadHint: block.loadHint,
    plannedCues: block.cues ?? [],
    alternatives: (block.alternatives ?? []).filter((alternative) => alternative.exerciseId !== exerciseId),
    lastLoadKg: block.lastLoadKg,
    skipped: false,
    endedEarly: false,
    stopwatchStartedAt: null,
  };
  const prefillKg = tracksLoad(base) ? block.lastLoadKg : null;
  const sets = Array.from({ length: count }, () => ({ value: target, kg: prefillKg, done: false }));
  return { ...base, sets };
}

/**
 * What this block would run an alternative as, or null when the runner
 * cannot dose it honestly.
 *
 * An alternative with no unit on the wire is NEVER offered: its unit is
 * unknown, and the planned unit is wrong for about one alternative in eight
 * (a plank for dead bugs, pool walking for a swim). An alternative with a
 * unit takes its own dose, or the planned dose when it is measured the same
 * way and the server sent no number.
 */
export function doseOfAlternative(
  exercise: RunnerExercise,
  alternative: ExerciseAlternative,
): { readonly unit: RunnerDoseUnit; readonly target: number; readonly perSide: boolean } | null {
  const timedPlan = exercise.plannedUnit === 'seconds' || exercise.plannedUnit === 'minutes';
  switch (alternative.unit) {
    case 'reps': {
      const value = alternative.reps ?? (exercise.plannedUnit === 'reps' ? exercise.plannedTarget : null);
      if (value === null || value <= 0) return null;
      return { unit: 'reps', target: Math.min(unitCeiling('reps'), value), perSide: alternative.perSide ?? false };
    }
    case 'seconds': {
      const value = alternative.seconds ?? (timedPlan ? exercise.plannedTarget : null);
      if (value === null || value <= 0) return null;
      // A one-row cardio block stays one stopwatch row; anything with several
      // sets counts each of them down.
      const unit: RunnerDoseUnit = exercise.plannedUnit === 'minutes' && exercise.sets.length === 1 ? 'minutes' : 'seconds';
      return { unit, target: Math.min(unitCeiling(unit), value), perSide: unit === 'seconds' && (alternative.perSide ?? false) };
    }
    case 'meters': {
      const value = alternative.meters ?? (exercise.plannedUnit === 'meters' ? exercise.plannedTarget : null);
      if (value === null || value <= 0) return null;
      return { unit: 'meters', target: Math.min(unitCeiling('meters'), value), perSide: false };
    }
    default:
      return null;
  }
}
