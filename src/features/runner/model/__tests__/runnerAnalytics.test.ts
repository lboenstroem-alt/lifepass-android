/**
 * The runner's analytics: the runner half of iOS AnalyticsParamTests. Every
 * event goes through the app's guard with every value it can carry, and
 * only the fixed words iOS sends travel: never an exercise, a weight, a rep
 * count, a feeling or a skip reason.
 */
import { SESSION_KINDS } from '../../../../api/profile';
import { ANALYTICS_EVENTS, setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { RunnerAnalytics } from '../analytics';
import { RUNNER_ENTRIES } from '../types';

let events: { event: string; params: AnalyticsParams }[] = [];

beforeEach(() => {
  events = [];
  setAnalyticsObserver((event, params) => events.push({ event, params }));
});

afterEach(() => setAnalyticsObserver(null));

/** The only keys a runner event may carry (iOS: kind, entry, future, outcome, feeling_given, choice, action). */
const RUNNER_KEYS = new Set(['kind', 'entry', 'future', 'outcome', 'feeling_given', 'choice', 'action']);

it('every runner event passes the guard with every value it can carry', () => {
  for (const kind of [...SESSION_KINDS, null]) {
    for (const entry of RUNNER_ENTRIES) RunnerAnalytics.started(kind, entry);
  }
  RunnerAnalytics.exerciseSwapped(true);
  RunnerAnalytics.exerciseSwapped(false);
  RunnerAnalytics.exerciseSkipped();
  RunnerAnalytics.workoutSkipped();
  for (const outcome of ['saved', 'extra', 'outbox', 'not_active'] as const) {
    RunnerAnalytics.finished(outcome, true);
    RunnerAnalytics.finished(outcome, false);
  }
  RunnerAnalytics.left('later');
  RunnerAnalytics.left('discard');
  for (const outcome of ['sent', 'extra', 'failed'] as const) RunnerAnalytics.outboxFlushed(outcome);

  expect(events.length).toBe((SESSION_KINDS.length + 1) * RUNNER_ENTRIES.length + 2 + 1 + 1 + 8 + 2 + 3);
  for (const { event, params } of events) {
    expect(ANALYTICS_EVENTS).toContain(event);
    for (const key of Object.keys(params)) expect(RUNNER_KEYS).toContain(key);
  }
});

it('says what iOS says, word for word', () => {
  RunnerAnalytics.started(null, 'resume');
  RunnerAnalytics.started('swim', 'missed');
  RunnerAnalytics.exerciseSwapped(true);
  RunnerAnalytics.exerciseSkipped();
  RunnerAnalytics.workoutSkipped();
  RunnerAnalytics.finished('outbox', true);
  RunnerAnalytics.left('later');
  RunnerAnalytics.outboxFlushed('failed');
  expect(events).toEqual([
    // A session that names no kind is a strength session.
    { event: 'workout_started', params: { kind: 'strength', entry: 'resume' } },
    { event: 'workout_started', params: { kind: 'swim', entry: 'missed' } },
    { event: 'workout_exercise_swapped', params: { future: true } },
    { event: 'workout_exercise_skipped', params: {} },
    // The reason is a member's answer: never sent.
    { event: 'workout_skipped', params: {} },
    // Whether a feeling was picked, never which.
    { event: 'workout_finished', params: { outcome: 'outbox', feeling_given: true } },
    { event: 'workout_left', params: { choice: 'later' } },
    { event: 'workout_outbox_flushed', params: { outcome: 'failed' } },
  ]);
});
