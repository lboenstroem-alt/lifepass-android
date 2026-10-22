/**
 * A Save's or a Skip's answer, onto the day in memory, before the runner
 * closes (iOS PlanView `runnerClosed`, `.saved` and `.skipped`).
 *
 * The response replaces day, week and upcoming at once, so the Today card
 * shows Done (or Skipped) the moment the runner goes, not after the read that
 * follows (Plan reads again when it is back in front). A "Do it now" answers
 * with ITS date's row and week, which may be last week: today's row and week
 * are only taken from it when they are today's, and the row goes onto the
 * date it belongs to when that date is in memory.
 */
import type { SessionActionResponse } from '../../../health/models';
import { useHealthStore } from '../../../health/store';
import { todayServerDay } from '../../../i18n/format';

export function applyRunnerAnswer(response: SessionActionResponse, today: string = todayServerDay()): void {
  const health = useHealthStore.getState();
  const sameWeek = (response.week?.weekStartsOn ?? null) === (health.today?.week?.weekStartsOn ?? null);
  const week = sameWeek ? response.week : null;
  if (response.session?.scheduledFor === today) {
    health.applyActionResult({ session: response.session, changed: response.changed, week, upcoming: response.upcoming });
  } else {
    health.applyActionResult({ session: null, changed: null, week, upcoming: response.upcoming });
  }
  if (response.session) useHealthStore.getState().applySessionsToOtherDays([response.session]);
}
