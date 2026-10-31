/**
 * The body sheet's and the target sheet's public types: the values a wizard
 * gets back (iOS `BodyDetails`, Models/CoachProgramWizard.swift), the chip
 * values they are made of, and the modes each sheet opens in. Published
 * through ../sheets/index.ts (plan 3.0.3); nothing here renders.
 */
import type { TargetWeightView } from '../../../health';

// ---------------------------------------------------------------------------
// The chip values (contract.ts PROGRAM_* enums)

/** The age bands, in iOS's order. Asked only when the kennitala is not verified. */
export const PROGRAM_AGE_BANDS = ['18_24', '25_34', '35_44', '45_54', '55_64', '65_plus'] as const;
export type ProgramAgeBand = (typeof PROGRAM_AGE_BANDS)[number];

export const PROGRAM_SEXES = ['female', 'male', 'unspecified'] as const;
export type ProgramSex = (typeof PROGRAM_SEXES)[number];

export const PROGRAM_ACTIVITIES = ['sedentary', 'light', 'moderate', 'active'] as const;
export type ProgramActivity = (typeof PROGRAM_ACTIVITIES)[number];

/** The programme goals (wire values). Only the first two take a target weight. */
export const PROGRAM_GOALS = ['lose_weight', 'gain_weight', 'build_muscle', 'get_fitter'] as const;
export type ProgramGoal = (typeof PROGRAM_GOALS)[number];

/** The calorie goal chips, in iOS's order. */
export const CALORIE_GOALS = ['lose', 'maintain', 'gain'] as const;
export type CalorieGoal = (typeof CALORIE_GOALS)[number];

export const ageBandLabelKey = (band: ProgramAgeBand): string => `body.age_band.${band}`;
export const sexLabelKey = (sex: ProgramSex): string => `body.sex.${sex}`;
export const activityLabelKey = (activity: ProgramActivity): string => `body.activity.${activity}`;
export const programGoalLabelKey = (goal: string): string => `program.goal.${goal}`;
export const calorieGoalLabelKey = (goal: CalorieGoal): string => `goal.${goal}`;

/** A wire value this build knows, else null (an unknown value from a newer server is not guessed at). */
export function knownValue<T extends string>(values: readonly T[], raw: string | null | undefined): T | null {
  return raw != null && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

// ---------------------------------------------------------------------------
// What the intake returns

/**
 * What the body sheet hands a wizard. Held in memory for the length of the
 * wizard and sent once, with the build: nothing here is stored by the sheet.
 * NEVER a chat bubble, a chip, an analytics param or a saved session: the
 * bubble says "details added" (and "with a target weight"), never a number.
 */
export interface BodyDetails {
  readonly weightKg: number;
  readonly heightCm: number;
  /** Used only when the kennitala is not verified, and then required. */
  readonly ageBand: ProgramAgeBand | null;
  readonly sex: ProgramSex | null;
  /** Required by the contract. The sheet preselects `light`, the value the server stores when no body is sent (C13). */
  readonly activity: ProgramActivity;
  /** The optional target, asked only for a lose or gain goal on a server that advertises `target_weight`. */
  readonly targetWeightKg: number | null;
  /**
   * The field was shown and its value differs from what it opened with (the
   * standing target, when that pointed the same way). Only a touched target
   * is sent: null touched means "remove it", untouched means "leave the
   * standing target alone".
   */
  readonly targetWeightTouched: boolean;
}

/** The 30 to 300 kg and 120 to 230 cm the fields take. */
export const BODY_WEIGHT_RANGE = { min: 30, max: 300 } as const;
export const BODY_HEIGHT_RANGE = { min: 120, max: 230 } as const;

/** A target the wizard should mention in its bubble: "with a target weight", never the number. */
export function givesTarget(details: Pick<BodyDetails, 'targetWeightTouched' | 'targetWeightKg'>): boolean {
  return details.targetWeightTouched && details.targetWeightKg !== null;
}

// ---------------------------------------------------------------------------
// Modes

/** What the intake already knows (iOS `BodySheet.Prefill`). */
export interface BodyPrefill {
  readonly weightKg?: number | null;
  readonly heightCm?: number | null;
  readonly kennitalaVerified: boolean;
  /** The programme goal the wizard is building for (its wire value). A target is asked only for lose or gain weight. */
  readonly goal?: string | null;
  /** The member's standing target (from the Today read), which prefills the field when it points the same way and is not reached. */
  readonly target?: TargetWeightView | null;
  /**
   * What this wizard was already told, when the sheet is opened again (the
   * summary's body row, "Change the target"), so the member is not asked to
   * type their sex, age and activity a second time.
   */
  readonly details?: BodyDetails | null;
}

/** What an intake answered. */
export type BodyIntakeResult =
  | { readonly kind: 'used'; readonly details: BodyDetails }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'cancelled' };

/**
 * The body sheet's modes. Every callback runs once the sheet has gone from
 * the screen, never while it is still sliding away, so a caller can open the
 * next sheet (the Coach's days question) straight from it.
 */
export type BodySheetMode =
  /** A wizard asks for the body details it plans with (nothing is saved here). */
  | {
      readonly kind: 'intake';
      readonly prefill: BodyPrefill;
      readonly onResult: (result: BodyIntakeResult) => void;
    }
  /** Update the body details (for a live programme when `programId` is set). `onSaved`: the caller re-reads. */
  | {
      readonly kind: 'update';
      readonly programId: string | null;
      readonly onSaved?: () => void;
    }
  /** The calorie goal without a workout plan. `onSaved`: the caller re-reads. */
  | { readonly kind: 'goal'; readonly onSaved?: () => void };

/** The target sheet's modes (iOS `TargetWeightSheet.Mode`). */
export type TargetSheetMode =
  /** Save (or remove) the member's target weight through `PUT /health/target-weight`. */
  | {
      readonly kind: 'save';
      /** The standing target the caller already holds (the Today read's, Body and goals'); the sheet re-reads it. */
      readonly existing?: TargetWeightView | null;
      /** The server stored the change (a new target or a removal); the caller re-reads. */
      readonly onSaved?: () => void;
      /** Also called, after `onSaved`, when the stored change was a removal. */
      readonly onRemove?: () => void;
      /** Closed without storing anything. */
      readonly onCancel?: () => void;
    }
  /** A wizard picks a target for `goal` (nothing is saved here: the Coach confirms first). */
  | {
      readonly kind: 'pick';
      /** The programme goal (wire value) the target is for. */
      readonly goal: string;
      /** The standing target from the Today read. */
      readonly existing?: TargetWeightView | null;
      readonly onPicked: (targetKg: number) => void;
      /** "Remove target" was confirmed. */
      readonly onRemove?: () => void;
      /** Closed without a choice. */
      readonly onCancel?: () => void;
    };
