/**
 * What the target sheet derives from what it knows: which way a target
 * points, whether the field is offered at all, which goal word sits under the
 * title, and what the field opens with. The port of the derived values in
 * iOS Views/Health/TargetWeightSheet.swift, pure so each case is tested.
 *
 * THE GOAL A TARGET SERVES, in the server's order (`SPEC` 2.4): the live
 * plan's goal when it is lose or gain weight, else the calorie goal when it
 * is lose or gain. Only the Today read carries the plan's goal, so a plan
 * the profile says is running while that read is missing is UNKNOWN, not
 * "no goal": the field shows, the typed value says which way it points, and
 * the server (which knows the plan) has the last word.
 */
import {
  isTargetReached,
  knownAppliesTo,
  knownDirection,
  type LivePlanGoal,
  type TargetWeightView,
} from '../../../health';
import { programGoalLabelKey } from '../sheet/types';

import { TargetWeightRules, type TargetDirection } from './rules';

export interface TargetSheetFacts {
  /** `pick` carries the programme goal (wire value) the wizard is building for. */
  readonly mode: { readonly kind: 'save' } | { readonly kind: 'pick'; readonly goal: string };
  /** The live plan's goal, as far as this phone knows it (src/health `livePlanGoal`). */
  readonly livePlan: LivePlanGoal;
  /** The standing target: the caller's, then the goal read's. */
  readonly storedTarget: TargetWeightView | null;
  /** Save mode: the calorie goal (`lose`, `maintain`, `gain`) from the goal read. */
  readonly standingGoal: string | null;
}

/** The direction the target serves, or null when there is none AND when a live plan's goal is not in hand. */
export function targetDirection(facts: TargetSheetFacts): TargetDirection | null {
  if (facts.mode.kind === 'pick') return TargetWeightRules.directionForProgramGoal(facts.mode.goal);
  const plan = facts.livePlan;
  if (plan.kind === 'known') {
    const fromPlan = TargetWeightRules.directionForProgramGoal(plan.goal);
    if (fromPlan) return fromPlan;
  } else if (plan.kind === 'unknown') {
    // The server's own answer may already say: `appliesTo` is `program` only
    // when the target points the live plan's way, and `goal` only when it
    // saw no live plan at all.
    const appliesTo = facts.storedTarget ? knownAppliesTo(facts.storedTarget) : null;
    if (appliesTo === 'program') return facts.storedTarget ? knownDirection(facts.storedTarget) : null;
    if (appliesTo !== 'goal') return null;
  }
  return TargetWeightRules.directionForCalorieGoal(facts.standingGoal);
}

/**
 * Save mode, a plan running whose goal this phone does not have (the Today
 * read has not loaded, or failed offline). NOT "no goal": the plan may well
 * be a lose-weight plan, so the field shows and the server decides.
 */
export function targetGoalUnknown(facts: TargetSheetFacts): boolean {
  if (facts.mode.kind === 'pick' || facts.livePlan.kind !== 'unknown') return false;
  return targetDirection(facts) === null;
}

/** The field is offered: a goal that takes a target, or one not known. */
export function acceptsTarget(facts: TargetSheetFacts): boolean {
  return targetDirection(facts) !== null || targetGoalUnknown(facts);
}

/**
 * What the field is checked against. With the goal unknown, the typed value
 * says which way it points (at or under the current weight: lose; over it:
 * gain), so the one-kilo gap and the healthy-weight bounds still hold.
 */
export function validationDirection(
  facts: TargetSheetFacts,
  targetKg: number | null,
  weightKg: number | null,
): TargetDirection | null {
  const direction = targetDirection(facts);
  if (direction) return direction;
  if (!targetGoalUnknown(facts)) return null;
  return TargetWeightRules.inferredDirection(targetKg, weightKg);
}

/** The goal word under the title (`target.sheet.for_goal`): the plan's goal, or the calorie goal's. None while unknown. */
export function goalWordKey(facts: TargetSheetFacts): string | null {
  if (facts.mode.kind === 'pick') return programGoalLabelKey(facts.mode.goal);
  const plan = facts.livePlan;
  if (plan.kind === 'known' && plan.goal && TargetWeightRules.directionForProgramGoal(plan.goal)) {
    return programGoalLabelKey(plan.goal);
  }
  if (plan.kind === 'unknown') {
    // Resolved through the stored target's `appliesTo`: only the lose-weight
    // plan points down, only gain-weight points up.
    const direction = targetDirection(facts);
    if (!facts.storedTarget || knownAppliesTo(facts.storedTarget) !== 'program' || !direction) return null;
    return programGoalLabelKey(direction === 'lose' ? 'lose_weight' : 'gain_weight');
  }
  if (facts.standingGoal === 'lose') return 'goal.lose';
  if (facts.standingGoal === 'gain') return 'goal.gain';
  return null;
}

/** The stored target was reached: the field opens empty, and says why. */
export function showsReachedNote(facts: TargetSheetFacts): boolean {
  const stored = facts.storedTarget;
  if (!stored || !isTargetReached(stored)) return false;
  const direction = targetDirection(facts);
  if (!direction) return targetGoalUnknown(facts);
  return knownDirection(stored) === direction;
}

/**
 * The value the field opens with: the stored target, when it points the way
 * of the goal it now serves (or that goal is unknown) and has not been
 * reached; otherwise null (an empty field).
 */
export function targetPrefillKg(facts: TargetSheetFacts): number | null {
  const stored = facts.storedTarget;
  if (!stored || isTargetReached(stored)) return null;
  const direction = targetDirection(facts);
  const matches = direction ? knownDirection(stored) === direction : targetGoalUnknown(facts);
  return matches ? TargetWeightRules.rounded(stored.targetWeightKg) : null;
}

// ---------------------------------------------------------------------------
// The body sheet's target field (iOS BodySheet `applyStoredTargetPrefill`)

/**
 * The body sheet prefills from the stored target when it matches the goal's
 * direction and has not been reached; otherwise empty. Run when the sheet
 * opens and whenever the goal chip changes direction, because a lose target
 * means nothing to a gain goal.
 */
export function bodyTargetPrefillKg(direction: TargetDirection | null, stored: TargetWeightView | null): number | null {
  if (!direction || !stored || knownDirection(stored) !== direction || isTargetReached(stored)) return null;
  return TargetWeightRules.rounded(stored.targetWeightKg);
}

/** The body sheet's reached note: the stored target points this goal's way but was already reached. */
export function bodyShowsReachedNote(
  showsTarget: boolean,
  direction: TargetDirection | null,
  stored: TargetWeightView | null,
): boolean {
  if (!showsTarget || !stored || !isTargetReached(stored)) return false;
  return knownDirection(stored) === direction;
}
