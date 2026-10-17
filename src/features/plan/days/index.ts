// @f4-stub (plan 3.0.3): the change-days sheet, filled by PLAN-4; used by COACH-4 and COACH-5.
//
// iOS `ChangeDaysSheet(mode:daysPerWeek:selected:...)`: `select` picks days
// for a wizard (nothing is saved), `program` saves a live programme's days.
// Keep the exported names and signatures; replace the bodies (and this
// marker). `ChangeDaysHost` is mounted once by F4's tabs shell.
export { default as ChangeDaysHost } from './ChangeDaysHost';

export type ChangeDaysMode =
  | {
      readonly kind: 'select';
      readonly daysPerWeek: number;
      /** ISO weekdays already picked (1 = Monday ... 7 = Sunday). */
      readonly selected: readonly number[];
      readonly onPicked: (days: number[]) => void;
      readonly onCancel?: () => void;
    }
  | {
      readonly kind: 'program';
      readonly programId: string;
      readonly daysPerWeek: number;
      readonly selected: readonly number[];
      /** Saved: the programme came back with its new days. */
      readonly onSaved?: () => void;
      readonly onCancel?: () => void;
    };

/** Opens the sheet over whatever is showing. A no-op until PLAN-4 lands. */
export function openChangeDays(mode: ChangeDaysMode): void {
  void mode;
}
