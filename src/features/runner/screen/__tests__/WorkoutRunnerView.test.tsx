/**
 * The runner page in the iOS fixture states (`-LPRunnerScreen`: rest,
 * progress, perside, timed, intervals, switchsides, side2, skipped, leave),
 * driven through the same calls a tap makes, in English and Icelandic and at
 * a font scale of 2: what the member reads, what TalkBack says, and that back
 * opens Leave instead of closing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceEventEmitter, StyleSheet } from 'react-native';

import { TransportError } from '../../../../api/errors';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage } from '../../../../i18n';
import { RunnerProgressIndex } from '../../persistence/progressIndex';
import { blocksJSON, intervalsJSON, perSideHoldJSON, session, t0 } from '../../model/__tests__/fixtures';
import type { RunnerRestAlerting } from '../../restNotification';
import { RunnerController, type RunnerCloseResult } from '../controller';
import { leaveButtons } from '../RunnerLeaveDialog';
import { progressFraction } from '../RunnerTopBar';
import WorkoutRunnerView from '../WorkoutRunnerView';

// expo-font (under @expo/vector-icons) needs expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

let clockNow = t0;
let closes: RunnerCloseResult[] = [];

const alerts: RunnerRestAlerting = { schedule: () => undefined, cancel: () => undefined, announce: () => undefined };

function plus(seconds: number): Date {
  return new Date(t0.getTime() + seconds * 1000);
}

function runner(blocks: string = blocksJSON, options: { canSkip?: boolean } = {}): RunnerController {
  const controller = new RunnerController({
    session: session({ blocks, canSkip: options.canSkip }),
    restored: null,
    profileId: MEMBER,
    language: 'en',
    entry: 'today',
    alerts,
    cues: { setTicked: () => undefined, restFinished: () => undefined, switchSides: () => undefined },
    keepAwake: () => undefined,
    clock: () => clockNow,
    today: '2026-09-16',
  });
  controller.onClose = (result) => closes.push(result);
  return controller;
}

async function show(controller: RunnerController): Promise<void> {
  await render(<WorkoutRunnerView controller={controller} />);
}

/** Moves the clock and lets the page's half-second timer see it. */
async function at(seconds: number, controller: RunnerController): Promise<void> {
  clockNow = plus(seconds);
  await act(async () => controller.tickNow());
}

function label(testID: string): string | undefined {
  return screen.getByTestId(testID).props.accessibilityLabel;
}

function text(testID: string): string {
  const node = screen.getByTestId(testID);
  const children = ([] as unknown[]).concat(node.props.children);
  return children.filter((child) => typeof child === 'string' || typeof child === 'number').join('');
}

beforeEach(() => {
  clockNow = t0;
  closes = [];
  RunnerProgressIndex.reset();
  resetHealthStoreForTests();
  setTestFontScale(1);
});

afterEach(() => restoreTestFontScale());

describe('the first exercise', () => {
  it('reads as on iOS: progress, block, name, target, cues, sets, actions, what is next', async () => {
    await show(runner());
    expect(text('runner.progress')).toBe('Exercise 1 of 5');
    expect(text('runner.kicker')).toBe('BLOCK 1 · SQUAT');
    expect(text('runner.exerciseName')).toBe('Goblet squat');
    expect(text('runner.targetLine')).toBe('3 × 10 · Moderate · Rest 90 s');
    // Three cues at most.
    expect(screen.getByText('c')).toBeTruthy();
    expect(screen.queryByText('d')).toBeNull();
    expect(label('runner.set.0.0.label')).toBe('Set 1, 10 reps, 12.5 kilograms, not done');
    expect(label('runner.set.0.0.check')).toBe('Mark set 1 done');
    expect(label('runner.set.0.0.kg.plus')).toBe('Plus 2.5 kilograms, Set 1');
    expect(screen.getByTestId('runner.set.0.0.kg').props.value).toBe('12.5');
    expect(screen.getByTestId('runner.swap')).toBeTruthy();
    expect(label('runner.skipExercise')).toBe('Skip exercise');
    expect(text('runner.upNext')).toBe('Up next: Reverse lunge');
    expect(text('runner.nextSetLine')).toBe('Set 1 of 3: 10 reps, 12.5 kg');
    expect(label('runner.primary')).toBe('Complete set 1');
    expect(label('runner.finishSecondary')).toBe('Finish workout');
    expect(label('runner.clock')).toBe('Time so far, 0 seconds');
    expect(label('runner.close')).toBe('Leave workout');
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    const controller = runner();
    controller.language = 'is';
    await show(controller);
    expect(text('runner.progress')).toBe('Æfing 1 af 5');
    expect(text('runner.targetLine')).toBe('3 × 10 · Miðlungsþyngd · Hvíld 90 sek.');
    expect(label('runner.set.0.0.label')).toBe('Sett 1, 10 endurtekningar, 12,5 kíló, ekki lokið');
    expect(screen.getByTestId('runner.set.0.0.kg').props.value).toBe('12,5');
    expect(text('runner.nextSetLine')).toBe('Sett 1 af 3: 10 endurtekningar, 12,5 kg');
    expect(label('runner.primary')).toBe('Ljúka setti 1');
  });

  it('typing a load keeps what is typed and stores it, the Icelandic comma included', async () => {
    setCurrentLanguage('is');
    const controller = runner();
    await show(controller);
    const field = screen.getByTestId('runner.set.0.1.kg');
    await fireEvent(field, 'focus');
    await fireEvent.changeText(field, '20,');
    expect(screen.getByTestId('runner.set.0.1.kg').props.value).toBe('20,');
    expect(controller.state.exercises[0]!.sets[1]!.kg).toBe(20);
    await fireEvent.changeText(screen.getByTestId('runner.set.0.1.kg'), '22,5');
    expect(controller.state.exercises[0]!.sets[1]!.kg).toBe(22.5);
    await fireEvent(screen.getByTestId('runner.set.0.1.kg'), 'blur');
    expect(screen.getByTestId('runner.set.0.1.kg').props.value).toBe('22,5');
    // An empty field is no load.
    await fireEvent(screen.getByTestId('runner.set.0.1.kg'), 'focus');
    await fireEvent.changeText(screen.getByTestId('runner.set.0.1.kg'), '');
    expect(controller.state.exercises[0]!.sets[1]!.kg).toBeNull();
  });

  it('the steppers move the dose and the load, and the field follows', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.set.0.2.value.plus'));
    await fireEvent.press(screen.getByTestId('runner.set.0.2.kg.minus'));
    expect(screen.getByTestId('runner.set.0.2.value').props.value).toBe('11');
    expect(screen.getByTestId('runner.set.0.2.kg').props.value).toBe('10');
    expect(label('runner.set.0.2.label')).toBe('Set 3, 11 reps, 10 kilograms, not done');
  });
});

describe('the rest (fixture "rest")', () => {
  it('the big button ticks the set and the rest bar takes its place', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.primary'));
    expect(screen.queryByTestId('runner.primary')).toBeNull();
    expect(text('runner.restClock')).toBe('1:30');
    expect(screen.getByTestId('runner.restCountdown').props.accessibilityLabel).toBe('Rest');
    expect(screen.getByTestId('runner.restCountdown').props.accessibilityValue).toEqual({ text: '1 minute 30 seconds left' });
    expect(label('runner.rest.minus')).toBe('Minus 15 seconds');
    expect(label('runner.rest.plus')).toBe('Plus 15 seconds');
    expect(label('runner.rest.skip')).toBe('Skip rest');
    expect(label('runner.set.0.0.check')).toBe('Mark set 1 not done');
    expect(label('runner.set.0.0.label')).toBe('Set 1, 10 reps, 12.5 kilograms, done');

    await at(31, controller);
    expect(text('runner.restClock')).toBe('0:59');
    await fireEvent.press(screen.getByTestId('runner.rest.plus'));
    expect(text('runner.restClock')).toBe('1:14');

    await fireEvent.press(screen.getByTestId('runner.rest.skip'));
    expect(screen.queryByTestId('runner.restBar')).toBeNull();
    expect(label('runner.primary')).toBe('Complete set 2');
  });

  it('ends by itself at zero', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.primary'));
    await at(90.2, controller);
    expect(screen.queryByTestId('runner.restBar')).toBeNull();
    expect(label('runner.primary')).toBe('Complete set 2');
  });
});

describe('progress (fixture "progress")', () => {
  it('counts done sets over the sets of the exercises not skipped', async () => {
    const controller = runner();
    await show(controller);
    for (let set = 0; set < 2; set += 1) {
      await act(async () => {
        controller.completeNextSet();
        controller.skipRest();
      });
    }
    // 3 + 2 + 2 + 1 + 4 sets.
    expect(progressFraction(controller.state)).toBeCloseTo(2 / 12);
    const fill = StyleSheet.flatten(screen.getByTestId('runner.progressBar', { includeHiddenElements: true }).props.children.props.style);
    expect(fill.width).toBe(`${(2 / 12) * 100}%`);
    await act(async () => controller.skipExercise());
    // Block 1 was cut short (two sets done): its sets still count.
    expect(progressFraction(controller.state)).toBeCloseTo(2 / 12);
    await act(async () => controller.skipExercise());
    // Block 2 skipped with nothing done: out of the count.
    expect(progressFraction(controller.state)).toBeCloseTo(2 / 10);
  });
});

describe('reps each side and holds (fixtures "perside", "timed", "intervals")', () => {
  it('a block dosed each side says so, with no kg column for bodyweight', async () => {
    const controller = runner();
    controller.advance();
    await show(controller);
    expect(text('runner.targetLine')).toBe('2 × 8 each side · Bodyweight · Rest 60 s');
    expect(label('runner.set.1.0.label')).toBe('Set 1, 8 reps each side, not done');
    expect(screen.getByTestId('runner.set.1.0.value').props.accessibilityLabel).toBe('each side');
    expect(screen.queryByTestId('runner.set.1.0.kg')).toBeNull();
  });

  it('a timed set starts from the big button and counts down in its capsule', async () => {
    const controller = runner();
    controller.advance();
    controller.advance();
    await show(controller);
    expect(text('runner.targetLine')).toBe('2 × 40 s · Rest 45 s');
    expect(label('runner.timer.2.0')).toBe('Start 40 seconds, Set 1');
    expect(label('runner.primary')).toBe('Start set 1');
    expect(text('runner.nextSetLine')).toBe('Set 1 of 2: 40 seconds');

    await fireEvent.press(screen.getByTestId('runner.primary'));
    await at(15.4, controller);
    expect(label('runner.timer.2.0')).toBe('25 seconds left');
    expect(screen.getByTestId('runner.timer.2.0').props.accessibilityHint).toBe('Stop timer');
    expect(label('runner.primary')).toBe('Complete set 1');

    // At zero the set ticks itself, and its rest runs from its end.
    await at(40.3, controller);
    expect(controller.state.exercises[2]!.sets[0]!.done).toBe(true);
    expect(text('runner.restClock')).toBe('0:45');
    await fireEvent.press(screen.getByTestId('runner.rest.skip'));
    expect(screen.getByTestId('runner.timer.2.0.done')).toBeTruthy();
  });

  it('intervals: six timed sets of 45 s, and minutes from a minute up', async () => {
    const controller = runner(intervalsJSON);
    await show(controller);
    expect(text('runner.targetLine')).toBe('6 × 45 s · Rest 75 s');
    expect(screen.getByTestId('runner.set.0.5')).toBeTruthy();
    await act(async () => controller.advance());
    expect(text('runner.targetLine')).toBe('3 × 2 min · Rest 60 s');
    expect(label('runner.timer.1.0')).toBe('Start 2 minutes, Set 1');
    await act(async () => controller.advance());
    expect(text('runner.targetLine')).toBe('3 × 500 s · Rest 60 s');
    expect(text('runner.nextSetLine')).toBe('Set 1 of 3: 8 minutes 20 seconds');
  });

  it('a hold each side: side 1, the changeover, side 2 (fixtures "switchsides" and "side2")', async () => {
    const controller = runner(perSideHoldJSON);
    await show(controller);
    expect(text('runner.targetLine')).toBe('2 × 20 s each side · Rest 15 s');
    expect(label('runner.timer.0.0')).toBe('Start 20 seconds each side, Set 1');
    await fireEvent.press(screen.getByTestId('runner.primary'));
    await at(5, controller);
    expect(label('runner.timer.0.0')).toBe('Side 1: 15 seconds left');
    await at(21, controller);
    expect(label('runner.timer.0.0')).toBe('Switch sides');
    await at(30, controller);
    expect(label('runner.timer.0.0')).toBe('Side 2: 15 seconds left');
  });

  it('one cardio row is a stopwatch', async () => {
    const controller = runner();
    controller.advance();
    controller.advance();
    controller.advance();
    await show(controller);
    expect(text('runner.targetLine')).toBe('20 min · Moderate');
    expect(label('runner.stopwatch.3')).toBe('Start timer');
    await fireEvent.press(screen.getByTestId('runner.stopwatch.3'));
    await at(70, controller);
    expect(label('runner.stopwatch.3')).toBe('Stop timer');
    expect(screen.getByTestId('runner.stopwatch.3').props.accessibilityValue).toEqual({ text: '1 minute 15 seconds' });
  });
});

describe('skip and Undo (fixture "skipped")', () => {
  it('moves on, says so with Undo, and Undo puts it back', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.skipExercise'));
    expect(text('runner.exerciseName')).toBe('Reverse lunge');
    expect(screen.getByText('Exercise skipped')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('runner.undoSkip'));
    expect(text('runner.exerciseName')).toBe('Goblet squat');
    expect(screen.queryByTestId('runner.undoToast')).toBeNull();
  });

  it('a block cut short shows its chip and dims the sets not done', async () => {
    const controller = runner();
    controller.completeNextSet();
    controller.skipRest();
    await show(controller);
    expect(label('runner.skipExercise')).toBe('Skip remaining sets');
    await act(async () => {
      controller.skipExercise();
      controller.undoSkip();
    });
    await act(async () => {
      controller.skipExercise();
    });
    await act(async () => {
      controller.apply((state) => ({ ...state, index: 0 }));
    });
    expect(screen.getByText('Cut short')).toBeTruthy();
    expect(screen.queryByTestId('runner.skipExercise')).toBeNull();
    expect(label('runner.set.0.1.label')).toBe('Set 2, 10 reps, 12.5 kilograms, skipped');
    expect(StyleSheet.flatten(screen.getByTestId('runner.set.0.1').props.style).opacity).toBe(0.55);
  });
});

describe('Leave (fixture "leave")', () => {
  it('the cross and back both open it, with its five answers', async () => {
    await show(runner());
    await fireEvent.press(screen.getByTestId('runner.close'));
    expect(screen.getByText('Leave this workout?')).toBeTruthy();
    for (const answer of ['Save and finish', 'Finish later today', 'Skip this workout', 'Discard workout', 'Cancel']) {
      expect(screen.getByText(answer)).toBeTruthy();
    }
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByText('Leave this workout?')).toBeNull();

    await act(async () => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });
    expect(screen.getByText('Leave this workout?')).toBeTruthy();
    expect(closes).toEqual([]);
  });

  it('"Finish later today" and "Discard workout" close the runner', async () => {
    const later = runner();
    await show(later);
    await fireEvent.press(screen.getByTestId('runner.close'));
    await fireEvent.press(screen.getByText('Finish later today'));
    expect(closes).toEqual([{ kind: 'later' }]);

    const discard = runner();
    await show(discard);
    await fireEvent.press(screen.getByTestId('runner.close'));
    await fireEvent.press(screen.getByText('Discard workout'));
    expect(closes).toEqual([{ kind: 'later' }, { kind: 'discarded' }]);
  });

  it('Skip this workout is not offered after a set, on a session that cannot skip, or offline', async () => {
    const done = runner();
    done.completeNextSet();
    await show(done);
    await fireEvent.press(screen.getByTestId('runner.close'));
    expect(screen.queryByText('Skip this workout')).toBeNull();

    await show(runner(blocksJSON, { canSkip: false }));
    await fireEvent.press(screen.getByTestId('runner.close'));
    expect(screen.queryByText('Skip this workout')).toBeNull();

    await act(async () => {
      useHealthStore.setState({ lastError: new TransportError('offline') });
    });
    await show(runner());
    await fireEvent.press(screen.getByTestId('runner.close'));
    expect(screen.queryByText('Skip this workout')).toBeNull();
  });

  it('lists its answers in iOS order, Discard in red and Cancel last', () => {
    const t = (key: string) => key;
    const noop = () => undefined;
    const buttons = leaveButtons(t, {
      canSkipWorkout: true,
      onSaveAndFinish: noop,
      onLater: noop,
      onSkipWorkout: noop,
      onDiscard: noop,
    });
    expect(buttons.map((button) => [button.label, button.role ?? 'default'])).toEqual([
      ['runner.leave_save', 'default'],
      ['runner.leave_later', 'default'],
      ['runner.skip_workout', 'default'],
      ['runner.leave_discard', 'destructive'],
      ['common.cancel', 'cancel'],
    ]);
  });
});

describe('large text (font scale 2)', () => {
  it('stacks the controls and widens the fields', async () => {
    setTestFontScale(2);
    await show(runner());
    const field = StyleSheet.flatten(screen.getByTestId('runner.set.0.0.kg').props.style);
    expect(field.minWidth).toBe(96);
    // Label and check share the top line; the steppers are under them.
    expect(screen.getByTestId('runner.set.0.0.label')).toBeTruthy();
    expect(screen.getByTestId('runner.set.0.0.check')).toBeTruthy();
  });
});

describe('a session with no blocks', () => {
  it('shows only its title, the clock and Finish', async () => {
    await show(runner('[]'));
    expect(text('runner.exerciseName')).toBe('Full body strength');
    expect(text('runner.progress')).toBe('Exercise 1 of 1');
    expect(label('runner.primary')).toBe('Finish workout');
    expect(screen.queryByTestId('runner.finishSecondary')).toBeNull();
    expect(screen.queryByTestId('runner.nextSetLine')).toBeNull();
  });
});

describe('narrow phones (360 dp): what fits on one line', () => {
  function layout(testID: string, width: number): Promise<void> {
    return fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 64 } } });
  }

  it('a set with a kg column stacks under its label, the two steppers side by side where they fit', async () => {
    await show(runner());
    // Before anything is measured: the stacked row, controls side by side.
    expect(screen.getByTestId('runner.set.0.0.stacked')).toBeTruthy();
    await layout('runner.set.0.0.doseControl', 140);
    await layout('runner.set.0.0.kgControl', 140);
    // 360 dp less the page's 20 + 20, the row's 3 + 3 margin and 12 + 12 padding: 290 inside.
    await layout('runner.set.0.0', 314);
    expect(screen.getByTestId('runner.set.0.0.controlsSideBySide')).toBeTruthy();
    await layout('runner.set.0.1.doseControl', 140);
    await layout('runner.set.0.1.kgControl', 152);
    await layout('runner.set.0.1', 314);
    expect(screen.getByTestId('runner.set.0.1.controlsStacked')).toBeTruthy();
    // A wide tablet: everything on one line.
    await layout('runner.set.0.2.doseControl', 140);
    await layout('runner.set.0.2.kgControl', 140);
    await layout('runner.set.0.2', 440);
    expect(screen.getByTestId('runner.set.0.2.oneLine')).toBeTruthy();
  });

  it('a set without one stays on one line', async () => {
    const controller = runner();
    controller.advance();
    await show(controller);
    expect(screen.getByTestId('runner.set.1.0.oneLine')).toBeTruthy();
    await layout('runner.set.1.0.doseControl', 140);
    await layout('runner.set.1.0', 314);
    expect(screen.getByTestId('runner.set.1.0.oneLine')).toBeTruthy();
  });

  it('the rest bar puts the countdown over its buttons unless the line holds both', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.primary'));
    const direction = () => StyleSheet.flatten(screen.getByTestId('runner.restBar').props.style).flexDirection;
    expect(direction()).toBeUndefined();
    await layout('runner.restBar.countdownPart', 140);
    await layout('runner.restBar.buttons', 218);
    await layout('runner.restBar', 360);
    expect(direction()).toBeUndefined();
    // 140 + 4 + 218 and two gaps of 10, inside 16 + 16 padding: 414.
    await layout('runner.restBar', 414);
    expect(direction()).toBe('row');
  });
});
