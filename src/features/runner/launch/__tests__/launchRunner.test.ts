/**
 * Opening the runner: the port of iOS testALoggedWorkoutIsNeverSilentlyReplaced
 * (PlanSectionTests V6), the entry rule of PlanView's `launchRunner`, and the
 * doors of `presentRunner` and `resumeSavedRunner` carried out against the
 * real runner file and workout outbox (an in-memory disk), with the
 * navigator and the dialog host standing in.
 */
import { fileSystemState } from '@test/mocks/expoFileSystem';

import { showDialog, type DialogOptions } from '../../../../components/ui/Dialog';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage } from '../../../../i18n';
import { addServerDays, todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { openRootModal, rootRouteName } from '../../../../navigation/navigationRef';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { openRunner } from '../../index';
import { fresh, session, t0 } from '../../model/__tests__/fixtures';
import { workoutDoneBody } from '../../model/performed';
import { completeNextSet, startRunnerState } from '../../model/state';
import type { RunnerState } from '../../model/types';
import { enqueueWorkout, resetWorkoutOutboxForTests } from '../../outbox/workoutOutbox';
import { raiseRunnerWipeFence } from '../../persistence/fence';
import { RunnerProgressIndex, useRunnerProgress } from '../../persistence/progressIndex';
import { loadRunner, saveRunner } from '../../persistence/runnerStore';
import { notifyRunnerWiped } from '../../persistence/wiped';
import { findRunnerSession, resetRunnerSessionHandoffForTests } from '../../screen/sessionSource';
import { decideRunnerLaunch, RunnerLaunchDecisions, runnerEntryFor } from '../decision';
import { launchRunner, resetRunnerLaunchForTests } from '../launchRunner';

jest.mock('../../../../navigation/navigationRef', () => ({
  ...jest.requireActual('../../../../navigation/navigationRef'),
  openRootModal: jest.fn(() => true),
  rootRouteName: jest.fn(() => 'Tabs'),
}));

jest.mock('../../../../components/ui/Dialog', () => ({
  ...jest.requireActual('../../../../components/ui/Dialog'),
  showDialog: jest.fn(),
}));

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const TODAY = todayServerDay();
const YESTERDAY = addServerDays(TODAY, -1)!;

const opened = jest.mocked(openRootModal);
const dialogs = jest.mocked(showDialog);
let events: { event: string; params: AnalyticsParams }[] = [];

/** Today's session (or another date's), as Plan's rows hand it over. */
function row(options: { id?: string; scheduledFor?: string; status?: string } = {}) {
  const base = session({ id: options.id ?? 'sess-1', scheduledFor: options.scheduledFor ?? TODAY });
  return options.status ? { ...base, status: options.status as typeof base.status } : base;
}

/** A runner file for `id`, started today (with a set done when `logged`). */
function file(id: string, options: { logged?: boolean; scheduledFor?: string } = {}): RunnerState {
  const state = startRunnerState({
    session: row({ id, scheduledFor: options.scheduledFor }),
    origin: 'today',
    now: new Date(),
    today: TODAY,
  });
  return options.logged ? completeNextSet(state, new Date()).state : state;
}

/** The last dialog shown, and a press on one of its buttons by test id. */
function lastDialog(): DialogOptions {
  const call = dialogs.mock.calls.at(-1);
  if (!call) throw new Error('no dialog shown');
  return call[0];
}

function press(testID: string): void {
  const button = lastDialog().buttons.find((candidate) => candidate.testID === testID);
  if (!button) throw new Error(`no ${testID}`);
  button.onPress?.();
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await localStore.settled();
}

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetWorkoutOutboxForTests();
  resetRunnerLaunchForTests();
  resetRunnerSessionHandoffForTests();
  RunnerProgressIndex.reset();
  setCurrentLanguage('en');
  useAppStore.setState({ userId: MEMBER });
  opened.mockClear();
  opened.mockReturnValue(true);
  jest.mocked(rootRouteName).mockReturnValue('Tabs');
  dialogs.mockClear();
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  await localStore.settled();
});

// ---------------------------------------------------------------------------
// The pure rule

describe('RunnerLaunchDecision', () => {
  it('testALoggedWorkoutIsNeverSilentlyReplaced (V6)', () => {
    let yesterday = startRunnerState({
      session: session({ scheduledFor: '2026-09-15', id: 's-miss' }),
      origin: 'missed',
      now: t0,
      today: '2026-09-16',
    });
    expect(decideRunnerLaunch(null, 'sess-1', '2026-09-16')).toEqual({ kind: 'open', restore: false });
    expect(decideRunnerLaunch(yesterday, 's-miss', '2026-09-16')).toEqual({ kind: 'open', restore: true });
    // Nothing logged yet: nothing to lose.
    expect(decideRunnerLaunch(yesterday, 'sess-1', '2026-09-16')).toEqual({ kind: 'replaceOther' });
    yesterday = completeNextSet(yesterday, t0).state;
    expect(decideRunnerLaunch(yesterday, 'sess-1', '2026-09-16')).toEqual({ kind: 'askAboutOther', saved: yesterday });
    // An expired file is gone anyway.
    expect(decideRunnerLaunch(yesterday, 'sess-1', '2026-09-18')).toEqual({ kind: 'open', restore: false });
  });

  it('the entry: resume when restored, missed for a missed row or an earlier date, else today', () => {
    const today = '2026-09-16';
    expect(runnerEntryFor({ status: 'planned', scheduledFor: today }, { restored: true, today })).toBe('resume');
    expect(runnerEntryFor({ status: 'planned', scheduledFor: today }, { restored: false, today })).toBe('today');
    expect(runnerEntryFor({ status: null, scheduledFor: today }, { restored: false, today })).toBe('today');
    expect(runnerEntryFor({ status: 'missed', scheduledFor: today }, { restored: false, today })).toBe('missed');
    expect(runnerEntryFor({ status: 'planned', scheduledFor: '2026-09-14' }, { restored: false, today })).toBe('missed');
    expect(RunnerLaunchDecisions.decide).toBe(decideRunnerLaunch);
  });

  it('a "Do it now" file is kept until the day after TODAY, not the day after its session', () => {
    const missed = startRunnerState({
      session: session({ scheduledFor: '2026-09-14' }),
      origin: runnerEntryFor({ status: 'missed', scheduledFor: '2026-09-14' }, { restored: false, today: '2026-09-16' }),
      now: t0,
      today: '2026-09-16',
    });
    expect(missed.keepUntilDay).toBe('2026-09-17');
    expect(fresh().keepUntilDay).toBe('2026-09-17');
  });
});

// ---------------------------------------------------------------------------
// The doors

describe('presentRunner', () => {
  it('nothing in the way: the runner opens on the row the member tapped, entry today', async () => {
    const today = row();
    await expect(launchRunner(today, 'today')).resolves.toBe('opened');
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-1', entry: 'today' });
    // The screen finds exactly that row.
    expect(findRunnerSession('sess-1', null)).toBe(today);
  });

  it('openRunner is the contract that does it', async () => {
    openRunner(row(), 'today');
    await settle();
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-1', entry: 'today' });
  });

  it('"Do it now" on yesterday\'s row opens as missed, whatever the caller said', async () => {
    await launchRunner(row({ scheduledFor: YESTERDAY }), 'today');
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-1', entry: 'missed' });
    opened.mockClear();
    await launchRunner(row({ id: 'sess-2', status: 'missed' }), 'today');
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-2', entry: 'missed' });
  });

  it('saved on this phone and waiting to sync: the toast, and nothing opens', async () => {
    await enqueueWorkout({
      sessionId: 'sess-1',
      body: workoutDoneBody({ minutes: 30, clientCompletedAt: t0 }),
      key: 'k-1',
      profileId: MEMBER,
    });
    await expect(launchRunner(row(), 'today')).resolves.toBe('pending');
    expect(opened).not.toHaveBeenCalled();
    expect(useHealthStore.getState().toastKey).toBe('health.saved_offline');
  });

  it('the queue is read from disk first when this member\'s is not loaded yet', async () => {
    await enqueueWorkout({
      sessionId: 'sess-1',
      body: workoutDoneBody({ minutes: 30, clientCompletedAt: t0 }),
      key: 'k-1',
      profileId: MEMBER,
    });
    resetWorkoutOutboxForTests();
    await expect(launchRunner(row(), 'today')).resolves.toBe('pending');
  });

  it('this session\'s workout in progress is restored (entry resume)', async () => {
    await saveRunner(file('sess-1', { logged: true }), MEMBER);
    await expect(launchRunner(row(), 'today')).resolves.toBe('opened');
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-1', entry: 'resume' });
  });

  it('another session\'s file with nothing logged is replaced without asking', async () => {
    await saveRunner(file('sess-0'), MEMBER);
    await expect(launchRunner(row(), 'today')).resolves.toBe('opened');
    expect(dialogs).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-1', entry: 'today' });
  });

  it('another session\'s workout with a set logged: the member is asked, in their words', async () => {
    await saveRunner(file('sess-0', { logged: true, scheduledFor: YESTERDAY }), MEMBER);
    await expect(launchRunner(row(), 'today')).resolves.toBe('asked');
    expect(opened).not.toHaveBeenCalled();
    const dialog = lastDialog();
    expect(dialog.title).toBe('Another workout is in progress');
    expect(dialog.message).toMatch(/^You haven't finished Full body strength \(.+\)\. Resume that workout, or discard it and start this one\?$/);
    expect(dialog.buttons.map((button) => [button.label, button.role ?? 'default'])).toEqual([
      ['Resume that workout', 'default'],
      ['Discard it and start this one', 'destructive'],
      ['Cancel', 'cancel'],
    ]);
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    await saveRunner(file('sess-0', { logged: true }), MEMBER);
    await launchRunner(row(), 'today');
    expect(lastDialog().title).toBe('Önnur æfing er í gangi');
    expect(lastDialog().buttons.map((button) => button.label)).toEqual([
      'Halda áfram með þá æfingu',
      'Henda henni og byrja á þessari',
      'Hætta við',
    ]);
  });

  it('"Resume that workout" opens the workout in progress, from the file', async () => {
    const other = file('sess-0', { logged: true });
    await saveRunner(other, MEMBER);
    await launchRunner(row(), 'today');
    press('runner.conflict.resume');
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-0', entry: 'resume' });
    expect(await loadRunner(MEMBER)).toEqual(other);
  });

  it('"Discard it and start this one" deletes the other workout, counts the discard, and opens this one', async () => {
    await saveRunner(file('sess-0', { logged: true }), MEMBER);
    await launchRunner(row(), 'today');
    press('runner.conflict.discard');
    await settle();
    expect(await loadRunner(MEMBER)).toBeNull();
    expect(events).toContainEqual({ event: 'workout_left', params: { choice: 'discard' } });
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-1', entry: 'today' });
    expect(useRunnerProgress.getState().summary).toBeNull();
  });

  it('Cancel keeps both, and the next tap asks again', async () => {
    await saveRunner(file('sess-0', { logged: true }), MEMBER);
    await launchRunner(row(), 'today');
    press('runner.conflict.cancel');
    expect(opened).not.toHaveBeenCalled();
    expect((await loadRunner(MEMBER))?.sessionId).toBe('sess-0');
    await expect(launchRunner(row(), 'today')).resolves.toBe('asked');
  });

  it('while the question is up, another request waits for the answer', async () => {
    await saveRunner(file('sess-0', { logged: true }), MEMBER);
    await launchRunner(row(), 'today');
    await expect(launchRunner(row({ id: 'sess-2' }), 'today')).resolves.toBe('busy');
    lastDialog().onDismiss?.();
    await expect(launchRunner(row({ id: 'sess-2' }), 'today')).resolves.toBe('asked');
  });

  it('an answer given after a sign-out wiped the workout does nothing', async () => {
    await saveRunner(file('sess-0', { logged: true }), MEMBER);
    await launchRunner(row(), 'today');
    raiseRunnerWipeFence();
    notifyRunnerWiped({ reason: 'signout', profileId: MEMBER });
    press('runner.conflict.discard');
    press('runner.conflict.resume');
    await settle();
    expect(opened).not.toHaveBeenCalled();
    // And the question no longer holds the door shut.
    await expect(launchRunner(row(), 'today')).resolves.not.toBe('busy');
  });

  it('an expired file of another session is no obstacle', async () => {
    const old = startRunnerState({
      session: row({ id: 'sess-0', scheduledFor: addServerDays(TODAY, -3)! }),
      origin: 'today',
      now: new Date(),
      today: addServerDays(TODAY, -3)!,
    });
    await saveRunner(completeNextSet(old, new Date()).state, MEMBER);
    await expect(launchRunner(row(), 'today')).resolves.toBe('opened');
    expect(dialogs).not.toHaveBeenCalled();
  });

  it('a runner already up, or a request still deciding, opens nothing more', async () => {
    jest.mocked(rootRouteName).mockReturnValue('WorkoutRunner');
    await expect(launchRunner(row(), 'today')).resolves.toBe('busy');
    jest.mocked(rootRouteName).mockReturnValue('Tabs');
    const first = launchRunner(row(), 'today');
    await expect(launchRunner(row(), 'today')).resolves.toBe('busy');
    await expect(first).resolves.toBe('opened');
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('no member signed in: nothing', async () => {
    useAppStore.setState({ userId: null, profile: null });
    await expect(launchRunner(row(), 'today')).resolves.toBe('nothing');
    expect(opened).not.toHaveBeenCalled();
  });
});

describe('resumeSavedRunner (only the id is known)', () => {
  it('resumes the file\'s workout', async () => {
    await saveRunner(file('sess-0', { logged: true, scheduledFor: YESTERDAY }), MEMBER);
    await expect(launchRunner({ id: 'sess-0' }, 'resume')).resolves.toBe('opened');
    expect(opened).toHaveBeenCalledWith('WorkoutRunner', { sessionId: 'sess-0', entry: 'resume' });
  });

  it('a file that has gone opens nothing, and the Resume row is read again', async () => {
    RunnerProgressIndex.note(file('sess-0', { logged: true }), MEMBER);
    expect(useRunnerProgress.getState().summary).not.toBeNull();
    fileSystemState.reset();
    await expect(launchRunner({ id: 'sess-0' }, 'resume')).resolves.toBe('nothing');
    expect(opened).not.toHaveBeenCalled();
    expect(useRunnerProgress.getState().summary).toBeNull();
  });
});
