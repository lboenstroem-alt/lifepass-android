/**
 * The Plan tab's Today section (plan 3.0.3: filled by PLAN-2, mounted by
 * PLAN-1 with no props): the Today card for the day the week strip is on.
 *
 * It reads what it needs itself, from the page's one view model
 * (`usePlanView`: the day on screen, read only, offline, a finished block),
 * so it can never disagree with the page it sits on, and wires the card's
 * taps to the Plan shell (../today/todayHandlers.ts). With no day read yet it
 * draws nothing; the page shows its skeleton.
 */
import { useMemo } from 'react';

import { usePlanView } from '../shell';
import TodayCard from '../today/TodayCard';
import { todayHandlers } from '../today/todayHandlers';

export default function TodaySection() {
  const view = usePlanView();
  const day = view.shownDay;
  const programId = day?.program?.id ?? null;
  // One set of handlers per programme, so the card's memoised context holds.
  const handlers = useMemo(() => todayHandlers(programId), [programId]);
  if (!day) return null;
  return (
    <TodayCard
      day={day}
      isReadOnly={view.isReadOnly}
      isOffline={view.isOffline}
      isBlockFinished={view.isBlockFinished}
      handlers={handlers}
    />
  );
}
