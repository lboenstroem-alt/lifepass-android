/**
 * Route `WorkoutRunner`: the screen finds the session the route names (the
 * one handed over, the saved workout's, or the health store's), resumes this
 * session's saved workout, leaves when there is nothing to run, and closes
 * through the navigator.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { HealthDay } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import type { RootModalProps } from '../../../../navigation/types';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { completeNextSet, pauseClock, startRunnerState } from '../../model/state';
import { session } from '../../model/__tests__/fixtures';
import { RunnerProgressIndex } from '../../persistence/progressIndex';
import { loadRunner, saveRunner } from '../../persistence/runnerStore';
import { notifyRunnerWiped } from '../../persistence/wiped';
import { handRunnerSession, resetRunnerSessionHandoffForTests } from '../sessionSource';
import WorkoutRunnerScreen from '../WorkoutRunnerScreen';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

let events: { event: string; params: AnalyticsParams }[] = [];

function props(sessionId: string, entry: 'today' | 'missed' | 'resume' = 'today') {
  const goBack = jest.fn();
  const value = {
    navigation: { goBack, canGoBack: () => true, setOptions: jest.fn() },
    route: { key: 'WorkoutRunner-1', name: 'WorkoutRunner', params: { sessionId, entry } },
  } as unknown as RootModalProps<'WorkoutRunner'>;
  return { goBack, value };
}

function today(view = session()): void {
  useHealthStore.setState({ today: { date: '2026-09-16', day: { session: view } } as unknown as HealthDay });
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
  const started = startRunnerState({ session: session(), origin: 'today', now: new Date(), today: '2026-09-16' });
  const saved = pauseClock(completeNextSet(started, new Date()).state, new Date(), false);
  await saveRunner(saved, MEMBER);
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
