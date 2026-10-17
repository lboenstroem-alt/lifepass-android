// @f4-stub (plan 3.0.3): "Log a workout" on any day, filled by PLAN-3; mounted by PLAN-2.
//
// iOS `LogWorkoutSheet(session:cardDate:pullCandidate:onPull:onResult:onChangedElsewhere:)`.
// Controlled: PLAN-2 shows it and closes it. Keep the default export and its
// props; replace the body (and this marker). Renders nothing until PLAN-3 lands.
import type { PlanSessionRef } from './types';

export interface LogWorkoutSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly session: PlanSessionRef;
  /** The `YYYY-MM-DD` of the card the sheet was opened from. */
  readonly cardDate: string;
  /** A later session this week a rest day could pull forward instead. */
  readonly pullCandidate?: PlanSessionRef | null;
  readonly onPull?: () => void;
  /** The server's answer (PLAN-3 types it as the health store's action result). */
  readonly onResult: (result: unknown) => void;
  readonly onChangedElsewhere: () => void;
}

export default function LogWorkoutSheet(_props: LogWorkoutSheetProps) {
  return null;
}
