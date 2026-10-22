/**
 * Adjust my plan's error table (iOS `handleRevisionFailure`, the catch of
 * `submitTargetOnly` and `appendCommonHealthRefusal`), row by row.
 */
import { HttpStatusError, ProblemError, decodeProblemDetails, type ApiError } from '../../../../api';
import { ProgramOptionValue } from '../../program/model';
import {
  CHANGE_MORE_CHIPS,
  commonHealthRefusal,
  refusalKey,
  resendsRevision,
  revisionFailurePlan,
  targetFailurePlan,
} from '../failure';
import { AdjustOptionValue } from '../model';

function problem(status: number, slug: string, extra: Record<string, unknown> = {}): ApiError {
  const details = decodeProblemDetails({ type: `https://lifepass.is/problems/${slug}`, title: slug, status, ...extra });
  if (!details) throw new Error('no problem');
  return new ProblemError(details, status);
}

const missingRoute = (): ApiError => new HttpStatusError(404, '<html>Not found</html>');

const OPEN_PLAN = [{ labelKey: 'program.chip.open_plan', value: ProgramOptionValue.gatePlanTab }];

describe('a revision', () => {
  it('reads a missing route as a stale feature list', () => {
    expect(revisionFailurePlan(missingRoute()).unsupported).toBe(true);
    // A problem 404 is a plan that is gone, not a missing route.
    const gone = revisionFailurePlan(problem(404, 'health_program_not_found'));
    expect(gone.unsupported).toBe(false);
    expect(gone).toMatchObject({ copyKey: 'program.adjust.err.changed', chips: OPEN_PLAN, endsFlow: true, storeChanged: true });
  });

  it('says the revision cap and offers Plan', () => {
    expect(revisionFailurePlan(problem(429, 'coach-plan-revision-limit'))).toMatchObject({
      copyKey: 'program.adjust.err.limit',
      chips: OPEN_PLAN,
      endsFlow: true,
    });
  });

  it('keeps the flow open on a refusal, in the server reason\'s words', () => {
    const refused = revisionFailurePlan(problem(422, 'program_refused', { reason: 'bmi_low_lose_weight' }));
    expect(refused).toMatchObject({ copyKey: 'program.refused.bmi_low', chips: CHANGE_MORE_CHIPS, endsFlow: false, targetRefused: false });
    expect(CHANGE_MORE_CHIPS.map((chip) => chip.value)).toEqual([AdjustOptionValue.more, AdjustOptionValue.cancel]);
  });

  it('counts a refused target as a target outcome, and only that', () => {
    expect(revisionFailurePlan(problem(422, 'program_refused', { reason: 'target_weight_bmi_low' }))).toMatchObject({
      copyKey: 'program.refused.target_bmi_low',
      targetRefused: true,
    });
    expect(revisionFailurePlan(problem(422, 'program_refused', { reason: 'bmi_high' })).targetRefused).toBe(false);
  });

  it('reads a plan ended elsewhere as changed', () => {
    expect(revisionFailurePlan(problem(409, 'program_action_not_allowed'))).toMatchObject({
      copyKey: 'program.adjust.err.changed',
      endsFlow: true,
      storeChanged: true,
    });
  });

  it('says there is nothing to update, and asks the menu again', () => {
    expect(revisionFailurePlan(problem(400, 'invalid-program-revision'))).toMatchObject({
      copyKey: 'program.adjust.nothing',
      chips: [],
      endsFlow: false,
      thenMenu: true,
    });
  });

  it('offers Try again on anything else, which resends the same revision', () => {
    expect(revisionFailurePlan(problem(500, 'internal_error'))).toMatchObject({
      copyKey: 'program.err.network',
      chips: [{ labelKey: 'program.chip.try_again', value: AdjustOptionValue.show }],
      endsFlow: false,
    });
    expect(revisionFailurePlan(new HttpStatusError(502, '<html>Bad gateway</html>')).copyKey).toBe('program.err.network');
  });

  it('resends a spent key once, silently, for exactly two codes', () => {
    expect(resendsRevision(problem(409, 'idempotency-key-reused'))).toBe(true);
    expect(resendsRevision(problem(409, 'health_program_deleted'))).toBe(true);
    expect(resendsRevision(problem(404, 'health_program_not_found'))).toBe(false);
    expect(resendsRevision(problem(500, 'internal_error'))).toBe(false);
  });
});

describe('a target on its own', () => {
  it('counts every refusal as a refused target', () => {
    expect(targetFailurePlan(problem(422, 'program_refused', { reason: 'target_weight_bmi_high' }))).toMatchObject({
      copyKey: 'program.refused.target_bmi_high',
      chips: CHANGE_MORE_CHIPS,
      targetRefused: true,
    });
  });

  it('says the server could not use the target', () => {
    expect(targetFailurePlan(problem(400, 'invalid_target_weight'))).toMatchObject({ copyKey: 'target.err.server', chips: CHANGE_MORE_CHIPS });
  });

  it('offers Try again, which saves the same target again', () => {
    expect(targetFailurePlan(problem(500, 'internal_error')).chips).toEqual([
      { labelKey: 'program.chip.try_again', value: AdjustOptionValue.saveTarget },
    ]);
    expect(targetFailurePlan(missingRoute()).unsupported).toBe(true);
  });
});

describe('the common answers', () => {
  it('gives the wizard\'s own answers, ending the flow where they do', () => {
    expect(commonHealthRefusal(problem(403, 'health_consent_required'))).toMatchObject({
      copyKey: 'program.consent_skipped',
      chips: [{ labelKey: 'coach.chip.program', value: ProgramOptionValue.intentProgram }],
      endsFlow: true,
    });
    expect(commonHealthRefusal(problem(409, 'account_pending_deletion'))).toMatchObject({
      copyKey: 'health.err.pending_deletion',
      chips: [{ labelKey: 'health.err.open_account', value: ProgramOptionValue.gateAccount }],
      endsFlow: true,
    });
    expect(commonHealthRefusal(problem(403, 'no_active_plan_or_pass'))).toMatchObject({
      copyKey: 'program.gate.not_member',
      chips: [{ labelKey: 'plan.gate.cta_choose', value: ProgramOptionValue.gatePlans }],
      endsFlow: true,
    });
    expect(commonHealthRefusal(problem(403, 'health_minor_blocked'))).toMatchObject({ copyKey: 'health.minor.body', chips: [], endsFlow: true });
    expect(commonHealthRefusal(problem(429, 'rate-limited'))).toMatchObject({
      copyKey: 'health.err.rate_limited',
      endsFlow: false,
      thenMenu: true,
    });
    expect(commonHealthRefusal(problem(500, 'internal_error'))).toBeNull();
  });
});

describe('refusal copy', () => {
  it('maps every reason the server sends, and a generic answer for the rest', () => {
    expect(refusalKey('bmi_low_lose_weight')).toBe('program.refused.bmi_low');
    expect(refusalKey('bmi_high')).toBe('program.refused.bmi_high');
    expect(refusalKey('target_too_low')).toBe('program.refused.target_low');
    expect(refusalKey('target_weight_bmi_low')).toBe('program.refused.target_bmi_low');
    expect(refusalKey('target_weight_bmi_high')).toBe('program.refused.target_bmi_high');
    expect(refusalKey('something_new')).toBe('program.refused.generic');
    expect(refusalKey(undefined)).toBe('program.refused.generic');
  });
});
