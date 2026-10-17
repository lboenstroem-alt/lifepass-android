/**
 * `runner.json` through the health file store, Plan's Resume row, and the
 * cold-launch check: the port of iOS testTheRunnerFileRoundTrips and
 * testTheResumableWorkoutCheckReadsTheRunnerFile (VenueBrowseOrderTests),
 * plus the 30-second clock write and the expiry Plan's load applies.
 */
import { File } from 'expo-file-system';
import { fileSystemState } from '@test/mocks/expoFileSystem';

import { hasResumableWorkoutAtLaunch } from '../../../../app/launchTab';
import * as localStore from '../../../../health/localStore';
import { todayServerDay } from '../../../../i18n/format';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { resumableWorkout } from '../../index';
import { encodeRunnerState } from '../../model/codec';
import { advance, completeNextSet, pauseClock, startRunnerState } from '../../model/state';
import { RUNNER_STATE_VERSION } from '../../model/types';
import { at, fresh, session, t0 } from '../../model/__tests__/fixtures';
import {
  RunnerProgressIndex,
  selectRunnerProgressFor,
  selectRunnerProgressOtherThan,
  useRunnerProgress,
} from '../progressIndex';
import {
  clockWriteDue,
  deleteRunner,
  loadRunner,
  persistRunner,
  refreshRunnerProgress,
  resumableWorkoutFor,
  saveRunner,
} from '../runnerStore';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';
const FILE = `health/${MEMBER}/runner.json`;

beforeEach(() => {
  RunnerProgressIndex.reset();
  resetAppStoreForTests();
});

afterEach(async () => {
  await localStore.settled();
});

it('testTheRunnerFileRoundTrips: the protected file the app really writes', async () => {
  const state = completeNextSet(fresh(), t0).state;
  await expect(saveRunner(state, MEMBER)).resolves.toBe(true);
  expect(fileSystemState.files()).toEqual([`files/${FILE}`]);
  const read = await loadRunner(MEMBER);
  expect(read?.restEndsAt).toEqual(at(90));
  expect(read?.session.id).toBe('sess-1');
  expect(read?.version).toBe(RUNNER_STATE_VERSION);
  expect(read).toEqual(state);
});

it('one file per member: another member reads nothing', async () => {
  await saveRunner(fresh(), MEMBER);
  expect(await loadRunner(OTHER)).toBeNull();
});

it('a file of another version is ignored, and kept', async () => {
  fileSystemState.seed(FILE, encodeRunnerState({ ...fresh(), version: 1 }));
  expect(await loadRunner(MEMBER)).toBeNull();
  expect(fileSystemState.exists(FILE)).toBe(true);
});

it('a file that no longer decodes reads as none and is deleted', async () => {
  fileSystemState.seed(FILE, '{"version": 2, "sessionId": "sess-1"}');
  expect(await loadRunner(MEMBER)).toBeNull();
  expect(fileSystemState.exists(FILE)).toBe(false);
});

it('a save notes the workout for Plan, a delete removes the file and the row', async () => {
  const state = advance(fresh());
  void saveRunner(state, MEMBER);
  expect(useRunnerProgress.getState().summary).toEqual({
    sessionId: 'sess-1',
    exercise: 2,
    total: 5,
    title: 'Full body strength',
    scheduledFor: '2026-09-16',
  });
  expect(selectRunnerProgressFor('sess-1')(useRunnerProgress.getState())?.exercise).toBe(2);
  expect(selectRunnerProgressFor('sess-2')(useRunnerProgress.getState())).toBeNull();
  expect(selectRunnerProgressOtherThan('sess-2')(useRunnerProgress.getState())?.sessionId).toBe('sess-1');
  expect(selectRunnerProgressOtherThan('sess-1')(useRunnerProgress.getState())).toBeNull();

  await deleteRunner(MEMBER);
  expect(useRunnerProgress.getState().summary).toBeNull();
  expect(fileSystemState.files()).toEqual([]);
});

it('a session with no blocks reads as exercise 1 of 1', () => {
  const empty = startRunnerState({ session: session({ blocks: '[]' }), origin: 'today', now: t0, today: '2026-09-16' });
  RunnerProgressIndex.note(empty, MEMBER);
  expect(RunnerProgressIndex.summaryFor('sess-1')).toMatchObject({ exercise: 1, total: 1 });
});

describe("Plan's load reads the file into the Resume row", () => {
  it('a live file is noted', async () => {
    fileSystemState.seed(FILE, encodeRunnerState(advance(advance(fresh()))));
    await refreshRunnerProgress(MEMBER, '2026-09-16');
    expect(RunnerProgressIndex.summaryFor('sess-1')).toMatchObject({ exercise: 3, total: 5 });
  });

  it('a file past the day after its session is deleted (the day after is still kept)', async () => {
    fileSystemState.seed(FILE, encodeRunnerState(fresh()));
    await refreshRunnerProgress(MEMBER, '2026-09-17');
    expect(RunnerProgressIndex.summaryFor('sess-1')).not.toBeNull();
    await refreshRunnerProgress(MEMBER, '2026-09-18');
    await localStore.settled();
    expect(RunnerProgressIndex.summaryFor('sess-1')).toBeNull();
    expect(fileSystemState.exists(FILE)).toBe(false);
  });

  it('no file clears a row left by an earlier read', async () => {
    RunnerProgressIndex.note(fresh(), MEMBER);
    await refreshRunnerProgress(MEMBER, '2026-09-16');
    expect(useRunnerProgress.getState().summary).toBeNull();
  });
});

describe('the active clock on disk', () => {
  it('a running clock is stamped as seen at every save; a stopped one is not', () => {
    const running = persistRunner(fresh(), MEMBER, at(45));
    expect(running.lastSeenAt).toEqual(at(45));
    const paused = pauseClock(fresh(), at(10), false);
    expect(persistRunner(paused, MEMBER, at(45)).lastSeenAt).toEqual(at(10));
  });

  it('is written every 30 seconds while it runs, and not while it is stopped', () => {
    const state = fresh();
    expect(clockWriteDue(state, at(29))).toBe(false);
    expect(clockWriteDue(state, at(30))).toBe(true);
    expect(clockWriteDue(pauseClock(state, at(5), true), at(600))).toBe(false);
  });
});

describe('testTheResumableWorkoutCheckReadsTheRunnerFile (the cold-launch tab)', () => {
  const today = '2026-10-14';
  const todays = () =>
    startRunnerState({ session: session({ scheduledFor: today, blocks: '[]' }), origin: 'today', now: t0, today });

  it('nothing without a member, nothing without a file', async () => {
    expect(await hasResumableWorkoutAtLaunch(null)).toBe(false);
    expect(await resumableWorkout(undefined, today)).toBeNull();
    expect(await resumableWorkoutFor(MEMBER, today)).toBeNull();
  });

  it('a live file counts, under the upper-case id too; one past its day does not', async () => {
    await saveRunner(todays(), MEMBER);
    expect(await resumableWorkout(MEMBER, today)).toEqual({ sessionId: 'sess-1' });
    expect(await resumableWorkout(MEMBER.toUpperCase(), today)).toEqual({ sessionId: 'sess-1' });
    expect(await resumableWorkout(MEMBER, '2026-10-20')).toBeNull();
    // Nothing here deletes: Plan's load does.
    expect(fileSystemState.exists(FILE)).toBe(true);
  });

  it('defaults to the signed-in member', async () => {
    await saveRunner(todays(), MEMBER);
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: null });
    expect(await resumableWorkout(undefined, today)).toEqual({ sessionId: 'sess-1' });
  });

  it('a file that is there and cannot be read keeps the stored tab', async () => {
    await saveRunner(todays(), MEMBER);
    const text = jest.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('EIO'));
    expect(await resumableWorkout(MEMBER, today)).toEqual({ sessionId: null });
    text.mockRestore();
  });

  it('the launch rule reads it', async () => {
    expect(await hasResumableWorkoutAtLaunch(MEMBER)).toBe(false);
    await saveRunner(startRunnerState({ session: session({ blocks: '[]' }), origin: 'today', now: new Date(), today: '2099-01-01' }), MEMBER);
    // keepUntilDay is 2026-09-17 (the session's date plus one): long gone.
    expect(await hasResumableWorkoutAtLaunch(MEMBER)).toBe(false);
    const live = startRunnerState({
      session: session({ scheduledFor: todayServerDay(), blocks: '[]' }),
      origin: 'today',
      now: new Date(),
      today: todayServerDay(),
    });
    await saveRunner(live, MEMBER);
    expect(await hasResumableWorkoutAtLaunch(MEMBER)).toBe(true);
  });
});
