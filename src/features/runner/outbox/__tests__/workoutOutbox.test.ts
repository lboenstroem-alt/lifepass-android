/**
 * The workout outbox end to end: queued on disk per member, flushed through
 * the real API client against the stub server, and forgotten by the local
 * wipe. The port of iOS testAFlushedWorkoutGoesOntoTodayAsDone
 * (PlanSectionTests V4) and of OutboxAdoptionTests for the workout queue,
 * plus the flush table carried out (iOS 7.7) and the triggers.
 */
import { File } from 'expo-file-system';
import { fileSystemState } from '@test/mocks/expoFileSystem';
import { api, Reply, type StubRequest } from '@test/server';

import { stubApiClientPerTest, expectSentToMatchContract } from '../../../../api/testing';
import { decodeProfile, type Profile } from '../../../../api/profile';
import { runActivationHooks } from '../../../../app/signOut';
import * as localStore from '../../../../health/localStore';
import { decodeHealthDay, type SessionActionResponse } from '../../../../health/models';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { hasPendingWorkout, onRunnerWiped, RunnerProgressIndex, useRunnerProgress } from '../../index';
import { fresh, session, t0 } from '../../model/__tests__/fixtures';
import { workoutDoneBody, type WorkoutDoneBody } from '../../model/performed';
import { startRunnerState } from '../../model/state';
import { saveRunner } from '../../persistence/runnerStore';
import '../../register';
import { encodeWorkoutOutbox } from '../codec';
import { workoutPlanOutboxSource } from '../planSource';
import { setWorkoutSessionPosting, type WorkoutSessionPosting } from '../posting';
import type { WorkoutOutboxItem } from '../rules';
import {
  activateWorkoutOutbox,
  discardWorkoutItem,
  enqueueWorkout,
  failedWorkoutItems,
  flushWorkoutOutbox,
  hasPendingWorkoutNow,
  resetWorkoutOutboxForTests,
  saveFailedWorkoutAsExtra,
  selectHasPendingWorkout,
  useWorkoutOutbox,
} from '../workoutOutbox';

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';
const SESSION = '0d6f7a52-6c1e-4c38-9a51-6a3b7f1e2a01';
const SESSION_2 = '0d6f7a52-6c1e-4c38-9a51-6a3b7f1e2a02';
const OUTBOX = `health/${MEMBER}/outbox.json`;
const TODAY = todayServerDay();
const DAY_MS = 86_400_000;

const store = () => useWorkoutOutbox.getState();

let events: { event: string; params: AnalyticsParams }[] = [];

function body(extra: Partial<Parameters<typeof workoutDoneBody>[0]> = {}): WorkoutDoneBody {
  return workoutDoneBody({ minutes: 30, feeling: 'ok', clientCompletedAt: t0, ...extra });
}

function profile(health: Record<string, unknown> | null = { access: 'entitled', consent: { version: '2026-09-v1' } }): Profile {
  return decodeProfile({
    id: MEMBER,
    email: 'member@example.com',
    locale: 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    ...(health === null ? {} : { health }),
  });
}

function sessionJSON(id: string, status: string): Record<string, unknown> {
  return { id, scheduledFor: TODAY, kind: 'strength', title: 'Full body strength', status };
}

function dayJSON(status = 'planned', sessionId = SESSION): Record<string, unknown> {
  return {
    contractVersion: '2026-09-v1',
    date: TODAY,
    today: TODAY,
    locale: 'en',
    access: 'entitled',
    day: { date: TODAY, relative: 'today', session: sessionJSON(sessionId, status) },
    week: { weekNo: 1, planned: 3, done: 0 },
    upcoming: [],
  };
}

/** Today in memory, as Plan or Home last read it. */
function seedToday(status = 'planned', access = 'entitled'): void {
  useHealthStore.setState({ today: decodeHealthDay({ ...dayJSON(status), access }), profileId: MEMBER });
}

function doneAnswer(sessionId = SESSION): Record<string, unknown> {
  return { session: sessionJSON(sessionId, 'done'), changed: [], upcoming: [], replayed: false };
}

function sessionPath(id = SESSION): string {
  return `/health/sessions/${id}`;
}

function sentTo(id = SESSION): StubRequest[] {
  return api.sentAll(sessionPath(id), 'POST');
}

function onDisk(profileId = MEMBER): { id: string; state: string; key: string; converted: boolean }[] | null {
  const text = fileSystemState.read(`health/${profileId}/outbox.json`);
  return text === null ? null : (JSON.parse(text) as { id: string; state: string; key: string; converted: boolean }[]);
}

function seedQueue(items: WorkoutOutboxItem[], profileId = MEMBER): void {
  fileSystemState.seed(`health/${profileId}/outbox.json`, encodeWorkoutOutbox(items));
}

function queued(id: string, overrides: Partial<WorkoutOutboxItem> = {}): WorkoutOutboxItem {
  return {
    id,
    sessionId: SESSION,
    body: body(),
    key: `key-${id}-0001`,
    createdAt: new Date(),
    state: 'pending',
    converted: false,
    ...overrides,
  };
}

/** Lets a request started in the background reach the stub server. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function flushed(): string[] {
  return events.filter((e) => e.event === 'workout_outbox_flushed').map((e) => String(e.params.outcome));
}

beforeEach(() => {
  resetAppStoreForTests();
  resetHealthStoreForTests();
  resetWorkoutOutboxForTests();
  RunnerProgressIndex.reset();
  setWorkoutSessionPosting(null);
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(async () => {
  setAnalyticsObserver(null);
  setWorkoutSessionPosting(null);
  await localStore.settled();
});

// ---------------------------------------------------------------------------
// V4

it('testAFlushedWorkoutGoesOntoTodayAsDone', async () => {
  seedToday('planned');
  const answer: SessionActionResponse = {
    session: decodeHealthDay(dayJSON('done')).day!.session!,
    changed: [],
    remark: null,
    tomorrow: null,
    nextWeekChange: null,
    week: null,
    upcoming: null,
    replayed: false,
  };
  let calls = 0;
  const posting: WorkoutSessionPosting = {
    done: async () => {
      calls += 1;
      return answer;
    },
    skip: async () => answer,
    swapForRestOfPlan: async () => answer,
  };
  setWorkoutSessionPosting(posting);

  await activateWorkoutOutbox(MEMBER);
  await expect(enqueueWorkout({ sessionId: SESSION, body: body(), key: 'k-flush', profileId: MEMBER })).resolves.toBe(
    true,
  );
  expect(hasPendingWorkoutNow(SESSION)).toBe(true); // "Waiting to sync"

  await flushWorkoutOutbox({ foreground: false });
  expect(calls).toBe(1);
  expect(hasPendingWorkoutNow(SESSION)).toBe(false);
  // The Today card shows Done, not Start.
  expect(useHealthStore.getState().today?.day?.session?.status).toBe('done');
});

// ---------------------------------------------------------------------------
// Queueing

describe('queueing a Save', () => {
  it('writes the item to the member\'s outbox.json, with its body, key and moment', async () => {
    const now = new Date('2027-01-15T08:05:00Z');
    await enqueueWorkout({ sessionId: SESSION, body: body(), key: 'k-1', profileId: MEMBER.toUpperCase(), now });
    await localStore.settled();
    const [item] = onDisk()!;
    expect(item).toMatchObject({ sessionId: SESSION, key: 'k-1', state: 'pending', converted: false });
    expect(item).toHaveProperty('createdAt', '2027-01-15T08:05:00.000Z');
    expect(item).toHaveProperty('body', {
      action: 'done',
      minutes: 30,
      feeling: 'ok',
      clientCompletedAt: '2027-01-15T08:00:00.000Z',
    });
    expect(store().loadedProfileId).toBe(MEMBER);
  });

  it('holds five; a sixth is refused and nothing is dropped', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(enqueueWorkout({ sessionId: SESSION, body: body(), key: `k-${i}`, profileId: MEMBER })).resolves.toBe(
        true,
      );
    }
    await expect(enqueueWorkout({ sessionId: SESSION_2, body: body(), key: 'k-6', profileId: MEMBER })).resolves.toBe(
      false,
    );
    await localStore.settled();
    expect(onDisk()).toHaveLength(5);
    expect(hasPendingWorkoutNow(SESSION_2)).toBe(false);
  });

  it('two members on one phone never mix queues: a Save reads its member\'s file first', async () => {
    await enqueueWorkout({ sessionId: SESSION, body: body(), key: 'a-1', profileId: MEMBER });
    await enqueueWorkout({ sessionId: SESSION, body: body(), key: 'a-2', profileId: MEMBER });
    await enqueueWorkout({ sessionId: SESSION_2, body: body(), key: 'b-1', profileId: OTHER });
    expect(store().items.map((item) => item.key)).toEqual(['b-1']);
    await enqueueWorkout({ sessionId: SESSION, body: body(), key: 'a-3', profileId: MEMBER });
    await localStore.settled();
    expect(onDisk(MEMBER)!.map((item) => item.key)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(onDisk(OTHER)!.map((item) => item.key)).toEqual(['b-1']);
  });

  it('only a pending item blocks a restart; a failed one waits on Plan\'s banner instead', async () => {
    seedQueue([queued('a', { state: 'failed' }), queued('b', { sessionId: SESSION_2 })]);
    await activateWorkoutOutbox(MEMBER);
    expect(hasPendingWorkoutNow(SESSION)).toBe(false);
    expect(hasPendingWorkoutNow(SESSION_2)).toBe(true);
    expect(selectHasPendingWorkout(SESSION_2)(store())).toBe(true);
    expect(selectHasPendingWorkout(null)(store())).toBe(false);
    expect(failedWorkoutItems()).toEqual([{ id: 'a', kind: 'workout' }]);
  });

  it('hasPendingWorkout loads the signed-in member\'s queue when nothing has yet', async () => {
    seedQueue([queued('a')]);
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
    await expect(hasPendingWorkout(SESSION)).resolves.toBe(true);
    await expect(hasPendingWorkout(SESSION_2)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OutboxAdoptionTests, for the workout queue

describe('a queue that cannot be read is not adopted', () => {
  it('a workout queued while the file is unreadable does not overwrite it, and is merged on the next read', async () => {
    seedQueue([queued('a'), queued('b')]);
    const before = fileSystemState.read(OUTBOX);
    const text = jest.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('EIO'));

    await expect(enqueueWorkout({ sessionId: SESSION_2, body: body(), key: 'k-c', profileId: MEMBER })).resolves.toBe(
      true,
    );
    text.mockRestore();
    expect(store().items).toHaveLength(1); // only the new one is in memory
    expect(store().loadedProfileId).toBeNull();
    await localStore.settled();
    expect(fileSystemState.read(OUTBOX)).toBe(before);

    // A flush never runs on a queue that was not adopted.
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo(SESSION_2)).toHaveLength(0);

    // Readable again: the disk queue first, nothing doubled, written through.
    await activateWorkoutOutbox(MEMBER);
    expect(store().items.map((item) => item.id).slice(0, 2)).toEqual(['a', 'b']);
    expect(store().items).toHaveLength(3);
    await localStore.settled();
    expect(onDisk()!.map((item) => item.key)).toEqual(['key-a-0001', 'key-b-0001', 'k-c']);

    // Emptied, the queue's file goes.
    for (const item of [...store().items]) discardWorkoutItem(item.id);
    await localStore.settled();
    expect(fileSystemState.exists(OUTBOX)).toBe(false);
  });

  it('an absent file is an empty queue, adopted', async () => {
    await activateWorkoutOutbox(MEMBER);
    expect(store().items).toEqual([]);
    expect(store().loadedProfileId).toBe(MEMBER);
  });
});

// ---------------------------------------------------------------------------
// The flush, carried out (iOS 7.7)

describe('the flush', () => {
  beforeEach(() => seedToday('planned'));

  it('sends each pending item with its own key; a sent item leaves the queue and the file', async () => {
    seedQueue([queued('a')]);
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });

    const sent = expectSentToMatchContract('POST', sessionPath());
    expect(sent.headers['idempotency-key']).toBe('key-a-0001');
    // Instants travel in whole seconds, as iOS's `.iso8601` sends them.
    expect(sent.body).toEqual({ action: 'done', minutes: 30, feeling: 'ok', clientCompletedAt: '2027-01-15T08:00:00Z' });
    expect(store().items).toEqual([]);
    expect(flushed()).toEqual(['sent']);
    await localStore.settled();
    expect(fileSystemState.exists(OUTBOX)).toBe(false);
  });

  it('no network stops the flush: nothing else is tried, nothing is lost', async () => {
    seedQueue([queued('a'), queued('b', { sessionId: SESSION_2 })]);
    api.on('POST', '/health/sessions/:id', Reply.fail());
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: false });
    expect(sentTo(SESSION)).toHaveLength(1);
    expect(sentTo(SESSION_2)).toHaveLength(0);
    expect(store().items.map((item) => item.state)).toEqual(['pending', 'pending']);
    expect(flushed()).toEqual([]);
  });

  it('a row that moved converts ONCE to an extra: the same moment, a new key', async () => {
    seedQueue([queued('a')]);
    // Later routes win: the refusal answers first, once.
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
    api.once('POST', '/health/sessions/:id', Reply.problem(409, 'session_action_not_allowed', { reason: 'too_old' }));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });

    const [first, second] = sentTo();
    expect(first.headers['idempotency-key']).toBe('key-a-0001');
    expect(second.headers['idempotency-key']).not.toBe('key-a-0001');
    expect(second.body).toEqual({ ...(first.body as object), asExtra: true });
    expectSentToMatchContract('POST', sessionPath());
    expect(store().items).toEqual([]);
    expect(flushed()).toEqual(['extra']);
  });

  it('a converted item that fails again waits for the member, failed', async () => {
    seedQueue([queued('a')]);
    api.on('POST', '/health/sessions/:id', Reply.problem(404, 'health_session_not_found'));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo()).toHaveLength(2);
    expect(store().items).toMatchObject([{ id: 'a', state: 'failed', converted: true, body: { asExtra: true } }]);
    expect(failedWorkoutItems()).toEqual([{ id: 'a', kind: 'workout' }]);
    expect(flushed()).toEqual(['failed']);
    await localStore.settled();
    expect(onDisk()).toMatchObject([{ id: 'a', state: 'failed', converted: true }]);

    // A failed item is not sent again by a flush: only the member decides.
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo()).toHaveLength(2);
  });

  it('no session on the date, or a paused plan: failed at once, never converted', async () => {
    seedQueue([queued('a'), queued('b', { sessionId: SESSION_2 })]);
    api.on('POST', sessionPath(), Reply.problem(409, 'session_action_not_allowed', { reason: 'no_session_on_date' }));
    api.on('POST', sessionPath(SESSION_2), Reply.problem(409, 'session_action_not_allowed', { reason: 'program_not_active' }));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo()).toHaveLength(1);
    expect(sentTo(SESSION_2)).toHaveLength(1);
    expect(store().items.map((item) => [item.state, item.converted])).toEqual([
      ['failed', false],
      ['failed', false],
    ]);
    expect(flushed()).toEqual(['failed', 'failed']);
  });

  it('deleted elsewhere or a reused key: dropped, "This was changed on another device."', async () => {
    seedQueue([queued('a'), queued('b', { sessionId: SESSION_2 })]);
    api.on('POST', sessionPath(), Reply.problem(422, 'idempotency_key_reused'));
    api.on('POST', sessionPath(SESSION_2), Reply.problem(409, 'health-session-deleted'));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(store().items).toEqual([]);
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
    expect(flushed()).toEqual([]);
  });

  it('a busy or broken server stops the flush and keeps the item pending', async () => {
    seedQueue([queued('a'), queued('b', { sessionId: SESSION_2 })]);
    api.on('POST', sessionPath(), Reply.problem(429, 'rate_limited'));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo(SESSION_2)).toHaveLength(0);

    api.on('POST', sessionPath(), Reply.problem(503, 'unavailable'));
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo(SESSION_2)).toHaveLength(0);
    expect(store().items.map((item) => item.state)).toEqual(['pending', 'pending']);
  });

  it('an item over seven days old is dropped unsent, with "changed"', async () => {
    const now = new Date();
    seedQueue([queued('old', { createdAt: new Date(now.getTime() - 7 * DAY_MS - 1000) }), queued('new', { sessionId: SESSION_2 })]);
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer(SESSION_2)));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true, now });
    expect(sentTo()).toHaveLength(0);
    expect(sentTo(SESSION_2)).toHaveLength(1);
    expect(store().items).toEqual([]);
    expect(useHealthStore.getState().toastKey).toBe('health.err.changed');
  });

  it('a flush asked for while one runs returns at once (serial, one at a time)', async () => {
    seedQueue([queued('a')]);
    let release: () => void = () => undefined;
    api.on(
      'POST',
      '/health/sessions/:id',
      () => new Promise((resolve) => (release = () => resolve(Reply.ok(doneAnswer())))),
    );
    await activateWorkoutOutbox(MEMBER);
    const first = flushWorkoutOutbox({ foreground: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushWorkoutOutbox({ foreground: true });
    expect(sentTo()).toHaveLength(1);
    release();
    await first;
    expect(sentTo()).toHaveLength(1);
    expect(store().items).toEqual([]);
  });
});

describe('a withdrawn consent', () => {
  it('in the background reconciles: the flush stops and nothing is deleted without the profile\'s answer', async () => {
    seedToday('planned');
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
    seedQueue([queued('a'), queued('b', { sessionId: SESSION_2 })]);
    api.on('POST', '/health/sessions/:id', Reply.problem(409, 'health_consent_required'));
    // The reconcile's profile read cannot answer: no answer is no withdrawal.
    api.on('GET', '/profile', Reply.fail());
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: false });
    await settle();
    expect(sentTo(SESSION_2)).toHaveLength(0);
    expect(api.sentAll('/profile', 'GET').length).toBeGreaterThan(0);
    await localStore.settled();
    expect(onDisk()!.map((item) => item.state)).toEqual(['pending', 'pending']);
    expect(store().items).toHaveLength(2);
  });

  it('on Plan, for an entitled member, waits on the banner instead', async () => {
    seedToday('planned');
    seedQueue([queued('a')]);
    api.on('POST', '/health/sessions/:id', Reply.problem(409, 'health_consent_required'));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(store().items).toMatchObject([{ id: 'a', state: 'failed' }]);
    await settle();
    expect(api.sentAll('/profile', 'GET')).toHaveLength(0);
  });

  it('on Plan, for a member who is not entitled, reconciles too', async () => {
    seedToday('planned', 'not_entitled');
    seedQueue([queued('a')]);
    api.on('POST', '/health/sessions/:id', Reply.problem(409, 'health_consent_required'));
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(store().items).toMatchObject([{ id: 'a', state: 'pending' }]);
  });
});

describe('after a flush Plan did not ask for', () => {
  beforeEach(() => {
    seedToday('planned');
    seedQueue([queued('a')]);
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
    api.on('GET', '/health', Reply.ok(dayJSON('done')));
  });

  it('Today is read again, so Home and the session\'s own date are up to date', async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: false });
    expect(api.sentAll('/health', 'GET')).toHaveLength(1);
  });

  it('Plan\'s own flush is followed by Plan\'s read, not this one', async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: true });
    expect(api.sentAll('/health', 'GET')).toHaveLength(0);
  });

  it('no read without consent, or for a minor', async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile({ access: 'entitled', consent: null }) });
    await activateWorkoutOutbox(MEMBER);
    await flushWorkoutOutbox({ foreground: false });
    expect(api.sentAll('/health', 'GET')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Plan's banner: Save as extra, Discard

describe('a failed item on Plan\'s banner', () => {
  beforeEach(() => {
    seedToday('planned');
    seedQueue([queued('a', { state: 'failed' })]);
  });

  it('Save as extra: a new key and asExtra; on success it leaves and Today shows it', async () => {
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
    await activateWorkoutOutbox(MEMBER);
    await saveFailedWorkoutAsExtra('a');
    const sent = expectSentToMatchContract('POST', sessionPath());
    expect(sent.headers['idempotency-key']).not.toBe('key-a-0001');
    expect(sent.body).toMatchObject({ action: 'done', asExtra: true, clientCompletedAt: '2027-01-15T08:00:00Z' });
    expect(store().items).toEqual([]);
    expect(flushed()).toEqual(['extra']);
    expect(useHealthStore.getState().today?.day?.session?.status).toBe('done');
  });

  it('Save as extra with no network: it waits, as an extra, for the next flush', async () => {
    api.on('POST', '/health/sessions/:id', Reply.fail());
    await activateWorkoutOutbox(MEMBER);
    await saveFailedWorkoutAsExtra('a');
    expect(store().items).toMatchObject([{ id: 'a', state: 'pending', converted: true, body: { asExtra: true } }]);
    expect(useHealthStore.getState().toastKey).toBe('health.saved_offline');
    await localStore.settled();
    expect(onDisk()).toMatchObject([{ id: 'a', state: 'pending', converted: true }]);
  });

  it('Save as extra refused again: "couldn\'t be saved", and it stays', async () => {
    api.on('POST', '/health/sessions/:id', Reply.problem(409, 'session_action_not_allowed', { reason: 'too_old' }));
    await activateWorkoutOutbox(MEMBER);
    await saveFailedWorkoutAsExtra('a');
    expect(store().items).toMatchObject([{ id: 'a', state: 'failed' }]);
    expect(useHealthStore.getState().toastKey).toBe('runner.err.not_saved');
  });

  it('Discard throws it away (Plan asks first)', async () => {
    await activateWorkoutOutbox(MEMBER);
    discardWorkoutItem('a');
    discardWorkoutItem('not-there');
    expect(store().items).toEqual([]);
    await localStore.settled();
    expect(fileSystemState.exists(OUTBOX)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The triggers and the wipe (./register.ts)

describe('the activation flush', () => {
  beforeEach(() => {
    seedToday('planned');
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
    seedQueue([queued('a')]);
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
    api.on('GET', '/health', Reply.ok(dayJSON('done')));
  });

  it('the first profile read sends what waits, whichever tab is open', async () => {
    await runActivationHooks({ memberId: MEMBER, trigger: 'profile' });
    expect(sentTo()).toHaveLength(1);
    expect(store().items).toEqual([]);
  });

  it('coming back to the foreground sends it too, with background semantics', async () => {
    await runActivationHooks({ memberId: MEMBER, trigger: 'foreground' });
    expect(sentTo()).toHaveLength(1);
    // A background flush that sent something reads Today again.
    expect(api.sentAll('/health', 'GET')).toHaveLength(1);
  });

  it('without a profile there is nothing to flush for', async () => {
    useAppStore.setState({ profile: null });
    await runActivationHooks({ memberId: MEMBER, trigger: 'foreground' });
    expect(sentTo()).toHaveLength(0);
  });
});

describe('the local wipe', () => {
  it('takes runner.json and outbox.json, and memory follows: the queue, the Resume row, an open runner', async () => {
    seedQueue([queued('a')]);
    await activateWorkoutOutbox(MEMBER);
    await saveRunner(fresh(), MEMBER);
    expect(useRunnerProgress.getState().summary).not.toBeNull();
    const told = jest.fn();
    const off = onRunnerWiped(told);

    await useHealthStore.getState().wipeLocal({ profileId: MEMBER, reason: 'withdrawn' });
    off();

    expect(fileSystemState.exists(OUTBOX)).toBe(false);
    expect(fileSystemState.exists(`health/${MEMBER}/runner.json`)).toBe(false);
    expect(store()).toMatchObject({ items: [], profileId: null, loadedProfileId: null });
    expect(useRunnerProgress.getState().summary).toBeNull();
    expect(told).toHaveBeenCalledWith({ profileId: MEMBER, reason: 'withdrawn' });
  });

  it('a send that lands after the wipe writes nothing back, and nothing more is sent', async () => {
    seedToday('planned');
    seedQueue([queued('a'), queued('b', { sessionId: SESSION_2 })]);
    let release: () => void = () => undefined;
    api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
    api.once(
      'POST',
      '/health/sessions/:id',
      () => new Promise((resolve) => (release = () => resolve(Reply.problem(404, 'health_session_not_found')))),
    );
    await activateWorkoutOutbox(MEMBER);
    const flushing = flushWorkoutOutbox({ foreground: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await useHealthStore.getState().wipeLocal({ profileId: MEMBER, reason: 'withdrawn' });
    release();
    await flushing;
    await localStore.settled();
    // Not the conversion, not the next item.
    expect(sentTo()).toHaveLength(1);
    expect(sentTo(SESSION_2)).toHaveLength(0);
    expect(fileSystemState.exists(OUTBOX)).toBe(false);
    expect(store().items).toEqual([]);
    expect(flushed()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PLAN-1's bridge

describe('the workout half of Plan\'s outbox bridge', () => {
  beforeEach(() => {
    seedToday('planned');
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: profile() });
  });

  it('flush: the Resume row and the queue are read, then sent with foreground semantics', async () => {
    seedQueue([queued('a')]);
    await saveRunner(
      startRunnerState({ session: session({ scheduledFor: TODAY }), origin: 'today', now: t0, today: TODAY }),
      MEMBER,
    );
    RunnerProgressIndex.reset();
    api.on('POST', '/health/sessions/:id', Reply.problem(409, 'health_consent_required'));
    await workoutPlanOutboxSource.flush();
    expect(useRunnerProgress.getState().summary?.sessionId).toBe('sess-1');
    // Foreground and entitled: the banner, not a reconcile.
    expect(workoutPlanOutboxSource.failedItems()).toEqual([{ id: 'a', kind: 'workout' }]);
    expect(api.sentAll('/health', 'GET')).toHaveLength(0);
  });

  it('acts only on its own items, and tells Plan when the queue changes', async () => {
    seedQueue([queued('a', { state: 'failed' })]);
    await activateWorkoutOutbox(MEMBER);
    const changed = jest.fn();
    const off = workoutPlanOutboxSource.subscribe(changed);

    await workoutPlanOutboxSource.discard({ id: 'a', kind: 'meal' });
    await workoutPlanOutboxSource.saveAsExtra({ id: 'zzz', kind: 'workout' });
    expect(store().items).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();

    await workoutPlanOutboxSource.discard({ id: 'a', kind: 'workout' });
    expect(store().items).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    off();
  });
});

it('the flush analytics carry only the outcome word', async () => {
  seedToday('planned');
  seedQueue([queued('a')]);
  api.on('POST', '/health/sessions/:id', Reply.ok(doneAnswer()));
  await activateWorkoutOutbox(MEMBER);
  await flushWorkoutOutbox({ foreground: true });
  expect(events).toEqual([{ event: 'workout_outbox_flushed', params: { outcome: 'sent' } }]);
});
