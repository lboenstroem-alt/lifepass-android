/**
 * "Skip this workout" with a reason (iOS `OP-20`, 7.8): what the skip sends,
 * what each answer does (the runner analysis: a 409 closes for a reload, no
 * network says "This needs a connection."), the sheet in English and
 * Icelandic, and the whole way from the Leave dialog on the runner page.
 * Where Skip this workout is offered (before any set, a skippable session,
 * online) is RUN-2's Leave dialog, tested there.
 */
import { api, Reply } from '@test/server';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { DecodingError, NotAuthenticatedError, ProblemError, TransportError } from '../../../../api/errors';
import { expectSentToMatchContract, stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import * as localStore from '../../../../health/localStore';
import { decodeHealthDay, decodeSessionActionResponse, type SessionActionResponse, type SkipReason } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { setCurrentLanguage } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { session, t0 } from '../../model/__tests__/fixtures';
import { liveWorkoutSessionPosting, setWorkoutSessionPosting, type WorkoutSessionPosting } from '../../outbox/posting';
import { loadRunner } from '../../persistence/runnerStore';
import type { RunnerRestAlerting } from '../../restNotification';
import { RunnerController, type RunnerCloseResult } from '../../screen/controller';
import WorkoutRunnerView from '../../screen/WorkoutRunnerView';
import SkipWorkoutSheet from '../SkipWorkoutSheet';
import { SKIP_WORKOUT_REASONS, SkipWorkoutFlow } from '../skipWorkoutFlow';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
// expo-font (under @expo/vector-icons) needs expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const SESSION = '0d6f7a52-6c1e-4c38-9a51-6a3b7f1e2a01';
const TODAY = '2026-09-16';

const alerts: RunnerRestAlerting = { schedule: () => undefined, cancel: () => undefined, announce: () => undefined };
let events: { event: string; params: AnalyticsParams }[] = [];
let closes: RunnerCloseResult[] = [];

function skipped(): SessionActionResponse {
  return decodeSessionActionResponse({
    session: { id: 'sess-1', scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', status: 'skipped', skipReason: 'tired' },
    changed: [],
    replayed: false,
  });
}

function problem(slug: string, status: number, reason?: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status, ...(reason ? { reason } : {}) }, status);
}

/** Records the skips; answers from a list (an error to throw, or the skipped session). */
class SkipPosting implements WorkoutSessionPosting {
  skips: { sessionId: string; reason: SkipReason; key: string }[] = [];
  answers: (Error | null)[] = [];
  release: (() => void) | null = null;
  hold = false;
  async done(): Promise<SessionActionResponse> {
    return skipped();
  }
  async skip(sessionId: string, reason: SkipReason, key: string): Promise<SessionActionResponse> {
    this.skips.push({ sessionId, reason, key });
    if (this.hold) await new Promise<void>((resolve) => (this.release = resolve));
    const next = this.answers.shift() ?? null;
    if (next) throw next;
    return skipped();
  }
  async swapForRestOfPlan(): Promise<SessionActionResponse> {
    return skipped();
  }
}

function seedToday(access = 'entitled'): void {
  useHealthStore.setState({
    today: decodeHealthDay({
      contractVersion: '2026-09-v1',
      date: TODAY,
      today: TODAY,
      locale: 'en',
      access,
      day: {
        date: TODAY,
        relative: 'today',
        session: { id: 'sess-1', scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', status: 'planned' },
      },
      week: { weekNo: 1, planned: 3, done: 0 },
      upcoming: [],
    }),
    profileId: MEMBER,
  });
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
    today: TODAY,
  });
  controller.onClose = (result) => closes.push(result);
  controller.appeared();
  return controller;
}

function flow(controller: RunnerController, posting: SkipPosting): SkipWorkoutFlow {
  let keys = 0;
  return new SkipWorkoutFlow(controller, {
    posting: () => posting,
    mintKey: () => {
      keys += 1;
      return `skip-key-${keys}`;
    },
  });
}

beforeEach(() => {
  events = [];
  closes = [];
  bottomSheetMock.reset();
  resetAppStoreForTests();
  resetHealthStoreForTests();
  setCurrentLanguage('en');
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setWorkoutSessionPosting(null);
  await localStore.settled();
});

describe('the skip', () => {
  it('went through: the reason under a fresh key, counted without it, the day updated, the file gone, closed', async () => {
    seedToday();
    const controller = runner();
    const posting = new SkipPosting();
    await flow(controller, posting).skip('tired');
    expect(posting.skips).toEqual([{ sessionId: 'sess-1', reason: 'tired', key: 'skip-key-1' }]);
    expect(events.filter((e) => e.event === 'workout_skipped')).toEqual([{ event: 'workout_skipped', params: {} }]);
    expect(closes).toEqual([{ kind: 'skipped', response: expect.objectContaining({ replayed: false }) }]);
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('skipped');
    await localStore.settled();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('an answer that cannot be applied on this phone still closes as skipped', async () => {
    seedToday();
    const controller = runner();
    const posting = new SkipPosting();
    const skip = flow(controller, posting);
    const applyActionResult = useHealthStore.getState().applyActionResult;
    useHealthStore.setState({
      applyActionResult: () => {
        throw new Error('an unexpected row');
      },
    });
    try {
      await skip.skip('tired');
    } finally {
      useHealthStore.setState({ applyActionResult });
    }
    expect(closes).toEqual([{ kind: 'skipped', response: expect.anything() }]);
    expect(skip.getSnapshot()).toEqual({ isSkipping: false, errorKey: null });
    expect(events.filter((e) => e.event === 'service_error').map((e) => e.params.op)).toEqual(['runner_apply_answer']);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('no network: "This needs a connection.", and the runner stays', async () => {
    const controller = runner();
    const posting = new SkipPosting();
    posting.answers.push(new TransportError('offline'));
    const skip = flow(controller, posting);
    await skip.skip('time');
    expect(skip.getSnapshot()).toEqual({ isSkipping: false, errorKey: 'health.offline.action_hint' });
    expect(closes).toEqual([]);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).not.toBeNull();
  });

  it('409 session_action_not_allowed: changed elsewhere, so the runner closes and Plan reads again', async () => {
    const controller = runner();
    const posting = new SkipPosting();
    posting.answers.push(problem('session_action_not_allowed', 409, 'not_planned'));
    await flow(controller, posting).skip('sore');
    expect(closes).toEqual([{ kind: 'needsReload' }]);
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
  });

  it('the gate, and consent while entitled, close for a reload too', async () => {
    seedToday();
    for (const error of [problem('no_active_plan_or_pass', 403), problem('health_consent_required', 409)]) {
      closes = [];
      const posting = new SkipPosting();
      posting.answers.push(error);
      await flow(runner(), posting).skip('other');
      expect(closes).toEqual([{ kind: 'needsReload' }]);
    }
  });

  it('anything else: "Something went wrong."', async () => {
    for (const error of [problem('validation_failed', 400), new DecodingError('<html>'), new Error('boom')]) {
      closes = [];
      const controller = runner();
      const posting = new SkipPosting();
      posting.answers.push(error);
      const skip = flow(controller, posting);
      await skip.skip('time');
      expect(skip.getSnapshot().errorKey).toBe('common.error_body');
      expect(closes).toEqual([]);
    }
  });

  it('cancelled, or signed out: nothing to say', async () => {
    for (const error of [new TransportError('cancelled'), new NotAuthenticatedError()]) {
      const controller = runner();
      const posting = new SkipPosting();
      posting.answers.push(error);
      const skip = flow(controller, posting);
      await skip.skip('time');
      expect(skip.getSnapshot()).toEqual({ isSkipping: false, errorKey: null });
    }
  });

  it('one skip at a time; a new sheet starts without the last error', async () => {
    const controller = runner();
    const posting = new SkipPosting();
    posting.hold = true;
    posting.answers.push(new TransportError('offline'));
    const skip = flow(controller, posting);
    const first = skip.skip('time');
    expect(skip.getSnapshot().isSkipping).toBe(true);
    await skip.skip('tired');
    posting.release?.();
    await first;
    expect(posting.skips).toHaveLength(1);
    expect(skip.getSnapshot().errorKey).toBe('health.offline.action_hint');
    skip.reset();
    expect(skip.getSnapshot().errorKey).toBeNull();
  });

  it('the wire: action skip with the reason', async () => {
    api.on('POST', '/health/sessions/:id', Reply.ok({ session: null, changed: [], replayed: false }));
    await liveWorkoutSessionPosting.skip(SESSION, 'tired', 'skip-key-0001');
    const sent = expectSentToMatchContract('POST', `/health/sessions/${SESSION}`);
    expect(sent.body).toEqual({ action: 'skip', skipReason: 'tired' });
    expect(sent.headers['idempotency-key']).toBe('skip-key-0001');
  });

  it("the reasons are the server's four member reasons, in the No energy sheet's order", () => {
    expect(SKIP_WORKOUT_REASONS).toEqual(['time', 'tired', 'sore', 'other']);
  });
});

describe('the sheet', () => {
  async function show(posting = new SkipPosting()): Promise<{ controller: RunnerController; onClose: jest.Mock }> {
    const controller = runner();
    const onClose = jest.fn();
    await render(
      <UiKitProvider>
        <SkipWorkoutSheet visible flow={flow(controller, posting)} onClose={onClose} />
      </UiKitProvider>,
    );
    return { controller, onClose };
  }

  it('asks what got in the way; Skip workout is off until a reason is chosen', async () => {
    await show();
    expect(screen.getByText('What got in the way?')).toBeTruthy();
    expect(screen.getByText('Your plan carries on as it is. Nothing else moves.')).toBeTruthy();
    expect(['No time', 'Tired', 'Sore', 'Something else'].map((label) => screen.getByText(label))).toHaveLength(4);
    expect(screen.getByTestId('skip.confirm').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('skip.reason.sore'));
    expect(screen.getByTestId('skip.reason.sore').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('skip.confirm').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('skip.confirm').props.accessibilityLabel).toBe('Skip workout');
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    await show();
    expect(screen.getByText('Hvað kom í veg fyrir það?')).toBeTruthy();
    expect(screen.getByText('Áætlunin heldur áfram eins og hún er. Ekkert annað færist til.')).toBeTruthy();
    expect(['Enginn tími', 'Þreyta', 'Harðsperrur', 'Eitthvað annað'].map((label) => screen.getByText(label))).toHaveLength(4);
    expect(screen.getByTestId('skip.confirm').props.accessibilityLabel).toBe('Sleppa æfingunni');
  });

  it('while the skip is in flight: the spinner, and neither button can be pressed again', async () => {
    const posting = new SkipPosting();
    posting.hold = true;
    await show(posting);
    await fireEvent.press(screen.getByTestId('skip.reason.time'));
    await fireEvent.press(screen.getByTestId('skip.confirm'));
    expect(screen.getByTestId('skip.confirm.spinner')).toBeTruthy();
    expect(screen.getByTestId('skip.confirm').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('skip.cancel').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => posting.release?.());
    expect(closes).toEqual([{ kind: 'skipped', response: expect.anything() }]);
  });

  it('says why a skip did not go through', async () => {
    const posting = new SkipPosting();
    posting.answers.push(new TransportError('offline'));
    await show(posting);
    await fireEvent.press(screen.getByTestId('skip.reason.time'));
    await fireEvent.press(screen.getByTestId('skip.confirm'));
    expect(screen.getByText('This needs a connection.')).toBeTruthy();
  });

  it('Cancel closes it', async () => {
    const { onClose } = await show();
    await fireEvent.press(screen.getByTestId('skip.cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('from the Leave dialog', () => {
  it('Skip this workout, a reason, Skip workout: the runner closes as skipped', async () => {
    const posting = new SkipPosting();
    setWorkoutSessionPosting(posting);
    const controller = runner();
    await render(
      <UiKitProvider>
        <WorkoutRunnerView controller={controller} />
      </UiKitProvider>,
    );
    await fireEvent.press(screen.getByTestId('runner.close'));
    await fireEvent.press(screen.getByText('Skip this workout'));
    await fireEvent.press(screen.getByTestId('skip.reason.tired'));
    await fireEvent.press(screen.getByTestId('skip.confirm'));
    expect(posting.skips.map((s) => s.reason)).toEqual(['tired']);
    expect(closes).toEqual([{ kind: 'skipped', response: expect.anything() }]);
    // The sheet leaves with the runner.
    expect(screen.queryByTestId('skip.confirm')).toBeNull();
  });
});
