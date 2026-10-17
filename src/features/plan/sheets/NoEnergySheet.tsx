// @f4-stub (plan 3.0.3): "No energy today?" (move or skip a session), filled by PLAN-3; mounted by PLAN-2.
//
// iOS `NoEnergySheet(session:tomorrowTitle:startsInSkipMode:onResult:onChangedElsewhere:)`.
// Controlled: PLAN-2 shows it and closes it. Locked while a move or skip is
// in flight (`busy` on F5's Sheet). Keep the default export and its props;
// replace the body (and this marker). Renders nothing until PLAN-3 lands.
import type { PlanSessionRef } from './types';

export interface NoEnergySheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly session: PlanSessionRef;
  /** Tomorrow's session title when tomorrow holds one: the move becomes a swap. */
  readonly tomorrowTitle?: string | null;
  /** Opened from a missed row: straight to the skip reasons. */
  readonly startsInSkipMode?: boolean;
  /** The server's answer to the move or skip (PLAN-3 types it as the health store's action result). */
  readonly onResult: (result: unknown) => void;
  /** The plan changed elsewhere (409): Plan re-reads. */
  readonly onChangedElsewhere: () => void;
}

export default function NoEnergySheet(_props: NoEnergySheetProps) {
  return null;
}
