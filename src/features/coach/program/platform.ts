/**
 * What the programme wizard asks of other features: the body sheet and the
 * day picker (BODY-2's and PLAN-4's published contracts) and the monthly
 * feedback's safety hook (FEED-1's).
 *
 * NOTHING LOADS AT IMPORT. The Coach's store loads every flow, and the store
 * loads with the Coach's sign-in and sign-out hooks (../register.ts), long
 * before any screen; those three doors bring their screens with them (the
 * sheets, their icons). So each is required when the wizard first calls it,
 * by which time the app has long loaded it, and a store, a register file or
 * a background job can load the Coach without loading any UI.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- loaded at call time (see above) */
import type * as BodySheets from '../../body/sheets';
import type * as Feedback from '../../feedback';
import type * as PlanDays from '../../plan/days';

/** The body sheet (`openBodySheet`), in intake mode for the wizard. */
export function presentBodySheet(mode: BodySheets.BodySheetMode): void {
  (require('../../body/sheets') as typeof BodySheets).openBodySheet(mode);
}

/** The day picker (`openChangeDays`), in select mode for the wizard. */
export function presentDaysSheet(mode: PlanDays.ChangeDaysMode): void {
  (require('../../plan/days') as typeof PlanDays).openChangeDays(mode);
}

/**
 * Whether a local safety refusal turns food and weight out of the monthly
 * feedback: the server has the feedback, consent stands, and the switch is on
 * or off only by default (FEED-1's `turnsOffFeedbackFoodOnRefusal`).
 */
export function feedbackFoodOffOnRefusal(): boolean {
  return (require('../../feedback') as typeof Feedback).turnsOffFeedbackFoodOnRefusal();
}

/** Sends `{ "includeFoodAndWeight": false }` and nothing else (FEED-1's `turnOffFoodForSafety`). */
export function turnFeedbackFoodOff(): Promise<void> {
  return (require('../../feedback') as typeof Feedback).turnOffFoodForSafety();
}
