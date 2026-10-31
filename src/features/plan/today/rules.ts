/**
 * The rules the Today card decides its offers by, as pure functions (iOS
 * `WorkoutRunnerEligibility`, Views/Workout/WorkoutRunnerView.swift, and
 * `LogWorkoutGate` and `PlanRestPull`, Views/Plan/LogWorkoutSheet.swift).
 *
 * They live with the card because the card is where each one is asked:
 * Start or not, "Log a workout" or not, which later session a rest day may
 * pull forward. The Home Today row and the session preview ask the same
 * questions, so they import them from here rather than keeping a copy that
 * could drift. PLAN-3's Log a workout sheet names the same pull candidate.
 */
import type { HealthDay, SessionBrief, SessionKind, SessionView } from '../../../health';
import { addServerDays } from '../../../i18n/format';

/**
 * What the workout runner runs: strength, cardio and mobility (iOS 7.2). A
 * swim day is NOT here: the runner already runs metres (a pool day's blocks
 * are dosed in them), but whether a pool day gets Start is the owner's call,
 * and iOS 2.5.6 says no. Adding `'swim'` here is the whole switch.
 */
export const RUNNER_KINDS: readonly SessionKind[] = ['strength', 'cardio', 'mobility'];

/** True when the runner runs this kind (iOS `WorkoutRunnerEligibility.runs`). */
export function runnerRuns(kind: SessionKind | null | undefined): boolean {
  return RUNNER_KINDS.includes(kind ?? 'rest');
}

/**
 * Start: today's planned session, for an entitled member, on a plan that is
 * not paused, and not already saved on this phone (iOS
 * `WorkoutRunnerEligibility.canStartToday`). `outboxPending` is the workout
 * outbox's answer for this session, read by the caller so this stays pure.
 */
export function canStartRunnerToday(
  session: Pick<SessionView, 'kind' | 'scheduledFor' | 'status'>,
  context: { readonly readOnly: boolean; readonly programPaused: boolean; readonly outboxPending: boolean; readonly today: string },
): boolean {
  return (
    !context.readOnly &&
    !context.programPaused &&
    runnerRuns(session.kind) &&
    session.scheduledFor === context.today &&
    (session.status ?? 'planned') === 'planned' &&
    !context.outboxPending
  );
}

/**
 * "Log a workout" on a row (iOS `LogWorkoutGate.offers`): the server's
 * `canLogExtra`, and nothing the card could get wrong around it: not read
 * only, not a future date (the flag already says so; this is the backup),
 * and not while a Save for the row waits in the workout outbox. A server
 * without API 0.34.0 sends no flag, and nothing new shows.
 */
export function offersLogWorkout(
  session: Pick<SessionView, 'canLogExtra'>,
  context: { readonly readOnly: boolean; readonly isFuture: boolean; readonly outboxPending: boolean },
): boolean {
  return session.canLogExtra === true && !context.readOnly && !context.isFuture && !context.outboxPending;
}

/**
 * The Sunday of the week the card is showing, from the week block the same
 * read answered with (iOS `PlanRestPull.weekEndDate`). Null without a week.
 */
export function weekEndDate(day: Pick<HealthDay, 'week'>): string | null {
  const start = day.week?.weekStartsOn;
  return start ? addServerDays(start, 6) : null;
}

/**
 * A planned non-rest row later in THIS ISO WEEK, which a rest day can offer
 * to pull forward (iOS `PlanRestPull.candidate`, `ios-ux.md` 3.7). Shared by
 * the rest row's own button and the Log a workout sheet's "Was it
 * Saturday's session?" link, so both name the same day.
 *
 * The week boundary is the whole point. `upcoming` is today plus six days,
 * so on a Friday or a Saturday it runs into next week, and the server will
 * not let a session cross the Sunday: the row would name Monday's session,
 * and the preview it opens would then have no "Do it today" button, because
 * `canPull` is false. Better not to make the offer.
 *
 * Nor on a rest day that already carries an extra: a pull swaps the two rows
 * whole, so the workout logged today would go with the rest row to the later
 * day (the web's form holds back the same way).
 */
export function restPullCandidate(day: Pick<HealthDay, 'upcoming' | 'day' | 'date' | 'week'>): SessionBrief | null {
  const upcoming = day.upcoming;
  if (!upcoming) return null;
  if ((day.day?.session?.extras ?? []).length > 0) return null;
  const weekEnd = weekEndDate(day);
  return (
    upcoming.find((brief) => {
      const date = brief.scheduledFor;
      if (!date || date <= day.date) return false;
      if (weekEnd !== null && date > weekEnd) return false;
      if ((brief.status ?? 'planned') !== 'planned') return false;
      return (brief.kind ?? 'rest') !== 'rest';
    }) ?? null
  );
}
