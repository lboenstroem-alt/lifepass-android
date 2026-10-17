// @f4-stub (plan 3.0.3): the body sheet and the target-weight sheet, filled by BODY-2; used by PLAN-4, PLAN-5, COACH-4 and COACH-5.
//
// iOS `BodySheet(mode:)` (intake for a wizard, update, goal) and
// `TargetWeightSheet(mode:)` (save a target, or pick one for a wizard).
// Keep the exported names and signatures; replace the bodies (and this
// marker). `BodySheetsHost` is mounted once by F4's tabs shell.
export { default as BodySheetsHost } from './BodySheetsHost';

/** What the intake already knows (iOS `BodySheet.Prefill`). */
export interface BodyPrefill {
  readonly weightKg?: number | null;
  readonly heightCm?: number | null;
  readonly kennitalaVerified: boolean;
  /** The programme goal the wizard is building for (its wire value). */
  readonly goal?: string | null;
}

/** What an intake answered (BODY-2 may widen `details` to its own type). */
export type BodyIntakeResult =
  | { readonly kind: 'used'; readonly details: { readonly weightKg: number | null; readonly heightCm: number | null } }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'cancelled' };

export type BodySheetMode =
  /** A wizard asks for the body details it plans with (nothing is saved here). */
  | { readonly kind: 'intake'; readonly prefill: BodyPrefill; readonly onResult: (result: BodyIntakeResult) => void }
  /** Update the body details (for a live programme when `programId` is set). */
  | { readonly kind: 'update'; readonly programId: string | null; readonly onSaved?: () => void }
  /** The calorie goal. */
  | { readonly kind: 'goal'; readonly onSaved?: () => void };

export type TargetSheetMode =
  /** Save (or remove) the member's target weight. */
  | {
      readonly kind: 'save';
      readonly onSaved?: () => void;
      readonly onRemove?: () => void;
      readonly onCancel?: () => void;
    }
  /** A wizard picks a target for `goal` (nothing is saved here). */
  | {
      readonly kind: 'pick';
      readonly goal: string;
      readonly onPicked: (targetKg: number) => void;
      readonly onCancel?: () => void;
    };

/** Opens the body sheet over whatever is showing. A no-op until BODY-2 lands. */
export function openBodySheet(mode: BodySheetMode): void {
  void mode;
}

/** Opens the target-weight sheet over whatever is showing. A no-op until BODY-2 lands. */
export function openTargetSheet(mode: TargetSheetMode): void {
  void mode;
}
