/**
 * What an answer to Save means: the port of iOS testTheSaveTable and
 * testTheFailureReaderFoldsHyphensAndCancellations (PlanSectionTests 7.7),
 * plus the failure reader on what the Android client really throws.
 */
import { api, Reply } from '@test/server';

import { NotAuthenticatedError, ProblemError, TransportError } from '../../../api';
import { stubApiClientPerTest } from '../../../api/testing';
import { workoutDoneBody } from '../model/performed';
import { liveWorkoutSessionPosting } from '../outbox/posting';
import {
  readRunnerFailure,
  runnerSaveOutcome,
  RunnerSaveRules,
  type RunnerFailureKind,
  type RunnerSaveOutcome,
} from '../saveRules';

stubApiClientPerTest();

function problem(slug: string, status: number, reason: string | null = null): RunnerFailureKind {
  return { kind: 'problem', slug, status, reason };
}

function outcome(failure: RunnerFailureKind, extra = false, retried = false): RunnerSaveOutcome {
  return runnerSaveOutcome(failure, { isExtra: extra, retriedKey: retried });
}

const NOT_SAVED: RunnerSaveOutcome = { kind: 'keep', messageKey: 'runner.err.not_saved' };

it('testTheSaveTable', () => {
  expect(outcome({ kind: 'offline' })).toEqual({ kind: 'queueOffline' });
  expect(outcome({ kind: 'offline' }, true)).toEqual({ kind: 'queueOffline' });
  expect(outcome({ kind: 'cancelled' })).toEqual({ kind: 'silent' });
  expect(outcome({ kind: 'notAuthenticated' })).toEqual({ kind: 'silent' });

  for (const reason of ['not_planned', 'future_date', 'too_old']) {
    expect(outcome(problem('session_action_not_allowed', 409, reason))).toEqual({ kind: 'askSaveAsExtra' });
  }
  expect(outcome(problem('health_session_not_found', 404))).toEqual({ kind: 'askSaveAsExtra' });
  expect(outcome(problem('health_session_not_found', 404), true)).toEqual(NOT_SAVED);

  expect(outcome(problem('session_action_not_allowed', 409, 'program_not_active'))).toEqual({ kind: 'notActive' });
  expect(outcome(problem('session_action_not_allowed', 409, 'no_session_on_date'), true)).toEqual(NOT_SAVED);
  expect(outcome(problem('no_active_plan_or_pass', 403))).toEqual({ kind: 'gate' });
  expect(outcome(problem('health_consent_required', 409))).toEqual({ kind: 'consent' });
  expect(outcome(problem('idempotency_key_reused', 422))).toEqual({ kind: 'retryWithNewKey' });
  expect(outcome(problem('idempotency_key_reused', 422), false, true)).toEqual({
    kind: 'keep',
    messageKey: 'common.error_body',
  });
  expect(outcome(problem('rate-limited', 429))).toEqual({ kind: 'keep', messageKey: 'health.err.rate_limited' });
  expect(outcome(problem('internal_error', 500))).toEqual(NOT_SAVED);
});

describe('the rest of the table (iOS 7.7)', () => {
  it('a moved row on an extra keeps it: the extra is filed on its date, so asking again would loop', () => {
    for (const reason of ['not_planned', 'future_date', 'too_old']) {
      expect(outcome(problem('session_action_not_allowed', 409, reason), true)).toEqual(NOT_SAVED);
    }
  });

  it('no_session_on_date and an unknown reason keep the file; a minor gets the gate', () => {
    expect(outcome(problem('session_action_not_allowed', 409, 'no_session_on_date'))).toEqual(NOT_SAVED);
    expect(outcome(problem('session_action_not_allowed', 409, 'something_new'))).toEqual(NOT_SAVED);
    expect(outcome(problem('session_action_not_allowed', 409))).toEqual(NOT_SAVED);
    expect(outcome(problem('health_minor_blocked', 403))).toEqual({ kind: 'gate' });
  });

  it('a pending deletion says so; any other 404 asks once; anything else keeps the file', () => {
    expect(outcome(problem('account-pending-deletion', 409))).toEqual({
      kind: 'keep',
      messageKey: 'health.err.pending_deletion',
    });
    expect(outcome(problem('http_404', 404))).toEqual({ kind: 'askSaveAsExtra' });
    expect(outcome(problem('http_404', 404), true)).toEqual(NOT_SAVED);
    expect(outcome(problem('validation_failed', 400))).toEqual(NOT_SAVED);
    expect(outcome({ kind: 'other' })).toEqual(NOT_SAVED);
  });

  it('keeps iOS names for the Swift port', () => {
    expect(RunnerSaveRules.outcome).toBe(runnerSaveOutcome);
    expect([...RunnerSaveRules.movedReasons].sort()).toEqual(['future_date', 'not_planned', 'too_old']);
  });
});

it('testTheFailureReaderFoldsHyphensAndCancellations', () => {
  const refused = new ProblemError(
    {
      type: 'https://lifepass.is/problems/session-action-not-allowed',
      status: 409,
      detail: 'never read',
      reason: 'too_old',
    },
    409,
  );
  expect(readRunnerFailure(refused).kind).toEqual({
    kind: 'problem',
    slug: 'session_action_not_allowed',
    status: 409,
    reason: 'too_old',
  });
  expect(readRunnerFailure(refused).apiError).toBe(refused);
  expect(readRunnerFailure(new TransportError('cancelled')).kind).toEqual({ kind: 'cancelled' });
  expect(readRunnerFailure(new TransportError('timeout')).kind).toEqual({ kind: 'offline' });
  expect(readRunnerFailure(new TransportError('offline')).kind).toEqual({ kind: 'offline' });
  expect(readRunnerFailure(new TransportError('network')).kind).toEqual({ kind: 'offline' });
  expect(readRunnerFailure(new NotAuthenticatedError()).kind).toEqual({ kind: 'notAuthenticated' });
});

it('an abort that never reached the client is a cancellation; any other throw is "other"', () => {
  const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  expect(readRunnerFailure(abort)).toEqual({ kind: { kind: 'cancelled' }, apiError: null });
  expect(readRunnerFailure(new TypeError('x is undefined'))).toEqual({ kind: { kind: 'other' }, apiError: null });
  expect(readRunnerFailure('nope').kind).toEqual({ kind: 'other' });
});

describe('what the client throws for a real Save', () => {
  const body = workoutDoneBody({ minutes: 30, clientCompletedAt: new Date('2027-01-15T08:00:00Z') });

  it('a fetch that fails (no connection) is offline, so the outbox keeps it', async () => {
    api.on('POST', '/health/sessions/:id', Reply.fail());
    const failure = await liveWorkoutSessionPosting.done('sess-1', body, 'k-1').then(
      () => null,
      (error: unknown) => readRunnerFailure(error),
    );
    expect(failure?.kind).toEqual({ kind: 'offline' });
    expect(outcome(failure!.kind)).toEqual({ kind: 'queueOffline' });
  });

  it('a problem is read by its slug, status and reason, never its detail', async () => {
    api.on(
      'POST',
      '/health/sessions/:id',
      Reply.problem(409, 'session-action-not-allowed', { reason: 'program_not_active' }),
    );
    const failure = await liveWorkoutSessionPosting.done('sess-1', body, 'k-1').then(
      () => null,
      (error: unknown) => readRunnerFailure(error),
    );
    expect(failure?.kind).toEqual({
      kind: 'problem',
      slug: 'session_action_not_allowed',
      status: 409,
      reason: 'program_not_active',
    });
    expect(outcome(failure!.kind)).toEqual({ kind: 'notActive' });
  });

  it('a gateway page with no problem body is http_<code>', async () => {
    api.on('POST', '/health/sessions/:id', Reply.raw(404, '<html>Not found</html>'));
    const failure = await liveWorkoutSessionPosting.done('sess-1', body, 'k-1').then(
      () => null,
      (error: unknown) => readRunnerFailure(error),
    );
    expect(failure?.kind).toEqual({ kind: 'problem', slug: 'http_404', status: 404, reason: null });
    expect(outcome(failure!.kind)).toEqual({ kind: 'askSaveAsExtra' });
  });
});
