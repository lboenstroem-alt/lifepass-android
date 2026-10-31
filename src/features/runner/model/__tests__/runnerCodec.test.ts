/**
 * `runner.json` as text: the iOS cases for a rest that survives the app
 * being killed (testTheRestEndIsRestoredFromTheSavedState) and a timer
 * written before per-side holds (testATimerSavedWithoutSidesStillDecodes),
 * plus the strictness the file store relies on.
 */
import { HealthShapeError } from '../../../../health/decode';
import { decodeRunnerState, decodeRunnerTimer, encodeRunnerState } from '../codec';
import { completeNextSet, endRestIfDue, pauseClock, primaryAction, restRemaining, swap, toggleStopwatch, withFinishKey } from '../state';
import { startRunnerTimer, timerPhase } from '../timer';
import { RUNNER_STATE_VERSION, type RunnerState } from '../types';
import { at, fresh, t0 } from './fixtures';

function roundTrip(state: RunnerState): RunnerState {
  return decodeRunnerState(JSON.parse(encodeRunnerState(state)));
}

it('testTheRestEndIsRestoredFromTheSavedState: the rest survives the app being killed', () => {
  const state = withFinishKey(completeNextSet(fresh(), t0).state, 'key-1');
  const restored = roundTrip(state);
  expect(restored).toEqual(state);
  expect(restored.restEndsAt).toEqual(at(90));
  expect(restRemaining(restored, at(30))).toBe(60);
  expect(restored.finishKey).toBe('key-1');
  expect(endRestIfDue(restored, at(30)).ended).toBe(false);
  const over = endRestIfDue(restored, at(95));
  expect(over.ended).toBe(true);
  expect(primaryAction(over.state)).toEqual({ kind: 'completeSet', number: 2 });
});

it('a swapped, paused runner with a stopwatch reads back exactly, milliseconds included', () => {
  let state = swap(fresh(), 0, 'box_squat').state;
  state = toggleStopwatch(state, 3, new Date(t0.getTime() + 1234));
  state = pauseClock(state, new Date(t0.getTime() + 61_789), true);
  const restored = roundTrip(state);
  expect(restored).toEqual(state);
  expect(restored.clockSeconds).toBeCloseTo(61.789, 6);
  expect(restored.exercises[3].stopwatchStartedAt).toEqual(new Date(t0.getTime() + 1234));
});

it('the file leaves empty members out, as iOS encodes them', () => {
  const text = encodeRunnerState(fresh());
  const json = JSON.parse(text) as Record<string, unknown>;
  expect(json.version).toBe(RUNNER_STATE_VERSION);
  expect(json).not.toHaveProperty('restEndsAt');
  expect(json).not.toHaveProperty('timer');
  expect(json).not.toHaveProperty('finishKey');
  expect(text).not.toContain('null');
  expect(json.startedAt).toBe('2027-01-15T08:00:00.000Z');
});

it('testATimerSavedWithoutSidesStillDecodes', () => {
  const timer = decodeRunnerTimer(
    { exercise: 2, set: 0, startedAt: '2027-01-15T08:00:00Z', endsAt: '2027-01-15T08:00:40Z' },
    'timer',
  );
  expect(timer.sideSeconds).toBeNull();
  expect(timerPhase(timer, new Date(timer.startedAt.getTime() + 10_000))).toEqual({ kind: 'single', remaining: 30 });
  const perSide = startRunnerTimer({ exercise: 0, set: 1, seconds: 30, perSide: true, now: t0 });
  expect(decodeRunnerTimer(JSON.parse(JSON.stringify(perSide)), 'timer')).toEqual(perSide);
});

it('reads the whole-second instants iOS writes', () => {
  const json = JSON.parse(encodeRunnerState(fresh())) as Record<string, unknown>;
  json.startedAt = '2027-01-15T08:00:00Z';
  json.lastSeenAt = '2027-01-15T08:00:00Z';
  expect(decodeRunnerState(json).startedAt).toEqual(t0);
});

it('a file of another version still decodes, so the caller can ignore it', () => {
  const json = JSON.parse(encodeRunnerState(fresh())) as Record<string, unknown>;
  json.version = 3;
  expect(decodeRunnerState(json).version).toBe(3);
});

it('half a runner is no runner: a missing clock, an unknown unit or a wrong type throws', () => {
  const base = (): Record<string, unknown> => JSON.parse(encodeRunnerState(fresh())) as Record<string, unknown>;
  const noClock = base();
  delete noClock.clockSeconds;
  expect(() => decodeRunnerState(noClock)).toThrow(HealthShapeError);

  const badUnit = base();
  (badUnit.exercises as Record<string, unknown>[])[0].unit = 'laps';
  expect(() => decodeRunnerState(badUnit)).toThrow(HealthShapeError);

  const badOrigin = base();
  badOrigin.origin = 'later';
  expect(() => decodeRunnerState(badOrigin)).toThrow(HealthShapeError);

  const badIndex = base();
  badIndex.index = '1';
  expect(() => decodeRunnerState(badIndex)).toThrow(HealthShapeError);

  expect(() => decodeRunnerState([])).toThrow(HealthShapeError);
});
