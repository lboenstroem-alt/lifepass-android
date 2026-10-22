/**
 * Finishing a workout (iOS 7.7): the Save the finish sheet sends and what
 * each answer does, carried out against the real runner file and workout
 * outbox (an in-memory disk), with the session calls standing in for the
 * server. The iOS cases: the key minted once per sheet and kept across a
 * relaunch, the moment fixed at the first attempt, "Save as extra" with a
 * new key, the one reused-key retry, the gate keeping the file, consent, the
 * outbox fallback, and the summary counted in both languages
 * (testTheSummaryIsCountedInBothLanguages).
 */
import { NotAuthenticatedError, ProblemError, TransportError } from '../../../../api/errors';
import * as localStore from '../../../../health/localStore';
import { decodeHealthDay, decodeSessionActionResponse, type SessionActionResponse, type SkipReason } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { RunnerFormat } from '../../../../i18n/runnerFormat';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetAppStoreForTests } from '../../../../stores/appStore';
import { at, session, t0 } from '../../model/__tests__/fixtures';
import type { WorkoutDoneBody } from '../../model/performed';
import { resetWorkoutOutboxForTests, useWorkoutOutbox, enqueueWorkout } from '../../outbox/workoutOutbox';
import type { WorkoutSessionPosting } from '../../outbox/posting';
import { RunnerProgressIndex } from '../../persistence/progressIndex';
import { loadRunner } from '../../persistence/runnerStore';
import type { RunnerRestAlerting } from '../../restNotification';
import { RunnerController, type RunnerCloseResult } from '../../screen/controller';
import { FinishFlow, finishFlowFor } from '../finishFlow';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const TODAY = '2026-09-16';

let clockNow = t0;
let events: { event: string; params: AnalyticsParams }[] = [];
let keys = 0;

const alerts: RunnerRestAlerting = { schedule: () => undefined, cancel: () => undefined, announce: () => undefined };

function mint(): string {
  keys += 1;
  return `key-${keys}`;
}

interface Sent {
  readonly sessionId: string;
  readonly body: WorkoutDoneBody;
  readonly key: string;
  /** What runner.json held when the request went out. */
  readonly onDisk: { finishKey: string | null; completedAt: Date | null } | null;
}

/** The session calls, answering from a list (a function per call, or an error to throw). */
class StubPosting implements WorkoutSessionPosting {
  sent: Sent[] = [];
  answers: ((body: WorkoutDoneBody) => SessionActionResponse | Error)[] = [];

  async done(sessionId: string, body: WorkoutDoneBody, key: string): Promise<SessionActionResponse> {
    const file = await loadRunner(MEMBER);
    this.sent.push({
      sessionId,
      body,
      key,
      onDisk: file ? { finishKey: file.finishKey, completedAt: file.completedAt } : null,
    });
    const next = this.answers.shift() ?? (() => answer('done'));
    const result = next(body);
    if (result instanceof Error) throw result;
    return result;
  }

  async skip(_sessionId: string, _reason: SkipReason): Promise<SessionActionResponse> {
    return answer('skipped');
  }

  async swapForRestOfPlan(): Promise<SessionActionResponse> {
    return answer('planned');
  }
}

function answer(status: string, scheduledFor = TODAY): SessionActionResponse {
  return decodeSessionActionResponse({
    session: { id: 'sess-1', scheduledFor, kind: 'strength', title: 'Full body strength', status },
    changed: [],
    replayed: false,
  });
}

function problem(slug: string, status: number, reason?: string): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status, ...(reason ? { reason } : {}) }, status);
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
    clock: () => clockNow,
    today: TODAY,
  });
  controller.onClose = (result) => closes.push(result);
  controller.appeared();
  return { controller, closes };
}

function flowFor(controller: RunnerController, posting: StubPosting): FinishFlow {
  return new FinishFlow(controller, { posting: () => posting, mintKey: mint, clock: () => clockNow });
}

function finished(): AnalyticsParams[] {
  return events.filter((e) => e.event === 'workout_finished').map((e) => e.params);
}

beforeEach(() => {
  clockNow = t0;
  keys = 0;
  events = [];
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetWorkoutOutboxForTests();
  RunnerProgressIndex.reset();
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  await localStore.settled();
});

describe('the sheet opens', () => {
  it('mints the key once and writes it down; a reopening keeps it', async () => {
    const { controller } = runner();
    const flow = flowFor(controller, new StubPosting());
    flow.prepare();
    expect(controller.state.finishKey).toBe('key-1');
    expect((await loadRunner(MEMBER))?.finishKey).toBe('key-1');
    flow.prepare();
    expect(controller.state.finishKey).toBe('key-1');
    expect(keys).toBe(1);
  });

  it('and after a relaunch: the runner read back from the file keeps the same key', async () => {
    const { controller } = runner();
    flowFor(controller, new StubPosting()).prepare();
    await localStore.settled();
    const saved = await loadRunner(MEMBER);
    const relaunched = new RunnerController({
      session: session(),
      restored: saved,
      profileId: MEMBER,
      language: 'en',
      entry: 'today',
      alerts,
      keepAwake: () => undefined,
      clock: () => clockNow,
      today: TODAY,
    });
    flowFor(relaunched, new StubPosting()).prepare();
    expect(relaunched.state.finishKey).toBe('key-1');
    expect(keys).toBe(1);
  });

  it('prefills the minutes from the active clock, rounded to five, and steps them within 5 and 180', () => {
    const { controller } = runner();
    const flow = flowFor(controller, new StubPosting());
    clockNow = at(37 * 60);
    flow.prepare();
    expect(flow.getSnapshot().minutes).toBe(35);
    flow.stepMinutes(1);
    expect(flow.getSnapshot().minutes).toBe(40);
    for (let i = 0; i < 50; i += 1) flow.stepMinutes(-1);
    expect(flow.getSnapshot().minutes).toBe(5);
    for (let i = 0; i < 50; i += 1) flow.stepMinutes(1);
    expect(flow.getSnapshot().minutes).toBe(180);
  });

  it('the feeling is optional: a second tap takes it back', () => {
    const { controller } = runner();
    const flow = flowFor(controller, new StubPosting());
    flow.toggleFeeling('hard');
    expect(flow.getSnapshot().feeling).toBe('hard');
    flow.toggleFeeling('ok');
    expect(flow.getSnapshot().feeling).toBe('ok');
    flow.toggleFeeling('ok');
    expect(flow.getSnapshot().feeling).toBeNull();
  });

  it('a refusal from an earlier attempt is not the answer to this one', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('rate_limited', 429));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(flow.status).toEqual({ kind: 'failed', messageKey: 'health.err.rate_limited' });
    flow.prepare();
    expect(flow.status).toEqual({ kind: 'idle' });
  });

  it('one flow per runner, so a feeling survives "Keep going"', () => {
    const { controller } = runner();
    finishFlowFor(controller).toggleFeeling('easy');
    expect(finishFlowFor(controller).getSnapshot().feeling).toBe('easy');
    expect(finishFlowFor(runner().controller).getSnapshot().feeling).toBeNull();
  });
});

describe('Save', () => {
  it('sends the done body under the key, with the moment and the key on disk BEFORE the request', async () => {
    seedToday();
    const { controller, closes } = runner();
    controller.completeNextSet();
    const posting = new StubPosting();
    const flow = flowFor(controller, posting);
    clockNow = at(31 * 60);
    flow.prepare();
    flow.toggleFeeling('ok');
    await flow.save();

    expect(posting.sent).toHaveLength(1);
    const [sent] = posting.sent;
    expect(sent!.key).toBe('key-1');
    expect(sent!.onDisk).toEqual({ finishKey: 'key-1', completedAt: at(31 * 60) });
    expect(sent!.body.action).toBe('done');
    expect(sent!.body.minutes).toBe(30);
    expect(sent!.body.feeling).toBe('ok');
    expect(sent!.body.clientCompletedAt).toEqual(at(31 * 60));
    expect(sent!.body.asExtra).toBeUndefined();
    expect(sent!.body.performed?.[0]?.sets[0]).toEqual({ reps: 10, kg: 12.5, done: true });

    expect(closes).toEqual([{ kind: 'saved', response: expect.objectContaining({ replayed: false }) }]);
    expect(finished()).toEqual([{ outcome: 'saved', feeling_given: true }]);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).toBeNull();
    // The answer is on the day before Plan reads again: Done, not Start.
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('done');
  });

  it('never sends a null: no feeling, no asExtra', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    const body = posting.sent[0]!.body;
    expect(Object.values(body)).not.toContain(null);
    expect('feeling' in body).toBe(false);
    expect('asExtra' in body).toBe(false);
    expect(finished()).toEqual([{ outcome: 'saved', feeling_given: false }]);
  });

  it('a second tap while saving sends nothing more', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    const flow = flowFor(controller, posting);
    flow.prepare();
    const first = flow.save();
    expect(flow.isSaving).toBe(true);
    await flow.save();
    await first;
    expect(posting.sent).toHaveLength(1);
  });

  it('the moment is fixed at the first attempt: a retry later carries the same one', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => new Error('decoding'));
    const flow = flowFor(controller, posting);
    flow.prepare();
    clockNow = at(10 * 60);
    await flow.save();
    expect(flow.status).toEqual({ kind: 'failed', messageKey: 'runner.err.not_saved' });
    clockNow = at(25 * 60);
    await flow.save();
    expect(posting.sent.map((s) => s.body.clientCompletedAt)).toEqual([at(10 * 60), at(10 * 60)]);
    expect(posting.sent.map((s) => s.key)).toEqual(['key-1', 'key-1']);
  });
});

describe('what each answer does (7.7)', () => {
  it('no network: queued in the outbox (on disk), runner.json goes, "Saved on this phone", closed as queued', async () => {
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => new TransportError('offline'));
    const flow = flowFor(controller, posting);
    flow.prepare();
    flow.toggleFeeling('easy');
    await flow.save();
    expect(closes).toEqual([{ kind: 'queued' }]);
    expect(useHealthStore.getState().toastKey).toBe('health.saved_offline');
    expect(finished()).toEqual([{ outcome: 'outbox', feeling_given: true }]);
    const items = useWorkoutOutbox.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sessionId: 'sess-1', key: 'key-1', state: 'pending' });
    expect(items[0]!.body).toEqual(posting.sent[0]!.body);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).toBeNull();
  });

  it('no network and five already waiting: nothing is lost, the sheet says why', async () => {
    for (let i = 0; i < 5; i += 1) {
      await enqueueWorkout({ sessionId: `old-${i}`, body: { action: 'done', minutes: 20 }, key: `k-${i}`, profileId: MEMBER });
    }
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => new TransportError('timeout'));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(flow.status).toEqual({ kind: 'failed', messageKey: 'runner.err.outbox_full' });
    expect(closes).toEqual([]);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).not.toBeNull();
  });

  it('moved on another device: "Save as extra?", which sends the same body and moment under a NEW key', async () => {
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('session_action_not_allowed', 409, 'not_planned'));
    const flow = flowFor(controller, posting);
    flow.prepare();
    clockNow = at(20 * 60);
    await flow.save();
    expect(flow.status).toEqual({ kind: 'askSaveAsExtra' });
    clockNow = at(22 * 60);
    await flow.saveAsExtra();
    const [first, extra] = posting.sent;
    expect(extra!.key).not.toBe(first!.key);
    expect(extra!.onDisk?.finishKey).toBe(extra!.key);
    expect(extra!.body).toEqual({ ...first!.body, asExtra: true });
    expect(extra!.body.clientCompletedAt).toEqual(at(20 * 60));
    expect(closes).toEqual([{ kind: 'saved', response: expect.anything() }]);
    expect(finished()).toEqual([{ outcome: 'extra', feeling_given: false }]);
  });

  it('Cancel on the question leaves the sheet as it was', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('health_session_not_found', 404));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(flow.status.kind).toBe('askSaveAsExtra');
    flow.dismissSaveAsExtra();
    expect(flow.status).toEqual({ kind: 'idle' });
  });

  it('an extra whose row has gone is not asked about again: the sheet says it was not saved', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('health_session_not_found', 404), () => problem('health_session_not_found', 404));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    await flow.saveAsExtra();
    expect(flow.status).toEqual({ kind: 'failed', messageKey: 'runner.err.not_saved' });
  });

  it('the plan was paused or ended: Save is off, the file stays, and "Finish later today" closes as later', async () => {
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('session_action_not_allowed', 409, 'program_not_active'));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(flow.status).toEqual({ kind: 'notActive' });
    expect(finished()).toEqual([{ outcome: 'not_active', feeling_given: false }]);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).not.toBeNull();
    flow.leaveLater();
    expect(closes).toEqual([{ kind: 'later' }]);
  });

  it('a reused key: a new key, once; reused again, the sheet says so', async () => {
    const { controller } = runner();
    const posting = new StubPosting();
    posting.answers.push(
      () => problem('idempotency_key_reused', 422),
      () => problem('idempotency-key-reused', 422),
    );
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(posting.sent.map((s) => s.key)).toEqual(['key-1', 'key-2']);
    expect(flow.status).toEqual({ kind: 'failed', messageKey: 'common.error_body' });
  });

  it('the gate: the store shows it, the runner closes for a reload, and the file is KEPT', async () => {
    seedToday();
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('no_active_plan_or_pass', 403));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(closes).toEqual([{ kind: 'needsReload' }]);
    await localStore.settled();
    expect(await loadRunner(MEMBER)).not.toBeNull();
  });

  it('consent while entitled: the consent sheet, and Save runs again after it', async () => {
    seedToday('entitled');
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('health_consent_required', 409));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(flow.getSnapshot().needsConsent).toBe(true);
    expect(flow.status).toEqual({ kind: 'idle' });
    expect(closes).toEqual([]);
    flow.consentShown();
    expect(flow.getSnapshot().needsConsent).toBe(false);
    await flow.save();
    expect(posting.sent.map((s) => s.key)).toEqual(['key-1', 'key-1']);
    expect(closes).toEqual([{ kind: 'saved', response: expect.anything() }]);
  });

  it('consent when not entitled: the reconcile decides, and the runner closes for a reload', async () => {
    seedToday('free');
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => problem('health_consent_required', 409));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(flow.getSnapshot().needsConsent).toBe(false);
    expect(closes).toEqual([{ kind: 'needsReload' }]);
  });

  it('too many changes, a pending deletion, anything new: the sheet says why and the file stays', async () => {
    const cases: [Error, string][] = [
      [problem('rate_limited', 429), 'health.err.rate_limited'],
      [problem('account_pending_deletion', 409), 'health.err.pending_deletion'],
      [problem('session_action_not_allowed', 409, 'no_session_on_date'), 'runner.err.not_saved'],
      [problem('something_new', 400), 'runner.err.not_saved'],
    ];
    for (const [error, key] of cases) {
      const { controller, closes } = runner();
      const posting = new StubPosting();
      posting.answers.push(() => error);
      const flow = flowFor(controller, posting);
      flow.prepare();
      await flow.save();
      expect(flow.status).toEqual({ kind: 'failed', messageKey: key });
      expect(closes).toEqual([]);
    }
  });

  it('cancelled, or signed out: nothing to say', async () => {
    for (const error of [new TransportError('cancelled'), new NotAuthenticatedError()]) {
      const { controller, closes } = runner();
      const posting = new StubPosting();
      posting.answers.push(() => error);
      const flow = flowFor(controller, posting);
      flow.prepare();
      await flow.save();
      expect(flow.status).toEqual({ kind: 'idle' });
      expect(closes).toEqual([]);
    }
  });

  it('a runner that closed meanwhile (the local wipe) applies nothing of the answer', async () => {
    seedToday();
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => {
      controller.wiped();
      return answer('done');
    });
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(closes).toEqual([{ kind: 'discarded' }]);
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('planned');
    expect(finished()).toEqual([]);
  });

  it('"Do it now" on last week\'s row: its answer does not replace today', async () => {
    seedToday();
    const { controller, closes } = runner();
    const posting = new StubPosting();
    posting.answers.push(() => answer('done', '2026-09-09'));
    const flow = flowFor(controller, posting);
    flow.prepare();
    await flow.save();
    expect(closes[0]?.kind).toBe('saved');
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('planned');
  });
});

describe('the summary line', () => {
  it('testTheSummaryIsCountedInBothLanguages', () => {
    expect(RunnerFormat.summary({ exercises: 1, total: 4, sets: 1 }, 'en')).toBe('1 of 4 exercises · 1 set');
    expect(RunnerFormat.summary({ exercises: 1, total: 1, sets: 3 }, 'en')).toBe('1 of 1 exercise · 3 sets');
    expect(RunnerFormat.summary({ exercises: 0, total: 4, sets: 0 }, 'en')).toBe('0 of 4 exercises · 0 sets');
    expect(RunnerFormat.summary({ exercises: 2, total: 4, sets: 5 }, 'is')).toBe('2 af 4 æfingum · 5 sett');
    expect(RunnerFormat.summary({ exercises: 1, total: 1, sets: 1 }, 'is')).toBe('1 af 1 æfingu · 1 sett');
    expect(RunnerFormat.summary({ exercises: 3, total: 21, sets: 21 }, 'is')).toBe('3 af 21 æfingu · 21 sett');
  });
});
