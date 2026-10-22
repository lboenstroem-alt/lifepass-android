/**
 * What a failed Adjust my plan call says and does: iOS
 * `CoachViewModel.handleRevisionFailure`, the catch of `submitTargetOnly` and
 * `appendCommonHealthRefusal`, as data, so the table can be read (and
 * tested) apart from the chat that shows it.
 *
 * The flow (./flow.ts) carries a plan out in this order: `endsFlow` first
 * (so a problem with chips is drawn as a programme question that outlives
 * the flow, and one without as a plain bubble), then `copyKey` with `chips`,
 * then the menu again when `thenMenu`, then the stores read again when
 * `storeChanged`. `unsupported` replaces all of that: the route is missing.
 *
 * NO PROBLEM COPY CARRIES A WEIGHT. A refused target is "below a healthy
 * weight for your height", never the number the member picked.
 */
import type { ApiError } from '../../../api';
import { isMissingRoute } from '../../../api/targetWeight';
import { ProgramOptionValue } from '../program/model';

import { AdjustOptionValue } from './model';

export interface AdjustChip {
  readonly labelKey: string;
  readonly value: string;
}

export interface AdjustFailurePlan {
  /**
   * The route answered 404 as a missing PAGE, not a problem: the server was
   * rolled back after its features were read. The features are cleared, the
   * flow ends and the network bubble is shown (iOS `adjustUnsupported`).
   */
  readonly unsupported: boolean;
  readonly copyKey: string;
  readonly chips: readonly AdjustChip[];
  /** The flow ends before the bubble is drawn. */
  readonly endsFlow: boolean;
  /** The menu is asked again under the bubble (the flow stays open). */
  readonly thenMenu: boolean;
  /** The plan changed on the server: the profile and the Today read are read again. */
  readonly storeChanged: boolean;
  /** `target_weight_saved` with outcome `refused`, surface `coach`. */
  readonly targetRefused: boolean;
}

function plan(copyKey: string, chips: readonly AdjustChip[], extra: Partial<AdjustFailurePlan> = {}): AdjustFailurePlan {
  return {
    unsupported: false,
    copyKey,
    chips,
    endsFlow: false,
    thenMenu: false,
    storeChanged: false,
    targetRefused: false,
    ...extra,
  };
}

const UNSUPPORTED: AdjustFailurePlan = plan('program.err.network', [], { unsupported: true });

export const OPEN_PLAN_CHIP: AdjustChip = { labelKey: 'program.chip.open_plan', value: ProgramOptionValue.gatePlanTab };

/** "Change something else" and "Never mind": the member decides what next. */
export const CHANGE_MORE_CHIPS: readonly AdjustChip[] = [
  { labelKey: 'program.adjust.change_more', value: AdjustOptionValue.more },
  { labelKey: 'program.adjust.opt.cancel', value: AdjustOptionValue.cancel },
];

/** The network bubble with "Try again", which resends the same request under the same key. */
export function networkFailure(retryValue: string): AdjustFailurePlan {
  return plan('program.err.network', [{ labelKey: 'program.chip.try_again', value: retryValue }]);
}

/** The server said no to a revision or a target, in its own words (iOS `refusalKey(for:)`). */
export function refusalKey(reason: string | null | undefined): string {
  switch (reason) {
    case 'bmi_low_lose_weight':
      return 'program.refused.bmi_low';
    case 'bmi_high':
      return 'program.refused.bmi_high';
    case 'target_too_low':
      return 'program.refused.target_low';
    case 'target_weight_bmi_low':
      return 'program.refused.target_bmi_low';
    case 'target_weight_bmi_high':
      return 'program.refused.target_bmi_high';
    default:
      return 'program.refused.generic';
  }
}

/**
 * Consent, membership, a pending deletion, under 18 and the rate limit: the
 * answers the wizard already gives, given here too (iOS
 * `appendCommonHealthRefusal`). Null when the error is none of them.
 */
export function commonHealthRefusal(error: ApiError): AdjustFailurePlan | null {
  switch (error.normalisedCode) {
    case 'health_consent_required':
      return plan('program.consent_skipped', [{ labelKey: 'coach.chip.program', value: ProgramOptionValue.intentProgram }], {
        endsFlow: true,
      });
    case 'account_pending_deletion':
      return plan('health.err.pending_deletion', [{ labelKey: 'health.err.open_account', value: ProgramOptionValue.gateAccount }], {
        endsFlow: true,
      });
    case 'no_active_plan_or_pass':
      return plan('program.gate.not_member', [{ labelKey: 'plan.gate.cta_choose', value: ProgramOptionValue.gatePlans }], {
        endsFlow: true,
      });
    case 'health_minor_blocked':
      // A statement, not an offer: no chip.
      return plan('health.minor.body', [], { endsFlow: true });
    case 'rate_limited':
      // A moment's wait: the flow and its choices are kept.
      return plan('health.err.rate_limited', [], { thenMenu: true });
    default:
      return null;
  }
}

/**
 * The two failures of "Show me the updated plan" that are resent ONCE under
 * a new key without telling the member, because there is nothing for them to
 * decide: the key was already spent (on a build, or on a revision since
 * discarded).
 */
export function resendsRevision(error: ApiError): boolean {
  return error.isProblem('idempotency_key_reused', 'health_program_deleted');
}

/** "Show me the updated plan" failed (after the silent resend, if any). */
export function revisionFailurePlan(error: ApiError): AdjustFailurePlan {
  if (isMissingRoute(error)) return UNSUPPORTED;
  switch (error.normalisedCode) {
    case 'coach_plan_revision_limit':
      return plan('program.adjust.err.limit', [OPEN_PLAN_CHIP], { endsFlow: true });
    case 'program_refused':
      // Only a refused TARGET counts as a target outcome; a refused goal or
      // body is the plan's.
      return plan(refusalKey(error.reason), CHANGE_MORE_CHIPS, {
        targetRefused: error.reason?.startsWith('target_weight_') === true,
      });
    case 'program_action_not_allowed':
    case 'health_program_not_found':
      // The plan was ended, finished or deleted elsewhere.
      return plan('program.adjust.err.changed', [OPEN_PLAN_CHIP], { endsFlow: true, storeChanged: true });
    case 'invalid_program_revision':
      // Nothing differs from the running plan.
      return plan('program.adjust.nothing', [], { thenMenu: true });
    default:
      return commonHealthRefusal(error) ?? networkFailure(AdjustOptionValue.show);
  }
}

/** "Yes, save it" on a target-only change failed. */
export function targetFailurePlan(error: ApiError): AdjustFailurePlan {
  if (isMissingRoute(error)) return UNSUPPORTED;
  if (error.isProblem('program_refused')) {
    return plan(refusalKey(error.reason), CHANGE_MORE_CHIPS, { targetRefused: true });
  }
  if (error.isProblem('invalid_target_weight')) return plan('target.err.server', CHANGE_MORE_CHIPS);
  return commonHealthRefusal(error) ?? networkFailure(AdjustOptionValue.saveTarget);
}
