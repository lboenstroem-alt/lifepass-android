/**
 * The outbox flush rules: the port of iOS testTheOutboxTable,
 * testConversionKeepsTheMomentAndMintsAKey and testAnItemExpiresAfterSevenDays
 * (PlanSectionTests 7.7), and outbox.json's codec.
 */
import { t0 } from '../../model/__tests__/fixtures';
import { workoutDoneBody } from '../../model/performed';
import type { RunnerFailureKind } from '../../saveRules';
import { decodeWorkoutOutbox, encodeWorkoutOutbox } from '../codec';
import {
  convertedItem,
  isTooOld,
  outboxStep,
  WORKOUT_OUTBOX_CAPACITY,
  WorkoutOutboxRules,
  type WorkoutOutboxItem,
  type WorkoutOutboxStep,
} from '../rules';

function item(options: { converted?: boolean; ageSeconds?: number } = {}): WorkoutOutboxItem {
  const converted = options.converted ?? false;
  return {
    id: 'i-1',
    sessionId: 'sess-1',
    body: workoutDoneBody({ minutes: 30, feeling: 'ok', clientCompletedAt: t0, asExtra: converted ? true : null }),
    key: 'k-1',
    createdAt: new Date(t0.getTime() - (options.ageSeconds ?? 0) * 1000),
    state: 'pending',
    converted,
  };
}

function problem(slug: string, status: number, reason: string | null = null): RunnerFailureKind {
  return { kind: 'problem', slug, status, reason };
}

function step(
  failure: RunnerFailureKind | null,
  options: { converted?: boolean; entitled?: boolean; foreground?: boolean } = {},
): WorkoutOutboxStep {
  return outboxStep(failure, item({ converted: options.converted }), {
    entitled: options.entitled ?? true,
    foreground: options.foreground ?? true,
  });
}

it('testTheOutboxTable', () => {
  expect(step(null)).toBe('sent');
  expect(step(null, { converted: true })).toBe('sentAsExtra');

  expect(step(problem('health_session_not_found', 404))).toBe('convertToExtra');
  for (const reason of ['not_planned', 'future_date', 'too_old']) {
    expect(step(problem('session_action_not_allowed', 409, reason))).toBe('convertToExtra');
    expect(step(problem('session_action_not_allowed', 409, reason), { converted: true })).toBe('markFailed');
  }

  expect(step(problem('session_action_not_allowed', 409, 'no_session_on_date'))).toBe('markFailed');
  expect(step(problem('session_action_not_allowed', 409, 'program_not_active'))).toBe('markFailed');
  expect(step(problem('no_active_plan_or_pass', 403))).toBe('markFailed');

  expect(step(problem('health_consent_required', 409))).toBe('markFailed');
  expect(step(problem('health_consent_required', 409), { foreground: false })).toBe('reconcile');
  expect(step(problem('health_consent_required', 409), { entitled: false })).toBe('reconcile');

  expect(step(problem('health_meal_deleted', 409))).toBe('dropChanged');
  expect(step(problem('health_measurement_deleted', 409))).toBe('dropChanged');
  expect(step(problem('idempotency_key_reused', 422))).toBe('dropChanged');

  expect(step({ kind: 'offline' })).toBe('stop');
  expect(step({ kind: 'notAuthenticated' })).toBe('stop');
  expect(step(problem('internal_error', 500))).toBe('stop');
  expect(step(problem('rate-limited', 429))).toBe('stop');
});

describe('the rest of the outbox table (iOS 7.7)', () => {
  it('a minor reconciles whatever the semantics; a cancellation or an undecodable answer stops', () => {
    expect(step(problem('health_minor_blocked', 403))).toBe('reconcile');
    expect(step(problem('health_minor_blocked', 403), { foreground: false })).toBe('reconcile');
    expect(step({ kind: 'cancelled' })).toBe('stop');
    expect(step({ kind: 'other' })).toBe('stop');
    expect(step(problem('http_502', 502))).toBe('stop');
  });

  it('hyphens fold: a hyphenated deleted slug is still "changed"', () => {
    expect(step(problem('health-session-deleted', 409))).toBe('dropChanged');
    expect(step(problem('idempotency-key-reused', 422))).toBe('dropChanged');
  });

  it('any other 404 converts once; a 400 or a 403 waits for the member', () => {
    expect(step(problem('http_404', 404))).toBe('convertToExtra');
    expect(step(problem('http_404', 404), { converted: true })).toBe('markFailed');
    expect(step(problem('validation_failed', 400))).toBe('markFailed');
    expect(step(problem('forbidden', 403))).toBe('markFailed');
  });

  it('a body already sent as an extra is never converted again, even before the flag', () => {
    const extra: WorkoutOutboxItem = { ...item(), body: { ...item().body, asExtra: true } };
    const options = { entitled: true, foreground: true };
    expect(outboxStep(problem('health_session_not_found', 404), extra, options)).toBe('markFailed');
    expect(outboxStep(null, extra, options)).toBe('sentAsExtra');
  });
});

it('testConversionKeepsTheMomentAndMintsAKey', () => {
  const original = item();
  const converted = WorkoutOutboxRules.converted(original, 'k-2');
  expect(converted.body.asExtra).toBe(true);
  expect(converted.body.clientCompletedAt).toEqual(original.body.clientCompletedAt);
  expect(converted.body.feeling).toBe('ok');
  expect(converted.body.minutes).toBe(30);
  expect(converted.key).toBe('k-2');
  expect(converted.converted).toBe(true);
  expect(converted.id).toBe(original.id);
  expect(converted.createdAt).toEqual(original.createdAt);
  expect(convertedItem).toBe(WorkoutOutboxRules.converted);
});

it('testAnItemExpiresAfterSevenDays', () => {
  expect(isTooOld(item({ ageSeconds: 6 * 86_400 }), t0)).toBe(false);
  expect(isTooOld(item({ ageSeconds: 7 * 86_400 }), t0)).toBe(false);
  expect(isTooOld(item({ ageSeconds: 7 * 86_400 + 1 }), t0)).toBe(true);
  expect(WorkoutOutboxRules.capacity).toBe(5);
  expect(WORKOUT_OUTBOX_CAPACITY).toBe(5);
});

describe('outbox.json', () => {
  it('round-trips a queue, the body exactly as it will be sent', () => {
    const queue: WorkoutOutboxItem[] = [
      item(),
      {
        ...convertedItem(item(), 'k-2'),
        id: 'i-2',
        state: 'failed',
        body: workoutDoneBody({
          minutes: 45,
          clientCompletedAt: new Date('2027-01-15T08:00:00.250Z'),
          asExtra: true,
          performed: [
            {
              exerciseId: 'goblet_squat',
              skipped: false,
              sets: [
                { reps: 10, kg: 12.5, done: true },
                { reps: 8, done: false },
              ],
            },
            { exerciseId: 'box_squat', swappedFrom: 'leg_press', skipped: true, sets: [] },
            { exerciseId: 'rower', skipped: false, minutes: 20, sets: [{ seconds: 1200, done: true }] },
          ],
        }),
      },
    ];
    const text = encodeWorkoutOutbox(queue);
    expect(decodeWorkoutOutbox(JSON.parse(text))).toEqual(queue);
    // Nothing empty is written: the server's schema takes no nulls.
    expect(text).not.toContain('null');
  });

  it('reads the queue iOS writes (whole-second instants)', () => {
    const ios = [
      {
        id: 'A1',
        sessionId: 'sess-1',
        body: { action: 'done', minutes: 30, clientCompletedAt: '2027-01-15T08:00:00Z' },
        key: 'K1',
        createdAt: '2027-01-15T08:00:05Z',
        state: 'pending',
        converted: false,
      },
    ];
    const [read] = decodeWorkoutOutbox(ios);
    expect(read.body).toEqual({ action: 'done', minutes: 30, clientCompletedAt: t0 });
    expect(read.createdAt).toEqual(new Date('2027-01-15T08:00:05Z'));
  });

  it('is strict: an unknown state, another action or a missing key fails the read', () => {
    const good = JSON.parse(encodeWorkoutOutbox([item()])) as Record<string, unknown>[];
    expect(() => decodeWorkoutOutbox([{ ...good[0], state: 'sent' }])).toThrow();
    expect(() => decodeWorkoutOutbox([{ ...good[0], body: { action: 'skip' } }])).toThrow();
    const { key: _key, ...withoutKey } = good[0];
    expect(() => decodeWorkoutOutbox([withoutKey])).toThrow();
    expect(() => decodeWorkoutOutbox({})).toThrow();
  });
});
