/**
 * What Adjust my plan asks of other features, each through its owner's
 * published contract: the target-weight sheet in pick mode (BODY-2's
 * `openTargetSheet`) and the change-days sheet (PLAN-4's `openChangeDays`).
 *
 * NOTHING LOADS AT IMPORT, for the reason ../program/platform.ts gives: the
 * Coach's store loads every flow with the sign-in and sign-out hooks, long
 * before any screen, and the sheets bring their screens with them. Each is
 * required when the flow first opens it.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- loaded at call time (see above) */
import type * as BodySheets from '../../body/sheets';
import type * as PlanDays from '../../plan/days';

/** The target-weight sheet (`openTargetSheet`), in pick mode: nothing is saved there, the Coach confirms first. */
export function presentTargetSheet(mode: BodySheets.TargetSheetMode): void {
  (require('../../body/sheets') as typeof BodySheets).openTargetSheet(mode);
}

/** The change-days sheet (`openChangeDays`): `select` to pick days for the confirmation, `program` to save the same number moved. */
export function presentDaysSheet(mode: PlanDays.ChangeDaysMode): void {
  (require('../../plan/days') as typeof PlanDays).openChangeDays(mode);
}
