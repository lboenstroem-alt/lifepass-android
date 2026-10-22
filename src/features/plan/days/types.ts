/**
 * What `openChangeDays` takes (iOS `ChangeDaysSheet.Mode` and its callbacks).
 *
 * The same sheet serves three callers, which is why it has a mode: the plan
 * overview and the proposal card save to the server (`program`), and the
 * programme wizard's training-days question simply hands the days back with
 * no call at all (`select`). One picker, one rule about how many days a plan
 * needs.
 *
 * Every callback runs once the sheet has GONE from the screen (./presenter.ts).
 */
import type { ProgramDetail } from '../../../health';

/** A saved change: the programme the server answered with (null when it sent none) and the days saved. */
export interface ChangeDaysSaved {
  readonly program: ProgramDetail | null;
  /** ISO weekdays, in weekday order. */
  readonly days: readonly number[];
}

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
      /**
       * Saved: the programme came back with its new days (iOS `onSaved` and
       * `onSavedDays` in one; a caller that wants neither ignores the argument).
       */
      readonly onSaved?: (saved: ChangeDaysSaved) => void;
      /**
       * The plan was ended, finished or deleted elsewhere
       * (`program_action_not_allowed`, `health_program_not_found`): the sheet
       * has closed, and the caller says so and reads again.
       */
      readonly onChanged?: () => void;
      readonly onCancel?: () => void;
    };
