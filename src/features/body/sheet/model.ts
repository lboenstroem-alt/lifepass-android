/**
 * The body sheet's rules, apart from its screen so they are tested on their
 * own: which error a field shows, when Save is allowed, what each save sends,
 * and which line a refusal reads. The port of the derived values in iOS
 * Views/Health/BodySheet.swift.
 *
 * Every field is TEXT, parsed with F1's HealthFormat port (`parseDecimal`,
 * `parseInteger`): a member on an Icelandic phone types "72,5" and one on an
 * English phone "72.5", and both mean the same whatever the device region.
 */
import type { NutritionGoalInput } from '../../../api/nutritionGoal';
import type { ProgramUpdateBody } from '../../../health';
import { parseDecimal, parseInteger } from '../../../i18n/format';
import { TargetWeightRules, type TargetDirection, type TargetProblem } from '../target/rules';

import {
  BODY_HEIGHT_RANGE,
  BODY_WEIGHT_RANGE,
  type ProgramActivity,
  type ProgramAgeBand,
  type ProgramSex,
} from './types';

/** The 1,000 to 5,000 kcal a member's own number may be. */
export const CUSTOM_KCAL_RANGE = { min: 1000, max: 5000 } as const;

export const parseWeight = (text: string): number | null => parseDecimal(text);
export const parseHeight = (text: string): number | null => parseInteger(text);
export const parseKcal = (text: string): number | null => parseInteger(text);

/** A typed weight that is not a weight in range (an empty field is not an error). */
export function weightFieldError(weightText: string): boolean {
  const value = parseWeight(weightText);
  if (value === null) return weightText.length > 0;
  return value < BODY_WEIGHT_RANGE.min || value > BODY_WEIGHT_RANGE.max;
}

export function heightFieldError(heightText: string): boolean {
  const value = parseHeight(heightText);
  if (value === null) return heightText.length > 0;
  return value < BODY_HEIGHT_RANGE.min || value > BODY_HEIGHT_RANGE.max;
}

export function customKcalError(customOn: boolean, customKcalText: string): boolean {
  if (!customOn) return false;
  const value = parseKcal(customKcalText);
  if (value === null) return customKcalText.length > 0;
  return value < CUSTOM_KCAL_RANGE.min || value > CUSTOM_KCAL_RANGE.max;
}

/**
 * The line under the weight field.
 *
 * `measurementCreateBodySchema` makes the weight mandatory, so a height
 * travels only beside one. Without the second rule Save was enabled on a
 * height-only edit, the weigh-in was skipped, and the sheet closed as if the
 * new height had been stored.
 *
 * THE TWO CASES SAY DIFFERENT THINGS. A weight outside 30 to 300 kg is a
 * wrong weight; a height typed with no weight beside it is a correct height
 * that cannot travel alone. Both used to say "Enter a weight between 30 and
 * 300 kg", which told a member who had touched only the height that their
 * weight was wrong.
 */
export function weightErrorKey(options: {
  readonly weightText: string;
  readonly heightText: string;
  readonly prefilledHeightCm: number | null;
  readonly isIntake: boolean;
}): string | null {
  if (weightFieldError(options.weightText)) return 'body.err.weight';
  const height = parseHeight(options.heightText);
  const heightEdited = height !== null && height !== options.prefilledHeightCm;
  if (!options.isIntake && heightEdited && parseWeight(options.weightText) === null)
    return 'body.err.height_needs_weight';
  return null;
}

export type BodySheetKind = 'intake' | 'update' | 'goal';

/** Whether the primary button may be pressed (iOS `canSubmit`). */
export function bodyCanSubmit(options: {
  readonly kind: BodySheetKind;
  readonly weightErrorKey: string | null;
  readonly heightError: boolean;
  readonly customError: boolean;
  readonly targetErrorKey: string | null;
  readonly weightText: string;
  readonly heightText: string;
  readonly needsAgeBand: boolean;
  readonly ageBand: ProgramAgeBand | null;
  readonly goal: string | null;
}): boolean {
  if (
    options.weightErrorKey !== null ||
    options.heightError ||
    options.customError ||
    options.targetErrorKey !== null
  ) {
    return false;
  }
  if (options.kind === 'intake') {
    if (parseWeight(options.weightText) === null || parseHeight(options.heightText) === null) return false;
    return !options.needsAgeBand || options.ageBand !== null;
  }
  if (options.kind === 'goal') {
    if (options.goal === null) return false;
    return !options.needsAgeBand || options.ageBand !== null;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The target field

/** The target's problem as the body sheet checks it: against the weight and height TYPED in this sheet. */
export function bodyTargetProblem(options: {
  readonly showsTarget: boolean;
  readonly direction: TargetDirection | null;
  readonly targetText: string;
  readonly weightText: string;
  readonly heightText: string;
}): TargetProblem | null {
  if (!options.showsTarget || options.direction === null) return null;
  return TargetWeightRules.validateText(
    options.targetText,
    options.direction,
    parseWeight(options.weightText),
    parseHeight(options.heightText),
  );
}

/** The typed target on the server's grid, or null. */
export function targetValueOf(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : TargetWeightRules.rounded(value);
}

/** `set`, `cleared` or `unchanged`: the analytics word, never the number. */
export function targetAnalyticsWord(touched: boolean, value: number | null): 'set' | 'cleared' | 'unchanged' {
  if (!touched) return 'unchanged';
  return value === null ? 'cleared' : 'set';
}

// ---------------------------------------------------------------------------
// What a save sends

/** Sex, age band and activity as the sheet opened, so Save sends only what CHANGED. */
export interface DetailsSnapshot {
  readonly sex: ProgramSex | null;
  /** Always null for a verified kennitala: the age comes from it. */
  readonly ageBand: ProgramAgeBand | null;
  readonly activity: ProgramActivity;
}

export function detailsSnapshot(
  details: {
    readonly sex: ProgramSex | null;
    readonly ageBand: ProgramAgeBand | null;
    readonly activity: ProgramActivity;
  },
  kennitalaVerified: boolean,
): DetailsSnapshot {
  return {
    sex: details.sex,
    ageBand: kennitalaVerified ? null : details.ageBand,
    activity: details.activity,
  };
}

/**
 * The live programme's update (6.5): only the fields that changed, and NO
 * CALL AT ALL (null) when none did. Activity always has a value, so posting
 * it every time would rewrite a programme on a Save that touched a weight.
 */
export function programBodyUpdate(initial: DetailsSnapshot, current: DetailsSnapshot): ProgramUpdateBody | null {
  if (initial.sex === current.sex && initial.ageBand === current.ageBand && initial.activity === current.activity) {
    return null;
  }
  const body: { sex?: string; ageBand?: string; activity?: string } = {};
  if (current.sex !== initial.sex && current.sex !== null) body.sex = current.sex;
  if (current.ageBand !== initial.ageBand && current.ageBand !== null) body.ageBand = current.ageBand;
  if (current.activity !== initial.activity) body.activity = current.activity;
  return { body };
}

/**
 * The calorie goal's save: the goal ALWAYS (null clears), the details, the
 * member's own number as a number or an explicit null when "Use my own
 * number" is off, and the target only when it was touched (left out means
 * "leave the stored target alone").
 */
export function goalSaveInput(options: {
  readonly goal: string | null;
  readonly sex: ProgramSex | null;
  readonly ageBand: ProgramAgeBand | null;
  readonly kennitalaVerified: boolean;
  readonly activity: ProgramActivity;
  readonly customOn: boolean;
  readonly customKcalText: string;
  readonly targetTouched: boolean;
  readonly targetValue: number | null;
}): NutritionGoalInput {
  return {
    goal: options.goal,
    sex: options.sex,
    ageBand: options.kennitalaVerified ? null : options.ageBand,
    activity: options.activity,
    // OFF means "clear the number I set": a null on the wire, not a missing key.
    customKcal: options.customOn ? parseKcal(options.customKcalText) : null,
    targetWeightKg: options.targetTouched ? options.targetValue : undefined,
  };
}

/**
 * Remove goal. The target goes with the goal ONLY when no plan it could
 * still serve is running: a lose plan keeps using it after the calorie goal
 * is gone (`SPEC` 6.1). When a plan runs whose goal this phone does not have,
 * the answer is keep: a target kept by mistake is one tap to remove, a target
 * cleared by mistake is gone from a plan that was using it.
 */
export function clearGoalInput(options: {
  readonly supportsTargetWeight: boolean;
  readonly hasStoredTarget: boolean;
  readonly liveProgramTakesTarget: boolean;
}): NutritionGoalInput {
  const clearsTarget = options.supportsTargetWeight && options.hasStoredTarget && !options.liveProgramTakesTarget;
  return { goal: null, targetWeightKg: clearsTarget ? null : undefined };
}

/** The line a `422 program_refused` reads. The sheet stays open and clears nothing. */
export function refusalKeyFor(reason: string | null | undefined): string {
  switch (reason) {
    case 'bmi_low_lose_weight':
      return 'goal.refused.bmi_low';
    case 'bmi_high':
      return 'goal.refused.bmi_high';
    case 'target_too_low':
      return 'goal.refused.target_low';
    case 'target_weight_bmi_low':
      return 'program.refused.target_bmi_low';
    case 'target_weight_bmi_high':
      return 'program.refused.target_bmi_high';
    default:
      return 'goal.refused.bmi_high';
  }
}
