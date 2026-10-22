/**
 * The runner's stub server for development builds (iOS `-LPRunnerStub`):
 * each mode answers as iOS's `FixtureWorkoutSessionPosting` does, it is put
 * in only for a known mode, and the outbox flush goes through it too.
 */
import { AppState } from 'react-native';

import { ProblemError, TransportError } from '../../../../api/errors';
import * as localStore from '../../../../health/localStore';
import type { SessionView } from '../../../../health/models';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { session, t0 } from '../../model/__tests__/fixtures';
import { workoutDoneBody } from '../../model/performed';
import { startRunnerState } from '../../model/state';
import { workoutSessionPosting } from '../../outbox/posting';
import { saveRunner } from '../../persistence/runnerStore';
import { installRunnerDevStub, resetRunnerDevStubForTests, RunnerStubPosting, type RunnerStubMode } from '../devStub';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const known: SessionView = session();
const body = workoutDoneBody({ minutes: 35, feeling: 'ok', clientCompletedAt: t0 });

function stub(mode: RunnerStubMode, away = false): RunnerStubPosting {
  return new RunnerStubPosting(mode, {
    lookup: async (id) => (id === known.id ? known : null),
    hasBeenAway: () => away,
    delays: { done: 0, skip: 0 },
  });
}

function slugOf(error: unknown): string | null {
  return error instanceof ProblemError ? `${error.normalisedCode}/${error.details.reason}` : null;
}

afterEach(async () => {
  resetRunnerDevStubForTests();
  resetAppStoreForTests();
  await localStore.settled();
});

it('ok: the session saved, with the minutes and the feeling, undoable', async () => {
  const answer = await stub('ok').done('sess-1', body);
  expect(answer.session).toMatchObject({ id: 'sess-1', status: 'done', doneSource: 'member', doneMinutes: 35, feeling: 'ok', canUndo: true, undoAction: 'done' });
  expect(answer.replayed).toBe(false);
  const skipped = await stub('ok').skip('sess-1', 'tired');
  expect(skipped.session).toMatchObject({ status: 'skipped', skipReason: 'tired', undoAction: 'skip' });
});

it('offline: no call answers', async () => {
  await expect(stub('offline').done('sess-1', body)).rejects.toBeInstanceOf(TransportError);
  await expect(stub('offline').skip('sess-1', 'time')).rejects.toBeInstanceOf(TransportError);
});

it('offline then online: no answer until the app has been away', async () => {
  await expect(stub('offline-then-online', false).done('sess-1', body)).rejects.toBeInstanceOf(TransportError);
  await expect(stub('offline-then-online', true).done('sess-1', body)).resolves.toMatchObject({ session: { status: 'done' } });
});

it('changed: a Save is refused as moved, an extra goes through', async () => {
  const refused = await stub('changed').done('sess-1', body).catch((error: unknown) => error);
  expect(slugOf(refused)).toBe('session_action_not_allowed/not_planned');
  await expect(stub('changed').done('sess-1', { ...body, asExtra: true })).resolves.toMatchObject({ session: { status: 'done' } });
});

it('notactive: the plan is paused or has ended', async () => {
  const refused = await stub('notactive').done('sess-1', body).catch((error: unknown) => error);
  expect(slugOf(refused)).toBe('session_action_not_allowed/program_not_active');
});

it('a session it does not know fails as an unreadable answer would', async () => {
  await expect(stub('ok').done('nope', body)).rejects.toBeInstanceOf(TransportError);
});

it('is put in only for a known mode, once, and the live seam answers through it', async () => {
  const live = workoutSessionPosting();
  expect(installRunnerDevStub(null)).toBeNull();
  expect(installRunnerDevStub('bogus')).toBeNull();
  expect(workoutSessionPosting()).toBe(live);
  expect(installRunnerDevStub('offline-then-online')).toBe('offline-then-online');
  expect(installRunnerDevStub('ok')).toBeNull();
  const posting = workoutSessionPosting() as RunnerStubPosting;
  expect(posting.mode).toBe('offline-then-online');

  // The answer comes from the member's runner file.
  useAppStore.setState({ userId: MEMBER });
  await saveRunner(startRunnerState({ session: known, origin: 'today', now: t0, today: '2026-09-16' }), MEMBER);
  jest.useFakeTimers();
  try {
    const first = posting.done('sess-1', body);
    jest.advanceTimersByTime(400);
    await expect(first).rejects.toBeInstanceOf(TransportError);
    // The app goes to the background: from now on the stub answers.
    (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1]('background');
    const second = posting.done('sess-1', body);
    jest.advanceTimersByTime(400);
    jest.useRealTimers();
    await expect(second).resolves.toMatchObject({ session: { id: 'sess-1', status: 'done' } });
  } finally {
    jest.useRealTimers();
  }
});
