/**
 * The Today card's rules without rendering: the row order of 3.7, the
 * session's body by status, the planned and missed actions, who may Start,
 * where "Log a workout" is offered, and which later session a rest day may
 * pull forward. Ports iOS LogWorkoutTests `testWithoutCanLogExtraTheCardOffersNothing`,
 * `testThePullCandidateStaysInThisWeek` and `testARestDayThatCarriesAnExtraOffersNoPull`.
 */
import { decodeHealthDay, decodeSessionView } from '../../../../health';
import {
  futureLines,
  missedActions,
  plannedActions,
  plannedLines,
  sessionBody,
  todayRowOrder,
  todayRunnerProgress,
  worksOffline,
  type TodayRowInput,
} from '../rowOrder';
import { canStartRunnerToday, offersLogWorkout, restPullCandidate, runnerRuns, weekEndDate } from '../rules';

const session = (json: Record<string, unknown>) => decodeSessionView({ id: 's-1', ...json }, 'session');

function day(date: string, sessionJSON: Record<string, unknown>, upcoming: unknown[] = [], weekStartsOn = '2026-10-12') {
  return decodeHealthDay({
    date,
    today: date,
    day: { date, relative: 'today', session: sessionJSON },
    week: { weekStartsOn, days: [] },
    upcoming,
  });
}

const base: TodayRowInput = {
  isToday: true,
  readOnly: false,
  isPaused: false,
  isBlockFinished: false,
  blockDoneDismissed: false,
  hasNote: false,
  checkInDue: false,
  hasRunnerProgress: false,
  hasOtherRunnerProgress: false,
  hasMovedAway: false,
  hasSession: true,
};

describe('the row order (3.7)', () => {
  it('puts every row in its place', () => {
    expect(
      todayRowOrder({
        ...base,
        hasNote: true,
        checkInDue: true,
        hasRunnerProgress: true,
        hasOtherRunnerProgress: true,
        hasMovedAway: true,
      }),
    ).toEqual(['note', 'checkIn', 'inProgress', 'inProgressOther', 'movedAway', 'session']);
  });

  it('offers the note, the check-in, another workout and a moved session on today only', () => {
    const otherDay = { ...base, isToday: false, hasNote: true, checkInDue: true, hasOtherRunnerProgress: true, hasMovedAway: true };
    expect(todayRowOrder(otherDay)).toEqual(['session']);
    // This session's own workout in progress shows on its own date, whatever day it is.
    expect(todayRowOrder({ ...otherDay, hasRunnerProgress: true })).toEqual(['inProgress', 'session']);
  });

  it('never offers the check-in read only', () => {
    expect(todayRowOrder({ ...base, readOnly: true, checkInDue: true })).toEqual(['session']);
  });

  it('a paused plan says so instead of the session, and hides the Resume rows', () => {
    expect(todayRowOrder({ ...base, isPaused: true, hasRunnerProgress: true, hasOtherRunnerProgress: true })).toEqual(['paused']);
  });

  it('a finished block asks about the next one until Not now', () => {
    expect(todayRowOrder({ ...base, isBlockFinished: true })).toEqual(['blockDone']);
    expect(todayRowOrder({ ...base, isBlockFinished: true, blockDoneDismissed: true })).toEqual(['session']);
    expect(todayRowOrder({ ...base, isBlockFinished: true, isPaused: true })).toEqual(['paused']);
  });

  it('a date with no session has no session row', () => {
    expect(todayRowOrder({ ...base, hasSession: false })).toEqual([]);
  });
});

describe("the runner's progress on the card", () => {
  const progress = { sessionId: 's-1', exercise: 2, total: 4 };

  it("is this session's for a runner kind, and another's otherwise", () => {
    expect(todayRunnerProgress(progress, { readOnly: false, session: session({ kind: 'strength' }) })).toEqual({ mine: progress, other: null });
    expect(todayRunnerProgress(progress, { readOnly: false, session: session({ kind: 'swim' }) })).toEqual({ mine: null, other: null });
    expect(todayRunnerProgress({ ...progress, sessionId: 's-2' }, { readOnly: false, session: session({ kind: 'strength' }) }).other?.sessionId).toBe('s-2');
    expect(todayRunnerProgress(progress, { readOnly: false, session: null }).other).toBe(progress);
  });

  it('is nothing on a read-only card', () => {
    expect(todayRunnerProgress(progress, { readOnly: true, session: session({ kind: 'strength' }) })).toEqual({ mine: null, other: null });
  });
});

describe("the session's body by status", () => {
  const body = (json: Record<string, unknown>, isFuture = false, outboxPending = false) =>
    sessionBody(session(json), { isFuture, outboxPending });

  it('reads each status', () => {
    expect(body({ status: 'done' })).toBe('done');
    expect(body({ status: 'skipped' })).toBe('skipped');
    expect(body({ status: 'missed' })).toBe('missed');
    expect(body({ status: 'rest' })).toBe('rest');
    expect(body({ status: 'planned', kind: 'strength' })).toBe('planned');
    expect(body({ kind: 'strength' })).toBe('planned');
    expect(body({ status: 'planned', kind: 'rest' })).toBe('rest');
    expect(body({ status: 'planned' })).toBe('rest');
    expect(body({ status: 'planned', kind: 'strength' }, true)).toBe('future');
  });

  it('a Save waiting in the outbox is done with nothing to tap, unless the server already says done', () => {
    expect(body({ status: 'planned', kind: 'strength' }, false, true)).toBe('waiting');
    expect(body({ status: 'missed', kind: 'strength' }, false, true)).toBe('waiting');
    expect(body({ status: 'done', kind: 'strength' }, false, true)).toBe('done');
  });

  it('a planned row with no kind reads as strength, a future one as rest', () => {
    expect(plannedLines(null)).toBe('exercises');
    expect(futureLines(null)).toBe('rest');
    expect(plannedLines('class')).toBe('class');
    expect(plannedLines('walk')).toBe('hike');
    expect(plannedLines('unknown')).toBe('rest');
  });
});

describe('the planned actions', () => {
  const actions = (kind: string, overrides: Partial<Parameters<typeof plannedActions>[1]> = {}) =>
    plannedActions(session({ kind }), { hasBooking: false, hasRunnerProgress: false, isToday: true, isOffline: false, ...overrides });

  it('per kind', () => {
    expect(actions('strength')).toEqual(['start', 'noEnergy']);
    expect(actions('class')).toEqual(['bookClass', 'markDone', 'noEnergy']);
    expect(actions('class', { hasBooking: true })).toEqual(['viewBooking', 'noEnergy']);
    expect(actions('swim')).toEqual(['findPool', 'markDone', 'noEnergy']);
    expect(actions('hike')).toEqual(['markDone', 'noEnergy']);
    expect(actions('walk')).toEqual(['markDone', 'noEnergy']);
  });

  it('a workout in progress gives Start to the Resume row', () => {
    expect(actions('cardio', { hasRunnerProgress: true })).toEqual(['noEnergy']);
  });

  it('No energy is for today, online', () => {
    expect(actions('strength', { isToday: false })).toEqual(['start']);
    expect(actions('strength', { isOffline: true })).toEqual(['start']);
  });

  it('offline dims everything but the runner', () => {
    expect(worksOffline('start')).toBe(true);
    expect(worksOffline('doItNow')).toBe(true);
    expect(worksOffline('resume')).toBe(true);
    expect(worksOffline('markDone')).toBe(false);
    expect(worksOffline('findPool')).toBe(false);
    expect(worksOffline('logDone')).toBe(false);
  });
});

describe('a missed row', () => {
  it('offers what the server allows, and only Missed. read only', () => {
    expect(missedActions(session({ kind: 'strength', canLogDone: true, canSkip: true }), false)).toEqual({
      canAct: true,
      actions: ['doItNow', 'logDone', 'skipIt'],
    });
    expect(missedActions(session({ kind: 'hike', canLogDone: true, canSkip: false }), false).actions).toEqual(['logDone']);
    expect(missedActions(session({ kind: 'strength', canSkip: true }), false).actions).toEqual(['skipIt']);
    expect(missedActions(session({ kind: 'strength', canLogDone: true, canSkip: true }), true)).toEqual({ canAct: false, actions: [] });
    expect(missedActions(session({ kind: 'strength' }), false).canAct).toBe(false);
  });
});

describe('Start (WorkoutRunnerEligibility)', () => {
  const today = '2026-10-16';
  const context = { readOnly: false, programPaused: false, outboxPending: false, today };

  it('runs strength, cardio and mobility, not a pool day yet', () => {
    expect(['strength', 'cardio', 'mobility'].every((kind) => runnerRuns(kind as never))).toBe(true);
    expect(runnerRuns('swim')).toBe(false);
    expect(runnerRuns(null)).toBe(false);
  });

  it("is today's planned session for an entitled member on a live plan, not already saved", () => {
    const planned = session({ kind: 'strength', scheduledFor: today, status: 'planned' });
    expect(canStartRunnerToday(planned, context)).toBe(true);
    expect(canStartRunnerToday(planned, { ...context, readOnly: true })).toBe(false);
    expect(canStartRunnerToday(planned, { ...context, programPaused: true })).toBe(false);
    expect(canStartRunnerToday(planned, { ...context, outboxPending: true })).toBe(false);
    expect(canStartRunnerToday(session({ kind: 'strength', scheduledFor: '2026-10-17', status: 'planned' }), context)).toBe(false);
    expect(canStartRunnerToday(session({ kind: 'strength', scheduledFor: today, status: 'done' }), context)).toBe(false);
    expect(canStartRunnerToday(session({ kind: 'hike', scheduledFor: today, status: 'planned' }), context)).toBe(false);
  });
});

describe('Log a workout (LogWorkoutGate)', () => {
  it('without canLogExtra the card offers nothing', () => {
    const context = { readOnly: false, isFuture: false, outboxPending: false };
    const old = session({});
    expect(old.canLogExtra).toBeNull();
    expect(offersLogWorkout(old, context)).toBe(false);

    const next = session({ canLogExtra: true });
    expect(offersLogWorkout(next, context)).toBe(true);
    expect(offersLogWorkout(next, { ...context, readOnly: true })).toBe(false);
    expect(offersLogWorkout(next, { ...context, isFuture: true })).toBe(false);
    expect(offersLogWorkout(next, { ...context, outboxPending: true })).toBe(false);

    expect(offersLogWorkout(session({ canLogExtra: false }), context)).toBe(false);
  });
});

describe('pulling a later session forward (PlanRestPull)', () => {
  const rest = { id: 's-rest', kind: 'rest', status: 'rest' };

  it('the pull candidate stays in this week', () => {
    // Friday 16 October; the week runs Monday 12 to Sunday 18.
    const friday = day('2026-10-16', rest, [
      { id: 'sat', scheduledFor: '2026-10-17', kind: 'strength', status: 'planned' },
      { id: 'mon', scheduledFor: '2026-10-19', kind: 'strength', status: 'planned' },
    ]);
    expect(restPullCandidate(friday)?.id).toBe('sat');
    expect(weekEndDate(friday)).toBe('2026-10-18');

    const onlyNextWeek = day('2026-10-16', rest, [{ id: 'mon', scheduledFor: '2026-10-19', kind: 'strength', status: 'planned' }]);
    expect(restPullCandidate(onlyNextWeek)).toBeNull();

    const restOrDone = day('2026-10-16', rest, [
      { id: 'a', scheduledFor: '2026-10-17', kind: 'rest', status: 'rest' },
      { id: 'b', scheduledFor: '2026-10-18', kind: 'swim', status: 'done' },
    ]);
    expect(restPullCandidate(restOrDone)).toBeNull();
  });

  it('never crosses Sunday, and never offers today itself', () => {
    const sunday = day('2026-10-18', rest, [
      { id: 'sun', scheduledFor: '2026-10-18', kind: 'strength', status: 'planned' },
      { id: 'mon', scheduledFor: '2026-10-19', kind: 'strength', status: 'planned' },
    ]);
    expect(restPullCandidate(sunday)).toBeNull();
  });

  it('a rest day that carries an extra offers no pull', () => {
    const upcoming = [{ id: 'sat', scheduledFor: '2026-10-17', kind: 'strength', status: 'planned' }];
    const logged = day('2026-10-16', { ...rest, extras: [{ id: 'x-1', index: 0, minutes: 45, kind: 'strength' }] }, upcoming);
    expect(restPullCandidate(logged)).toBeNull();
    const empty = day('2026-10-16', { ...rest, extras: [] }, upcoming);
    expect(restPullCandidate(empty)?.id).toBe('sat');
  });

  it('a day without upcoming rows has nothing to pull', () => {
    const noUpcoming = decodeHealthDay({ date: '2026-10-16', day: { date: '2026-10-16', session: rest } });
    expect(restPullCandidate(noUpcoming)).toBeNull();
  });
});
