/**
 * The runner's state machine: the port of iOS WorkoutRunnerTests'
 * model cases (LifePassTests/PlanSectionTests.swift), same vectors, same
 * names, in the same order. The rest restored from `runner.json` is in
 * ./runnerCodec.test.ts, the save and outbox tables in
 * ../../__tests__/saveRules.test.ts and ../../outbox/__tests__.
 */
import { RunnerFormat } from '../../../../i18n/runnerFormat';
import { cuesOf, doseOfAlternative, exerciseDose, tracksLoad } from '../exercise';
import { performed, runnerDoneBody, workoutDoneBody } from '../performed';
import {
  activeSeconds,
  adjustRest,
  advance,
  completeNextSet,
  endRestIfDue,
  ensureFinishKey,
  finishTimerIfDue,
  isExpired,
  isResting,
  openRunnerState,
  pauseClock,
  primaryAction,
  recoverClock,
  restRemaining,
  resumeClock,
  setKg,
  skipCurrentExercise,
  skipRest,
  startNextTimer,
  startRunnerState,
  startTimer,
  stepKg,
  stepValue,
  setValue,
  stopwatchRunning,
  suggestedMinutes,
  summary,
  swap,
  swapOptions,
  tick,
  timerRemaining,
  toggleStopwatch,
  undoSkip,
  untick,
  withCompletedAt,
  withFinishKey,
} from '../state';
import { decodeRunnerState, encodeRunnerState } from '../codec';
import { isPerSideTimer, switchStartsAt, timerPhase } from '../timer';
import type { RunnerState } from '../types';
import { encodeBody } from '../../../../api/wire';
import { at, fresh, intervalsJSON, perSideHoldJSON, session, t0, tEn, tIs } from './fixtures';

/** The state after `tick`, for the cases that only need the state. */
function ticked(state: RunnerState, exercise: number, set: number, now: Date): RunnerState {
  return tick(state, exercise, set, now).state;
}

function completed(state: RunnerState, now: Date): RunnerState {
  return completeNextSet(state, now).state;
}

describe('one dose per block', () => {
  it('testEachBlockIsDosedInItsOwnUnit', () => {
    const state = fresh();
    expect(state.exercises.map((e) => e.unit)).toEqual(['reps', 'reps', 'seconds', 'minutes', 'meters']);
    expect(state.exercises.map((e) => e.target)).toEqual([10, 8, 40, 1200, 100]);
    expect(state.exercises[1].perSide).toBe(true);
    expect(state.exercises.map((e) => e.sets.length)).toEqual([3, 2, 2, 1, 4]);
    expect(cuesOf(state.exercises[0])).toHaveLength(3);
  });

  it('testIntervalBlocksKeepEverySetAndTheirSeconds (V11: minutes never turns intervals into one row)', () => {
    const state = fresh(intervalsJSON);
    expect(state.exercises.map((e) => e.unit)).toEqual(['seconds', 'seconds', 'seconds']);
    expect(state.exercises.map((e) => e.target)).toEqual([45, 120, 500]);
    expect(state.exercises.map((e) => e.sets.length)).toEqual([6, 3, 3]);
    expect(state.exercises.map((e) => tracksLoad(e))).toEqual([false, false, false]);
    expect(primaryAction(state)).toEqual({ kind: 'startTimer', number: 1 });

    expect(RunnerFormat.planLine('seconds', 45, 6, false, tEn)).toBe('6 × 45 s');
    expect(RunnerFormat.planLine('seconds', 120, 3, false, tEn)).toBe('3 × 2 min');
    expect(RunnerFormat.planLine('seconds', 500, 3, false, tEn)).toBe('3 × 500 s');
    expect(RunnerFormat.dose('seconds', 120, false, 'en')).toBe('2 minutes');
    expect(RunnerFormat.dose('seconds', 500, false, 'en')).toBe('8 minutes 20 seconds');

    let next = ticked(state, 0, 0, t0);
    next = ticked(next, 0, 1, t0);
    const first = performed(next)[0];
    expect(first.sets).toHaveLength(6);
    expect(first.sets.filter((set) => set.done)).toHaveLength(2);
    expect(first.sets[0]).toEqual({ seconds: 45, done: true });
    expect(first.minutes).toBeUndefined();
  });

  it('testAOneSetCardioBlockIsOneStopwatchRow', () => {
    const dose = exerciseDose(1, null, 1200, 20, null);
    expect(dose).toEqual({ unit: 'minutes', target: 1200 });
    expect(exerciseDose(1, null, 40, null, null).unit).toBe('seconds');
    expect(exerciseDose(4, null, null, null, 50).unit).toBe('meters');
  });

  it('testTheWireRestKeyIsRead', () => {
    expect(fresh().exercises[0].restSec).toBe(90);
  });

  it('testTheKgColumnFollowsTheEquipment', () => {
    const state = fresh();
    expect(state.exercises.map((e) => tracksLoad(e))).toEqual([true, false, false, false, false]);
    expect(state.exercises[0].sets[0].kg).toBe(12.5);
    expect(state.exercises[1].sets[0].kg).toBeNull();
  });

  it('testTheAlternativesNeverOfferTheExerciseItself', () => {
    expect(fresh().exercises[0].alternatives.some((a) => a.exerciseId === 'goblet_squat')).toBe(false);
  });

  it('testATimedBlockDosedPerSideSaysEachSide (the runner half)', () => {
    const sidePlank = `[{ "blockNo": 1, "exerciseId": "side-plank", "name": "Side plank", "pattern": "core",
       "patternLabel": "Core", "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
       "sets": 2, "reps": null, "perSide": true, "seconds": 30, "minutes": null, "meters": null,
       "restSec": 45, "loadHint": "bodyweight", "cues": [], "alternatives": [] }]`;
    const exercise = fresh(sidePlank).exercises[0];
    expect(exercise.unit).toBe('seconds');
    expect(exercise.perSide).toBe(true);
    expect(RunnerFormat.planLine(exercise.unit, exercise.target, 2, exercise.perSide, tEn)).toBe('2 × 30 s each side');
    expect(RunnerFormat.dose('seconds', 30, true, 'en')).toBe('30 seconds each side');
    expect(RunnerFormat.dose('seconds', 30, true, 'is')).toBe('30 sekúndur hvor hlið');
    expect(RunnerFormat.dose('meters', 100, true, 'en')).toBe('100 metres');
  });

  it('a block with no exercise id is not a row, and the next block keeps its own number', () => {
    const state = fresh(`[ { "name": "Warm-up", "sets": 1, "minutes": 5 },
      { "exerciseId": "a", "name": "A", "sets": 2, "reps": 5 } ]`);
    expect(state.exercises.map((e) => e.exerciseId)).toEqual(['a']);
    expect(state.exercises[0].blockNo).toBe(2);
  });
});

describe('ticking sets and the rest', () => {
  it('testCompleteSetStartsTheBlocksRest', () => {
    const state = fresh();
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 1 });
    const { state: next, outcome } = completeNextSet(state, t0);
    expect(outcome).toEqual({ kind: 'restStarted', endsAt: at(90) });
    expect(next.exercises[0].sets[0].done).toBe(true);
    expect(next.exercises[0].sets[0].value).toBe(10);
    expect(restRemaining(next, at(30))).toBe(60);
    expect(primaryAction(next)).toEqual({ kind: 'completeSet', number: 2 });
    // The state handed in never changes.
    expect(state.exercises[0].sets[0].done).toBe(false);
  });

  it('testAMissingRestDefaultsToSixtySeconds', () => {
    const state = advance(fresh());
    expect(completeNextSet(state, t0).outcome).toEqual({ kind: 'restStarted', endsAt: at(60) });
  });

  it('testTheButtonWalksSetThenNextThenFinish', () => {
    let state = fresh(`[ { "blockNo": 1, "exerciseId": "a", "name": "A", "sets": 2, "reps": 5, "restSec": 30 },
      { "blockNo": 2, "exerciseId": "b", "name": "B", "sets": 1, "reps": 5, "restSec": 30 } ]`);
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 1 });
    state = skipRest(completed(state, t0));
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 2 });
    const second = completeNextSet(state, t0);
    expect(second.outcome).toEqual({ kind: 'restStarted', endsAt: at(30) });
    state = second.state;
    expect(primaryAction(state)).toEqual({ kind: 'next' });
    state = advance(state);
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 1 });
    const last = completeNextSet(state, t0);
    expect(last.outcome).toEqual({ kind: 'workoutComplete' });
    expect(last.state.restEndsAt).toBeNull();
    expect(primaryAction(last.state)).toEqual({ kind: 'finish' });
  });

  it('testRestIsComputedFromItsEndAndCanBeMovedOrSkipped', () => {
    let state = completed(fresh(), t0);
    state = adjustRest(state, 15, at(10));
    expect(restRemaining(state, at(10))).toBe(95);
    state = adjustRest(state, -15, at(10));
    expect(restRemaining(state, at(10))).toBe(80);
    state = adjustRest(state, -15, at(89));
    expect(state.restEndsAt).toBeNull();
    expect(isResting(state, at(89))).toBe(false);

    state = completed(state, t0);
    expect(endRestIfDue(state, at(89)).ended).toBe(false);
    const ended = endRestIfDue(state, at(90));
    expect(ended.ended).toBe(true);
    expect(restRemaining(ended.state, at(90))).toBeNull();
  });

  it('a rest moved later keeps the longest total for the ring', () => {
    let state = completed(fresh(), t0);
    expect(state.restTotalSeconds).toBe(90);
    state = adjustRest(state, 15, at(10));
    expect(state.restTotalSeconds).toBe(95);
    state = adjustRest(state, -15, at(10));
    expect(state.restTotalSeconds).toBe(95);
  });

  it('testUntickingASetStartsNothing', () => {
    let state = skipRest(ticked(fresh(), 0, 1, t0));
    state = untick(state, 0, 1);
    expect(state.exercises[0].sets[1].done).toBe(false);
    expect(state.restEndsAt).toBeNull();
  });

  it('testATimedSetStartsFromTheBigButtonAndTicksItselfAtZero', () => {
    let state = advance(advance(fresh()));
    expect(primaryAction(state)).toEqual({ kind: 'startTimer', number: 1 });
    state = startNextTimer(state, t0);
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 1 });
    expect(timerRemaining(state, at(15))).toBe(25);
    expect(finishTimerIfDue(state, at(39)).outcome).toBeNull();
    const done = finishTimerIfDue(state, at(40));
    expect(done.outcome).toEqual({ kind: 'restStarted', endsAt: at(85) });
    expect(done.state.exercises[2].sets[0].done).toBe(true);
    expect(done.state.exercises[2].sets[0].value).toBe(40);
    expect(done.state.timer).toBeNull();
  });

  it('testASetThatEndedWhileTheAppWasAwayRestsFromItsRealEnd', () => {
    const plank = `[ { "blockNo": 1, "exerciseId": "plank", "name": "Plank", "sets": 2, "seconds": 20, "restSec": 15 } ]`;
    let state = startNextTimer(fresh(plank), t0);
    expect(state.timer?.endsAt).toEqual(at(20));
    const back = at(45);
    const done = finishTimerIfDue(state, back);
    expect(done.outcome).toEqual({ kind: 'restStarted', endsAt: at(35) });
    state = done.state;
    expect(state.restEndsAt).toEqual(at(35));
    expect(state.exercises[0].sets[0].value).toBe(20);
    const over = endRestIfDue(state, back);
    expect(over.ended).toBe(true);
    expect(primaryAction(over.state)).toEqual({ kind: 'startTimer', number: 2 });

    // Back in the middle of the rest it had: what is left of it.
    const mid = finishTimerIfDue(startNextTimer(fresh(plank), t0), at(30)).state;
    expect(restRemaining(mid, at(30))).toBe(5);
  });

  it('testATimedSetEndedEarlyLogsTheSecondsHeld', () => {
    let state = startTimer(fresh(), 2, 0, t0);
    state = ticked(state, 2, 0, at(25));
    expect(state.exercises[2].sets[0].value).toBe(25);
    expect(state.timer).toBeNull();
  });
});

describe('holds dosed each side', () => {
  it('testAHoldDosedEachSideCountsDownOncePerSide', () => {
    let state = fresh(perSideHoldJSON);
    const hold = state.exercises[0];
    expect(hold.unit).toBe('seconds');
    expect(hold.perSide).toBe(true);
    expect(RunnerFormat.planLine(hold.unit, hold.target, 2, hold.perSide, tEn)).toBe('2 × 20 s each side');
    expect(RunnerFormat.dose('seconds', 20, true, 'en')).toBe('20 seconds each side');
    expect(
      tEn('runner.next_set_line', {
        n: '1',
        total: '2',
        dose: RunnerFormat.dose(hold.unit, hold.sets[0].value, hold.perSide, 'en'),
      }),
    ).toBe('Set 1 of 2: 20 seconds each side');
    expect(primaryAction(state)).toEqual({ kind: 'startTimer', number: 1 });

    state = startNextTimer(state, t0);
    const timer = state.timer!;
    expect(timer.sideSeconds).toBe(20);
    expect(timer.endsAt).toEqual(at(20 + 5 + 20));
    expect(timerRemaining(state, t0)).toBe(45);

    expect(timerPhase(timer, t0)).toEqual({ kind: 'side', side: 1, remaining: 20 });
    expect(timerPhase(timer, at(5))).toEqual({ kind: 'side', side: 1, remaining: 15 });
    expect(timerPhase(timer, at(19.4))).toEqual({ kind: 'side', side: 1, remaining: 1 });
    expect(timerPhase(timer, at(20))).toEqual({ kind: 'switching', remaining: 5 });
    expect(timerPhase(timer, at(24.5))).toEqual({ kind: 'switching', remaining: 1 });
    expect(timerPhase(timer, at(25))).toEqual({ kind: 'side', side: 2, remaining: 20 });
    expect(timerPhase(timer, at(44.2))).toEqual({ kind: 'side', side: 2, remaining: 1 });
    expect(timerPhase(timer, at(45))).toEqual({ kind: 'ended' });

    expect(finishTimerIfDue(state, at(20)).outcome).toBeNull();
    expect(finishTimerIfDue(state, at(44)).outcome).toBeNull();
    const done = finishTimerIfDue(state, at(45));
    expect(done.outcome).toEqual({ kind: 'restStarted', endsAt: at(60) });
    state = done.state;
    expect(state.exercises[0].sets[0].done).toBe(true);
    expect(state.exercises[0].sets[0].value).toBe(20);
    expect(state.timer).toBeNull();
    expect(performed(state)[0].sets[0]).toEqual({ seconds: 20, done: true });

    // The plank beside it is held once: one countdown, no sides.
    state = startNextTimer(skipRest(advance(state)), t0);
    const plank = state.timer!;
    expect(plank.sideSeconds).toBeNull();
    expect(isPerSideTimer(plank)).toBe(false);
    expect(plank.endsAt).toEqual(at(40));
    expect(timerPhase(plank, at(15))).toEqual({ kind: 'single', remaining: 25 });
  });

  it('testAHoldDosedEachSideStoppedEarlyLogsTheMeanOfTheSides', () => {
    let state = startTimer(fresh(perSideHoldJSON), 0, 0, t0);
    state = ticked(state, 0, 0, at(10));
    expect(state.exercises[0].sets[0].value).toBe(5);

    state = startTimer(skipRest(state), 0, 1, t0);
    // Side 1 (20 s) and 10 s of side 2, after the 5 s changeover.
    state = ticked(state, 0, 1, at(35));
    expect(state.exercises[0].sets[1].value).toBe(15);

    // Stopped during the changeover: side 1 only.
    const again = ticked(startTimer(fresh(perSideHoldJSON), 0, 0, t0), 0, 0, at(22));
    expect(again.exercises[0].sets[0].value).toBe(10);
  });

  it('testATimedAlternativeDosedEachSideKeepsItThroughTheSwap', () => {
    const blocks = `[ { "blockNo": 1, "exerciseId": "forearm-plank", "name": "Forearm plank", "pattern": "core",
        "patternLabel": "Core", "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
        "sets": 2, "reps": null, "perSide": false, "seconds": 30, "minutes": null, "meters": null,
        "restSec": 45, "loadHint": "bodyweight", "cues": [],
        "alternatives": [
          { "exerciseId": "side-plank", "name": "Side plank", "equipment": "bodyweight",
            "equipmentLabel": "Bodyweight", "level": "harder",
            "unit": "seconds", "reps": null, "seconds": 30, "meters": null, "perSide": true } ] } ]`;
    let state = fresh(blocks);
    const alternative = state.exercises[0].alternatives[0];
    expect(doseOfAlternative(state.exercises[0], alternative)).toEqual({ unit: 'seconds', target: 30, perSide: true });
    const swapped = swap(state, 0, 'side-plank');
    expect(swapped.swapped).toBe(true);
    state = swapped.state;
    expect(state.exercises[0].perSide).toBe(true);
    state = startNextTimer(state, t0);
    expect(state.timer?.sideSeconds).toBe(30);
    expect(state.timer?.endsAt).toEqual(at(65));
  });

  it('the changeover starts after side 1', () => {
    const state = startNextTimer(fresh(perSideHoldJSON), t0);
    expect(switchStartsAt(state.timer!)).toEqual(at(20));
  });
});

describe('the stopwatch and the steppers', () => {
  it('testTheStopwatchLogsWhatItMeasured', () => {
    let state = fresh();
    expect(stopwatchRunning(state)).toBe(false);
    state = toggleStopwatch(state, 3, t0);
    expect(stopwatchRunning(state)).toBe(true);
    state = ticked(state, 3, 0, at(1_500));
    expect(state.exercises[3].sets[0].value).toBe(1_500);
    expect(performed(state)[3].minutes).toBe(25);
    expect(performed(state)[3].sets[0].seconds).toBe(1_500);
    expect(stopwatchRunning(state)).toBe(false);
  });

  it('a stopwatch stopped by hand under a minute keeps the planned time', () => {
    let state = toggleStopwatch(fresh(), 3, t0);
    state = toggleStopwatch(state, 3, at(40));
    expect(state.exercises[3].sets[0].value).toBe(1200);
    expect(stopwatchRunning(state)).toBe(false);
    state = toggleStopwatch(toggleStopwatch(state, 3, t0), 3, at(600));
    expect(state.exercises[3].sets[0].value).toBe(600);
  });

  it('testStepsAreClampedToTheWire', () => {
    let state = fresh();
    for (let i = 0; i < 200; i += 1) state = stepValue(state, 0, 0, 1);
    expect(state.exercises[0].sets[0].value).toBe(100);
    for (let i = 0; i < 200; i += 1) state = stepValue(state, 0, 0, -1);
    expect(state.exercises[0].sets[0].value).toBe(0);
    state = stepKg(state, 0, 0, 1);
    expect(state.exercises[0].sets[0].kg).toBe(15);
    state = setKg(state, 0, 0, 22.46);
    expect(state.exercises[0].sets[0].kg).toBe(22.5);
    state = setKg(state, 0, 0, 9_999);
    expect(state.exercises[0].sets[0].kg).toBe(500);
    state = setKg(state, 0, 1, null);
    expect(state.exercises[0].sets[1].kg).toBeNull();
    state = stepValue(state, 4, 0, 1);
    expect(state.exercises[4].sets[0].value).toBe(125);
  });

  it('minus from 2.5 kg clears the field; plus from empty starts at 2.5', () => {
    let state = setKg(fresh(), 0, 0, 2.5);
    state = stepKg(state, 0, 0, -1);
    expect(state.exercises[0].sets[0].kg).toBeNull();
    state = stepKg(state, 0, 0, 1);
    expect(state.exercises[0].sets[0].kg).toBe(2.5);
    expect(setKg(state, 0, 0, Number.NaN).exercises[0].sets[0].kg).toBeNull();
  });

  it('a typed value is clamped, never refused; minutes are typed as minutes', () => {
    expect(setValue(fresh(), 0, 0, 250).exercises[0].sets[0].value).toBe(100);
    expect(setValue(fresh(), 0, 0, -3).exercises[0].sets[0].value).toBe(0);
    expect(setValue(fresh(), 3, 0, 25).exercises[3].sets[0].value).toBe(1500);
    expect(setValue(fresh(), 3, 0, 90).exercises[3].sets[0].value).toBe(3600);
  });

  it('a set that does not exist changes nothing', () => {
    const state = fresh();
    expect(tick(state, 9, 0, t0)).toEqual({ state, outcome: null });
    expect(tick(state, 0, 9, t0)).toEqual({ state, outcome: null });
    expect(untick(state, -1, 0)).toBe(state);
    expect(stepValue(state, 0, 7, 1)).toBe(state);
  });
});

describe('skip', () => {
  it('testSkippingAnUntouchedExerciseMovesOnAndUndoPutsItBack', () => {
    const { state, undo } = skipCurrentExercise(fresh());
    expect(state.index).toBe(1);
    expect(state.exercises[0].skipped).toBe(true);
    expect(performed(state)[0].skipped).toBe(true);
    const back = undoSkip(state, undo!);
    expect(back.index).toBe(0);
    expect(back.exercises[0].skipped).toBe(false);
  });

  it('testSkippingKeepsTheSetsAlreadyDone (V7)', () => {
    let state = skipRest(completed(fresh(), t0));
    state = skipRest(completed(state, t0));
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 3 });
    const skipped = skipCurrentExercise(state);
    state = skipped.state;
    const undo = skipped.undo!;
    expect(state.index).toBe(1);
    expect(state.exercises[0].skipped).toBe(false);
    expect(state.exercises[0].endedEarly).toBe(true);
    expect(state.exercises[0].sets.map((set) => set.done)).toEqual([true, true, false]);

    const first = performed(state)[0];
    expect(first.skipped).toBe(false);
    expect(first.sets[0]).toEqual({ reps: 10, kg: 12.5, done: true });
    expect(first.sets[2].done).toBe(false);

    expect(summary(state)).toEqual({ exercises: 1, total: 5, sets: 2 });
    expect(RunnerFormat.summary(summary(state), 'en')).toBe('1 of 5 exercises · 2 sets');

    // Undo puts the open set back.
    state = undoSkip(state, undo);
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 3 });

    // Ticking the skipped set later reopens the exercise.
    state = ticked(skipCurrentExercise(state).state, 0, 2, t0);
    expect(state.exercises[0].endedEarly).toBe(false);
    expect(state.exercises[0].sets.filter((set) => set.done)).toHaveLength(3);
  });

  it('skipping the last exercise stays on it, and Finish is next', () => {
    let state = advance(advance(advance(advance(fresh()))));
    state = skipCurrentExercise(state).state;
    expect(state.index).toBe(4);
    expect(primaryAction(state)).toEqual({ kind: 'finish' });
  });
});

describe('swap', () => {
  it('testSwapIsLimitedToThePrecomputedAlternatives', () => {
    let state = fresh();
    expect(swap(state, 0, 'deadlift').swapped).toBe(false);
    expect(state.exercises[0].exerciseId).toBe('goblet_squat');

    const toBox = swap(state, 0, 'box_squat');
    expect(toBox.swapped).toBe(true);
    state = toBox.state;
    expect(state.exercises[0].name).toBe('Box squat');
    expect(state.exercises[0].sets).toHaveLength(3);
    expect(state.exercises[0].restSec).toBe(90);
    expect(tracksLoad(state.exercises[0])).toBe(false);
    expect(cuesOf(state.exercises[0])).toEqual([]);
    expect(performed(state)[0].exerciseId).toBe('box_squat');
    expect(performed(state)[0].swappedFrom).toBe('goblet_squat');

    const options = swapOptions(state, 0);
    expect(options.map((o) => o.exerciseId)).toEqual(['goblet_squat', 'leg_press']);
    expect(options.map((o) => o.level)).toEqual(['harder', 'harder']);
    expect(options[0].isPlanned).toBe(true);

    const back = swap(state, 0, 'goblet_squat');
    expect(back.swapped).toBe(true);
    expect(performed(back.state)[0].swappedFrom).toBeUndefined();
    expect(back.state.exercises[0].sets[0].kg).toBe(12.5);
  });

  it('testAnAlternativeWithNoUnitIsNeverOffered', () => {
    const state = fresh();
    expect(swapOptions(state, 0).some((o) => o.exerciseId === 'wall_sit')).toBe(false);
    expect(swap(state, 0, 'wall_sit').swapped).toBe(false);
  });

  it('testSwapNeverOffersAnotherBlocksExercise', () => {
    const state = fresh();
    expect(swapOptions(state, 0).some((o) => o.exerciseId === 'plank')).toBe(false);
    expect(swap(state, 0, 'plank').swapped).toBe(false);
    const other = fresh(`[ { "blockNo": 1, "exerciseId": "a", "name": "A", "sets": 2, "reps": 5,
        "alternatives": [ { "exerciseId": "x", "name": "X", "level": "same", "unit": "reps", "reps": 5 } ] },
      { "blockNo": 2, "exerciseId": "b", "name": "B", "sets": 2, "reps": 5,
        "alternatives": [ { "exerciseId": "x", "name": "X", "level": "same", "unit": "reps", "reps": 5 } ] } ]`);
    const swapped = swap(other, 0, 'x');
    expect(swapped.swapped).toBe(true);
    expect(swapOptions(swapped.state, 1)).toEqual([]);
  });

  it('testASwapTakesTheAlternativesUnitAndGivesItBack (V1, V3b)', () => {
    let state = advance(advance(fresh()));
    const deadBug = swapOptions(state, 2).find((o) => o.exerciseId === 'dead_bug')!;
    expect(deadBug.unit).toBe('reps');
    expect(deadBug.target).toBe(10);
    state = swap(state, 2, 'dead_bug').state;
    expect(state.exercises[2].unit).toBe('reps');
    expect(state.exercises[2].target).toBe(10);
    expect(state.exercises[2].perSide).toBe(true);
    expect(state.exercises[2].sets.map((s) => s.value)).toEqual([10, 10]);
    expect(primaryAction(state)).toEqual({ kind: 'completeSet', number: 1 });
    state = completed(state, t0);
    expect(performed(state)[2].sets[0]).toEqual({ reps: 10, done: true });
    expect(RunnerFormat.planLine(deadBug.unit, deadBug.target, 2, deadBug.perSide, tEn)).toBe('2 × 10 each side');

    // A set is logged in reps now: the way back is not offered.
    expect(swapOptions(state, 2)).toEqual([]);
    expect(swap(state, 2, 'plank').swapped).toBe(false);
    state = skipRest(untick(state, 2, 0));

    // Nothing logged: back to the plank, in seconds.
    const back = swapOptions(state, 2)[0];
    expect(back.isPlanned).toBe(true);
    expect(back.unit).toBe('seconds');
    state = swap(state, 2, 'plank').state;
    expect(state.exercises[2].unit).toBe('seconds');
    expect(state.exercises[2].target).toBe(40);
    expect(state.exercises[2].perSide).toBe(false);
    expect(state.exercises[2].sets.map((s) => s.value)).toEqual([40, 40]);
    expect(cuesOf(state.exercises[2])).toEqual(['ribs down']);

    // A pool block swapped to pool walking counts time, not metres.
    state = swap(state, 4, 'pool_walking').state;
    expect(state.exercises[4].unit).toBe('seconds');
    expect(state.exercises[4].sets.map((s) => s.value)).toEqual([120, 120, 120, 120]);
    state = ticked(state, 4, 0, t0);
    expect(performed(state)[4].sets[0]).toEqual({ seconds: 120, done: true });
  });

  it('testASameUnitAlternativeWithNoNumberTakesThePlannedDose', () => {
    const state = fresh(`[ { "blockNo": 1, "exerciseId": "a", "name": "A", "sets": 3, "reps": 12,
        "alternatives": [ { "exerciseId": "b", "name": "B", "level": "same", "unit": "reps" },
                          { "exerciseId": "c", "name": "C", "level": "same", "unit": "seconds" } ] } ]`);
    expect(swapOptions(state, 0).map((o) => o.exerciseId)).toEqual(['b']);
    const swapped = swap(state, 0, 'b');
    expect(swapped.swapped).toBe(true);
    expect(swapped.state.exercises[0].target).toBe(12);
  });

  it('a swap stops the countdown of its block', () => {
    let state = advance(advance(fresh()));
    state = startNextTimer(state, t0);
    expect(state.timer).not.toBeNull();
    expect(swap(state, 2, 'dead_bug').state.timer).toBeNull();
  });
});

describe('what Save sends', () => {
  it('testPerformedSpeaksTheWire', () => {
    let state = ticked(fresh(), 0, 0, t0);
    state = ticked(state, 1, 0, t0);
    state = ticked(state, 2, 0, t0);
    state = ticked(state, 4, 0, t0);
    const sets = performed(state);
    expect(sets[0].sets[0]).toEqual({ reps: 10, kg: 12.5, done: true });
    expect(sets[0].sets[1].done).toBe(false);
    expect(sets[1].sets[0]).toEqual({ reps: 8, done: true });
    expect(sets[2].sets[0]).toEqual({ seconds: 40, done: true });
    expect(sets[4].sets[0]).toEqual({ meters: 100, done: true });
    expect(sets[3].minutes).toBeUndefined();

    const body = workoutDoneBody({ minutes: 35, feeling: null, performed: sets, clientCompletedAt: t0, asExtra: null });
    const json = encodeBody(body);
    expect(json).not.toContain('null');
    expect(json).not.toContain('"feeling"');
    expect(json).not.toContain('"asExtra"');
    expect(json).toContain('"action":"done"');
    expect(json).toContain('"clientCompletedAt":"2027-01-15T08:00:00Z"');
  });

  it('testTheWireCeilingsHold', () => {
    const many = Array.from(
      { length: 25 },
      (_, index) => `{ "blockNo": ${index + 1}, "exerciseId": "x${index}", "name": "X", "sets": 20, "reps": 5 }`,
    ).join(',');
    const state = fresh(`[${many}]`);
    expect(state.exercises[0].sets).toHaveLength(12);
    expect(performed(state)).toHaveLength(20);
  });

  it('the Save key: minted once when the sheet opens, kept on every reopening; replaced only on purpose', () => {
    let minted = 0;
    const mint = (): string => {
      minted += 1;
      return `key-${minted}`;
    };
    const opened = ensureFinishKey(fresh(), mint);
    expect(opened.finishKey).toBe('key-1');
    // Reopened after a Save that timed out (the server may have it): the
    // same key, so a retry is counted once.
    const reopened = ensureFinishKey(opened, mint);
    expect(reopened).toBe(opened);
    expect(minted).toBe(1);
    // And after a relaunch, through runner.json.
    const relaunched = ensureFinishKey(decodeRunnerState(JSON.parse(encodeRunnerState(reopened))), mint);
    expect(relaunched.finishKey).toBe('key-1');
    expect(minted).toBe(1);
    // "Save as extra" and the reused-key retry mint a new one deliberately.
    expect(withFinishKey(relaunched, 'key-extra').finishKey).toBe('key-extra');
  });

  it('the runner body: the moment of the first attempt, a feeling only when given, no empty performed', () => {
    let state = withCompletedAt(ticked(fresh(), 0, 0, t0), at(600));
    state = withCompletedAt(state, at(900));
    const body = runnerDoneBody(state, { minutes: 35, feeling: 'ok', asExtra: false });
    expect(body.clientCompletedAt).toEqual(at(600));
    expect(body.feeling).toBe('ok');
    expect(body.asExtra).toBeUndefined();
    expect(body.performed).toHaveLength(5);

    const empty = startRunnerState({ session: session({ blocks: '[]' }), origin: 'today', now: t0, today: '2026-09-16' });
    const extra = runnerDoneBody(empty, { minutes: 20, feeling: 'unknown', asExtra: true });
    expect(extra).toEqual({ action: 'done', minutes: 20, asExtra: true });
  });

  it('the summary is counted in both languages', () => {
    expect(RunnerFormat.summary({ exercises: 1, total: 4, sets: 1 }, 'en')).toBe('1 of 4 exercises · 1 set');
    expect(RunnerFormat.summary({ exercises: 2, total: 4, sets: 5 }, 'is')).toBe('2 af 4 æfingum · 5 sett');
    expect(tIs('runner.err.not_saved')).not.toBe('runner.err.not_saved');
  });
});

describe('the active clock (V8b)', () => {
  it('testMinutesAreRoundedToFiveWithinFiveAndTheCap', () => {
    const state = fresh();
    expect(suggestedMinutes(state, t0)).toBe(5);
    expect(suggestedMinutes(state, at(37 * 60))).toBe(35);
    expect(suggestedMinutes(state, at(38 * 60))).toBe(40);
    expect(suggestedMinutes(state, at(9 * 3600))).toBe(80);
    const long = startRunnerState({ session: session({ minutes: 150 }), origin: 'today', now: t0, today: '2026-09-16' });
    expect(suggestedMinutes(long, at(9 * 3600))).toBe(180);
  });

  it('testAResumedWorkoutDoesNotClaimTheTimeAway', () => {
    const state = pauseClock(fresh(), at(20 * 60), false);
    expect(activeSeconds(state, at(4 * 3600))).toBe(20 * 60);
    // Through runner.json, as iOS's JSONEncoder/JSONDecoder round trip: a
    // "Finish later" pause (no `clockAwaySince`) read back after a relaunch
    // still credits no time away.
    const back = at(4 * 3600);
    const restored = recoverClock(decodeRunnerState(JSON.parse(encodeRunnerState(state))), back);
    expect(activeSeconds(restored, back)).toBe(20 * 60);
    expect(activeSeconds(restored, at(4 * 3600 + 10 * 60))).toBe(30 * 60);
    expect(suggestedMinutes(restored, at(4 * 3600 + 10 * 60))).toBe(30);
  });

  it('testTimeAwayCountsUpToTheLimit', () => {
    let state = pauseClock(fresh(), at(5 * 60), true);
    state = resumeClock(state, at(8 * 60));
    expect(activeSeconds(state, at(8 * 60))).toBe(8 * 60);

    state = pauseClock(state, at(10 * 60), true);
    state = pauseClock(state, at(10 * 60 + 5), true);
    state = resumeClock(state, at(3 * 3600));
    expect(activeSeconds(state, at(3 * 3600))).toBe(20 * 60);

    // With a stopwatch running, up to an hour counts.
    state = toggleStopwatch(state, 3, at(3 * 3600));
    state = pauseClock(state, at(3 * 3600), true);
    state = resumeClock(state, at(3 * 3600 + 25 * 60));
    expect(activeSeconds(state, at(3 * 3600 + 25 * 60))).toBe(45 * 60);
  });

  it('testAClockThatDiedRunningCountsToItsLastWrite', () => {
    const state = { ...fresh(), lastSeenAt: at(15 * 60) };
    const recovered = recoverClock(state, at(5 * 3600));
    expect(activeSeconds(recovered, at(5 * 3600))).toBe(25 * 60);
  });

  it('resuming a running clock changes nothing; "later" credits nothing', () => {
    const running = fresh();
    expect(resumeClock(running, at(60))).toBe(running);
    let later = pauseClock(running, at(60), false);
    expect(later.clockAwaySince).toBeNull();
    later = resumeClock(later, at(3600));
    expect(activeSeconds(later, at(3600))).toBe(60);
  });
});

describe('the file and opening a runner', () => {
  it('testTheFileExpiresTheDayAfterItsSession', () => {
    const today = startRunnerState({ session: session(), origin: 'today', now: t0, today: '2026-09-16' });
    expect(today.keepUntilDay).toBe('2026-09-17');
    expect(isExpired(today, '2026-09-17')).toBe(false);
    expect(isExpired(today, '2026-09-18')).toBe(true);
    const missed = startRunnerState({
      session: session({ scheduledFor: '2026-09-14' }),
      origin: 'missed',
      now: t0,
      today: '2026-09-16',
    });
    expect(missed.keepUntilDay).toBe('2026-09-17');
  });

  it('a runner never stores "resume" as its origin', () => {
    expect(startRunnerState({ session: session(), origin: 'resume', now: t0, today: '2026-09-16' }).origin).toBe('today');
  });

  it('opens the saved runner for its own session with the clock recovered, else a fresh one', () => {
    const saved = pauseClock(completed(fresh(), t0), at(600), true);
    const resumed = openRunnerState({ session: session(), restored: saved, entry: 'today', now: at(700), today: '2026-09-16' });
    expect(resumed.entry).toBe('resume');
    expect(resumed.state.exercises[0].sets[0].done).toBe(true);
    expect(activeSeconds(resumed.state, at(700))).toBe(700);

    const other = openRunnerState({
      session: session({ id: 'sess-2' }),
      restored: saved,
      entry: 'missed',
      now: at(700),
      today: '2026-09-16',
    });
    expect(other.entry).toBe('missed');
    expect(other.state.sessionId).toBe('sess-2');
    expect(other.state.exercises[0].sets[0].done).toBe(false);
  });
});
