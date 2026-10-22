/**
 * The finish sheet on the runner page, end to end against a stub server: the
 * iOS RunnerFixtures modes (`-LPRunnerStub ok | offline | offline-then-online
 * | changed | notactive`) driven through the same taps a member makes, plus
 * what the sheet says in English and Icelandic, what TalkBack hears, and the
 * sheet at a font scale of 2.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TransportError, ProblemError } from '../../../../api/errors';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import * as localStore from '../../../../health/localStore';
import { decodeSessionActionResponse, type SessionActionResponse } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { session, t0 } from '../../model/__tests__/fixtures';
import type { WorkoutDoneBody } from '../../model/performed';
import { setWorkoutSessionPosting, type WorkoutSessionPosting } from '../../outbox/posting';
import { flushWorkoutOutbox, resetWorkoutOutboxForTests, useWorkoutOutbox } from '../../outbox/workoutOutbox';
import { RunnerProgressIndex } from '../../persistence/progressIndex';
import { loadRunner } from '../../persistence/runnerStore';
import type { RunnerRestAlerting } from '../../restNotification';
import { RunnerController, type RunnerCloseResult } from '../../screen/controller';
import WorkoutRunnerView from '../../screen/WorkoutRunnerView';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
// expo-font (under @expo/vector-icons) needs expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

let clockNow = t0;
let closes: RunnerCloseResult[] = [];
let events: { event: string; params: AnalyticsParams }[] = [];

const alerts: RunnerRestAlerting = { schedule: () => undefined, cancel: () => undefined, announce: () => undefined };

/**
 * The iOS fixture server (`FixtureWorkoutSessionPosting`): `offline` never
 * answers, `offline-then-online` answers once the app has been away,
 * `changed` refuses a Save that is not an extra, `notactive` says the plan is
 * paused. Otherwise it answers with the session saved.
 */
class FixturePosting implements WorkoutSessionPosting {
  hasBeenAway = false;
  sent: { body: WorkoutDoneBody; key: string }[] = [];
  constructor(readonly mode: string) {}

  async done(sessionId: string, body: WorkoutDoneBody, key: string): Promise<SessionActionResponse> {
    this.sent.push({ body, key });
    if (this.mode === 'offline') throw new TransportError('offline');
    if (this.mode === 'offline-then-online' && !this.hasBeenAway) throw new TransportError('offline');
    if (this.mode === 'changed' && body.asExtra !== true) throw problem('session_action_not_allowed', 'not_planned');
    if (this.mode === 'notactive') throw problem('session_action_not_allowed', 'program_not_active');
    return response(sessionId, 'done');
  }

  async skip(sessionId: string): Promise<SessionActionResponse> {
    if (this.mode === 'offline') throw new TransportError('offline');
    return response(sessionId, 'skipped');
  }

  async swapForRestOfPlan(sessionId: string): Promise<SessionActionResponse> {
    return response(sessionId, 'planned');
  }
}

function problem(slug: string, reason: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status: 409, reason }, 409);
}

function response(sessionId: string, status: string): SessionActionResponse {
  return decodeSessionActionResponse({
    session: { id: sessionId, scheduledFor: '2026-09-16', kind: 'strength', title: 'Full body strength', status },
    changed: [],
    replayed: false,
  });
}

function runner(language: 'en' | 'is' = 'en'): RunnerController {
  const controller = new RunnerController({
    session: session(),
    restored: null,
    profileId: MEMBER,
    language,
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
  await render(
    <UiKitProvider>
      <WorkoutRunnerView controller={controller} />
    </UiKitProvider>,
  );
}

/** Two sets of the first exercise and one of the second, then "Finish workout". */
async function finishAfterSomeWork(controller: RunnerController): Promise<void> {
  await act(async () => {
    controller.completeNextSet();
    controller.skipRest();
    controller.completeNextSet();
    controller.skipRest();
    controller.advance();
    controller.completeNextSet();
    controller.skipRest();
  });
  clockNow = new Date(t0.getTime() + 33 * 60 * 1000);
  await fireEvent.press(screen.getByTestId('runner.finishSecondary'));
}

function text(testID: string): string {
  const node = screen.getByTestId(testID);
  return ([] as unknown[])
    .concat(node.props.children)
    .filter((child) => typeof child === 'string' || typeof child === 'number')
    .join('');
}

function finished(): AnalyticsParams[] {
  return events.filter((e) => e.event === 'workout_finished').map((e) => e.params);
}

beforeEach(() => {
  clockNow = t0;
  closes = [];
  events = [];
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetWorkoutOutboxForTests();
  RunnerProgressIndex.reset();
  setCurrentLanguage('en');
  setTestFontScale(1);
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setWorkoutSessionPosting(null);
  setAnalyticsObserver(null);
  restoreTestFontScale();
  await localStore.settled();
});

describe('the sheet', () => {
  it('reads as on iOS: title, the count, minutes, the feeling, Save and Keep going', async () => {
    setWorkoutSessionPosting(new FixturePosting('ok'));
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    expect(screen.getByText('Nice work')).toBeTruthy();
    expect(text('finish.summary')).toBe('2 of 5 exercises · 3 sets');
    expect(screen.getByText('Minutes', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('35 min')).toBeTruthy();
    expect(screen.getByText('How did it feel?')).toBeTruthy();
    expect(screen.getByText('Easy')).toBeTruthy();
    expect(screen.getByText('Just right')).toBeTruthy();
    expect(screen.getByText('Hard')).toBeTruthy();
    expect(screen.getByText('Too hard')).toBeTruthy();
    expect(screen.getByTestId('finish.save').props.accessibilityLabel).toBe('Save workout');
    expect(screen.getByTestId('finish.keepGoing').props.accessibilityLabel).toBe('Keep going');
    // The key is on the workout from the moment the sheet opened.
    expect(controller.state.finishKey).not.toBeNull();
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    const controller = runner('is');
    await show(controller);
    await finishAfterSomeWork(controller);
    expect(screen.getByText('Vel gert')).toBeTruthy();
    expect(text('finish.summary')).toBe('2 af 5 æfingum · 3 sett');
    expect(screen.getByText('35 mín')).toBeTruthy();
    expect(screen.getByText('Hvernig var þetta?')).toBeTruthy();
    expect(screen.getByTestId('finish.save').props.accessibilityLabel).toBe('Vista æfingu');
  });

  it('TalkBack: the minutes are adjustable, five at a time, and the feelings say which is chosen', async () => {
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    const minutes = screen.getByTestId('finish.minutes');
    expect(minutes.props.accessibilityRole).toBe('adjustable');
    expect(minutes.props.accessibilityLabel).toBe('Minutes');
    expect(minutes.props.accessibilityValue).toEqual({ text: '35 minutes' });
    await fireEvent(minutes, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('finish.minutes').props.accessibilityValue).toEqual({ text: '40 minutes' });
    await fireEvent(screen.getByTestId('finish.minutes'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('finish.minutes').props.accessibilityValue).toEqual({ text: '35 minutes' });
    expect(screen.getByTestId('finish.minutes.minus').props.accessibilityLabel).toBe('5 minutes less');
    expect(screen.getByTestId('finish.minutes.plus').props.accessibilityLabel).toBe('5 minutes more');

    await fireEvent.press(screen.getByTestId('finish.feeling.hard'));
    expect(screen.getByTestId('finish.feeling.hard').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('finish.feeling.easy').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('the minus is off at 5 minutes', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.finishSecondary'));
    expect(screen.getByText('5 min')).toBeTruthy();
    expect(screen.getByTestId('finish.minutes.minus').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('offline before a Save: it says the workout will wait on this phone', async () => {
    useHealthStore.setState({ lastError: new TransportError('offline') });
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.finishSecondary'));
    expect(screen.getByText("You're offline. The workout is saved on this phone and sent when you're back online.")).toBeTruthy();
  });

  it('Keep going closes the sheet and the workout goes on', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.finishSecondary'));
    await fireEvent.press(screen.getByTestId('finish.keepGoing'));
    expect(screen.queryByText('Nice work')).toBeNull();
    expect(closes).toEqual([]);
  });

  it('"Save and finish" in the Leave dialog opens it too', async () => {
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.close'));
    await fireEvent.press(screen.getByText('Save and finish'));
    expect(screen.getByText('Nice work')).toBeTruthy();
  });

  it('at a font scale of 2 every control is still there', async () => {
    setTestFontScale(2);
    const controller = runner();
    await show(controller);
    await fireEvent.press(screen.getByTestId('runner.finishSecondary'));
    expect(screen.getByTestId('finish.minutes.minus')).toBeTruthy();
    expect(screen.getByTestId('finish.minutes.plus')).toBeTruthy();
    expect(screen.getByTestId('finish.save')).toBeTruthy();
    expect(screen.getByTestId('finish.keepGoing')).toBeTruthy();
    expect(screen.getByTestId('finish.minutes.stacked')).toBeTruthy();
  });
});

describe('the stub server modes (iOS -LPRunnerStub)', () => {
  it('ok: saved, counted, the file gone, closed with the answer', async () => {
    const posting = new FixturePosting('ok');
    setWorkoutSessionPosting(posting);
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    await fireEvent.press(screen.getByTestId('finish.feeling.ok'));
    await fireEvent.press(screen.getByTestId('finish.save'));
    expect(posting.sent).toHaveLength(1);
    expect(posting.sent[0]!.body).toMatchObject({ action: 'done', minutes: 35, feeling: 'ok' });
    expect(closes).toEqual([{ kind: 'saved', response: expect.anything() }]);
    expect(finished()).toEqual([{ outcome: 'saved', feeling_given: true }]);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('offline: queued on this phone, the file gone, closed as queued', async () => {
    setWorkoutSessionPosting(new FixturePosting('offline'));
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    await fireEvent.press(screen.getByTestId('finish.save'));
    expect(closes).toEqual([{ kind: 'queued' }]);
    expect(useWorkoutOutbox.getState().items).toHaveLength(1);
    expect(finished()).toEqual([{ outcome: 'outbox', feeling_given: false }]);
  });

  it('offline then online: queued, then sent once the app has been away, under the same key', async () => {
    const posting = new FixturePosting('offline-then-online');
    setWorkoutSessionPosting(posting);
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    await fireEvent.press(screen.getByTestId('finish.save'));
    expect(closes).toEqual([{ kind: 'queued' }]);
    posting.hasBeenAway = true;
    await act(async () => {
      await flushWorkoutOutbox({ foreground: false });
    });
    expect(useWorkoutOutbox.getState().items).toEqual([]);
    expect(posting.sent.map((s) => s.key)).toEqual([posting.sent[0]!.key, posting.sent[0]!.key]);
    expect(posting.sent[1]!.body).toEqual(posting.sent[0]!.body);
  });

  it('changed: "Save what you did as an extra workout?", and Save as extra goes through', async () => {
    const posting = new FixturePosting('changed');
    setWorkoutSessionPosting(posting);
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    await fireEvent.press(screen.getByTestId('finish.save'));
    // The alert is its own window over the sheet (an RN Modal), outside the screens TalkBack is kept from.
    expect(
      screen.getByText('This workout was changed on another device. Save what you did as an extra workout?', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Save as extra', { includeHiddenElements: true }));
    expect(posting.sent).toHaveLength(2);
    expect(posting.sent[1]!.body.asExtra).toBe(true);
    expect(posting.sent[1]!.key).not.toBe(posting.sent[0]!.key);
    expect(closes).toEqual([{ kind: 'saved', response: expect.anything() }]);
    expect(finished()).toEqual([{ outcome: 'extra', feeling_given: false }]);
  });

  it('changed, then Cancel: back on the sheet, nothing sent again', async () => {
    const posting = new FixturePosting('changed');
    setWorkoutSessionPosting(posting);
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    await fireEvent.press(screen.getByTestId('finish.save'));
    await fireEvent.press(screen.getByTestId('finish.saveExtra.cancel', { includeHiddenElements: true }));
    expect(screen.queryByText('Save as extra', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('Nice work')).toBeTruthy();
    expect(posting.sent).toHaveLength(1);
  });

  it('notactive: the reason pinned above a greyed Save; "Finish later today" keeps the workout', async () => {
    setWorkoutSessionPosting(new FixturePosting('notactive'));
    const controller = runner();
    await show(controller);
    await finishAfterSomeWork(controller);
    await fireEvent.press(screen.getByTestId('finish.save'));
    expect(
      screen.getByText(
        "Your plan is paused or has ended, so this workout can't be saved to it. Resume the plan to save it.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('finish.save').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('finish.later'));
    expect(closes).toEqual([{ kind: 'later' }]);
    await localStore.settled();
    expect((await loadRunner(MEMBER))?.finishKey).not.toBeNull();
  });
});
