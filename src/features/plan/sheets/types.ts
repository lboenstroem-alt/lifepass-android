// What the Plan sheets need of a session (plan 3.0.3, filled by PLAN-3).
//
// Every field but `id` is optional, so the health store's `SessionView` (the
// Today card's session) and its `SessionBrief` (a later row a rest day may
// pull forward) both satisfy it without a conversion.
import type { DoneSource, SessionKind, SessionStatusView } from '../../../health';

export interface PlanSessionRef {
  readonly id: string;
  readonly title?: string | null;
  /** The row's `YYYY-MM-DD` (the pull line names its weekday). */
  readonly scheduledFor?: string | null;
  readonly kind?: SessionKind | null;
  readonly status?: SessionStatusView | null;
  /** Who counted a done row: the "already logged" line under Log a workout. */
  readonly doneSource?: DoneSource | null;
  /** The server's move rule for No energy (`canMove`, `moveBlockedReason`, `canSkip`). */
  readonly canMove?: boolean | null;
  readonly moveBlockedReason?: string | null;
  readonly canSkip?: boolean | null;
}
