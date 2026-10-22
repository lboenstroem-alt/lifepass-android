/**
 * Route `WorkoutRunner`: the screen finds the session the route names (the
 * one handed over, the saved workout's, or the health store's), resumes this
 * session's saved workout unless it has outlived its day, leaves when there
 * is nothing to run, closes through the navigator (and says how), refuses
 * any other removal while it is up, and opens nothing a wipe during its read
 * discarded.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { HealthDay } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import type { RootModalProps } from '../../../../navigation/types';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { completeNextSet, pauseClock, startRunnerState } from '../../model/state';
import { session } from '../../model/__tests__/fixtures';
import { wipeRunnerLocal } from '../../outbox/localWipe';
import { RunnerProgressIndex } from '../../persistence/progressIndex';
import * as runnerStore from '../../persistence/runnerStore';
import { loadRunner, saveRunner } from '../../persistence/runnerStore';
import { notifyRunnerWiped } from '../../persistence/wiped';
import { onRunnerClosed } from '../closeEvents';
import type { RunnerCloseResult } from '../controller';
import { handRunnerSession, resetRunnerSessionHandoffForTests } from '../sessionSource';
import WorkoutRunnerScreen from '../WorkoutRunnerScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

let events: { event: string; params: AnalyticsParams }[] = [];

type BeforeRemove = (event: { preventDefault(): void }) => void;

function props(sessionId: string, entry: 'today' | 'missed' | 'resume' = 'today') {
  const goBack = jest.fn();
  const beforeRemove = new Set<BeforeRemove>();
  const value = {
    navigation: {
      goBack,
      canGoBack: () => true,
      setOptions: jest.fn(),
      addListener: jest.fn((name: string, listener: BeforeRemove) => {
        if (name !== 'beforeRemove') return () => undefined;
        beforeRemove.add(listener);
        return () => beforeRemove.delete(listener);
      }),
    },
    route: { key: 'WorkoutRunner-1', name: 'WorkoutRunner', params: { sessionId, entry } },
  } as unknown as RootModalProps<'WorkoutRunner'>;
  /** A removal the screen did not ask for (F4's `popTo('Main')` for a tab switch): true when it may go. */
  const mayRemove = (): boolean => {
    let prevented = false;
    for (const listener of beforeRemove) listener({ preventDefault: () => (prevented = true) });
    return !prevented;
  };
  return { goBack, value, mayRemove };
}

function today(view = session()): void {
  useHealthStore.setState({ today: { date: '2026-09-16', day: { session: view } } as unknown as HealthDay });
}

/** A workout of `sess-1` with its first set done, left with "Finish later today". */
function savedWorkout(scheduledFor: string) {
  const started = startRunnerState({
    session: session({ scheduledFor }),
    origin: 'today',
    now: new Date(),
    today: scheduledFor,
  });
  return pauseClock(completeNextSet(started, new Date()).state, new Date(), false);
}

beforeEach(() => {
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetRunnerSessionHandoffForTests();
  RunnerProgressIndex.reset();
  useAppStore.setState({ userId: MEMBER });
  setTestFontScale(1);
});

afterEach(() => {
  setAnalyticsObserver(null);
  restoreTestFontScale();
  jest.restoreAllMocks();
});

it("opens today's session from the health store, and writes it down", async () => {
  today();
  const { value } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  expect(screen.getByText('Goblet squat')).toBeTruthy();
  expect(events).toContainEqual({ event: 'workout_started', params: { kind: 'strength', entry: 'today' } });
  expect((await loadRunner(MEMBER))?.sessionId).toBe('sess-1');
  expect(value.navigation.setOptions).toHaveBeenCalledWith({ gestureEnabled: false });
});

it("resumes this session's saved workout, even when no read holds the session any more", async () => {
  await saveRunner(savedWorkout(todayServerDay()), MEMBER);
  const { value } = props('sess-1', 'resume');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  expect(screen.getByTestId('runner.set.0.0.check').props.accessibilityLabel).toBe('Mark set 1 not done');
  expect(events).toContainEqual({ event: 'workout_started', params: { kind: 'strength', entry: 'resume' } });
});

it('the session handed over by the opener wins (a past row the member tapped)', async () => {
  today(session({ id: 'sess-1' }));
  handRunnerSession(session({ id: 'sess-2', scheduledFor: '2026-09-14' }));
  const { value } = props('sess-2', 'missed');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  expect(events).toContainEqual({ event: 'workout_started', params: { kind: 'strength', entry: 'missed' } });
  expect((await loadRunner(MEMBER))?.sessionId).toBe('sess-2');
});

it('opens no workout when the session cannot be found: it says so and offers its close', async () => {
  const { goBack, value } = props('nowhere');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.unavailable')).toBeTruthy());
  expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
  expect(screen.queryByTestId('runner.page')).toBeNull();
  expect(await loadRunner(MEMBER)).toBeNull();
  expect(events.map((entry) => entry.event)).not.toContain('workout_started');
  await fireEvent.press(screen.getByTestId('runner.close'));
  expect(goBack).toHaveBeenCalledTimes(1);
});

it('opens no workout with nobody signed in', async () => {
  useAppStore.setState({ userId: null, profile: null });
  today();
  const { value } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.unavailable')).toBeTruthy());
});

it('closes through the navigator ("Finish later today")', async () => {
  today();
  const { goBack, value } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('runner.close'));
  await fireEvent.press(screen.getByText('Finish later today'));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(await loadRunner(MEMBER)).not.toBeNull();
});

it('the local wipe closes it as discarded', async () => {
  today();
  const { goBack, value } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  await act(async () => notifyRunnerWiped({ profileId: MEMBER, reason: 'signout' }));
  expect(goBack).toHaveBeenCalledTimes(1);
});

it('a saved workout that has outlived its day is not resumed: a fresh runner opens over it', async () => {
  await saveRunner(savedWorkout('2026-09-16'), MEMBER);
  today();
  const { value } = props('sess-1', 'today');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  expect(screen.getByTestId('runner.set.0.0.check').props.accessibilityLabel).toBe('Mark set 1 done');
  expect(events).toContainEqual({ event: 'workout_started', params: { kind: 'strength', entry: 'today' } });
  expect((await loadRunner(MEMBER))?.exercises[0]!.sets[0]!.done).toBe(false);
});

it('the hand-over is used once: a later open of the same id reads the session as it is now', async () => {
  handRunnerSession(session({ id: 'sess-1', minutes: 40 }));
  const first = props('sess-1');
  const opened = await render(<WorkoutRunnerScreen {...first.value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('runner.close'));
  await fireEvent.press(screen.getByText('Discard workout'));
  await opened.unmount();

  // Nothing handed over now, and no read holds it: nothing to run.
  const second = props('sess-1');
  await render(<WorkoutRunnerScreen {...second.value} />);
  await waitFor(() => expect(screen.getByTestId('runner.unavailable')).toBeTruthy());
});

it('a wipe while the saved workout is read: the runner does not open, and nothing is written back', async () => {
  await saveRunner(savedWorkout(todayServerDay()), MEMBER);
  const realLoad = runnerStore.loadRunner;
  jest.spyOn(runnerStore, 'loadRunner').mockImplementationOnce(async (profileId) => {
    const state = await realLoad(profileId);
    await wipeRunnerLocal({ profileId: MEMBER, reason: 'withdrawn_elsewhere' }, 'folder');
    return state;
  });
  const { goBack, value } = props('sess-1', 'resume');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(goBack).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('runner.page')).toBeNull();
  expect(events.map((entry) => entry.event)).not.toContain('workout_started');
  expect(await loadRunner(MEMBER)).toBeNull();
});

it('an open that fails says something went wrong, offers its close, and is reported', async () => {
  today();
  jest.spyOn(runnerStore, 'loadRunner').mockRejectedValueOnce(new Error('disk'));
  const { goBack, value } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.unavailable')).toBeTruthy());
  expect(events).toContainEqual({ event: 'service_error', params: { op: 'runner_open', error: 'disk' } });
  await fireEvent.press(screen.getByTestId('runner.close'));
  expect(goBack).toHaveBeenCalledTimes(1);
});

it('nothing removes the runner but its own close (a tab switch waits, as iOS keeps the cover up)', async () => {
  today();
  const { goBack, value, mayRemove } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  expect(mayRemove()).toBe(false);
  await fireEvent.press(screen.getByTestId('runner.close'));
  await fireEvent.press(screen.getByText('Finish later today'));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(mayRemove()).toBe(true);
});

it('the page with nothing to run may be removed', async () => {
  const { value, mayRemove } = props('nowhere');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.unavailable')).toBeTruthy());
  expect(mayRemove()).toBe(true);
});

it('says how it closed, with the session, before it leaves', async () => {
  today();
  const heard: [RunnerCloseResult, string][] = [];
  const unsubscribe = onRunnerClosed((result, sessionId) => heard.push([result, sessionId]));
  const { value } = props('sess-1');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.page')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('runner.close'));
  await fireEvent.press(screen.getByText('Finish later today'));
  unsubscribe();
  expect(heard).toEqual([[{ kind: 'later' }, 'sess-1']]);
});

it('a wipe before the runner opened drops the session handed over (it is the member who left)', async () => {
  handRunnerSession(session({ id: 'sess-2', scheduledFor: '2026-09-14' }));
  notifyRunnerWiped({ profileId: MEMBER, reason: 'signout' });
  const { value } = props('sess-2', 'missed');
  await render(<WorkoutRunnerScreen {...value} />);
  await waitFor(() => expect(screen.getByTestId('runner.unavailable')).toBeTruthy());
});
