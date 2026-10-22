/**
 * A device-QA launch and the launch after it (iOS `RunnerFixtures.resets`,
 * `WorkoutRunnerSupport.activate`): a `runnerStub` launch starts with no
 * runner file and no queue (unless `runnerKeep`), and a Save the stub saw is
 * never sent to the server by a later development launch without the stub.
 * Every build talks to production, so the second half is the one that keeps
 * device QA from writing a fabricated workout there.
 */
import { ProblemError, TransportError } from '../../../../api/errors';
import { decodeProfile, type Profile } from '../../../../api/profile';
import type { ActivationHook } from '../../../../app/signOut';
import * as localStore from '../../../../health/localStore';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { session, t0 } from '../../model/__tests__/fixtures';
import { workoutDoneBody } from '../../model/performed';
import { startRunnerState } from '../../model/state';
import { liveWorkoutSessionPosting, workoutSessionPosting } from '../../outbox/posting';
import { queueWorkoutSave, resetWorkoutOutboxForTests, useWorkoutOutbox } from '../../outbox/workoutOutbox';
import { RunnerProgressIndex, useRunnerProgress } from '../../persistence/progressIndex';
import { loadRunner, saveRunner } from '../../persistence/runnerStore';
import type { RunnerRestAlerting } from '../../restNotification';
import { RunnerController, type RunnerCloseResult } from '../../screen/controller';
import {
  installRunnerDevStub,
  readRunnerStubSaves,
  resetRunnerDevStubForTests,
  resetRunnerFilesForFixtureLaunch,
  RunnerStubLeftoverGuard,
  RunnerStubPosting,
  runnerStubMode,
} from '../devStub';
import { finishFlowFor } from '../finishFlow';

// The runner's activation hook, as ../../register.ts registers it.
const mockActivationHooks = new Map<string, ActivationHook>();
jest.mock('../../../../app/signOut', () => ({
  ...jest.requireActual('../../../../app/signOut'),
  registerActivationHook: (id: string, hook: ActivationHook) => {
    mockActivationHooks.set(id, hook);
    return () => undefined;
  },
}));

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const TODAY = '2026-09-16';
const alerts: RunnerRestAlerting = { schedule: () => undefined, cancel: () => undefined, announce: () => undefined };
const savedEnv = process.env.EXPO_PUBLIC_FIXTURE;

function profile(): Profile {
  return decodeProfile({
    id: MEMBER,
    email: 'member@example.com',
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: { access: 'entitled', consent: { version: '2026-09-v1' } },
  });
}

/**
 * A new launch of a development build with these switches: memory starts
 * empty (the files stay), and the runner's dev support goes in as the
 * runner's index puts it in at startup.
 */
function launch(fixture: string | undefined): void {
  if (fixture === undefined) delete process.env.EXPO_PUBLIC_FIXTURE;
  else process.env.EXPO_PUBLIC_FIXTURE = fixture;
  resetRunnerDevStubForTests();
  resetWorkoutOutboxForTests();
  RunnerProgressIndex.reset();
  installRunnerDevStub(undefined, { delays: { done: 0, skip: 0 } });
}

function signIn(): void {
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
}

function runner(): { controller: RunnerController; closes: RunnerCloseResult[] } {
  const closes: RunnerCloseResult[] = [];
  const controller = new RunnerController({
    session: session(),
    restored: null,
    profileId: MEMBER,
    language: 'en',
    entry: 'today',
    alerts,
    cues: { setTicked: () => undefined, restFinished: () => undefined, switchSides: () => undefined },
    keepAwake: () => undefined,
    clock: () => t0,
    today: TODAY,
  });
  controller.onClose = (result) => closes.push(result);
  controller.appeared();
  return { controller, closes };
}

/** A workout in progress and one queued Save, on disk, from an earlier launch. */
async function leftovers(): Promise<void> {
  await saveRunner(startRunnerState({ session: session(), origin: 'today', now: t0, today: TODAY }), MEMBER);
  const queued = await queueWorkoutSave({
    sessionId: 'sess-old',
    body: workoutDoneBody({ minutes: 20, clientCompletedAt: t0 }),
    key: 'k-old',
    profileId: MEMBER,
  });
  expect(queued).toBe('queued');
  await localStore.settled();
}

async function queueOnDisk(): Promise<unknown> {
  await localStore.settled();
  return localStore.read('workoutOutbox', MEMBER, (json) => json);
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- registers the activation hook above
  require('../../register');
});

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.EXPO_PUBLIC_FIXTURE;
  else process.env.EXPO_PUBLIC_FIXTURE = savedEnv;
  jest.restoreAllMocks();
  resetRunnerDevStubForTests();
  resetWorkoutOutboxForTests();
  await localStore.settled();
});

describe('a Save the stub saw never reaches the server', () => {
  it('queued under runnerStub=offline, it is dropped, not sent, by the next launch without the stub', async () => {
    launch('runnerStub=offline');
    expect(runnerStubMode()).toBe('offline');
    signIn();
    const { controller, closes } = runner();
    const flow = finishFlowFor(controller);
    flow.prepare();
    await flow.save();
    expect(closes).toEqual([{ kind: 'queued' }]);
    expect(await queueOnDisk()).toHaveLength(1);
    expect((await readRunnerStubSaves()).size).toBeGreaterThan(0);

    // The app is killed; the next development launch has no stub.
    const live = jest.spyOn(liveWorkoutSessionPosting, 'done').mockRejectedValue(new TransportError('offline'));
    launch(undefined);
    expect(runnerStubMode()).toBeNull();
    expect(workoutSessionPosting()).toBeInstanceOf(RunnerStubLeftoverGuard);
    signIn();
    await mockActivationHooks.get('runner.outbox')!({ memberId: MEMBER, trigger: 'profile' });

    expect(live).not.toHaveBeenCalled();
    expect(useWorkoutOutbox.getState().items).toEqual([]);
    expect(await queueOnDisk()).toBeNull();
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
  });

  it('a Save the stub never saw goes to the server as before; with nothing marked the guard steps aside', async () => {
    const live = jest.spyOn(liveWorkoutSessionPosting, 'done').mockRejectedValue(new TransportError('offline'));
    launch(undefined);
    const guard = workoutSessionPosting();
    expect(guard).toBeInstanceOf(RunnerStubLeftoverGuard);
    const body = workoutDoneBody({ minutes: 30, clientCompletedAt: t0 });
    await expect(guard.done('sess-1', body, 'k-real')).rejects.toBeInstanceOf(TransportError);
    expect(live).toHaveBeenCalledWith('sess-1', body, 'k-real');
    // Nothing on this phone was seen by a stub: the live posting itself, for the rest of the launch.
    expect(workoutSessionPosting()).toBe(liveWorkoutSessionPosting);
  });

  it('the guard knows a Save by its session and moment too: a conversion to an extra under a new key is refused', async () => {
    launch('runnerStub=offline');
    const body = workoutDoneBody({ minutes: 30, clientCompletedAt: t0 });
    await expect(workoutSessionPosting().done('sess-1', body, 'k-stub')).rejects.toBeInstanceOf(TransportError);

    const live = jest.spyOn(liveWorkoutSessionPosting, 'done').mockRejectedValue(new TransportError('offline'));
    launch(undefined);
    const refused = await workoutSessionPosting()
      .done('sess-1', { ...body, asExtra: true }, 'k-converted')
      .catch((error: unknown) => error);
    expect(refused instanceof ProblemError ? refused.normalisedCode : null).toBe('idempotency_key_reused');
    // Another session, or the same one finished at another moment, is a real Save.
    await expect(workoutSessionPosting().done('sess-2', body, 'k-2')).rejects.toBeInstanceOf(TransportError);
    await expect(
      workoutSessionPosting().done('sess-1', workoutDoneBody({ minutes: 30, clientCompletedAt: new Date(t0.getTime() + 1000) }), 'k-3'),
    ).rejects.toBeInstanceOf(TransportError);
    expect(live).toHaveBeenCalledTimes(2);
  });
});

describe('a fixture launch starts clean (iOS RunnerFixtures.resets)', () => {
  it('runnerStub: the runner file and the queue go before the activation reads or flushes them', async () => {
    launch(undefined);
    await leftovers();
    launch('runnerStub=offline');
    const stub = workoutSessionPosting() as RunnerStubPosting;
    const sent = jest.spyOn(stub, 'done');
    signIn();
    await mockActivationHooks.get('runner.outbox')!({ memberId: MEMBER, trigger: 'profile' });

    expect(sent).not.toHaveBeenCalled();
    expect(useWorkoutOutbox.getState().items).toEqual([]);
    expect(await queueOnDisk()).toBeNull();
    expect(await loadRunner(MEMBER)).toBeNull();
    expect(useRunnerProgress.getState().summary).toBeNull();
    // Once per launch: what this launch makes stays.
    expect(resetRunnerFilesForFixtureLaunch(MEMBER)).toBeNull();
  });

  it('runnerKeep keeps them (the relaunch after a kill)', async () => {
    launch(undefined);
    await leftovers();
    launch('runnerStub=offline,runnerKeep');
    signIn();
    expect(resetRunnerFilesForFixtureLaunch(MEMBER)).toBeNull();
    expect(await loadRunner(MEMBER)).not.toBeNull();
    await mockActivationHooks.get('runner.outbox')!({ memberId: MEMBER, trigger: 'profile' });
    // The flush met "no network" (the stub): the item waits.
    expect(useWorkoutOutbox.getState().items).toHaveLength(1);
    expect(await queueOnDisk()).toHaveLength(1);
  });

  it('runnerReset resets without the stub; a launch with no switch never does', async () => {
    launch(undefined);
    await leftovers();
    expect(resetRunnerFilesForFixtureLaunch(MEMBER)).toBeNull();
    launch('runnerReset');
    await resetRunnerFilesForFixtureLaunch(MEMBER);
    expect(await loadRunner(MEMBER)).toBeNull();
    expect(await queueOnDisk()).toBeNull();
  });
});
