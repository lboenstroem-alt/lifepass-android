/**
 * What Save sends, checked against the API contract (openapi.yaml,
 * `actOnSession`'s `done` branch: no nulls, no member the schema does not
 * name): a workout with ticked sets and load, a swap, a skip, a stopwatch
 * and a length count; the same body as an extra; and the leanest one.
 */
import { api, Reply } from '@test/server';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { liveWorkoutSessionPosting } from '../../outbox/posting';
import { asExtraBody, runnerDoneBody } from '../performed';
import { advance, setKg, skipCurrentExercise, swap, tick, toggleStopwatch, withCompletedAt } from '../state';
import type { RunnerState } from '../types';
import { at, fresh, t0 } from './fixtures';

stubApiClientPerTest();

const SESSION = '0d6f7a52-6c1e-4c38-9a51-6a3b7f1e2a01';
const PATH = `/health/sessions/${SESSION}`;

function answer(): Record<string, unknown> {
  return {
    session: { id: SESSION, scheduledFor: '2027-01-15', kind: 'strength', title: 'Full body strength', status: 'done' },
    changed: [],
    upcoming: [],
    replayed: false,
  };
}

/** A workout as members really leave one: some sets, a swap, a skip, a stopwatch, a pool count. */
function aRealWorkout(): RunnerState {
  let state = fresh();
  // Goblet squat: two of three sets, one with a typed load.
  state = tick(state, 0, 0, t0).state;
  state = setKg(state, 0, 1, 14);
  state = tick(state, 0, 1, at(120)).state;
  state = advance(state);
  // Reverse lunge: skipped untouched.
  state = skipCurrentExercise(state).state;
  // Plank swapped for dead bug (reps each side), one set done.
  state = swap(state, 2, 'dead_bug').state;
  state = tick(state, 2, 0, at(300)).state;
  // Rower: the stopwatch ran for 21 minutes.
  state = toggleStopwatch(state, 3, at(400));
  state = toggleStopwatch(state, 3, at(400 + 21 * 60));
  state = tick(state, 3, 0, at(400 + 21 * 60)).state;
  // Easy swim: 2 of 4 lengths.
  state = tick(state, 4, 0, at(2000)).state;
  state = tick(state, 4, 1, at(2100)).state;
  return withCompletedAt(state, at(2400));
}

beforeEach(() => {
  api.on('POST', '/health/sessions/:id', Reply.ok(answer()));
});

it('a real workout\'s body is one the server takes', async () => {
  const body = runnerDoneBody(aRealWorkout(), { minutes: 40, feeling: 'hard', asExtra: false });
  await liveWorkoutSessionPosting.done(SESSION, body, 'runner-key-0001');
  const sent = expectSentToMatchContract('POST', PATH);
  expect(sent.headers['idempotency-key']).toBe('runner-key-0001');
  const wire = sent.body as {
    performed: { exerciseId: string; swappedFrom?: string; skipped: boolean; minutes?: number; sets: object[] }[];
  };
  expect(wire.performed.map((exercise) => [exercise.exerciseId, exercise.swappedFrom ?? null, exercise.skipped])).toEqual([
    ['goblet_squat', null, false],
    ['reverse_lunge', null, true],
    ['dead_bug', 'plank', false],
    ['rower', null, false],
    ['easy_swim', null, false],
  ]);
  expect(wire.performed[0].sets.slice(0, 2)).toEqual([
    { reps: 10, kg: 12.5, done: true },
    { reps: 10, kg: 14, done: true },
  ]);
  expect(wire.performed[3].minutes).toBe(21);
  expect(wire.performed[4].sets[0]).toEqual({ meters: 100, done: true });
  expect(sent.rawBody).not.toContain('null');
});

it('the same body as an extra is one the server takes too', async () => {
  const body = asExtraBody(runnerDoneBody(aRealWorkout(), { minutes: 40, feeling: null, asExtra: false }));
  await liveWorkoutSessionPosting.done(SESSION, body, 'runner-key-0002');
  const sent = expectSentToMatchContract('POST', PATH);
  expect(sent.body).toMatchObject({ action: 'done', asExtra: true, clientCompletedAt: '2027-01-15T08:40:00Z' });
  expect(sent.body).not.toHaveProperty('feeling');
});

it('the leanest Save: minutes and the moment, nothing empty', async () => {
  const body = runnerDoneBody(withCompletedAt(fresh('[]'), t0), { minutes: 5, feeling: 'unknown', asExtra: false });
  await liveWorkoutSessionPosting.done(SESSION, body, 'runner-key-0003');
  const sent = expectSentToMatchContract('POST', PATH);
  expect(sent.body).toEqual({ action: 'done', minutes: 5, clientCompletedAt: '2027-01-15T08:00:00Z' });
});
