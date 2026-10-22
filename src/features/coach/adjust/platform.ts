/**
 * What Adjust my plan asks of other features: the target-weight sheet in
 * pick mode (BODY-2's published contract) and the change-days sheet (PLAN-4's,
 * through the programme wizard's own door, ../program/platform.ts).
 *
 * NOTHING LOADS AT IMPORT, for the reason ../program/platform.ts gives: the
 * Coach's store loads every flow with the sign-in and sign-out hooks, long
 * before any screen, and the sheets bring their screens with them. Each is
 * required when the flow first opens it.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- loaded at call time (see above) */
import type * as BodySheets from '../../body/sheets';

export { presentDaysSheet } from '../program/platform';

/** The target-weight sheet (`openTargetSheet`), in pick mode: nothing is saved there, the Coach confirms first. */
export function presentTargetSheet(mode: BodySheets.TargetSheetMode): void {
  (require('../../body/sheets') as typeof BodySheets).openTargetSheet(mode);
}
