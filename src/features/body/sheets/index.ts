// The body sheet and the target-weight sheet (plan 3.0.3, BODY-2), for PLAN-4,
// PLAN-5, COACH-4, COACH-5 and Body and goals.
//
// iOS `BodySheet(mode:)` (intake for a wizard, update, goal) and
// `TargetWeightSheet(mode:)` (save a target, or pick one for a wizard), opened
// from anywhere: `BodySheetsHost` is mounted once by F4's tabs shell and
// draws what these ask for.
//
//   openBodySheet({ kind: 'goal', onSaved: () => void reload() });
//   openTargetSheet({ kind: 'pick', goal: 'lose_weight', existing, onPicked: (kg) => ... });
//
// RULES FOR CALLERS:
// - One sheet at a time. A request while one is on screen (or with no host,
//   signed out) is not shown and is answered at once as a close: an intake's
//   `{ kind: 'cancelled' }`, a pick's or a save's `onCancel`.
// - Every callback runs once the sheet has GONE from the screen, never while
//   it is sliding away, so the next sheet or a page can be opened from it.
// - The values an intake returns are health data: never a chat bubble, a
//   chip, an analytics param or a saved session (`givesTarget` says whether
//   a bubble may mention "a target weight", never which).
// - The target rules (`TargetWeightRules`) are the same ones the sheets run;
//   the Coach checks a target with them before it confirms a change.
import { presentBodySheet, presentTargetSheet } from '../sheet/presenter';
import type { BodySheetMode, TargetSheetMode } from '../sheet/types';

export { default as BodySheetsHost } from './BodySheetsHost';

export {
  activityLabelKey,
  ageBandLabelKey,
  BODY_HEIGHT_RANGE,
  BODY_WEIGHT_RANGE,
  CALORIE_GOALS,
  calorieGoalLabelKey,
  givesTarget,
  knownValue,
  PROGRAM_ACTIVITIES,
  PROGRAM_AGE_BANDS,
  PROGRAM_GOALS,
  PROGRAM_SEXES,
  programGoalLabelKey,
  sexLabelKey,
  type BodyDetails,
  type BodyIntakeResult,
  type BodyPrefill,
  type BodySheetMode,
  type CalorieGoal,
  type ProgramActivity,
  type ProgramAgeBand,
  type ProgramGoal,
  type ProgramSex,
  type TargetSheetMode,
} from '../sheet/types';
export { TargetWeightRules, type TargetDirection, type TargetProblem } from '../target/rules';
export { isBodySheetsHostMounted } from '../sheet/presenter';

/** Opens the body sheet over whatever is showing (see the rules above). */
export function openBodySheet(mode: BodySheetMode): void {
  presentBodySheet(mode);
}

/** Opens the target-weight sheet over whatever is showing (see the rules above). */
export function openTargetSheet(mode: TargetSheetMode): void {
  presentTargetSheet(mode);
}
