/**
 * Plan's weekly check-in (iOS PlanView `case .weeklyCheckIn(let entry)`):
 * draws the request `openWeeklyCheckIn` made (./presenter.ts) with the Today
 * read's weigh-in and check-in state, reports `weekly_checkin_opened` with
 * the door it came through, and reads the day again once a check-in is
 * saved so the review card and the week show it.
 *
 * Mounted by Plan's review slot (../../sections/WeeklyReview.tsx); draws
 * nothing until a request comes in.
 */
import { useEffect } from 'react';

import { useHealthStore } from '../../../health';
import { track } from '../../../lib/analytics';
import { reloadPlan } from '../shell';

import {
  attachWeeklyCheckInHost,
  dismissWeeklyCheckIn,
  useWeeklyCheckInPresenter,
  weeklyCheckInClosed,
} from './presenter';
import WeeklyCheckInSheet from './WeeklyCheckInSheet';

export default function WeeklyCheckInHost() {
  useEffect(() => attachWeeklyCheckInHost(), []);
  const request = useWeeklyCheckInPresenter((s) => s.request);
  const visible = useWeeklyCheckInPresenter((s) => s.visible);
  const weighIn = useHealthStore((s) => s.today?.weighIn ?? null);
  const checkIn = useHealthStore((s) => s.today?.checkIn ?? null);

  const requestId = request?.id ?? null;
  const entry = request?.entry ?? null;
  useEffect(() => {
    if (requestId !== null && entry !== null) track('weekly_checkin_opened', { entry });
  }, [requestId, entry]);

  if (!request) return null;
  return (
    <WeeklyCheckInSheet
      key={request.id}
      visible={visible}
      weighIn={weighIn}
      checkIn={checkIn}
      onClose={() => dismissWeeklyCheckIn(request.id)}
      onClosed={() => weeklyCheckInClosed(request.id)}
      onSaved={() => void reloadPlan({ force: true })}
      testID="plan.checkin"
    />
  );
}
