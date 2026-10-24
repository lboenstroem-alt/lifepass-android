/**
 * Swapping the exercise on screen (iOS 7.5): the swap carried out on the
 * runner (`WorkoutRunnerModel.swap(to:forRestOfPlan:)`), "for the rest of the
 * plan" told to the server in the background and silently, the sheet's rows,
 * levels and toggle, and the sheet on the runner page. The rule itself
 * (only the precomputed alternatives, never another block's exercise, the
 * unit and dose of the alternative) is RUN-1's, ported in
 * ../../model/__tests__/runnerState.test.ts; here it is driven through the
 * page.
 */
import { api, Reply } from '@test/server';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { TransportError } from '../../../../api/errors';
import * as localStore from '../../../../health/localStore';
import { decodeHealthDay, decodeSessionActionResponse, type SessionActionResponse } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage } from '../../../../i18n';
import { decodeProfile } from '../../../../api/profile';
import { useAppStore } from '../../../../stores/appStore';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { session, t0 } from '../../model/__tests__/fixtures';
import { liveWorkoutSessionPosting, setWorkoutSessionPosting, type WorkoutSessionPosting } from '../../outbox/posting';
import { loadRunner } from '../../persistence/runnerStore';
import type { RunnerRestAlerting } from '../../restNotification';
import { RunnerController } from '../../screen/controller';
import WorkoutRunnerView from '../../screen/WorkoutRunnerView';
import SwapExerciseSheet from '../SwapExerciseSheet';
import { swapExercise } from '../swapFlow';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
// expo-font (under @expo/vector-icons) needs expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const SESSION = '0d6f7a52-6c1e-4c38-9a51-6a3b7f1e2a01';

const alerts: RunnerRestAlerting = { schedule: () => undefined, cancel: () => undefined, announce: () => undefined };
let events: { event: string; params: AnalyticsParams }[] = [];

function answer(): SessionActionResponse {
  return decodeSessionActionResponse({
    session: { id: 'sess-1', scheduledFor: '2026-09-16', kind: 'strength', title: 'Full body strength', status: 'planned' },
    changed: [],
    replayed: false,
  });
}

/** Records the background swaps; `fail` makes each one fail. */
class SwapPosting implements WorkoutSessionPosting {
  swaps: { sessionId: string; exerciseId: string; toExerciseId: string; key: string }[] = [];
  fail: Error | null = null;
  async done(): Promise<SessionActionResponse> {
    return answer();
  }
  async skip(): Promise<SessionActionResponse> {
    return answer();
  }
  async swapForRestOfPlan(sessionId: string, exerciseId: string, toExerciseId: string, key: string): Promise<SessionActionResponse> {
    this.swaps.push({ sessionId, exerciseId, toExerciseId, key });
    if (this.fail) throw this.fail;
    return answer();
  }
}

function runner(): RunnerController {
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
    today: '2026-09-16',
  });
  controller.onClose = () => undefined;
  return controller;
}

function option(controller: RunnerController, exerciseId: string) {
  const found = controller.swapOptions().find((candidate) => candidate.exerciseId === exerciseId);
  if (!found) throw new Error(`${exerciseId} is not on offer`);
  return found;
}

function swaps(): AnalyticsParams[] {
  return events.filter((e) => e.event === 'workout_exercise_swapped').map((e) => e.params);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  events = [];
  bottomSheetMock.reset();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  useAppStore.setState({ serverFeatures: [], profile: null });
  setCurrentLanguage('en');
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setWorkoutSessionPosting(null);
  await localStore.settled();
});

describe('the swap', () => {
  it('this session only: the exercise and its dose change, written down, counted, nothing posted', async () => {
    const controller = runner();
    const posting = new SwapPosting();
    expect(swapExercise(controller, option(controller, 'leg_press'), false, { posting })).toBe(true);
    expect(controller.current?.exerciseId).toBe('leg_press');
    expect(controller.current?.target).toBe(12);
    expect(swaps()).toEqual([{ future: false }]);
    expect(posting.swaps).toEqual([]);
    await localStore.settled();
    expect((await loadRunner(MEMBER))?.exercises[0]?.exerciseId).toBe('leg_press');
  });

  it('for the rest of the plan: the PLANNED exercise and the new one, under a fresh key, in the background', async () => {
    const controller = runner();
    const posting = new SwapPosting();
    swapExercise(controller, option(controller, 'box_squat'), true, { posting, mintKey: () => 'swap-key-1' });
    await settle();
    expect(posting.swaps).toEqual([
      { sessionId: 'sess-1', exerciseId: 'goblet_squat', toExerciseId: 'box_squat', key: 'swap-key-1' },
    ]);
    expect(swaps()).toEqual([{ future: true }]);
    // Swapping again from the swapped exercise still names the planned one.
    swapExercise(controller, option(controller, 'leg_press'), true, { posting, mintKey: () => 'swap-key-2' });
    await settle();
    expect(posting.swaps[1]).toMatchObject({ exerciseId: 'goblet_squat', toExerciseId: 'leg_press', key: 'swap-key-2' });
  });

  it('a failure shows nothing: the swap still applies to this session', async () => {
    const controller = runner();
    const posting = new SwapPosting();
    posting.fail = new TransportError('offline');
    expect(swapExercise(controller, option(controller, 'box_squat'), true, { posting })).toBe(true);
    await settle();
    expect(controller.current?.exerciseId).toBe('box_squat');
    expect(useHealthStore.getState().toastKey).toBeNull();
  });

  it('going back to the planned exercise never posts, even with the toggle on', async () => {
    const controller = runner();
    const posting = new SwapPosting();
    swapExercise(controller, option(controller, 'box_squat'), false, { posting });
    const back = option(controller, 'goblet_squat');
    expect(back.isPlanned).toBe(true);
    swapExercise(controller, back, true, { posting });
    await settle();
    expect(controller.current?.exerciseId).toBe('goblet_squat');
    expect(posting.swaps).toEqual([]);
    expect(swaps()).toEqual([{ future: false }, { future: false }]);
  });

  it('a stale option changes nothing (not on offer any more, or the runner has closed)', () => {
    const controller = runner();
    const posting = new SwapPosting();
    // The plank block: its alternative is dosed in reps, a change of unit.
    controller.advance();
    controller.advance();
    const stale = option(controller, 'dead_bug');
    // A set done in seconds: the unit may no longer change.
    controller.completeNextSet();
    expect(swapExercise(controller, stale, true, { posting })).toBe(false);
    expect(controller.current?.exerciseId).toBe('plank');
    const closing = runner();
    const offered = option(closing, 'box_squat');
    closing.discard();
    expect(swapExercise(closing, offered, true, { posting })).toBe(false);
    expect(closing.current?.exerciseId).toBe('goblet_squat');
    expect(swaps()).toEqual([]);
  });

  it('the wire: action swap, scope future, the planned id and the new one', async () => {
    api.on('POST', '/health/sessions/:id', Reply.ok({ session: null, changed: [], replayed: false }));
    await liveWorkoutSessionPosting.swapForRestOfPlan(SESSION, 'goblet_squat', 'box_squat', 'swap-key-0001');
    const sent = expectSentToMatchContract('POST', `/health/sessions/${SESSION}`);
    expect(sent.body).toEqual({ action: 'swap', exerciseId: 'goblet_squat', toExerciseId: 'box_squat', scope: 'future' });
    expect(sent.headers['idempotency-key']).toBe('swap-key-0001');
  });
});

describe('the sheet', () => {
  function sheet(props: Partial<Parameters<typeof SwapExerciseSheet>[0]> = {}) {
    const controller = runner();
    const onSelect = jest.fn();
    const onClose = jest.fn();
    return {
      controller,
      onSelect,
      onClose,
      element: (
        <UiKitProvider>
          <SwapExerciseSheet
            visible
            onClose={onClose}
            currentName="Goblet squat"
            setCount={3}
            options={controller.swapOptions()}
            canUseForRestOfPlan
            onSelect={onSelect}
            {...props}
          />
        </UiKitProvider>
      ),
    };
  }

  it('what is on screen now, then each option with its dose and its level', async () => {
    const { element } = sheet();
    await render(element);
    expect(screen.getByText('Swap exercise')).toBeTruthy();
    expect(screen.getByTestId('swap.current').props.children).toBe('Now: Goblet squat');
    expect(screen.getByTestId('swap.option.box_squat.detail').props.children).toBe('Bodyweight · 3 × 10');
    expect(screen.getByTestId('swap.option.leg_press.detail').props.children).toBe('Machine · 3 × 12');
    expect(screen.getByTestId('swap.option.box_squat').props.accessibilityLabel).toBe('Box squat, Bodyweight · 3 × 10, Easier');
    expect(screen.getByTestId('swap.option.leg_press').props.accessibilityLabel).toBe('Leg press, Machine · 3 × 12, Harder');
    // Wall sit has no unit, the plank is another block's, and the planned
    // exercise is not an alternative to itself.
    expect(screen.queryByTestId('swap.option.wall_sit')).toBeNull();
    expect(screen.queryByTestId('swap.option.plank')).toBeNull();
    expect(screen.queryByTestId('swap.option.goblet_squat')).toBeNull();
    expect(screen.getByTestId('swap.future')).toBeTruthy();
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    const { element } = sheet();
    await render(element);
    expect(screen.getByText('Skipta út æfingu')).toBeTruthy();
    expect(screen.getByTestId('swap.current').props.children).toBe('Núna: Goblet squat');
    expect(screen.getByText('Nota þessa skiptingu út áætlunina')).toBeTruthy();
    expect(screen.getByTestId('swap.option.box_squat').props.accessibilityLabel).toMatch(/, Léttari$/);
  });

  it('a row hands its option over with the toggle (off by default)', async () => {
    const { element, onSelect } = sheet();
    await render(element);
    await fireEvent.press(screen.getByTestId('swap.option.box_squat'));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ exerciseId: 'box_squat' }), false);
    await fireEvent.press(screen.getByTestId('swap.future'));
    expect(screen.getByTestId('swap.future').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('swap.option.leg_press'));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ exerciseId: 'leg_press' }), true);
  });

  it('offline the toggle is hidden, and nothing is for the rest of the plan', async () => {
    const { element, onSelect } = sheet({ canUseForRestOfPlan: false });
    await render(element);
    expect(screen.queryByTestId('swap.future')).toBeNull();
    await fireEvent.press(screen.getByTestId('swap.option.box_squat'));
    expect(onSelect).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it('once swapped: "Back to the planned exercise" first, levels against what is on screen now', async () => {
    const controller = runner();
    swapExercise(controller, option(controller, 'box_squat'), false, { posting: new SwapPosting() });
    const options = controller.swapOptions();
    // Box squat is easier than planned, so the way back and the leg press are both harder.
    expect(options.map((o) => [o.exerciseId, o.level])).toEqual([
      ['goblet_squat', 'harder'],
      ['leg_press', 'harder'],
    ]);
    await render(
      <UiKitProvider>
        <SwapExerciseSheet
          visible
          onClose={() => undefined}
          currentName="Box squat"
          setCount={3}
          options={options}
          canUseForRestOfPlan
          onSelect={() => undefined}
        />
      </UiKitProvider>,
    );
    expect(screen.getByTestId('swap.option.goblet_squat.detail').props.children).toBe(
      'Back to the planned exercise · 3 × 10',
    );
  });

  it('only the way back on offer: no toggle', async () => {
    const { element } = sheet({
      options: [
        {
          exerciseId: 'goblet_squat',
          name: 'Goblet squat',
          equipmentLabel: 'Dumbbell',
          level: 'same',
          isPlanned: true,
          unit: 'reps',
          target: 10,
          perSide: false,
        },
      ],
    });
    await render(element);
    expect(screen.queryByTestId('swap.future')).toBeNull();
  });

  it('Cancel closes it', async () => {
    const { element, onClose } = sheet();
    await render(element);
    await fireEvent.press(screen.getByTestId('swap.cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('on the runner page', () => {
  it('Swap opens the sheet; a row swaps the exercise and closes it', async () => {
    setWorkoutSessionPosting(new SwapPosting());
    const controller = runner();
    await render(
      <UiKitProvider>
        <WorkoutRunnerView controller={controller} />
      </UiKitProvider>,
    );
    await fireEvent.press(screen.getByTestId('runner.swap'));
    expect(screen.getByText('Swap exercise')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('swap.option.box_squat'));
    await act(async () => undefined);
    expect(screen.queryByText('Swap exercise')).toBeNull();
    expect(screen.getByTestId('runner.exerciseName').props.children).toBe('Box squat');
    expect(screen.getByText('Swapped')).toBeTruthy();
  });

  it('offline (the last health call met no network): no toggle', async () => {
    useHealthStore.setState({ lastError: new TransportError('offline') });
    const controller = runner();
    await render(
      <UiKitProvider>
        <WorkoutRunnerView controller={controller} />
      </UiKitProvider>,
    );
    await fireEvent.press(screen.getByTestId('runner.swap'));
    expect(screen.queryByTestId('swap.future')).toBeNull();
  });

  it('a custom plan: no toggle (the server refuses a swap for the rest of a plan the member wrote)', async () => {
    useHealthStore.setState({ today: decodeHealthDay({ date: '2026-09-16', program: { id: 'prog-1', status: 'active', custom: true } }) });
    const controller = runner();
    await render(
      <UiKitProvider>
        <WorkoutRunnerView controller={controller} />
      </UiKitProvider>,
    );
    await fireEvent.press(screen.getByTestId('runner.swap'));
    expect(screen.queryByTestId('swap.future')).toBeNull();
  });

  it('"I don\'t have this" (COACH-6): the workout is kept for later and the Coach opens with the words, unsent', async () => {
    useAppStore.setState({
      serverFeatures: ['plan_edit'],
      profile: decodeProfile({
        id: MEMBER,
        email: 'member@example.com',
        locale: 'en',
        kennitalaVerified: true,
        marketingConsent: false,
        health: { access: 'entitled', consent: { version: '2026-09-v3', consentedAt: '2026-09-01T10:00:00Z', ageSource: 'kennitala' } },
      }),
    });
    useHealthStore.setState({ today: decodeHealthDay({ date: '2026-09-16', program: { id: 'prog-1', status: 'active' } }) });
    const controller = runner();
    let closed: unknown = null;
    controller.onClose = (result) => {
      closed = result;
    };
    await render(
      <UiKitProvider>
        <WorkoutRunnerView controller={controller} />
      </UiKitProvider>,
    );
    await fireEvent.press(screen.getByTestId('runner.swap'));
    await fireEvent.press(screen.getByTestId('swap.notHaveThis'));
    await act(async () => undefined);
    const parked = useIntentStore.getState().pendingCoachPlanEdit;
    expect(parked).toEqual({
      sessionId: 'sess-1',
      exerciseId: controller.state.exercises[0]!.plannedExerciseId,
      prefill: `I don't have the equipment for ${controller.state.exercises[0]!.plannedName}`,
    });
    expect(useIntentStore.getState().pendingTab).toBe('Coach');
    expect(closed).toEqual({ kind: 'later' });
  });

  it('without the feature there is no "I don\'t have this"', async () => {
    const controller = runner();
    await render(
      <UiKitProvider>
        <WorkoutRunnerView controller={controller} />
      </UiKitProvider>,
    );
    await fireEvent.press(screen.getByTestId('runner.swap'));
    expect(screen.queryByTestId('swap.notHaveThis')).toBeNull();
  });
});
