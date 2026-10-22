/**
 * The build's error table (iOS `handleBuildFailure`, `ios-ux.md` 5.5 and
 * 5.10), row by row: what each refusal says, offers, counts and keeps.
 */
import { ProblemError, TransportError, type ProblemDetails } from '../../../../api';
import { buildFailurePlan, problemFieldNames, silentRetry } from '../buildFailure';
import { ProgramOptionValue } from '../model';

// expo-font (behind @expo/vector-icons, which the body sheets load) imports
// expo-asset, which npm left nested under expo/ where Jest cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

function problem(slug: string, status: number, extra: Partial<ProblemDetails> = {}): ProblemError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status, ...extra }, status);
}

const values = (slug: string, status: number, extra: Partial<ProblemDetails> = {}) =>
  buildFailurePlan(problem(slug, status, extra)).chips.map((chip) => chip.value);

describe('the silent retries', () => {
  it('resends a reused key, and a missing previous block only when one was sent', () => {
    expect(silentRetry(problem('idempotency_key_reused', 409), { previousProgramId: null })).toBe('reusedKey');
    expect(silentRetry(problem('health_program_not_found', 404), { previousProgramId: 'p' })).toBe('previousGone');
    expect(silentRetry(problem('health_program_not_found', 404), { previousProgramId: null })).toBeNull();
    expect(silentRetry(problem('coach-busy', 503), { previousProgramId: 'p' })).toBeNull();
  });
});

describe('program_refused, by reason', () => {
  it.each([
    ['bmi_low_lose_weight', 'program.refused.bmi_low', [ProgramOptionValue.getFitterInstead, ProgramOptionValue.planDay], true],
    ['target_too_low', 'program.refused.target_low', [ProgramOptionValue.getFitterInstead, ProgramOptionValue.planDay], true],
    ['bmi_high', 'program.refused.bmi_high', [ProgramOptionValue.planDay], false],
    ['target_weight_bmi_low', 'program.refused.target_bmi_low', [ProgramOptionValue.changeTarget, ProgramOptionValue.planDay], true],
    ['target_weight_bmi_high', 'program.refused.target_bmi_high', [ProgramOptionValue.changeTarget, ProgramOptionValue.planDay], true],
    ['something_new', 'program.refused.generic', [ProgramOptionValue.planDay], false],
  ])('%s says %s', (reason, copyKey, chips, keepFlow) => {
    const plan = buildFailurePlan(problem('program_refused', 422, { reason }));
    expect(plan.copyKey).toBe(copyKey);
    expect(plan.chips.map((chip) => chip.value)).toEqual(chips);
    expect(plan.keepFlow).toBe(keepFlow);
    expect(plan.outcome).toBe('refused');
    expect(plan.targetRefused).toBe(reason.startsWith('target_weight_'));
  });
});

describe('the other rows', () => {
  it('reads either spelling of the Coach limits', () => {
    for (const slug of ['coach-daily-limit', 'coach_daily_limit']) {
      const plan = buildFailurePlan(problem(slug, 429));
      expect(plan).toMatchObject({ copyKey: 'program.err.daily_cap', appliesCoachLimit: true, outcome: 'daily_cap', keepFlow: true });
    }
    expect(buildFailurePlan(problem('coach-free-limit', 429))).toMatchObject({
      copyKey: 'coach.free.limit.body',
      appliesCoachLimit: true,
      keepFlow: false,
      outcome: 'limit',
    });
    expect(values('coach-free-limit', 429)).toEqual([ProgramOptionValue.gatePlans]);
  });

  it('asks for a moment when the Coach is busy, and offers the past plans at the plan limit', () => {
    expect(buildFailurePlan(problem('coach-busy', 503)).copyKey).toBe('coach.busy');
    expect(values('coach-busy', 503)).toEqual([ProgramOptionValue.tryAgain]);
    expect(buildFailurePlan(problem('coach-program-limit', 429))).toMatchObject({ copyKey: 'program.err.limit', outcome: 'limit' });
    expect(values('coach-program-limit', 429)).toEqual([ProgramOptionValue.openPastPlans]);
  });

  it('clears the key for a deleted plan and offers a new one', () => {
    expect(buildFailurePlan(problem('health_program_deleted', 410))).toMatchObject({ copyKey: 'program.err.deleted', clearsKey: true });
    expect(values('health_program_deleted', 410)).toEqual([ProgramOptionValue.gateMakeNew]);
  });

  it('answers the health refusals the way the gates do', () => {
    expect(buildFailurePlan(problem('health_consent_required', 403)).copyKey).toBe('program.consent_skipped');
    expect(values('health_consent_required', 403)).toEqual([ProgramOptionValue.intentProgram]);
    expect(buildFailurePlan(problem('account_pending_deletion', 409)).copyKey).toBe('health.err.pending_deletion');
    expect(values('account_pending_deletion', 409)).toEqual([ProgramOptionValue.gateAccount]);
    expect(buildFailurePlan(problem('no_active_plan_or_pass', 403))).toMatchObject({
      copyKey: 'program.gate.not_member',
      keepFlow: false,
    });
    expect(buildFailurePlan(problem('health_minor_blocked', 403))).toMatchObject({ copyKey: 'health.minor.body', chips: [], keepFlow: false });
    expect(buildFailurePlan(problem('rate_limited', 429)).copyKey).toBe('health.err.rate_limited');
  });

  it('tells a refused target from any other refused field', () => {
    const target = problem('invalid_coach_request', 400, { errors: [{ field: 'program.targetWeightKg' }] });
    expect(problemFieldNames(target)).toEqual(['program.targetWeightKg']);
    expect(buildFailurePlan(target)).toMatchObject({ copyKey: 'target.err.server', outcome: 'error', thenSummary: false });
    expect(buildFailurePlan(problem('invalid_program_request', 400, { errors: [{ field: 'program.focus' }] }))).toMatchObject({
      copyKey: 'program.err.network',
      chips: [],
      thenSummary: true,
    });
  });

  it('keeps the answers and offers Try again for anything else', () => {
    const plan = buildFailurePlan(new TransportError('timeout'));
    expect(plan).toMatchObject({ copyKey: 'program.err.network', keepFlow: true, outcome: 'error' });
    expect(plan.chips.map((chip) => chip.value)).toEqual([ProgramOptionValue.tryAgain]);
    expect(buildFailurePlan(problem('internal_error', 500)).copyKey).toBe('program.err.network');
  });
});
