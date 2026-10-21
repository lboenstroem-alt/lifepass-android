/**
 * What of a session action's answer goes into TODAY's read (iOS
 * `PlanActionAnswer`, PlanView.swift).
 *
 * THE WEEK IN AN ANSWER IS THE WEEK OF THE SESSION ACTED ON. Log it as done
 * or Skip on last week's missed row answers with LAST week, and writing that
 * into today's read put last week under this week's strip. So today's strip
 * takes the answer's week only when it is the week today's read shows, and
 * today's block takes the answer's session only when it is dated today. An
 * answer about another week leaves both alone and asks for the date on
 * screen to be read again.
 */
import type { SessionActionResponse, SessionView, WeekView } from '../../../health';

export interface PlanActionAnswer {
  readonly session: SessionView | null;
  readonly week: WeekView | null;
  readonly rereadsShownDate: boolean;
}

export function planActionAnswer(
  response: Pick<SessionActionResponse, 'session' | 'week'>,
  todayWeekStartsOn: string | null | undefined,
  today: string,
): PlanActionAnswer {
  // No week in the answer is no evidence of another week.
  const sameWeek = response.week ? response.week.weekStartsOn === (todayWeekStartsOn ?? null) : true;
  const scheduledFor = response.session?.scheduledFor ?? null;
  const actedOnToday = scheduledFor === null || scheduledFor === today;
  return {
    session: actedOnToday ? response.session : null,
    week: sameWeek ? response.week : null,
    rereadsShownDate: !sameWeek,
  };
}
