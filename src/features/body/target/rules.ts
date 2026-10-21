/**
 * The client half of the target weight rules (`SPEC` 4.4): the Android port
 * of iOS `TargetWeightRules` (Models/HealthModels.swift), mirrored so the
 * server rarely has to refuse. The body sheet, the target sheet and the
 * Coach all check a target with this before anything is sent.
 *
 * Comparisons are on TENTHS of a kilo, as the server's are: `72.9 - 1.0` in
 * floating point is not `71.9`, and a member who types exactly one kilo under
 * their weight must not be told it is too close. And the lowest target a
 * height allows is rounded UP, so the number shown is one the member can save.
 *
 * Pure, no React, no I/O.
 */
import { roundTargetKg, targetTenths } from '../../../api/targetWeight';
import { parseDecimal } from '../../../i18n/format';

/** Which way a target points. */
export type TargetDirection = 'lose' | 'gain';

/** What is wrong with a typed target, in the order the server checks. */
export type TargetProblem =
  | { readonly kind: 'range' }
  | { readonly kind: 'needsWeight' }
  | { readonly kind: 'loseDirection' }
  | { readonly kind: 'gainDirection' }
  /** Below a healthy weight for the height; carries the lowest target that height allows, which is shown. */
  | { readonly kind: 'bmiLow'; readonly minKg: number }
  | { readonly kind: 'bmiHigh' };

const PROBLEM_KEYS: Readonly<Record<TargetProblem['kind'], string>> = {
  range: 'target.err.range',
  needsWeight: 'target.err.needs_weight',
  loseDirection: 'target.err.lose_direction',
  gainDirection: 'target.err.gain_direction',
  bmiLow: 'target.err.bmi_low',
  bmiHigh: 'target.err.bmi_high',
};

/** The 30 to 300 kg every weight field takes. */
const RANGE = { min: 30, max: 300 } as const;
/** A target this close to the current weight is "already there". */
const MIN_GAP_TENTHS = 10;
const BMI_LOWER_BOUND = 18.5;
const BMI_UPPER_BOUND = 40;

/**
 * Swift's `(x - 1e-9).rounded(.up)`, with the multiplication in Swift's
 * order (`bound * metres * metres * 10`), so a float lands on the same side
 * of a whole tenth as it does on iOS.
 */
function bmiTenths(bound: number, heightCm: number): number {
  const metres = heightCm / 100;
  return Math.ceil(bound * metres * metres * 10 - 1e-9);
}

export const TargetWeightRules = {
  range: RANGE,
  minGapTenths: MIN_GAP_TENTHS,
  bmiLowerBound: BMI_LOWER_BOUND,
  bmiUpperBound: BMI_UPPER_BOUND,

  /** Whole tenths of a kilo (`tenths(71.9)` is 719). */
  tenths: targetTenths,

  /** A typed or stored value on the server's 0.1 kg grid. */
  rounded: roundTargetKg,

  /** True when `kg` is inside 30 to 300 (the closed range). */
  inRange(kg: number): boolean {
    return kg >= RANGE.min && kg <= RANGE.max;
  },

  /** The lowest target a height allows, in tenths: BMI 18.5, rounded UP. */
  minHealthyTenths(heightCm: number): number {
    return bmiTenths(BMI_LOWER_BOUND, heightCm);
  },

  /** The lowest target a height allows, in kilos (170 cm: 53.5). */
  minHealthyKg(heightCm: number): number {
    return bmiTenths(BMI_LOWER_BOUND, heightCm) / 10;
  },

  /** The first target at BMI 40 or over for a height, in tenths. */
  maxRefusedTenths(heightCm: number): number {
    return bmiTenths(BMI_UPPER_BOUND, heightCm);
  },

  /** The plan goal a target goes with (`lose_weight`, `gain_weight`), or null for a goal that takes none. */
  directionForProgramGoal(goal: string | null | undefined): TargetDirection | null {
    if (goal === 'lose_weight') return 'lose';
    if (goal === 'gain_weight') return 'gain';
    return null;
  },

  /** The calorie goal (`lose`, `maintain`, `gain`) a target goes with, or null. */
  directionForCalorieGoal(goal: string | null | undefined): TargetDirection | null {
    if (goal === 'lose') return 'lose';
    if (goal === 'gain') return 'gain';
    return null;
  },

  /**
   * Which way a typed target points when the goal it would serve is not
   * known on this phone (a running plan whose Today read has not loaded): at
   * or under the current weight is down, over it is up. It only picks which
   * checks apply to the field; the server, which knows the goal, decides.
   * Without a value or a weight, `validate` answers before the direction
   * matters, so `lose` is only a placeholder there.
   */
  inferredDirection(targetKg: number | null | undefined, weightKg: number | null | undefined): TargetDirection {
    if (targetKg == null || weightKg == null) return 'lose';
    return targetTenths(targetKg) <= targetTenths(weightKg) ? 'lose' : 'gain';
  },

  /** The field as typed. Empty is not a problem: the target is optional. */
  validateText(
    text: string,
    direction: TargetDirection,
    weightKg: number | null | undefined,
    heightCm: number | null | undefined,
  ): TargetProblem | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const value = parseDecimal(trimmed);
    if (value === null) return { kind: 'range' };
    return TargetWeightRules.validate(value, direction, weightKg, heightCm);
  },

  /**
   * In the server's order (4.4): range, a current weight, the direction and
   * the one-kilo gap, then the healthy-weight bounds when the height is known.
   */
  validate(
    targetKg: number,
    direction: TargetDirection,
    weightKg: number | null | undefined,
    heightCm: number | null | undefined,
  ): TargetProblem | null {
    if (!Number.isFinite(targetKg) || !TargetWeightRules.inRange(targetKg)) return { kind: 'range' };
    if (weightKg == null) return { kind: 'needsWeight' };
    const target = targetTenths(targetKg);
    const weight = targetTenths(weightKg);
    if (direction === 'lose' && target > weight - MIN_GAP_TENTHS) return { kind: 'loseDirection' };
    if (direction === 'gain' && target < weight + MIN_GAP_TENTHS) return { kind: 'gainDirection' };
    if (heightCm != null && heightCm > 0) {
      if (direction === 'lose' && target < TargetWeightRules.minHealthyTenths(heightCm)) {
        return {
          kind: 'bmiLow',
          minKg: TargetWeightRules.minHealthyKg(heightCm),
        };
      }
      if (direction === 'gain' && target >= TargetWeightRules.maxRefusedTenths(heightCm)) return { kind: 'bmiHigh' };
    }
    return null;
  },

  /** The copy key for a problem (`target.err.*`). */
  problemKey(problem: TargetProblem): string {
    return PROBLEM_KEYS[problem.kind];
  },
} as const;
