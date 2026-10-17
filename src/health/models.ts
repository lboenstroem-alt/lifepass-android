/**
 * The health wire shapes: the Android port of iOS Models/HealthModels.swift.
 * The `health` block on `GET /profile` lives with the profile (src/api/profile.ts);
 * this file holds the one Today read `GET /health` (OP-06) and the pieces every
 * other health operation answers with.
 *
 * TWO RULES RUN THROUGH THIS FILE, as they do through the Swift.
 *
 * 1. FAIL SOFT. A health response is a garnish on a member's day, never their
 *    identity. Every enum reads an unknown server value as `'unknown'`
 *    instead of throwing, and every field the screens can live without is
 *    optional (null when absent). A server that ships a new session kind or
 *    a new insight key must not blank a member's plan on an app that has not
 *    been updated. Types are still checked the way Swift checks them: a
 *    member with the wrong type fails the value it sits in, except the
 *    members iOS softens on purpose (the scores' numbers, the target weight,
 *    the feature list, the meal-description drafts, a proposal's week, the
 *    fields "log a workout on any day" added to an extra), which cost only
 *    themselves (./decode.ts `soft`).
 *
 * 2. NO TIME SHIFTING. Calendar days are `YYYY-MM-DD` strings in Iceland time
 *    and stay strings. Decoding them into a Date and back is how a Sunday
 *    session lands on Saturday for someone at 23:30 in June. Only true
 *    instants (`loggedAt`, `bookingStartsAt`) are Dates.
 *
 * Every model is decoded from the wire by its `decodeX` function and keeps
 * the wire's member names, so the day cached to disk is the same JSON
 * (`encodeHealthDay`) and reads back with the same decoder.
 */
import {
  HEALTH_ACCESS_VALUES,
  PROGRAM_STATUSES,
  SESSION_KINDS,
  SESSION_STATUSES,
  type HealthAccess,
  type HealthConsent,
  type ProgramStatus,
  type SessionKind,
  type SessionStatusView,
} from '../api/profile';
import { encodeBody } from '../api/wire';
import { wholeNumberOf } from '../i18n/format';

import {
  arrayOf,
  boolean,
  double,
  enumOf,
  instant,
  integer,
  isObject,
  object,
  opt,
  req,
  soft,
  string,
  type Json,
  type Reader,
} from './decode';

export type { HealthAccess, HealthConsent, ProgramStatus, SessionKind, SessionStatusView };

// ---------------------------------------------------------------------------
// Forward-compatible enums

export type SessionIntensity = 'easy' | 'moderate' | 'hard' | 'unknown';
export type Feeling = 'easy' | 'ok' | 'hard' | 'too_hard' | 'unknown';
export type SkipReason = 'time' | 'tired' | 'sore' | 'other' | 'paused' | 'unknown';
export type DoneSource = 'member' | 'check_in' | 'wearable' | 'unknown';
export type UndoAction = 'done' | 'move' | 'skip' | 'pull' | 'unknown';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'unknown';
export type TargetWithheldReason = 'bmi_low_lose_weight' | 'bmi_high' | 'target_too_low' | 'unknown';
export type MeasurementSource = 'self_reported' | 'weekly_prompt' | 'program_intake' | 'wearable' | 'unknown';
/**
 * What a workout the member logged by hand was (`contract.ts` `WORKOUT_KINDS`):
 * the plan's session kinds without `rest`, plus `other`.
 */
export type ExtraWorkoutKind = 'strength' | 'cardio' | 'walk' | 'hike' | 'swim' | 'mobility' | 'class' | 'other' | 'unknown';

export const SESSION_INTENSITIES: readonly SessionIntensity[] = ['easy', 'moderate', 'hard'];
export const FEELINGS: readonly Feeling[] = ['easy', 'ok', 'hard', 'too_hard'];
export const SKIP_REASONS: readonly SkipReason[] = ['time', 'tired', 'sore', 'other', 'paused'];
export const DONE_SOURCES: readonly DoneSource[] = ['member', 'check_in', 'wearable'];
export const UNDO_ACTIONS: readonly UndoAction[] = ['done', 'move', 'skip', 'pull'];
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'];
export const TARGET_WITHHELD_REASONS: readonly TargetWithheldReason[] = ['bmi_low_lose_weight', 'bmi_high', 'target_too_low'];
export const MEASUREMENT_SOURCES: readonly MeasurementSource[] = ['self_reported', 'weekly_prompt', 'program_intake', 'wearable'];
export const EXTRA_WORKOUT_KINDS: readonly ExtraWorkoutKind[] = [
  'strength',
  'cardio',
  'walk',
  'hike',
  'swim',
  'mobility',
  'class',
  'other',
];

/**
 * The six chips of the Log a workout sheet, in the order they are offered.
 * `walk` and `mobility` are kinds the server knows but not chips.
 */
export const EXTRA_WORKOUT_CHIPS: readonly ExtraWorkoutKind[] = ['strength', 'class', 'swim', 'cardio', 'hike', 'other'];

const healthAccess = enumOf(HEALTH_ACCESS_VALUES);
const sessionKind = enumOf(SESSION_KINDS);
const sessionStatus = enumOf(SESSION_STATUSES);
const programStatus = enumOf(PROGRAM_STATUSES);
const intensity = enumOf(SESSION_INTENSITIES);
const feeling = enumOf(FEELINGS);
const skipReason = enumOf(SKIP_REASONS);
const doneSource = enumOf(DONE_SOURCES);
const undoAction = enumOf(UNDO_ACTIONS);
const mealSlot = enumOf(MEAL_SLOTS);
const targetWithheld = enumOf(TARGET_WITHHELD_REASONS);
const measurementSource = enumOf(MEASUREMENT_SOURCES);
const extraWorkoutKind = enumOf(EXTRA_WORKOUT_KINDS);

/** A session the member can start in the runner or mark as done (iOS `SessionKind.isWorkout`). */
export function isWorkoutKind(kind: SessionKind | null | undefined): boolean {
  return !!kind && kind !== 'rest' && kind !== 'unknown';
}

/** The copy key of a meal slot's kicker (`slot.*`). */
export function mealSlotCopyKey(slot: MealSlot): string {
  return `slot.${slot}`;
}

/** The Log a workout chip's label and the type segment of an extra's line. */
export function extraWorkoutLabelKey(kind: ExtraWorkoutKind): string {
  return `logworkout.kind.${kind}`;
}

// ---------------------------------------------------------------------------
// Shared pieces

/** Server copy in the resolved locale, with the key it came from. Screens show `text`. */
export interface LocalizedLine {
  readonly key: string | null;
  readonly text: string | null;
}

export interface ProgressionChange {
  readonly kind: string | null;
  readonly exerciseId: string | null;
  readonly exerciseName: string | null;
  readonly text: string | null;
}

/**
 * A calorie and protein target. Always an estimate on the wire: the numbers
 * are a model of a body, never a measurement, and the UI says so.
 */
export interface NutritionTarget {
  readonly kcalLow: number;
  readonly kcalHigh: number;
  readonly proteinG: number;
  /** `program`, `goal` or `activity_adjusted`. */
  readonly basis: string | null;
}

export interface ProgramTargets {
  readonly kcalLow: number | null;
  readonly kcalHigh: number | null;
  readonly proteinG: number | null;
  readonly weeklyMinutes: number | null;
  readonly strengthDays: number | null;
  readonly sources: readonly string[] | null;
}

export const decodeLocalizedLine: Reader<LocalizedLine> = (value, path) => {
  const json = object(value, path);
  return { key: opt(json, 'key', path, string), text: opt(json, 'text', path, string) };
};

export const decodeProgressionChange: Reader<ProgressionChange> = (value, path) => {
  const json = object(value, path);
  return {
    kind: opt(json, 'kind', path, string),
    exerciseId: opt(json, 'exerciseId', path, string),
    exerciseName: opt(json, 'exerciseName', path, string),
    text: opt(json, 'text', path, string),
  };
};

export const decodeNutritionTarget: Reader<NutritionTarget> = (value, path) => {
  const json = object(value, path);
  return {
    kcalLow: req(json, 'kcalLow', path, integer),
    kcalHigh: req(json, 'kcalHigh', path, integer),
    proteinG: req(json, 'proteinG', path, double),
    basis: opt(json, 'basis', path, string),
  };
};

const decodeProgramTargets: Reader<ProgramTargets> = (value, path) => {
  const json = object(value, path);
  return {
    kcalLow: opt(json, 'kcalLow', path, integer),
    kcalHigh: opt(json, 'kcalHigh', path, integer),
    proteinG: opt(json, 'proteinG', path, double),
    weeklyMinutes: opt(json, 'weeklyMinutes', path, integer),
    strengthDays: opt(json, 'strengthDays', path, integer),
    sources: opt(json, 'sources', path, arrayOf(string)),
  };
};

// ---------------------------------------------------------------------------
// Programmes and sessions

export interface ProgramSummary {
  readonly id: string;
  readonly status: ProgramStatus | null;
  readonly summaryTitle: string | null;
  readonly goal: string | null;
  readonly focus: string | null;
  readonly daysPerWeek: number | null;
  readonly weeks: number | null;
  readonly kinds: readonly SessionKind[] | null;
  readonly experience: string | null;
  readonly planType: string | null;
  /** ISO weekday numbers (1 = Monday). */
  readonly trainingDays: readonly number[] | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  /** For a proposal: the date it would start if adopted now. */
  readonly startsOnIfAdoptedNow: string | null;
  readonly weekNo: number | null;
  readonly targets: ProgramTargets | null;
  readonly targetsWithheld: TargetWithheldReason | null;
  readonly intro: string | null;
  readonly weekNotes: readonly string[] | null;
  readonly typicalMinutes: number | null;
  readonly adoptedAt: Date | null;
  readonly pausedOn: string | null;
  readonly finishedAt: Date | null;
  readonly notStarted: boolean | null;
  /** `model` or `template`. */
  readonly source: string | null;
  readonly libraryVersion: string | null;
  readonly disclaimer: string | null;
  readonly createdAt: Date | null;
  /** The running plan this one revises (Adjust my plan), else null. Absent on an older server. */
  readonly revisionOf: string | null;
  /** This plan was ended because the member switched to a revision of it. */
  readonly revised: boolean | null;
}

/** A proposal made by Adjust my plan rather than by the wizard. */
export function isRevision(program: Pick<ProgramSummary, 'revisionOf'>): boolean {
  return program.revisionOf !== null;
}

/** Active or paused: a plan the member still owns. */
export function isLiveStatus(status: ProgramStatus | null | undefined): boolean {
  return status === 'active' || status === 'paused';
}

export const decodeProgramSummary: Reader<ProgramSummary> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    status: opt(json, 'status', path, programStatus),
    summaryTitle: opt(json, 'summaryTitle', path, string),
    goal: opt(json, 'goal', path, string),
    focus: opt(json, 'focus', path, string),
    daysPerWeek: opt(json, 'daysPerWeek', path, integer),
    weeks: opt(json, 'weeks', path, integer),
    kinds: opt(json, 'kinds', path, arrayOf(sessionKind)),
    experience: opt(json, 'experience', path, string),
    planType: opt(json, 'planType', path, string),
    trainingDays: opt(json, 'trainingDays', path, arrayOf(integer)),
    startsOn: opt(json, 'startsOn', path, string),
    endsOn: opt(json, 'endsOn', path, string),
    startsOnIfAdoptedNow: opt(json, 'startsOnIfAdoptedNow', path, string),
    weekNo: opt(json, 'weekNo', path, integer),
    targets: opt(json, 'targets', path, decodeProgramTargets),
    targetsWithheld: opt(json, 'targetsWithheld', path, targetWithheld),
    intro: opt(json, 'intro', path, string),
    weekNotes: opt(json, 'weekNotes', path, arrayOf(string)),
    typicalMinutes: opt(json, 'typicalMinutes', path, integer),
    adoptedAt: opt(json, 'adoptedAt', path, instant),
    pausedOn: opt(json, 'pausedOn', path, string),
    finishedAt: opt(json, 'finishedAt', path, instant),
    notStarted: opt(json, 'notStarted', path, boolean),
    source: opt(json, 'source', path, string),
    libraryVersion: opt(json, 'libraryVersion', path, string),
    disclaimer: opt(json, 'disclaimer', path, string),
    createdAt: opt(json, 'createdAt', path, instant),
    revisionOf: opt(json, 'revisionOf', path, string),
    revised: opt(json, 'revised', path, boolean),
  };
};

export interface SessionBrief {
  readonly id: string;
  readonly programId: string | null;
  readonly weekNo: number | null;
  /** ISO weekday (1 = Monday). */
  readonly weekday: number | null;
  /** Null for a proposal: rows are not dated until the member adopts. */
  readonly scheduledFor: string | null;
  readonly kind: SessionKind | null;
  readonly title: string | null;
  readonly minutes: number | null;
  readonly intensity: SessionIntensity | null;
  readonly status: SessionStatusView | null;
  readonly doneSource: DoneSource | null;
  readonly feeling: Feeling | null;
  readonly skipReason: SkipReason | null;
  readonly extrasCount: number | null;
}

export const decodeSessionBrief: Reader<SessionBrief> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    programId: opt(json, 'programId', path, string),
    weekNo: opt(json, 'weekNo', path, integer),
    weekday: opt(json, 'weekday', path, integer),
    scheduledFor: opt(json, 'scheduledFor', path, string),
    kind: opt(json, 'kind', path, sessionKind),
    title: opt(json, 'title', path, string),
    minutes: opt(json, 'minutes', path, integer),
    intensity: opt(json, 'intensity', path, intensity),
    status: opt(json, 'status', path, sessionStatus),
    doneSource: opt(json, 'doneSource', path, doneSource),
    feeling: opt(json, 'feeling', path, feeling),
    skipReason: opt(json, 'skipReason', path, skipReason),
    extrasCount: opt(json, 'extrasCount', path, integer),
  };
};

/**
 * A proposal is the summary plus week 1, so the Plan proposal card renders
 * after a relaunch without a second read. On the wire it is ONE object (the
 * summary's members and `week1`); `encodeHealthDay` writes it back that way.
 */
export interface HealthProposal {
  readonly program: ProgramSummary;
  readonly week1: readonly SessionBrief[];
}

export const decodeHealthProposal: Reader<HealthProposal> = (value, path) => {
  const json = object(value, path);
  return {
    program: decodeProgramSummary(json, path),
    // Fail-soft on its own: a week this build cannot read costs the preview
    // rows, never the proposal.
    week1: soft(json, 'week1', path, arrayOf(decodeSessionBrief)) ?? [],
  };
};

export interface PerformedSet {
  readonly reps: number | null;
  readonly seconds: number | null;
  /** A pool set, in metres. */
  readonly meters: number | null;
  readonly kg: number | null;
  readonly done: boolean | null;
}

export interface PerformedExercise {
  readonly exerciseId: string | null;
  readonly swappedFrom: string | null;
  readonly skipped: boolean | null;
  readonly minutes: number | null;
  readonly sets: readonly PerformedSet[] | null;
  readonly name: string | null;
  readonly swappedFromName: string | null;
}

const decodePerformedSet: Reader<PerformedSet> = (value, path) => {
  const json = object(value, path);
  return {
    reps: opt(json, 'reps', path, integer),
    seconds: opt(json, 'seconds', path, integer),
    meters: opt(json, 'meters', path, integer),
    kg: opt(json, 'kg', path, double),
    done: opt(json, 'done', path, boolean),
  };
};

export const decodePerformedExercise: Reader<PerformedExercise> = (value, path) => {
  const json = object(value, path);
  return {
    exerciseId: opt(json, 'exerciseId', path, string),
    swappedFrom: opt(json, 'swappedFrom', path, string),
    skipped: opt(json, 'skipped', path, boolean),
    minutes: opt(json, 'minutes', path, integer),
    sets: opt(json, 'sets', path, arrayOf(decodePerformedSet)),
    name: opt(json, 'name', path, string),
    swappedFromName: opt(json, 'swappedFromName', path, string),
  };
};

export interface ExtraWorkoutView {
  readonly index: number | null;
  readonly loggedAt: Date | null;
  readonly minutes: number | null;
  readonly feeling: Feeling | null;
  readonly performed: readonly PerformedExercise[] | null;
  // LOG A WORKOUT ON ANY DAY (API 0.34.0): read fail-soft, so one odd value
  // costs that value, never the member's day.
  /** Stable id the server derives from the entry; what `remove_extra` names. Null on an older server. */
  readonly id: string | null;
  readonly kind: ExtraWorkoutKind | null;
  /** The member's own words, at most 140 characters. Plain text, never sent anywhere else. */
  readonly note: string | null;
  /** The localised kind ("Gym"), or null for `other` and for no kind. */
  readonly title: string | null;
  /** The server's rule: in the done window, the plan active, no runner sets a mis-tap would lose. */
  readonly canRemove: boolean | null;
}

const decodeExtraWorkout: Reader<ExtraWorkoutView> = (value, path) => {
  const json = object(value, path);
  return {
    index: opt(json, 'index', path, integer),
    loggedAt: opt(json, 'loggedAt', path, instant),
    minutes: opt(json, 'minutes', path, integer),
    feeling: opt(json, 'feeling', path, feeling),
    performed: opt(json, 'performed', path, arrayOf(decodePerformedExercise)),
    id: soft(json, 'id', path, string),
    kind: soft(json, 'kind', path, extraWorkoutKind),
    note: soft(json, 'note', path, string),
    title: soft(json, 'title', path, string),
    canRemove: soft(json, 'canRemove', path, boolean),
  };
};

/**
 * An alternative exercise with ITS OWN unit and dose: a plank offered for
 * dead bugs is held, not counted. Until the server sends a unit, the runner
 * offers no alternative it cannot dose.
 */
export interface ExerciseAlternative {
  readonly exerciseId: string;
  readonly name: string | null;
  readonly equipment: string | null;
  readonly equipmentLabel: string | null;
  /** `easier`, `same` or `harder` against the exercise it replaces. */
  readonly level: string | null;
  /** `reps`, `seconds` or `meters`. */
  readonly unit: string | null;
  readonly reps: number | null;
  readonly seconds: number | null;
  readonly meters: number | null;
  readonly perSide: boolean | null;
}

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

/**
 * One block of a session. ONE DOSE PER BLOCK: the server sends exactly one of
 * `reps`, `seconds` and `meters`; `minutes` is `seconds` restated for a cardio
 * or swim block. ./doseCopy.ts reads it.
 */
export interface ExerciseBlockView {
  readonly blockNo: number | null;
  readonly exerciseId: string | null;
  readonly name: string | null;
  readonly pattern: string | null;
  readonly patternLabel: string | null;
  readonly equipment: string | null;
  readonly equipmentLabel: string | null;
  readonly sets: number | null;
  readonly reps: number | null;
  readonly seconds: number | null;
  /** Kept for caches written before `restSec` was read; read `restSecondsResolved`. */
  readonly restSeconds: number | null;
  readonly loadHint: string | null;
  readonly lastLoadKg: number | null;
  readonly cues: readonly string[] | null;
  readonly alternatives: readonly ExerciseAlternative[] | null;
  /** Rest after each set, in seconds. The wire name. */
  readonly restSec: number | null;
  /** The reps are PER SIDE: "5 x 12" is twelve each leg. */
  readonly perSide: boolean | null;
  /** Cardio and swim blocks measured in minutes (derived from `seconds`). */
  readonly minutes: number | null;
  /** Pool blocks dosed in metres. */
  readonly meters: number | null;
  readonly progression: ProgressionChange | null;
}

/** The rest the server asked for, whichever key carried it. */
export function restSecondsResolved(block: Pick<ExerciseBlockView, 'restSec' | 'restSeconds'>): number | null {
  return block.restSec ?? block.restSeconds;
}

export const decodeExerciseBlock: Reader<ExerciseBlockView> = (value, path) => {
  const json = object(value, path);
  return {
    blockNo: opt(json, 'blockNo', path, integer),
    exerciseId: opt(json, 'exerciseId', path, string),
    name: opt(json, 'name', path, string),
    pattern: opt(json, 'pattern', path, string),
    patternLabel: opt(json, 'patternLabel', path, string),
    equipment: opt(json, 'equipment', path, string),
    equipmentLabel: opt(json, 'equipmentLabel', path, string),
    sets: opt(json, 'sets', path, integer),
    reps: opt(json, 'reps', path, integer),
    seconds: opt(json, 'seconds', path, integer),
    restSeconds: opt(json, 'restSeconds', path, integer),
    loadHint: opt(json, 'loadHint', path, string),
    lastLoadKg: opt(json, 'lastLoadKg', path, double),
    cues: opt(json, 'cues', path, arrayOf(string)),
    alternatives: opt(json, 'alternatives', path, arrayOf(decodeAlternative)),
    restSec: opt(json, 'restSec', path, integer),
    perSide: opt(json, 'perSide', path, boolean),
    minutes: opt(json, 'minutes', path, integer),
    meters: opt(json, 'meters', path, integer),
    progression: opt(json, 'progression', path, decodeProgressionChange),
  };
};

export interface PoolAlternative {
  readonly title: string | null;
  readonly minutes: number | null;
  readonly blocks: readonly ExerciseBlockView[] | null;
}

/**
 * One session, hydrated. Every `can*` flag is the server's precondition table
 * evaluated without writing, so the app never has to guess whether an action
 * would be refused.
 */
export interface SessionView {
  readonly id: string;
  readonly programId: string | null;
  readonly weekNo: number | null;
  readonly weekday: number | null;
  readonly scheduledFor: string | null;
  readonly kind: SessionKind | null;
  readonly title: string | null;
  readonly minutes: number | null;
  readonly intensity: SessionIntensity | null;
  readonly status: SessionStatusView | null;
  readonly doneSource: DoneSource | null;
  readonly feeling: Feeling | null;
  readonly skipReason: SkipReason | null;
  readonly extrasCount: number | null;
  readonly focus: string | null;
  readonly classTag: string | null;
  /** The `catalog_categories` slug `GET /classes?category=` takes. */
  readonly classCategory: string | null;
  readonly classLabel: string | null;
  readonly blocks: readonly ExerciseBlockView[] | null;
  readonly lighter: boolean | null;
  readonly weatherSwap: boolean | null;
  readonly poolAlternative: PoolAlternative | null;
  readonly canMove: boolean | null;
  readonly moveBlockedReason: string | null;
  readonly canLogDone: boolean | null;
  readonly canSkip: boolean | null;
  readonly canPull: boolean | null;
  readonly canUndo: boolean | null;
  readonly undoAction: UndoAction | null;
  readonly undoUntil: Date | null;
  /** The plan is gentle and the day shows a soak, so the doctor caution line is added. */
  readonly soakCaution: boolean | null;
  readonly movedFrom: string | null;
  readonly doneAt: Date | null;
  readonly doneMinutes: number | null;
  readonly checkInVenueName: string | null;
  readonly performed: readonly PerformedExercise[] | null;
  readonly extras: readonly ExtraWorkoutView[] | null;
  readonly remark: LocalizedLine | null;
  /**
   * The member can log a workout they did as an extra on this row (API
   * 0.34.0). Null from an older server, which would refuse the kind and the
   * note, so null hides the action.
   */
  readonly canLogExtra: boolean | null;
}

const decodePoolAlternative: Reader<PoolAlternative> = (value, path) => {
  const json = object(value, path);
  return {
    title: opt(json, 'title', path, string),
    minutes: opt(json, 'minutes', path, integer),
    blocks: opt(json, 'blocks', path, arrayOf(decodeExerciseBlock)),
  };
};

export const decodeSessionView: Reader<SessionView> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    programId: opt(json, 'programId', path, string),
    weekNo: opt(json, 'weekNo', path, integer),
    weekday: opt(json, 'weekday', path, integer),
    scheduledFor: opt(json, 'scheduledFor', path, string),
    kind: opt(json, 'kind', path, sessionKind),
    title: opt(json, 'title', path, string),
    minutes: opt(json, 'minutes', path, integer),
    intensity: opt(json, 'intensity', path, intensity),
    status: opt(json, 'status', path, sessionStatus),
    doneSource: opt(json, 'doneSource', path, doneSource),
    feeling: opt(json, 'feeling', path, feeling),
    skipReason: opt(json, 'skipReason', path, skipReason),
    extrasCount: opt(json, 'extrasCount', path, integer),
    focus: opt(json, 'focus', path, string),
    classTag: opt(json, 'classTag', path, string),
    classCategory: opt(json, 'classCategory', path, string),
    classLabel: opt(json, 'classLabel', path, string),
    blocks: opt(json, 'blocks', path, arrayOf(decodeExerciseBlock)),
    lighter: opt(json, 'lighter', path, boolean),
    weatherSwap: opt(json, 'weatherSwap', path, boolean),
    poolAlternative: opt(json, 'poolAlternative', path, decodePoolAlternative),
    canMove: opt(json, 'canMove', path, boolean),
    moveBlockedReason: opt(json, 'moveBlockedReason', path, string),
    canLogDone: opt(json, 'canLogDone', path, boolean),
    canSkip: opt(json, 'canSkip', path, boolean),
    canPull: opt(json, 'canPull', path, boolean),
    canUndo: opt(json, 'canUndo', path, boolean),
    undoAction: opt(json, 'undoAction', path, undoAction),
    undoUntil: opt(json, 'undoUntil', path, instant),
    soakCaution: opt(json, 'soakCaution', path, boolean),
    movedFrom: opt(json, 'movedFrom', path, string),
    doneAt: opt(json, 'doneAt', path, instant),
    doneMinutes: opt(json, 'doneMinutes', path, integer),
    checkInVenueName: opt(json, 'checkInVenueName', path, string),
    performed: opt(json, 'performed', path, arrayOf(decodePerformedExercise)),
    extras: opt(json, 'extras', path, arrayOf(decodeExtraWorkout)),
    remark: opt(json, 'remark', path, decodeLocalizedLine),
    canLogExtra: opt(json, 'canLogExtra', path, boolean),
  };
};

export interface SessionHistoryItem {
  /** "<sessionId>" or "<sessionId>:extra:<index>". */
  readonly id: string;
  readonly sessionId: string | null;
  readonly programId: string | null;
  readonly date: string | null;
  readonly kind: SessionKind | null;
  readonly title: string | null;
  /** `done`, `skipped` or `missed`. */
  readonly status: SessionStatusView | null;
  readonly minutes: number | null;
  readonly feeling: Feeling | null;
  readonly doneSource: DoneSource | null;
  readonly checkInVenueName: string | null;
  readonly skipReason: SkipReason | null;
  readonly performed: readonly PerformedExercise[] | null;
  readonly isExtra: boolean | null;
  /** What a hand-logged extra was (API 0.34.0); `kind` stays the plan session's kind. */
  readonly extraKind: ExtraWorkoutKind | null;
  /** The extra's note. Dormant: API 0.34.0 does not send it on history items yet. */
  readonly note: string | null;
}

export const decodeSessionHistoryItem: Reader<SessionHistoryItem> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    sessionId: opt(json, 'sessionId', path, string),
    programId: opt(json, 'programId', path, string),
    date: opt(json, 'date', path, string),
    kind: opt(json, 'kind', path, sessionKind),
    title: opt(json, 'title', path, string),
    status: opt(json, 'status', path, sessionStatus),
    minutes: opt(json, 'minutes', path, integer),
    feeling: opt(json, 'feeling', path, feeling),
    doneSource: opt(json, 'doneSource', path, doneSource),
    checkInVenueName: opt(json, 'checkInVenueName', path, string),
    skipReason: opt(json, 'skipReason', path, skipReason),
    performed: opt(json, 'performed', path, arrayOf(decodePerformedExercise)),
    isExtra: opt(json, 'isExtra', path, boolean),
    extraKind: opt(json, 'extraKind', path, extraWorkoutKind),
    note: opt(json, 'note', path, string),
  };
};

// ---------------------------------------------------------------------------
// Week and day

export interface WeekDayCell {
  readonly date: string;
  readonly weekday: number | null;
  readonly inProgram: boolean | null;
  readonly sessionId: string | null;
  readonly kind: SessionKind | null;
  readonly title: string | null;
  readonly minutes: number | null;
  readonly status: SessionStatusView | null;
  readonly isToday: boolean | null;
}

export interface WeekView {
  readonly programId: string | null;
  readonly weekNo: number | null;
  readonly weeks: number | null;
  /** The Monday of the calendar week shown. */
  readonly weekStartsOn: string | null;
  readonly days: readonly WeekDayCell[] | null;
  readonly planned: number | null;
  readonly done: number | null;
  readonly skipped: number | null;
  readonly missed: number | null;
  readonly canGoBack: boolean | null;
  readonly canGoForward: boolean | null;
}

const decodeWeekDayCell: Reader<WeekDayCell> = (value, path) => {
  const json = object(value, path);
  return {
    date: req(json, 'date', path, string),
    weekday: opt(json, 'weekday', path, integer),
    inProgram: opt(json, 'inProgram', path, boolean),
    sessionId: opt(json, 'sessionId', path, string),
    kind: opt(json, 'kind', path, sessionKind),
    title: opt(json, 'title', path, string),
    minutes: opt(json, 'minutes', path, integer),
    status: opt(json, 'status', path, sessionStatus),
    isToday: opt(json, 'isToday', path, boolean),
  };
};

export const decodeWeekView: Reader<WeekView> = (value, path) => {
  const json = object(value, path);
  return {
    programId: opt(json, 'programId', path, string),
    weekNo: opt(json, 'weekNo', path, integer),
    weeks: opt(json, 'weeks', path, integer),
    weekStartsOn: opt(json, 'weekStartsOn', path, string),
    days: opt(json, 'days', path, arrayOf(decodeWeekDayCell)),
    planned: opt(json, 'planned', path, integer),
    done: opt(json, 'done', path, integer),
    skipped: opt(json, 'skipped', path, integer),
    missed: opt(json, 'missed', path, integer),
    canGoBack: opt(json, 'canGoBack', path, boolean),
    canGoForward: opt(json, 'canGoForward', path, boolean),
  };
};

export interface SoakPick {
  readonly venueSlug: string | null;
  readonly venueName: string | null;
  readonly driveMinutes: number | null;
  /** "Included in your plan", "From 4,800 ISK", or null. Server copy: never computed on the phone. */
  readonly priceLabel: string | null;
}

export interface TomorrowBrief {
  readonly kind: SessionKind | null;
  readonly title: string | null;
  readonly minutes: number | null;
}

export interface DayView {
  readonly date: string;
  /** `past`, `today` or `future` against the SERVER's today. */
  readonly relative: string | null;
  readonly programId: string | null;
  readonly session: SessionView | null;
  readonly movedAway: {
    readonly sessionId: string;
    readonly title: string | null;
    readonly movedTo: string | null;
    readonly canUndo: boolean | null;
    readonly undoUntil: Date | null;
  } | null;
  readonly booking: {
    readonly bookingId: string;
    readonly activityTitle: string | null;
    readonly venueName: string | null;
    readonly startsAt: Date | null;
  } | null;
  readonly attraction: {
    readonly slug: string;
    readonly name: string | null;
    readonly difficulty: string | null;
    readonly durationMinutes: number | null;
    readonly ascentM: number | null;
  } | null;
  readonly soak: SoakPick | null;
  readonly restPick: {
    readonly soak: SoakPick | null;
    readonly walk: { readonly slug: string; readonly name: string | null; readonly durationMinutes: number | null } | null;
  } | null;
  readonly tomorrow: TomorrowBrief | null;
  readonly nextWeekChange: ProgressionChange | null;
}

const decodeSoakPick: Reader<SoakPick> = (value, path) => {
  const json = object(value, path);
  return {
    venueSlug: opt(json, 'venueSlug', path, string),
    venueName: opt(json, 'venueName', path, string),
    driveMinutes: opt(json, 'driveMinutes', path, integer),
    priceLabel: opt(json, 'priceLabel', path, string),
  };
};

export const decodeTomorrowBrief: Reader<TomorrowBrief> = (value, path) => {
  const json = object(value, path);
  return {
    kind: opt(json, 'kind', path, sessionKind),
    title: opt(json, 'title', path, string),
    minutes: opt(json, 'minutes', path, integer),
  };
};

export const decodeDayView: Reader<DayView> = (value, path) => {
  const json = object(value, path);
  return {
    date: req(json, 'date', path, string),
    relative: opt(json, 'relative', path, string),
    programId: opt(json, 'programId', path, string),
    session: opt(json, 'session', path, decodeSessionView),
    movedAway: opt(json, 'movedAway', path, (raw, p) => {
      const m = object(raw, p);
      return {
        sessionId: req(m, 'sessionId', p, string),
        title: opt(m, 'title', p, string),
        movedTo: opt(m, 'movedTo', p, string),
        canUndo: opt(m, 'canUndo', p, boolean),
        undoUntil: opt(m, 'undoUntil', p, instant),
      };
    }),
    booking: opt(json, 'booking', path, (raw, p) => {
      const b = object(raw, p);
      return {
        bookingId: req(b, 'bookingId', p, string),
        activityTitle: opt(b, 'activityTitle', p, string),
        venueName: opt(b, 'venueName', p, string),
        startsAt: opt(b, 'startsAt', p, instant),
      };
    }),
    attraction: opt(json, 'attraction', path, (raw, p) => {
      const a = object(raw, p);
      return {
        slug: req(a, 'slug', p, string),
        name: opt(a, 'name', p, string),
        difficulty: opt(a, 'difficulty', p, string),
        durationMinutes: opt(a, 'durationMinutes', p, integer),
        ascentM: opt(a, 'ascentM', p, integer),
      };
    }),
    soak: opt(json, 'soak', path, decodeSoakPick),
    restPick: opt(json, 'restPick', path, (raw, p) => {
      const r = object(raw, p);
      return {
        soak: opt(r, 'soak', p, decodeSoakPick),
        walk: opt(r, 'walk', p, (w, wp) => {
          const walk = object(w, wp);
          return {
            slug: req(walk, 'slug', wp, string),
            name: opt(walk, 'name', wp, string),
            durationMinutes: opt(walk, 'durationMinutes', wp, integer),
          };
        }),
      };
    }),
    tomorrow: opt(json, 'tomorrow', path, decodeTomorrowBrief),
    nextWeekChange: opt(json, 'nextWeekChange', path, decodeProgressionChange),
  };
};

// ---------------------------------------------------------------------------
// Note, scores, review, weigh-in, check-in

export interface DailyNote {
  readonly date: string | null;
  readonly templateId: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly reasonCodes: readonly string[] | null;
  /** A fixed server enum the reminder planner turns into a lock-screen line. The body never reaches a notification. */
  readonly notificationKey: string | null;
}

export const decodeDailyNote: Reader<DailyNote> = (value, path) => {
  const json = object(value, path);
  return {
    date: opt(json, 'date', path, string),
    templateId: opt(json, 'templateId', path, string),
    title: opt(json, 'title', path, string),
    body: opt(json, 'body', path, string),
    reasonCodes: opt(json, 'reasonCodes', path, arrayOf(string)),
    notificationKey: opt(json, 'notificationKey', path, string),
  };
};

export interface HealthScores {
  readonly connected: boolean | null;
  readonly day: string | null;
  readonly sleepMinutes: number | null;
  readonly sleepBand: string | null;
  readonly steps: number | null;
  readonly restingHrBpm: number | null;
  readonly restingHrTypicalBpm: number | null;
  readonly hrvMs: number | null;
  readonly hrvTypicalMs: number | null;
  readonly activeEnergyKcal: number | null;
  readonly workoutsThisWeek: {
    readonly count: number | null;
    readonly first: { readonly kind: string | null; readonly minutes: number | null } | null;
  } | null;
  readonly recoveryBand: string | null;
  readonly nightsAvailable: number | null;
  readonly latestSleepDay: string | null;
  readonly latestRestingHrDay: string | null;
  readonly sourceLabel: string | null;
  readonly sources: readonly string[] | null;
  /** When the PHONE last uploaded. Honest about the phone, not the watch. */
  readonly syncedAt: Date | null;
  /** The watch or ring has not synced, however recently the phone uploaded. */
  readonly stale: boolean | null;
}

/**
 * THE NUMBERS ARE READ AS NUMBERS, WHATEVER THEIR SHAPE. The server stores HRV
 * with two decimals and reports a typical value as a median (45.37 ms, a
 * resting heart rate of 55.5 bpm). Read as whole numbers, the first such day
 * threw, took `scores` with it, and `scores` took the whole Today read: the
 * Plan tab went to its error state for exactly the members with a connected
 * wearable. Every number is read as a number and rounded (half away from
 * zero, as Swift's `rounded()`), and one unreadable value leaves that value
 * out, never the day.
 */
const roundedNumber: Reader<number> = (value, path) => wholeNumberOf(double(value, path));

export const decodeHealthScores: Reader<HealthScores> = (value, path) => {
  const json = object(value, path);
  return {
    connected: soft(json, 'connected', path, boolean),
    day: soft(json, 'day', path, string),
    sleepMinutes: soft(json, 'sleepMinutes', path, roundedNumber),
    sleepBand: soft(json, 'sleepBand', path, string),
    steps: soft(json, 'steps', path, roundedNumber),
    restingHrBpm: soft(json, 'restingHrBpm', path, roundedNumber),
    restingHrTypicalBpm: soft(json, 'restingHrTypicalBpm', path, roundedNumber),
    hrvMs: soft(json, 'hrvMs', path, roundedNumber),
    hrvTypicalMs: soft(json, 'hrvTypicalMs', path, roundedNumber),
    activeEnergyKcal: soft(json, 'activeEnergyKcal', path, roundedNumber),
    workoutsThisWeek: soft(json, 'workoutsThisWeek', path, (raw, p) => {
      const w = object(raw, p);
      return {
        count: opt(w, 'count', p, integer),
        first: opt(w, 'first', p, (f, fp) => {
          const first = object(f, fp);
          return { kind: opt(first, 'kind', fp, string), minutes: opt(first, 'minutes', fp, integer) };
        }),
      };
    }),
    recoveryBand: soft(json, 'recoveryBand', path, string),
    nightsAvailable: soft(json, 'nightsAvailable', path, roundedNumber),
    latestSleepDay: soft(json, 'latestSleepDay', path, string),
    latestRestingHrDay: soft(json, 'latestRestingHrDay', path, string),
    sourceLabel: soft(json, 'sourceLabel', path, string),
    sources: soft(json, 'sources', path, arrayOf(string)),
    syncedAt: soft(json, 'syncedAt', path, instant),
    stale: soft(json, 'stale', path, boolean),
  };
};

export interface WeeklyReviewView {
  readonly id: string;
  readonly weekStartsOn: string | null;
  readonly programId: string | null;
  readonly hasPlan: boolean | null;
  readonly weekRating: string | null;
  readonly sessionsPlanned: number | null;
  readonly sessionsDone: number | null;
  readonly weightAvgKg: number | null;
  readonly weightDeltaKg: number | null;
  readonly weightDirection: string | null;
  readonly kcalAvg: number | null;
  readonly proteinAvgG: number | null;
  readonly checkInsCount: number | null;
  readonly streakWeeks: number | null;
  readonly insight: LocalizedLine | null;
  readonly nextWeekChange: ProgressionChange | null;
  readonly createdAt: Date | null;
}

export const decodeWeeklyReview: Reader<WeeklyReviewView> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    weekStartsOn: opt(json, 'weekStartsOn', path, string),
    programId: opt(json, 'programId', path, string),
    hasPlan: opt(json, 'hasPlan', path, boolean),
    weekRating: opt(json, 'weekRating', path, string),
    sessionsPlanned: opt(json, 'sessionsPlanned', path, integer),
    sessionsDone: opt(json, 'sessionsDone', path, integer),
    weightAvgKg: opt(json, 'weightAvgKg', path, double),
    weightDeltaKg: opt(json, 'weightDeltaKg', path, double),
    weightDirection: opt(json, 'weightDirection', path, string),
    kcalAvg: opt(json, 'kcalAvg', path, integer),
    proteinAvgG: opt(json, 'proteinAvgG', path, double),
    checkInsCount: opt(json, 'checkInsCount', path, integer),
    streakWeeks: opt(json, 'streakWeeks', path, integer),
    insight: opt(json, 'insight', path, decodeLocalizedLine),
    nextWeekChange: opt(json, 'nextWeekChange', path, decodeProgressionChange),
    createdAt: opt(json, 'createdAt', path, instant),
  };
};

export interface WeighInState {
  readonly due: boolean | null;
  readonly lastWeightKg: number | null;
  readonly lastMeasuredAt: Date | null;
  readonly lastSource: MeasurementSource | null;
  readonly heightCm: number | null;
  readonly heightMeasuredAt: Date | null;
  readonly heightConfirmDue: boolean | null;
}

export const decodeWeighInState: Reader<WeighInState> = (value, path) => {
  const json = object(value, path);
  return {
    due: opt(json, 'due', path, boolean),
    lastWeightKg: opt(json, 'lastWeightKg', path, double),
    lastMeasuredAt: opt(json, 'lastMeasuredAt', path, instant),
    lastSource: opt(json, 'lastSource', path, measurementSource),
    heightCm: opt(json, 'heightCm', path, integer),
    heightMeasuredAt: opt(json, 'heightMeasuredAt', path, instant),
    heightConfirmDue: opt(json, 'heightConfirmDue', path, boolean),
  };
};

/** When the weekly check-in is offered. Computed for today only. */
export interface CheckInState {
  readonly due: boolean | null;
  /** The Monday of the review week. */
  readonly weekStartsOn: string | null;
  /** A weight logged in the last 3 days, so the sheet can preselect "skip weight" and prefill from it. */
  readonly recentWeightKg: number | null;
}

export const decodeCheckInState: Reader<CheckInState> = (value, path) => {
  const json = object(value, path);
  return {
    due: opt(json, 'due', path, boolean),
    weekStartsOn: opt(json, 'weekStartsOn', path, string),
    recentWeightKg: opt(json, 'recentWeightKg', path, double),
  };
};

export interface Measurement {
  readonly id: string;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly source: MeasurementSource | null;
  readonly measuredAt: Date | null;
  readonly createdAt: Date | null;
}

export const decodeMeasurement: Reader<Measurement> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    weightKg: opt(json, 'weightKg', path, double),
    heightCm: opt(json, 'heightCm', path, integer),
    source: opt(json, 'source', path, measurementSource),
    measuredAt: opt(json, 'measuredAt', path, instant),
    createdAt: opt(json, 'createdAt', path, instant),
  };
};

export interface WeightTrendPoint {
  readonly date: string;
  readonly weightKg: number | null;
  readonly trendKg: number | null;
}

export const decodeWeightTrendPoint: Reader<WeightTrendPoint> = (value, path) => {
  const json = object(value, path);
  return {
    date: req(json, 'date', path, string),
    weightKg: opt(json, 'weightKg', path, double),
    trendKg: opt(json, 'trendKg', path, double),
  };
};

// ---------------------------------------------------------------------------
// Meals inside the Today read
//
// The editing-level meal models (drafts, serving pickers, item math) belong
// to the meal package. What is here is what the Today read answers with and
// what the Plan nutrition card and the Home row need: one shape per wire
// block, so two screens can never disagree about a day's totals.

export interface MealDayTotals {
  readonly kcalLow: number;
  readonly kcalHigh: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** The part of the range that comes from photo estimates. */
  readonly estimateKcalLow: number | null;
  readonly estimateKcalHigh: number | null;
  /** Database, label and member-entered calories as one number. */
  readonly pointKcal: number | null;
  readonly memberEnteredKcal: number | null;
  readonly mealCount: number | null;
  /** False when a quick add or a created food left a macro unknown. */
  readonly macrosComplete: boolean | null;
}

export const decodeMealDayTotals: Reader<MealDayTotals> = (value, path) => {
  const json = object(value, path);
  return {
    kcalLow: req(json, 'kcalLow', path, integer),
    kcalHigh: req(json, 'kcalHigh', path, integer),
    proteinG: req(json, 'proteinG', path, double),
    carbsG: req(json, 'carbsG', path, double),
    fatG: req(json, 'fatG', path, double),
    estimateKcalLow: opt(json, 'estimateKcalLow', path, integer),
    estimateKcalHigh: opt(json, 'estimateKcalHigh', path, integer),
    pointKcal: opt(json, 'pointKcal', path, integer),
    memberEnteredKcal: opt(json, 'memberEnteredKcal', path, integer),
    mealCount: opt(json, 'mealCount', path, integer),
    macrosComplete: opt(json, 'macrosComplete', path, boolean),
  };
};

export interface ItemNutrients {
  readonly kcalLow: number;
  readonly kcalHigh: number;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly grams: number | null;
  readonly macrosComplete: boolean | null;
}

export interface ServingOption {
  /** "g" or "serving". */
  readonly unit: string;
  readonly label: string | null;
  readonly grams: number | null;
}

export interface MealItemView {
  readonly id: string;
  readonly source: string | null;
  readonly basis: string | null;
  readonly label: string | null;
  readonly brand: string | null;
  readonly foodId: string | null;
  readonly barcode: string | null;
  readonly serving: ServingOption | null;
  readonly amount: number | null;
  readonly servingOptions: readonly ServingOption[] | null;
  readonly confidence: string | null;
  readonly confirmed: boolean | null;
  readonly nutrients: ItemNutrients | null;
  /** A drink measured by volume: grams are labelled ml (1 g = 1 ml). */
  readonly liquid: boolean | null;
  /** Fields the member overrode. */
  readonly edited: readonly string[] | null;
}

export interface MealView {
  readonly id: string;
  readonly logDate: string | null;
  readonly loggedAt: Date | null;
  readonly slot: MealSlot | null;
  readonly source: string | null;
  readonly confirmed: boolean | null;
  readonly confidence: string | null;
  readonly needsConfirm: boolean | null;
  readonly hasEstimate: boolean | null;
  readonly items: readonly MealItemView[] | null;
  readonly totals: MealDayTotals | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

/** "Skyr, banana, oats" for the one-line meal row. */
export function mealItemSummary(meal: Pick<MealView, 'items'>): string {
  return (meal.items ?? [])
    .map((item) => item.label)
    .filter((label): label is string => label !== null)
    .join(', ');
}

export interface MealDraftBrief {
  readonly id: string;
  readonly logDate: string | null;
  readonly loggedAt: Date | null;
  readonly slot: MealSlot | null;
  readonly itemCount: number | null;
  /** `photo` or `text` (2.5.6). Absent on a server that predates the meal description. */
  readonly source: string | null;
}

/** A draft made from a description the member typed or dictated. */
export function isDraftFromDescription(draft: Pick<MealDraftBrief, 'source'>): boolean {
  return draft.source === 'text';
}

export interface MealDaySummary {
  readonly date: string;
  readonly kcalLow: number | null;
  readonly kcalHigh: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly mealCount: number | null;
  readonly draftCount: number | null;
  readonly target: NutritionTarget | null;
}

export interface HealthMealsBlock {
  readonly date: string | null;
  readonly meals: readonly MealView[] | null;
  /** Drafts filed on `date`. */
  readonly drafts: readonly MealDraftBrief[] | null;
  readonly totals: MealDayTotals | null;
  readonly target: NutritionTarget | null;
  readonly targetWithheld: TargetWithheldReason | null;
  /** Photo scans left today. Null for other dates. */
  readonly scansLeftToday: number | null;
}

const decodeItemNutrients: Reader<ItemNutrients> = (value, path) => {
  const json = object(value, path);
  return {
    kcalLow: req(json, 'kcalLow', path, integer),
    kcalHigh: req(json, 'kcalHigh', path, integer),
    proteinG: opt(json, 'proteinG', path, double),
    carbsG: opt(json, 'carbsG', path, double),
    fatG: opt(json, 'fatG', path, double),
    grams: opt(json, 'grams', path, double),
    macrosComplete: opt(json, 'macrosComplete', path, boolean),
  };
};

const decodeServingOption: Reader<ServingOption> = (value, path) => {
  const json = object(value, path);
  return {
    unit: req(json, 'unit', path, string),
    label: opt(json, 'label', path, string),
    grams: opt(json, 'grams', path, double),
  };
};

const decodeMealItem: Reader<MealItemView> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    source: opt(json, 'source', path, string),
    basis: opt(json, 'basis', path, string),
    label: opt(json, 'label', path, string),
    brand: opt(json, 'brand', path, string),
    foodId: opt(json, 'foodId', path, string),
    barcode: opt(json, 'barcode', path, string),
    serving: opt(json, 'serving', path, decodeServingOption),
    amount: opt(json, 'amount', path, double),
    servingOptions: opt(json, 'servingOptions', path, arrayOf(decodeServingOption)),
    confidence: opt(json, 'confidence', path, string),
    confirmed: opt(json, 'confirmed', path, boolean),
    nutrients: opt(json, 'nutrients', path, decodeItemNutrients),
    liquid: opt(json, 'liquid', path, boolean),
    edited: opt(json, 'edited', path, arrayOf(string)),
  };
};

export const decodeMealView: Reader<MealView> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    logDate: opt(json, 'logDate', path, string),
    loggedAt: opt(json, 'loggedAt', path, instant),
    slot: opt(json, 'slot', path, mealSlot),
    source: opt(json, 'source', path, string),
    confirmed: opt(json, 'confirmed', path, boolean),
    confidence: opt(json, 'confidence', path, string),
    needsConfirm: opt(json, 'needsConfirm', path, boolean),
    hasEstimate: opt(json, 'hasEstimate', path, boolean),
    items: opt(json, 'items', path, arrayOf(decodeMealItem)),
    totals: opt(json, 'totals', path, decodeMealDayTotals),
    createdAt: opt(json, 'createdAt', path, instant),
    updatedAt: opt(json, 'updatedAt', path, instant),
  };
};

export const decodeMealDraftBrief: Reader<MealDraftBrief> = (value, path) => {
  const json = object(value, path);
  return {
    id: req(json, 'id', path, string),
    logDate: opt(json, 'logDate', path, string),
    loggedAt: opt(json, 'loggedAt', path, instant),
    slot: opt(json, 'slot', path, mealSlot),
    itemCount: opt(json, 'itemCount', path, integer),
    source: opt(json, 'source', path, string),
  };
};

export const decodeMealDaySummary: Reader<MealDaySummary> = (value, path) => {
  const json = object(value, path);
  return {
    date: req(json, 'date', path, string),
    kcalLow: opt(json, 'kcalLow', path, integer),
    kcalHigh: opt(json, 'kcalHigh', path, integer),
    proteinG: opt(json, 'proteinG', path, double),
    carbsG: opt(json, 'carbsG', path, double),
    fatG: opt(json, 'fatG', path, double),
    mealCount: opt(json, 'mealCount', path, integer),
    draftCount: opt(json, 'draftCount', path, integer),
    target: opt(json, 'target', path, decodeNutritionTarget),
  };
};

export const decodeHealthMealsBlock: Reader<HealthMealsBlock> = (value, path) => {
  const json = object(value, path);
  return {
    date: opt(json, 'date', path, string),
    meals: opt(json, 'meals', path, arrayOf(decodeMealView)),
    drafts: opt(json, 'drafts', path, arrayOf(decodeMealDraftBrief)),
    totals: opt(json, 'totals', path, decodeMealDayTotals),
    target: opt(json, 'target', path, decodeNutritionTarget),
    targetWithheld: opt(json, 'targetWithheld', path, targetWithheld),
    scansLeftToday: opt(json, 'scansLeftToday', path, integer),
  };
};

// ---------------------------------------------------------------------------
// Target weight (server feature `target_weight`)

/**
 * The feature names a server advertises in `features`. The app hides a
 * feature whose name is absent and never calls a route of one it has not
 * seen (src/stores/appStore.ts keeps the list: `ServerFeature`).
 */
export const HealthServerFeature = {
  targetWeight: 'target_weight',
  planRevision: 'plan_revision',
  feedback: 'health_feedback',
  mealDescribe: 'meal_describe',
} as const;

/**
 * The member's standing target weight, as the server says it shapes their
 * numbers today. FAIL SOFT: only the weight itself is required. An unknown
 * `direction` or `appliesTo` reads through the `known*` helpers as null, and
 * an estimate that makes no sense is dropped.
 */
export interface TargetWeightView {
  /** One decimal. */
  readonly targetWeightKg: number;
  /** `lose` or `gain`; read `knownDirection`. */
  readonly direction: string | null;
  readonly setAt: Date | null;
  /** Non-null: the target was reached and the range keeps the weight steady. */
  readonly reachedAt: Date | null;
  /** The latest height puts the target outside a healthy weight, so every calculation ignores it. */
  readonly outsideHealthyRange: boolean | null;
  /** `program`, `goal`, or null; read `knownAppliesTo`. */
  readonly appliesTo: string | null;
  /** A rough estimate, or null when the server hides it. */
  readonly eta: { readonly weeksLow: number; readonly weeksHigh: number } | null;
}

export const decodeTargetWeightView: Reader<TargetWeightView> = (value, path) => {
  const json = object(value, path);
  const eta = soft(json, 'eta', path, (raw, p) => {
    const e = object(raw, p);
    return { weeksLow: req(e, 'weeksLow', p, integer), weeksHigh: req(e, 'weeksHigh', p, integer) };
  });
  return {
    targetWeightKg: req(json, 'targetWeightKg', path, double),
    direction: soft(json, 'direction', path, string),
    setAt: soft(json, 'setAt', path, instant),
    reachedAt: soft(json, 'reachedAt', path, instant),
    outsideHealthyRange: soft(json, 'outsideHealthyRange', path, boolean),
    appliesTo: soft(json, 'appliesTo', path, string),
    eta: eta && eta.weeksLow > 0 && eta.weeksHigh >= eta.weeksLow ? eta : null,
  };
};

/** `lose` or `gain`; anything else is null. */
export function knownDirection(target: Pick<TargetWeightView, 'direction'>): 'lose' | 'gain' | null {
  return target.direction === 'lose' || target.direction === 'gain' ? target.direction : null;
}

/** `program` or `goal`; an unknown value from a newer server is null. */
export function knownAppliesTo(target: Pick<TargetWeightView, 'appliesTo'>): 'program' | 'goal' | null {
  return target.appliesTo === 'program' || target.appliesTo === 'goal' ? target.appliesTo : null;
}

export function isTargetReached(target: Pick<TargetWeightView, 'reachedAt'>): boolean {
  return target.reachedAt !== null;
}

export function isTargetOutsideHealthyRange(target: Pick<TargetWeightView, 'outsideHealthyRange'>): boolean {
  return target.outsideHealthyRange === true;
}

/** `(try? decodeIfPresent([String].self, ...)) ?? nil`: a list of strings, else null. */
export function decodeFeatureList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

// ---------------------------------------------------------------------------
// OP-06 the Today read

/**
 * One read answers the whole Plan tab: today's session, the week, nutrition,
 * the scores, the review, both histories and the reminder planner's input.
 * One read, one truth: a screen assembled from five calls is a screen that
 * disagrees with itself while three of them are still in flight.
 */
export interface HealthDay {
  readonly contractVersion: string | null;
  readonly date: string;
  /** The SERVER's today, which is what every `relative` is measured against. */
  readonly today: string | null;
  readonly locale: string | null;
  readonly access: HealthAccess | null;
  readonly consent: HealthConsent | null;
  readonly program: ProgramSummary | null;
  readonly proposal: HealthProposal | null;
  readonly week: WeekView | null;
  readonly day: DayView | null;
  readonly note: DailyNote | null;
  readonly meals: HealthMealsBlock | null;
  readonly scores: HealthScores | null;
  readonly review: WeeklyReviewView | null;
  readonly weighIn: WeighInState | null;
  readonly checkIn: CheckInState | null;
  /** Today only: the live programme's rows for today through today + 6. The reminder planner's only source. */
  readonly upcoming: readonly SessionBrief[] | null;
  /** Today only: every unconfirmed PHOTO draft of the last 30 days, whatever its own date. */
  readonly pendingDrafts: readonly MealDraftBrief[] | null;
  readonly history: {
    readonly workouts: readonly SessionHistoryItem[] | null;
    readonly mealDays: readonly MealDaySummary[] | null;
  } | null;
  readonly libraryVersion: string | null;
  /** Today only: the standing target weight, or null. Absent on a server that predates `target_weight`. */
  readonly targetWeight: TargetWeightView | null;
  /** What this server supports beyond the contract. */
  readonly features: readonly string[] | null;
  /** Today only: unconfirmed estimates made from a meal description. Absent on an older server. */
  readonly pendingTextDrafts: readonly MealDraftBrief[] | null;
}

const decodeConsent: Reader<HealthConsent> = (value, path) => {
  const json = object(value, path);
  return {
    version: opt(json, 'version', path, string),
    consentedAt: opt(json, 'consentedAt', path, instant),
    ageSource: opt(json, 'ageSource', path, string),
  };
};

/**
 * `GET /health`'s `data`. Throws `HealthShapeError` when a member the day
 * always had has the wrong type (the API client turns that into a
 * `DecodingError`); the three newest members (`targetWeight`, `features`,
 * `pendingTextDrafts`) and every unknown enum value never fail it.
 */
export function decodeHealthDay(data: unknown): HealthDay {
  const path = 'health';
  const json = object(data, path);
  return {
    contractVersion: opt(json, 'contractVersion', path, string),
    date: req(json, 'date', path, string),
    today: opt(json, 'today', path, string),
    locale: opt(json, 'locale', path, string),
    access: opt(json, 'access', path, healthAccess),
    consent: opt(json, 'consent', path, decodeConsent),
    program: opt(json, 'program', path, decodeProgramSummary),
    proposal: opt(json, 'proposal', path, decodeHealthProposal),
    week: opt(json, 'week', path, decodeWeekView),
    day: opt(json, 'day', path, decodeDayView),
    note: opt(json, 'note', path, decodeDailyNote),
    meals: opt(json, 'meals', path, decodeHealthMealsBlock),
    scores: opt(json, 'scores', path, decodeHealthScores),
    review: opt(json, 'review', path, decodeWeeklyReview),
    weighIn: opt(json, 'weighIn', path, decodeWeighInState),
    checkIn: opt(json, 'checkIn', path, decodeCheckInState),
    upcoming: opt(json, 'upcoming', path, arrayOf(decodeSessionBrief)),
    pendingDrafts: opt(json, 'pendingDrafts', path, arrayOf(decodeMealDraftBrief)),
    history: opt(json, 'history', path, (raw, p) => {
      const h = object(raw, p);
      return {
        workouts: opt(h, 'workouts', p, arrayOf(decodeSessionHistoryItem)),
        mealDays: opt(h, 'mealDays', p, arrayOf(decodeMealDaySummary)),
      };
    }),
    libraryVersion: opt(json, 'libraryVersion', path, string),
    targetWeight: soft(json, 'targetWeight', path, decodeTargetWeightView),
    features: decodeFeatureList(json.features),
    pendingTextDrafts: soft(json, 'pendingTextDrafts', path, arrayOf(decodeMealDraftBrief)),
  };
}

/** True when this is the day the server calls today. */
export function isServerToday(day: Pick<HealthDay, 'day' | 'date' | 'today'>): boolean {
  return day.day?.relative === 'today' || day.date === day.today;
}

/**
 * Every estimate waiting for the member: the photo drafts and the
 * description drafts, newest first. A description draft always says `text`,
 * whatever its brief carried.
 */
export function allPendingDrafts(day: Pick<HealthDay, 'pendingDrafts' | 'pendingTextDrafts'>): MealDraftBrief[] {
  const photos = day.pendingDrafts ?? [];
  const texts = (day.pendingTextDrafts ?? []).map((brief) => ({ ...brief, source: 'text' }));
  const seen = new Set<string>();
  const unique = [...photos, ...texts].filter((brief) => {
    if (seen.has(brief.id)) return false;
    seen.add(brief.id);
    return true;
  });
  // A stable sort, newest first; a draft with no time sorts last (distantPast).
  return unique
    .map((brief, index) => ({ brief, index, at: brief.loggedAt?.getTime() ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => (b.at === a.at ? a.index - b.index : b.at > a.at ? 1 : -1))
    .map(({ brief }) => brief);
}

/**
 * The day as JSON, in the wire's shape, for the cache: dates as ISO
 * instants, a proposal flattened back into one object. `decodeHealthDay`
 * reads it back to an equal value.
 */
export function encodeHealthDay(day: HealthDay): string {
  const wire: Json = { ...day };
  if (day.proposal) wire.proposal = { ...day.proposal.program, week1: day.proposal.week1 };
  return encodeBody(wire);
}

/** The cached day, or null when the text is not one (an unreadable cache is no cache). */
export function decodeCachedHealthDay(text: string): HealthDay | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? decodeHealthDay(parsed) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Action responses

export interface SessionActionResponse {
  readonly session: SessionView | null;
  /** Other rows the action changed (a move's swap partner, a pull, an undo). */
  readonly changed: readonly SessionView[] | null;
  readonly remark: LocalizedLine | null;
  readonly tomorrow: TomorrowBrief | null;
  readonly nextWeekChange: ProgressionChange | null;
  readonly week: WeekView | null;
  /** Today plus 6 days AFTER the action, so the reminder planner never needs a second read. */
  readonly upcoming: readonly SessionBrief[] | null;
  readonly replayed: boolean | null;
}

export function decodeSessionActionResponse(data: unknown): SessionActionResponse {
  const path = 'sessionAction';
  const json = object(data, path);
  return {
    session: opt(json, 'session', path, decodeSessionView),
    changed: opt(json, 'changed', path, arrayOf(decodeSessionView)),
    remark: opt(json, 'remark', path, decodeLocalizedLine),
    tomorrow: opt(json, 'tomorrow', path, decodeTomorrowBrief),
    nextWeekChange: opt(json, 'nextWeekChange', path, decodeProgressionChange),
    week: opt(json, 'week', path, decodeWeekView),
    upcoming: opt(json, 'upcoming', path, arrayOf(decodeSessionBrief)),
    replayed: opt(json, 'replayed', path, boolean),
  };
}

export interface ProgramWeekPlan {
  readonly weekNo: number;
  readonly deload: boolean | null;
  readonly note: string | null;
  readonly days: readonly SessionBrief[] | null;
}

/** A programme with its weeks. On the wire the summary's members and the weeks are ONE object. */
export interface ProgramDetail {
  readonly program: ProgramSummary;
  readonly weekPlans: readonly ProgramWeekPlan[] | null;
  readonly previousProgramId: string | null;
}

const decodeWeekPlan: Reader<ProgramWeekPlan> = (value, path) => {
  const json = object(value, path);
  return {
    weekNo: req(json, 'weekNo', path, integer),
    deload: opt(json, 'deload', path, boolean),
    note: opt(json, 'note', path, string),
    days: opt(json, 'days', path, arrayOf(decodeSessionBrief)),
  };
};

export const decodeProgramDetail: Reader<ProgramDetail> = (value, path) => {
  const json = object(value, path);
  return {
    program: decodeProgramSummary(json, path),
    weekPlans: soft(json, 'weekPlans', path, arrayOf(decodeWeekPlan)),
    previousProgramId: soft(json, 'previousProgramId', path, string),
  };
};

export interface ProgramAdoptResponse {
  readonly program: ProgramDetail | null;
  readonly week: WeekView | null;
  readonly day: DayView | null;
  readonly upcoming: readonly SessionBrief[] | null;
  readonly replaced: { readonly id: string } | null;
  readonly replayed: boolean | null;
}

export function decodeProgramAdoptResponse(data: unknown): ProgramAdoptResponse {
  const path = 'adopt';
  const json = object(data, path);
  return {
    program: opt(json, 'program', path, decodeProgramDetail),
    week: opt(json, 'week', path, decodeWeekView),
    day: opt(json, 'day', path, decodeDayView),
    upcoming: opt(json, 'upcoming', path, arrayOf(decodeSessionBrief)),
    replaced: opt(json, 'replaced', path, (raw, p) => ({ id: req(object(raw, p), 'id', p, string) })),
    replayed: opt(json, 'replayed', path, boolean),
  };
}

export interface ProgramUpdateResponse {
  readonly program: ProgramDetail | null;
  readonly week: WeekView | null;
  readonly day: DayView | null;
  readonly upcoming: readonly SessionBrief[] | null;
  readonly replayed: boolean | null;
}

export function decodeProgramUpdateResponse(data: unknown): ProgramUpdateResponse {
  const path = 'programUpdate';
  const json = object(data, path);
  return {
    program: opt(json, 'program', path, decodeProgramDetail),
    week: opt(json, 'week', path, decodeWeekView),
    day: opt(json, 'day', path, decodeDayView),
    upcoming: opt(json, 'upcoming', path, arrayOf(decodeSessionBrief)),
    replayed: opt(json, 'replayed', path, boolean),
  };
}

export interface CheckinResponse {
  readonly review: WeeklyReviewView | null;
  readonly weighIn: WeighInState | null;
  readonly checkIn: CheckInState | null;
  readonly replayed: boolean | null;
}

export function decodeCheckinResponse(data: unknown): CheckinResponse {
  const path = 'checkin';
  const json = object(data, path);
  return {
    review: opt(json, 'review', path, decodeWeeklyReview),
    weighIn: opt(json, 'weighIn', path, decodeWeighInState),
    checkIn: opt(json, 'checkIn', path, decodeCheckInState),
    replayed: opt(json, 'replayed', path, boolean),
  };
}

// ---------------------------------------------------------------------------
// Routing and wipe vocabulary

/**
 * An action Plan performs after its read, parked by whoever asked for it
 * (Home, the Coach, a notification, a toast). Each is consumed once.
 */
export type PlanAction =
  | { readonly kind: 'startWorkout'; readonly sessionId: string }
  | { readonly kind: 'openWeeklyCheckIn' }
  | { readonly kind: 'openDiary'; readonly date: string }
  | { readonly kind: 'showAdoptedBanner'; readonly startsOn: string | null }
  | { readonly kind: 'openProposal' }
  | { readonly kind: 'openPastPlans' }
  | { readonly kind: 'openDraft'; readonly mealId: string }
  /** A tapped monthly feedback notification: the report it names, or the current one. */
  | { readonly kind: 'openFeedback'; readonly reportId: string | null }
  /** A tapped mid-month note notification: the card on Plan. */
  | { readonly kind: 'openFeedbackNote' };

/** How the member entered the Coach's programme wizard. `adjust` carries nothing, on purpose. */
export type CoachProgramEntry =
  | { readonly kind: 'planTab' }
  | { readonly kind: 'nextBlock'; readonly programId: string }
  | { readonly kind: 'home' }
  | { readonly kind: 'adjust' };

/** Why local health data was wiped from this phone. Analytics only: never a member value. */
export type HealthWipeReason = 'signout' | 'withdrawn' | 'withdrawn_elsewhere' | 'account_deletion' | 'minor';
