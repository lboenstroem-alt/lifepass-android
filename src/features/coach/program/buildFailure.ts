/**
 * What a failed build says and offers (iOS `CoachViewModel.handleBuildFailure`):
 * the error table of `ios-ux.md` 5.5 and 5.10 as data, so it can be read (and
 * tested) apart from the chat that shows it.
 *
 * The flow (../flows/program.ts) appends `copyKey` as a health-lane bubble,
 * with `chips` as a programme question when there are any; `keepFlow: false`
 * ends the wizard (the answers go); `thenSummary` draws the summary again
 * under it so the member can change the answer the server refused.
 */
import type { ApiError } from '../../../api';

import { ProgramOptionValue, type ProgramFlowState } from './model';

export interface BuildFailureChip {
  readonly labelKey: string;
  readonly value: string;
}

export interface BuildFailurePlan {
  readonly copyKey: string;
  readonly chips: readonly BuildFailureChip[];
  /** False: the wizard ends here. */
  readonly keepFlow: boolean;
  /** `program_created`'s outcome, when this failure counts one. */
  readonly outcome: 'refused' | 'daily_cap' | 'limit' | 'error' | null;
  /** A Coach 429: the lock is applied (the input locks, the strip changes). */
  readonly appliesCoachLimit: boolean;
  /** The TARGET was refused (`target_weight_saved`, outcome `refused`, surface `coach`). */
  readonly targetRefused: boolean;
  /** The next Build is a new plan, never a replay of this one. */
  readonly clearsKey: boolean;
  /** The summary is drawn again under the bubble. */
  readonly thenSummary: boolean;
}

export const TRY_AGAIN_CHIP: BuildFailureChip = { labelKey: 'program.chip.try_again', value: ProgramOptionValue.tryAgain };
const PLAN_DAY_CHIP: BuildFailureChip = { labelKey: 'coach.chip.plan_day', value: ProgramOptionValue.planDay };
const GET_FITTER_CHIP: BuildFailureChip = {
  labelKey: 'program.chip.get_fitter_instead',
  value: ProgramOptionValue.getFitterInstead,
};
const CHANGE_TARGET_CHIP: BuildFailureChip = {
  labelKey: 'program.chip.change_target',
  value: ProgramOptionValue.changeTarget,
};

function plan(copyKey: string, chips: readonly BuildFailureChip[], extra: Partial<BuildFailurePlan> = {}): BuildFailurePlan {
  return {
    copyKey,
    chips,
    keepFlow: true,
    outcome: null,
    appliesCoachLimit: false,
    targetRefused: false,
    clearsKey: false,
    thenSummary: false,
    ...extra,
  };
}

/** Anything that is not an API error at all, and the default row. */
export const NETWORK_FAILURE: BuildFailurePlan = plan('program.err.network', [TRY_AGAIN_CHIP]);

/**
 * Two failures are resent once without telling the member, because there is
 * nothing for them to decide (5.5): the key was already used for another
 * body (`idempotency_key_reused`), or the block before this one is gone
 * (`health_program_not_found` while a `previousProgramId` was sent). Both
 * retries go out with a NEW key; the second also drops the previous id.
 */
export function silentRetry(
  error: ApiError,
  flow: Pick<ProgramFlowState, 'previousProgramId'>,
): 'reusedKey' | 'previousGone' | null {
  const code = error.normalisedCode;
  if (code === 'idempotency_key_reused') return 'reusedKey';
  if (code === 'health_program_not_found' && flow.previousProgramId !== null) return 'previousGone';
  return null;
}

/** The field names a 400 named (iOS `problemFieldNames`). */
export function problemFieldNames(error: ApiError): string[] {
  return (error.problem?.errors ?? []).flatMap((entry) => (entry.field ? [entry.field] : []));
}

/** The row of the table for `error` (the silent retries are decided first, by `silentRetry`). */
export function buildFailurePlan(error: ApiError): BuildFailurePlan {
  // Hyphens folded to underscores: `coach-daily-limit` and `coach_daily_limit` alike.
  switch (error.normalisedCode) {
    case 'program_refused':
      switch (error.reason) {
        case 'bmi_low_lose_weight':
          return plan('program.refused.bmi_low', [GET_FITTER_CHIP, PLAN_DAY_CHIP], { outcome: 'refused' });
        case 'target_too_low':
          return plan('program.refused.target_low', [GET_FITTER_CHIP, PLAN_DAY_CHIP], { outcome: 'refused' });
        case 'bmi_high':
          return plan('program.refused.bmi_high', [PLAN_DAY_CHIP], { outcome: 'refused', keepFlow: false });
        case 'target_weight_bmi_low':
        case 'target_weight_bmi_high':
          // The TARGET was refused, not the plan: the answers are kept and
          // the body sheet opens again on the target (`SPEC` 6.2).
          return plan(
            error.reason === 'target_weight_bmi_low' ? 'program.refused.target_bmi_low' : 'program.refused.target_bmi_high',
            [CHANGE_TARGET_CHIP, PLAN_DAY_CHIP],
            { outcome: 'refused', targetRefused: true },
          );
        default:
          return plan('program.refused.generic', [PLAN_DAY_CHIP], { outcome: 'refused', keepFlow: false });
      }
    case 'coach_daily_limit':
      return plan('program.err.daily_cap', [TRY_AGAIN_CHIP], { outcome: 'daily_cap', appliesCoachLimit: true });
    case 'coach_free_limit':
      // Only an active member passes the programme gate, so this should not
      // happen; if the server ever says it, it is the membership prompt and
      // never "try again later today".
      return plan('coach.free.limit.body', [{ labelKey: 'coach.free.limit.cta', value: ProgramOptionValue.gatePlans }], {
        outcome: 'limit',
        appliesCoachLimit: true,
        keepFlow: false,
      });
    case 'coach_busy':
      return plan('coach.busy', [TRY_AGAIN_CHIP]);
    case 'coach_program_limit':
      return plan('program.err.limit', [{ labelKey: 'program.chip.open_plan', value: ProgramOptionValue.openPastPlans }], {
        outcome: 'limit',
      });
    case 'health_program_deleted':
      return plan('program.err.deleted', [{ labelKey: 'program.chip.make_new', value: ProgramOptionValue.gateMakeNew }], {
        clearsKey: true,
      });
    case 'health_consent_required':
      // The consent bubble with the chip its copy promises ("tap below").
      return plan('program.consent_skipped', [{ labelKey: 'coach.chip.program', value: ProgramOptionValue.intentProgram }]);
    case 'account_pending_deletion':
      return plan('health.err.pending_deletion', [{ labelKey: 'health.err.open_account', value: ProgramOptionValue.gateAccount }]);
    case 'no_active_plan_or_pass':
      return plan('program.gate.not_member', [{ labelKey: 'plan.gate.cta_choose', value: ProgramOptionValue.gatePlans }], {
        keepFlow: false,
      });
    case 'health_minor_blocked':
      return plan('health.minor.body', [], { keepFlow: false });
    case 'rate_limited':
      return plan('health.err.rate_limited', [TRY_AGAIN_CHIP]);
    case 'invalid_coach_request':
    case 'invalid_program_request':
      if (problemFieldNames(error).some((field) => field.endsWith('targetWeightKg'))) {
        // The target, not the plan: say so, and open it again.
        return plan('target.err.server', [CHANGE_TARGET_CHIP], { outcome: 'error' });
      }
      // A field the server refused: the error and the summary again, so the
      // member can change the answer behind it (C13).
      return plan('program.err.network', [], { outcome: 'error', thenSummary: true });
    default:
      return { ...NETWORK_FAILURE, outcome: 'error' };
  }
}
