/**
 * `runner.json` as text: the shape iOS's `Codable` gives `RunnerState`
 * (Views/Workout/WorkoutRunnerView.swift), with the same member names and the
 * same strictness.
 *
 * STRICT, ON PURPOSE. A required member that is missing or of the wrong type
 * throws, and the health file store then deletes the file and reads it as
 * absent (src/health/localStore.ts): half a workout is worse than none,
 * because a resume would put the member on the wrong set with the wrong
 * clock. A file of another VERSION that still decodes is read and then
 * ignored by the caller (`RUNNER_STATE_VERSION`), as iOS does.
 *
 * Instants are written with milliseconds (`toISOString`), so a rest's end
 * and the active clock read back exactly as they were written; the reader
 * also takes the whole-second form iOS writes.
 */
import {
  arrayOf,
  boolean,
  double,
  instant,
  integer,
  object,
  opt,
  req,
  string,
  HealthShapeError,
  type Reader,
} from '../../../health/decode';
import { decodeSessionView, type ExerciseAlternative } from '../../../health/models';

import {
  RUNNER_DOSE_UNITS,
  RUNNER_ENTRIES,
  type RunnerDoseUnit,
  type RunnerEntry,
  type RunnerExercise,
  type RunnerSet,
  type RunnerState,
  type RunnerTimer,
} from './types';

function oneOf<T extends string>(known: readonly T[]): Reader<T> {
  return (value, path) => {
    const raw = string(value, path);
    if (!(known as readonly string[]).includes(raw)) throw new HealthShapeError(path);
    return raw as T;
  };
}

const doseUnit: Reader<RunnerDoseUnit> = oneOf(RUNNER_DOSE_UNITS);
const entry: Reader<RunnerEntry> = oneOf(RUNNER_ENTRIES);

const decodeAlternative: Reader<ExerciseAlternative> = (value, path) => {
  const json = object(value, path);
  return {
    exerciseId: req(json, 'exerciseId', path, string),
    name: opt(json, 'name', path, string),
    equipment: opt(json, 'equipment', path, string),
    equipmentLabel: opt(json, 'equipmentLabel', path, string),
    level: opt(json, 'level', path, string),
    unit: opt(json, 'unit', path, string),
    reps: opt(json, 'reps', path, integer),
    seconds: opt(json, 'seconds', path, integer),
    meters: opt(json, 'meters', path, integer),
    perSide: opt(json, 'perSide', path, boolean),
  };
};

const decodeSet: Reader<RunnerSet> = (value, path) => {
  const json = object(value, path);
  return {
    value: req(json, 'value', path, integer),
    kg: opt(json, 'kg', path, double),
    done: req(json, 'done', path, boolean),
  };
};

const decodeExercise: Reader<RunnerExercise> = (value, path) => {
  const json = object(value, path);
  return {
    plannedExerciseId: req(json, 'plannedExerciseId', path, string),
    plannedName: req(json, 'plannedName', path, string),
    plannedEquipment: opt(json, 'plannedEquipment', path, string),
    plannedEquipmentLabel: opt(json, 'plannedEquipmentLabel', path, string),
    plannedUnit: req(json, 'plannedUnit', path, doseUnit),
    plannedTarget: req(json, 'plannedTarget', path, integer),
    plannedPerSide: req(json, 'plannedPerSide', path, boolean),
    exerciseId: req(json, 'exerciseId', path, string),
    name: req(json, 'name', path, string),
    equipment: opt(json, 'equipment', path, string),
    equipmentLabel: opt(json, 'equipmentLabel', path, string),
    blockNo: req(json, 'blockNo', path, integer),
    pattern: opt(json, 'pattern', path, string),
    patternLabel: req(json, 'patternLabel', path, string),
    unit: req(json, 'unit', path, doseUnit),
    target: req(json, 'target', path, integer),
    perSide: req(json, 'perSide', path, boolean),
    restSec: req(json, 'restSec', path, integer),
    loadHint: opt(json, 'loadHint', path, string),
    plannedCues: req(json, 'plannedCues', path, arrayOf(string)),
    alternatives: req(json, 'alternatives', path, arrayOf(decodeAlternative)),
    lastLoadKg: opt(json, 'lastLoadKg', path, double),
    sets: req(json, 'sets', path, arrayOf(decodeSet)),
    skipped: req(json, 'skipped', path, boolean),
    endedEarly: req(json, 'endedEarly', path, boolean),
    stopwatchStartedAt: opt(json, 'stopwatchStartedAt', path, instant),
  };
};

/** A timer written before holds were timed per side has no `sideSeconds`, and still reads. */
export const decodeRunnerTimer: Reader<RunnerTimer> = (value, path) => {
  const json = object(value, path);
  return {
    exercise: req(json, 'exercise', path, integer),
    set: req(json, 'set', path, integer),
    startedAt: req(json, 'startedAt', path, instant),
    endsAt: req(json, 'endsAt', path, instant),
    sideSeconds: opt(json, 'sideSeconds', path, integer),
  };
};

/** `runner.json`, parsed. Throws (`HealthShapeError`) on anything that is not a runner of a shape this build reads. */
export function decodeRunnerState(value: unknown): RunnerState {
  const path = 'runner';
  const json = object(value, path);
  const state: RunnerState = {
    version: req(json, 'version', path, integer),
    sessionId: req(json, 'sessionId', path, string),
    session: req(json, 'session', path, decodeSessionView),
    origin: req(json, 'origin', path, entry),
    startedAt: req(json, 'startedAt', path, instant),
    keepUntilDay: req(json, 'keepUntilDay', path, string),
    exercises: req(json, 'exercises', path, arrayOf(decodeExercise)),
    index: req(json, 'index', path, integer),
    restEndsAt: opt(json, 'restEndsAt', path, instant),
    restTotalSeconds: opt(json, 'restTotalSeconds', path, integer),
    timer: opt(json, 'timer', path, decodeRunnerTimer),
    finishKey: opt(json, 'finishKey', path, string),
    completedAt: opt(json, 'completedAt', path, instant),
    clockSeconds: req(json, 'clockSeconds', path, double),
    clockRunningSince: opt(json, 'clockRunningSince', path, instant),
    clockAwaySince: opt(json, 'clockAwaySince', path, instant),
    lastSeenAt: req(json, 'lastSeenAt', path, instant),
  };
  return state;
}

/**
 * Any value as JSON with every Date as a full ISO instant and every null or
 * undefined member left out (Swift's `encodeIfPresent`), so the file holds
 * exactly what iOS's would.
 */
export function encodeRunnerJson(value: unknown): string {
  return JSON.stringify(value, function replacer(this: Record<string, unknown>, key: string, raw: unknown) {
    const original = key === '' ? value : this[key];
    if (original instanceof Date) return original.toISOString();
    if (raw === null && key !== '' && !Array.isArray(this)) return undefined;
    return raw;
  });
}

/** `runner.json`'s text for `state`. */
export function encodeRunnerState(state: RunnerState): string {
  return encodeRunnerJson(state);
}
