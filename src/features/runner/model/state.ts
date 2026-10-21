/**
 * Every rule that changes an in-progress workout: the Android port of the
 * mutating methods of iOS `RunnerState` (Views/Workout/WorkoutRunnerView.swift).
 *
 * PURE. Nothing here reads a clock, a file or the network: each function is
 * told the time (`now`) and returns a NEW state (and, where iOS returns
 * something, that too). So the runner screen, the launch rules and the tests
 * all run the same code, and a test can hold it to the iOS cases line by
 * line without a device.
 *
 *   const { state: next, outcome } = tick(state, 0, 1, new Date());
 */
import { addServerDays, roundHalfAwayFromZero, wholeNumberOf } from '../../../i18n/format';
import type { SessionView } from '../../../health/models';

import {
  doneCount,
  doseOfAlternative,
  exerciseFromBlock,
  isClosed,
  isComplete,
  isSwapped,
  nextOpenSet,
  tracksLoad,
} from './exercise';
import { startRunnerTimer, timerHeld } from './timer';
import {
  AWAY_CREDIT_SECONDS,
  AWAY_CREDIT_STOPWATCH_SECONDS,
  DEFAULT_REST_SECONDS,
  KG_CEILING,
  KG_STEP,
  RUNNER_STATE_VERSION,
  unitCeiling,
  unitStep,
  type RunnerEntry,
  type RunnerExercise,
  type RunnerPrimaryAction,
  type RunnerSet,
  type RunnerSkipUndo,
  type RunnerState,
  type RunnerSummary,
  type RunnerSwapOption,
  type RunnerTickOutcome,
} from './types';

// ---------------------------------------------------------------------------
// Drafts: a deep-enough copy to change, so the state handed in never changes.

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DraftSet = Mutable<RunnerSet>;
type DraftExercise = Omit<Mutable<RunnerExercise>, 'sets'> & { sets: DraftSet[] };
type Draft = Omit<Mutable<RunnerState>, 'exercises'> & { exercises: DraftExercise[] };

function draftOf(state: RunnerState): Draft {
  return {
    ...state,
    exercises: state.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => ({ ...set })) })),
  };
}

/** Runs `change` on a copy and returns the copy with what `change` returned. */
function mutate<R>(state: RunnerState, change: (draft: Draft) => R): { state: RunnerState; result: R } {
  const draft = draftOf(state);
  const result = change(draft);
  return { state: draft, result };
}

function hasSet(state: RunnerState, exercise: number, set: number): boolean {
  const block = state.exercises[exercise];
  return exercise >= 0 && block !== undefined && set >= 0 && set < block.sets.length;
}

function seconds(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000;
}

function plus(date: Date, secondsLater: number): Date {
  return new Date(date.getTime() + secondsLater * 1000);
}

// ---------------------------------------------------------------------------
// Start

/** The Iceland day after `day` (Reykjavík is UTC, no daylight saving). */
export function dayAfter(day: string): string | null {
  return addServerDays(day, 1);
}

/** A fresh runner for `session`. `today` is the SERVER's calendar day. */
export function startRunnerState(options: {
  readonly session: SessionView;
  readonly origin: RunnerEntry;
  readonly now: Date;
  readonly today: string;
}): RunnerState {
  const { session, origin, now, today } = options;
  const exercises = (session.blocks ?? [])
    .map((block, index) => exerciseFromBlock(block, index))
    .filter((exercise): exercise is RunnerExercise => exercise !== null);
  // The end of the day AFTER the session's date; for "Do it now", the day
  // after today.
  const base = origin === 'missed' ? today : (session.scheduledFor ?? today);
  return {
    version: RUNNER_STATE_VERSION,
    sessionId: session.id,
    session,
    origin: origin === 'resume' ? 'today' : origin,
    startedAt: now,
    keepUntilDay: dayAfter(base) ?? base,
    exercises,
    index: 0,
    restEndsAt: null,
    restTotalSeconds: null,
    timer: null,
    finishKey: null,
    completedAt: null,
    clockSeconds: 0,
    clockRunningSince: now,
    clockAwaySince: null,
    lastSeenAt: now,
  };
}

/**
 * The runner a screen opens with: the saved one when it is this session's
 * (its clock recovered, the entry `resume`), else a fresh one with the
 * entry it was opened from (iOS `WorkoutRunnerModel.init`).
 */
export function openRunnerState(options: {
  readonly session: SessionView;
  readonly restored: RunnerState | null;
  readonly entry: RunnerEntry;
  readonly now: Date;
  readonly today: string;
}): { readonly state: RunnerState; readonly entry: RunnerEntry } {
  const { session, restored, entry, now, today } = options;
  if (restored && restored.sessionId === session.id) {
    // The clock stopped when the app left or the member chose "later"; it
    // runs again from here, crediting only what counts.
    return { state: recoverClock(restored, now), entry: 'resume' };
  }
  return { state: startRunnerState({ session, origin: entry, now, today }), entry };
}

/** Past the end of the day after its session: Plan deletes it on load. */
export function isExpired(state: Pick<RunnerState, 'keepUntilDay'>, today: string): boolean {
  return today > state.keepUntilDay;
}

// ---------------------------------------------------------------------------
// Reading

export function totalExercises(state: RunnerState): number {
  return state.exercises.length;
}

export function currentExercise(state: RunnerState): RunnerExercise | null {
  return state.exercises[state.index] ?? null;
}

export function nextExercise(state: RunnerState): RunnerExercise | null {
  return state.exercises[state.index + 1] ?? null;
}

export function anySetDone(state: RunnerState): boolean {
  return state.exercises.some((exercise) => doneCount(exercise) > 0);
}

export function isAtLastExercise(state: RunnerState): boolean {
  return state.index >= state.exercises.length - 1;
}

/** Is there any set left to do after (exercise, set)? */
export function workRemains(state: RunnerState, exercise: number, set: number): boolean {
  const current = state.exercises[exercise];
  if (exercise < 0 || !current) return false;
  if (!isClosed(current) && current.sets.some((other, index) => index !== set && !other.done)) return true;
  return state.exercises.some((other, index) => index > exercise && !isComplete(other));
}

export function primaryAction(state: RunnerState): RunnerPrimaryAction {
  const current = currentExercise(state);
  if (!current) return { kind: 'finish' };
  const open = nextOpenSet(current);
  if (open !== null) {
    const counting = state.timer !== null && state.timer.exercise === state.index && state.timer.set === open;
    if (current.unit === 'seconds' && !counting) return { kind: 'startTimer', number: open + 1 };
    return { kind: 'completeSet', number: open + 1 };
  }
  return isAtLastExercise(state) ? { kind: 'finish' } : { kind: 'next' };
}

/**
 * Exercises with at least one set done, of all; and every set done, the done
 * sets of an exercise ended early included.
 */
export function summary(state: RunnerState): RunnerSummary {
  return {
    exercises: state.exercises.filter((exercise) => doneCount(exercise) > 0).length,
    total: state.exercises.length,
    sets: state.exercises.reduce((sum, exercise) => sum + doneCount(exercise), 0),
  };
}

// ---------------------------------------------------------------------------
// The active clock

/** Whole active seconds at `now`: stopped while the member is away or chose "later". */
export function activeSeconds(state: RunnerState, now: Date): number {
  const running = state.clockRunningSince ? Math.max(0, seconds(state.clockRunningSince, now)) : 0;
  return Math.trunc(state.clockSeconds + running);
}

export function stopwatchRunning(state: RunnerState): boolean {
  return state.exercises.some((exercise) => exercise.stopwatchStartedAt !== null);
}

/**
 * Stop the clock. `away`: the app left the foreground (the return may credit
 * the time); otherwise "Finish later today" (it will not).
 */
export function pauseClock(state: RunnerState, now: Date, away: boolean): RunnerState {
  const since = state.clockRunningSince;
  if (since) {
    return {
      ...state,
      clockSeconds: state.clockSeconds + Math.max(0, seconds(since, now)),
      clockRunningSince: null,
      clockAwaySince: away ? now : null,
      lastSeenAt: now,
    };
  }
  return { ...state, clockAwaySince: away ? state.clockAwaySince : null, lastSeenAt: now };
}

/** Start the clock again, crediting the time away up to its limit. */
export function resumeClock(state: RunnerState, now: Date): RunnerState {
  if (state.clockRunningSince) return state;
  let banked = state.clockSeconds;
  if (state.clockAwaySince) {
    const limit = stopwatchRunning(state) ? AWAY_CREDIT_STOPWATCH_SECONDS : AWAY_CREDIT_SECONDS;
    banked += Math.min(Math.max(0, seconds(state.clockAwaySince, now)), limit);
  }
  return { ...state, clockSeconds: banked, clockAwaySince: null, clockRunningSince: now, lastSeenAt: now };
}

/**
 * A file read back after a relaunch. A clock that was RUNNING when the
 * process died counts up to the last write, then as time away.
 */
export function recoverClock(state: RunnerState, now: Date): RunnerState {
  let next = state;
  const since = state.clockRunningSince;
  if (since) {
    const seenMs = Math.max(since.getTime(), Math.min(state.lastSeenAt.getTime(), now.getTime()));
    const seen = new Date(seenMs);
    next = {
      ...state,
      clockSeconds: state.clockSeconds + seconds(since, seen),
      clockRunningSince: null,
      clockAwaySince: seen,
    };
  }
  return resumeClock(next, now);
}

/**
 * Elapsed ACTIVE minutes rounded to the nearest 5, within 5 to 180, and
 * never more than twice the planned session (or the plan plus half an hour),
 * so a clock that ran on cannot claim hours.
 */
export function suggestedMinutes(state: RunnerState, now: Date): number {
  const minutes = activeSeconds(state, now) / 60;
  let rounded = roundHalfAwayFromZero(minutes / 5) * 5;
  const planned = state.session.minutes;
  if (planned !== null && planned > 0) rounded = Math.min(rounded, Math.max(planned * 2, planned + 30));
  return Math.min(180, Math.max(5, rounded));
}

// ---------------------------------------------------------------------------
// Rest

export function isResting(state: RunnerState, now: Date): boolean {
  return state.restEndsAt !== null && state.restEndsAt.getTime() > now.getTime();
}

/** Whole seconds left, rounded up, or null when not resting. */
export function restRemaining(state: RunnerState, now: Date): number | null {
  if (!isResting(state, now) || !state.restEndsAt) return null;
  return Math.ceil(seconds(now, state.restEndsAt));
}

export function skipRest(state: RunnerState): RunnerState {
  if (state.restEndsAt === null && state.restTotalSeconds === null) return state;
  return { ...state, restEndsAt: null, restTotalSeconds: null };
}

/** -15 or +15. A rest pushed to zero ends. */
export function adjustRest(state: RunnerState, by: number, now: Date): RunnerState {
  if (!state.restEndsAt || state.restEndsAt.getTime() <= now.getTime()) return state;
  const moved = plus(state.restEndsAt, by);
  if (moved.getTime() <= now.getTime()) return skipRest(state);
  return {
    ...state,
    restEndsAt: moved,
    restTotalSeconds: Math.max(state.restTotalSeconds ?? 0, Math.ceil(seconds(now, moved))),
  };
}

/** `ended` is true when a rest was running and has now run out. */
export function endRestIfDue(state: RunnerState, now: Date): { readonly state: RunnerState; readonly ended: boolean } {
  if (!state.restEndsAt || state.restEndsAt.getTime() > now.getTime()) return { state, ended: false };
  return { state: skipRest(state), ended: true };
}

function startRest(draft: Draft, exercise: number, now: Date): Date {
  const rest = draft.exercises[exercise].restSec;
  const restSeconds = rest > 0 ? rest : DEFAULT_REST_SECONDS;
  const endsAt = plus(now, restSeconds);
  draft.restEndsAt = endsAt;
  draft.restTotalSeconds = restSeconds;
  return endsAt;
}

// ---------------------------------------------------------------------------
// Sets

function tickDraft(draft: Draft, exercise: number, set: number, now: Date): RunnerTickOutcome | null {
  if (!hasSet(draft, exercise, set)) return null;
  const block = draft.exercises[exercise];
  // Ticking a set of a skipped exercise reopens it.
  block.skipped = false;
  block.endedEarly = false;
  block.sets[set].done = true;
  const timer = draft.timer;
  if (timer && timer.exercise === exercise && timer.set === set) {
    // Ended before zero: log the seconds actually held (each side's, for a
    // hold done each side).
    const held = timerHeld(timer, now);
    if (held > 0 && held < block.sets[set].value) block.sets[set].value = held;
    draft.timer = null;
  }
  if (block.unit === 'minutes' && block.stopwatchStartedAt) {
    // A stopwatch that ran logs what it measured.
    const measured = roundHalfAwayFromZero(Math.max(0, seconds(block.stopwatchStartedAt, now)));
    if (measured >= 60) block.sets[set].value = Math.min(unitCeiling('minutes'), measured);
    block.stopwatchStartedAt = null;
  }
  if (!workRemains(draft, exercise, set)) {
    draft.restEndsAt = null;
    draft.restTotalSeconds = null;
    return { kind: 'workoutComplete' };
  }
  return { kind: 'restStarted', endsAt: startRest(draft, exercise, now) };
}

/**
 * Tick one set with the values shown. Starts a rest when more work follows;
 * otherwise the workout is complete. A set that does not exist changes
 * nothing (`outcome` null).
 */
export function tick(
  state: RunnerState,
  exercise: number,
  set: number,
  now: Date,
): { readonly state: RunnerState; readonly outcome: RunnerTickOutcome | null } {
  if (!hasSet(state, exercise, set)) return { state, outcome: null };
  const { state: next, result } = mutate(state, (draft) => tickDraft(draft, exercise, set, now));
  return { state: next, outcome: result };
}

/** Tick the next open set of the exercise on screen. */
export function completeNextSet(
  state: RunnerState,
  now: Date,
): { readonly state: RunnerState; readonly outcome: RunnerTickOutcome | null } {
  const current = currentExercise(state);
  const open = current ? nextOpenSet(current) : null;
  if (open === null) return { state, outcome: null };
  return tick(state, state.index, open, now);
}

/** Untick a set the member ticked by mistake. No rest starts or stops. */
export function untick(state: RunnerState, exercise: number, set: number): RunnerState {
  if (!hasSet(state, exercise, set)) return state;
  return mutate(state, (draft) => {
    draft.exercises[exercise].sets[set].done = false;
  }).state;
}

/** `-` or `+` on the dose value (reps, seconds, metres, minutes). */
export function stepValue(state: RunnerState, exercise: number, set: number, direction: number): RunnerState {
  if (!hasSet(state, exercise, set)) return state;
  return mutate(state, (draft) => {
    const block = draft.exercises[exercise];
    const current = block.sets[set].value;
    block.sets[set].value = Math.min(unitCeiling(block.unit), Math.max(0, current + direction * unitStep(block.unit)));
  }).state;
}

/**
 * A typed value. Out-of-range values are clamped, never refused (minutes are
 * typed as minutes and stored as seconds).
 */
export function setValue(state: RunnerState, exercise: number, set: number, value: number): RunnerState {
  if (!hasSet(state, exercise, set)) return state;
  return mutate(state, (draft) => {
    const block = draft.exercises[exercise];
    const whole = wholeNumberOf(value);
    const stored = block.unit === 'minutes' ? whole * 60 : whole;
    block.sets[set].value = Math.min(unitCeiling(block.unit), Math.max(0, stored));
  }).state;
}

/** `-` or `+` 2.5 kg. From an empty field `+` starts at 2.5; `-` from 2.5 empties it. */
export function stepKg(state: RunnerState, exercise: number, set: number, direction: number): RunnerState {
  if (!hasSet(state, exercise, set)) return state;
  return mutate(state, (draft) => {
    const target = draft.exercises[exercise].sets[set];
    const moved = Math.min(KG_CEILING, Math.max(0, (target.kg ?? 0) + direction * KG_STEP));
    target.kg = moved === 0 && direction < 0 ? null : moved;
  }).state;
}

/** A typed load: clamped to 0 to 500 and rounded to 0.1; null (or not a number) empties it. */
export function setKg(state: RunnerState, exercise: number, set: number, kg: number | null): RunnerState {
  if (!hasSet(state, exercise, set)) return state;
  return mutate(state, (draft) => {
    const target = draft.exercises[exercise].sets[set];
    if (kg === null || !Number.isFinite(kg)) {
      target.kg = null;
      return;
    }
    target.kg = Math.min(KG_CEILING, Math.max(0, roundHalfAwayFromZero(kg * 10) / 10));
  }).state;
}

// ---------------------------------------------------------------------------
// Timed sets and the cardio stopwatch

/** Start the countdown of a timed set (a set dosed each side counts down once per side). */
export function startTimer(state: RunnerState, exercise: number, set: number, now: Date): RunnerState {
  if (!hasSet(state, exercise, set) || state.exercises[exercise].unit !== 'seconds') return state;
  const block = state.exercises[exercise];
  return {
    ...state,
    timer: startRunnerTimer({ exercise, set, seconds: block.sets[set].value, perSide: block.perSide, now }),
  };
}

/** The big button on a timed set: start the countdown of the next open set of the exercise on screen. */
export function startNextTimer(state: RunnerState, now: Date): RunnerState {
  const current = currentExercise(state);
  const open = current ? nextOpenSet(current) : null;
  if (open === null) return state;
  return startTimer(state, state.index, open, now);
}

export function stopTimer(state: RunnerState): RunnerState {
  return state.timer === null ? state : { ...state, timer: null };
}

/** Whole seconds until the countdown is over (both sides of a hold done each side), or null when nothing counts. */
export function timerRemaining(state: RunnerState, now: Date): number | null {
  if (!state.timer || state.timer.endsAt.getTime() <= now.getTime()) return null;
  return Math.ceil(seconds(now, state.timer.endsAt));
}

/**
 * A timed set that reached zero ticks itself.
 *
 * It ticks AT ITS END, not at `now`: a set that ran out while the app was in
 * the background (a plank with the phone locked) was over at `endsAt`, so
 * its rest started then too. Ticked at the return, the member met a full
 * rest they had already had.
 */
export function finishTimerIfDue(
  state: RunnerState,
  now: Date,
): { readonly state: RunnerState; readonly outcome: RunnerTickOutcome | null } {
  const timer = state.timer;
  if (!timer || timer.endsAt.getTime() > now.getTime()) return { state, outcome: null };
  const at = new Date(Math.min(now.getTime(), timer.endsAt.getTime()));
  return tick(state, timer.exercise, timer.set, at);
}

/** Start or stop a stopwatch row. Stopped after a minute or more, it logs what it measured. */
export function toggleStopwatch(state: RunnerState, exercise: number, now: Date): RunnerState {
  const block = state.exercises[exercise];
  if (exercise < 0 || !block || block.unit !== 'minutes') return state;
  return mutate(state, (draft) => {
    const target = draft.exercises[exercise];
    const started = target.stopwatchStartedAt;
    if (started) {
      const measured = roundHalfAwayFromZero(Math.max(0, seconds(started, now)));
      if (measured >= 60 && target.sets.length > 0) target.sets[0].value = Math.min(unitCeiling('minutes'), measured);
      target.stopwatchStartedAt = null;
    } else {
      target.stopwatchStartedAt = now;
    }
  }).state;
}

// ---------------------------------------------------------------------------
// Moving through the session

/** Next exercise. A rest that is still running keeps running. */
export function advance(state: RunnerState): RunnerState {
  if (state.index >= state.exercises.length - 1) return state;
  return { ...state, index: state.index + 1, timer: null };
}

/**
 * Skip the exercise on screen and move on. Returns what Undo restores.
 *
 * SETS ALREADY DONE STAY DONE. A member who managed two of three sets and
 * cannot do the third did those two: they are logged (with their kg, the
 * source of next week's `lastLoadKg`), and only the open set goes unlogged.
 * `skipped` is for an exercise with nothing done.
 */
export function skipCurrentExercise(state: RunnerState): { readonly state: RunnerState; readonly undo: RunnerSkipUndo | null } {
  const current = currentExercise(state);
  if (!current) return { state, undo: null };
  const undo: RunnerSkipUndo = { exercise: state.index, previous: current, previousIndex: state.index };
  const next = mutate(state, (draft) => {
    const block = draft.exercises[draft.index];
    if (doneCount(block) > 0) block.endedEarly = true;
    else block.skipped = true;
    block.stopwatchStartedAt = null;
    if (draft.timer?.exercise === draft.index) draft.timer = null;
    if (draft.index < draft.exercises.length - 1) draft.index += 1;
  }).state;
  return { state: next, undo };
}

export function undoSkip(state: RunnerState, undo: RunnerSkipUndo): RunnerState {
  if (undo.exercise < 0 || undo.exercise >= state.exercises.length) return state;
  const exercises = state.exercises.map((exercise, index) => (index === undo.exercise ? undo.previous : exercise));
  return { ...state, exercises, index: undo.previousIndex };
}

// ---------------------------------------------------------------------------
// Swap

/**
 * What a swap to `exerciseId` would put on screen, or null when it is not on
 * offer: not one of this block's alternatives (or its planned exercise),
 * already another block of this session, a unit the runner cannot dose, or a
 * change of unit after a set was logged in the old one.
 */
function swapTarget(
  state: RunnerState,
  exercise: number,
  exerciseId: string,
): { readonly option: RunnerSwapOption; readonly equipment: string | null } | null {
  const block = state.exercises[exercise];
  if (exercise < 0 || !block) return null;
  if (exerciseId === block.exerciseId) return null;
  const unitMayChange = doneCount(block) === 0;
  if (exerciseId === block.plannedExerciseId) {
    if (!unitMayChange && block.plannedUnit !== block.unit) return null;
    return {
      option: {
        exerciseId: block.plannedExerciseId,
        name: block.plannedName,
        equipmentLabel: block.plannedEquipmentLabel,
        level: 'same',
        isPlanned: true,
        unit: block.plannedUnit,
        target: block.plannedTarget,
        perSide: block.plannedPerSide,
      },
      equipment: block.plannedEquipment,
    };
  }
  const elsewhere = new Set(
    state.exercises.flatMap((other, index) => (index === exercise ? [] : [other.plannedExerciseId, other.exerciseId])),
  );
  if (elsewhere.has(exerciseId)) return null;
  const alternative = block.alternatives.find((candidate) => candidate.exerciseId === exerciseId);
  if (!alternative) return null;
  const dose = doseOfAlternative(block, alternative);
  if (!dose || (!unitMayChange && dose.unit !== block.unit)) return null;
  return {
    option: {
      exerciseId: alternative.exerciseId,
      name: alternative.name ?? '',
      equipmentLabel: alternative.equipmentLabel,
      level: alternative.level ?? 'same',
      isPlanned: false,
      unit: dose.unit,
      target: dose.target,
      perSide: dose.perSide,
    },
    equipment: alternative.equipment,
  };
}

function levelOrdinal(level: string | null | undefined): number {
  if (level === 'easier') return -1;
  if (level === 'harder') return 1;
  return 0;
}

function levelWord(difference: number): string {
  if (difference < 0) return 'easier';
  return difference > 0 ? 'harder' : 'same';
}

/**
 * The alternatives the runner can dose, with the planned exercise added back
 * once a swap is on, each with its level relative to what is on screen now.
 */
export function swapOptions(state: RunnerState, exercise: number): RunnerSwapOption[] {
  const block = state.exercises[exercise];
  if (exercise < 0 || !block) return [];
  const currentOrdinal = isSwapped(block)
    ? levelOrdinal(block.alternatives.find((alternative) => alternative.exerciseId === block.exerciseId)?.level)
    : 0;
  const ids = [...(isSwapped(block) ? [block.plannedExerciseId] : []), ...block.alternatives.map((a) => a.exerciseId)];
  const seen = new Set<string>();
  const options: RunnerSwapOption[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const found = swapTarget(state, exercise, id)?.option;
    if (!found) continue;
    const level = found.isPlanned ? levelWord(0 - currentOrdinal) : levelWord(levelOrdinal(found.level) - currentOrdinal);
    options.push({ ...found, level });
  }
  return options;
}

/**
 * Replace the exercise for this session only, keeping the set count and the
 * rest, and taking the new exercise's unit and dose for every set not done
 * yet. Only what `swapOptions` offers is accepted: the server refuses a
 * `performed` id outside the block.
 */
export function swap(
  state: RunnerState,
  exercise: number,
  toExerciseId: string,
): { readonly state: RunnerState; readonly swapped: boolean } {
  const target = swapTarget(state, exercise, toExerciseId);
  if (!target) return { state, swapped: false };
  const next = mutate(state, (draft) => {
    const block = draft.exercises[exercise];
    const option = target.option;
    const unitChanged: boolean = block.unit !== option.unit;
    block.exerciseId = option.exerciseId;
    block.name = option.name;
    block.equipment = target.equipment;
    block.equipmentLabel = option.equipmentLabel;
    block.unit = option.unit;
    block.target = option.target;
    block.perSide = option.perSide;
    if (unitChanged) block.stopwatchStartedAt = null;
    // The last load belongs to the planned exercise; a different one starts
    // empty. Sets already done keep what was logged.
    const loads = tracksLoad(block);
    const prefill = loads && !isSwapped(block) ? block.lastLoadKg : null;
    for (const set of block.sets) {
      if (set.done) continue;
      set.value = option.target;
      set.kg = loads ? prefill : null;
    }
    if (draft.timer?.exercise === exercise) draft.timer = null;
  }).state;
  return { state: next, swapped: true };
}

// ---------------------------------------------------------------------------
// Finish

/**
 * The finish sheet opens (iOS `prepareFinish`): the Save key is minted only
 * when there is none, and kept for every retry of the same Save, across
 * reopenings of the sheet and relaunches. A Save that timed out after the
 * server recorded it is then sent again under the SAME key, and counted once.
 * `mint` runs only when a key is needed. Returns `state` itself when it has one.
 */
export function ensureFinishKey(state: RunnerState, mint: () => string): RunnerState {
  return state.finishKey === null ? { ...state, finishKey: mint() } : state;
}

/**
 * Replaces the Save key, on purpose: only "Save as extra" (a new Save of the
 * same workout) and the `idempotency_key_reused` retry (iOS `saveAsExtra`,
 * `retryWithNewKey`). Opening the sheet uses `ensureFinishKey`.
 */
export function withFinishKey(state: RunnerState, key: string): RunnerState {
  return { ...state, finishKey: key };
}

/** Fixed at the first Save attempt, so a retry, an outbox item and its conversion all carry the same moment. */
export function withCompletedAt(state: RunnerState, now: Date): RunnerState {
  return state.completedAt ? state : { ...state, completedAt: now };
}
