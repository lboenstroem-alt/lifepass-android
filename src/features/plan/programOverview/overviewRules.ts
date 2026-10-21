/**
 * The programme overview's rules (iOS ProgramOverviewView.swift), pure so
 * they can be tested on their own: the weeks in order, which week opens,
 * which week a choice lands on, the deload note, and whether a previewed
 * session may be started from here.
 */
import type { ProgramDetail, ProgramWeekPlan, SessionKind, SessionView } from '../../../health';

/** The weeks, by number. */
export function sortedWeeks(detail: Pick<ProgramDetail, 'weekPlans'> | null): ProgramWeekPlan[] {
  return [...(detail?.weekPlans ?? [])].sort((a, b) => a.weekNo - b.weekNo);
}

/**
 * The week a choice lands on: the chosen one when the plan has it, else the
 * first week there is (iOS `clampWeek`). A plan with no weeks keeps the choice.
 */
export function clampWeek(selected: number, weeks: readonly Pick<ProgramWeekPlan, 'weekNo'>[]): number {
  const numbers = weeks.map((week) => week.weekNo);
  if (numbers.length === 0 || numbers.includes(selected)) return selected;
  return numbers[0]!;
}

/** The week the screen opens on: the programme's current week, clamped to one it has. */
export function initialWeek(detail: ProgramDetail): number {
  return clampWeek(detail.program.weekNo ?? 1, sortedWeeks(detail));
}

/** The week drawn: the selected one, else the first (iOS `shownWeek`). */
export function shownWeek(weeks: readonly ProgramWeekPlan[], selected: number): ProgramWeekPlan | null {
  return weeks.find((week) => week.weekNo === selected) ?? weeks[0] ?? null;
}

/** "A lighter week to let your body catch up." shows only on the LAST week, and only when it is a deload. */
export function showsDeloadNote(weeks: readonly ProgramWeekPlan[], shown: ProgramWeekPlan | null): boolean {
  if (!shown) return false;
  return shown.weekNo === weeks[weeks.length - 1]?.weekNo && shown.deload === true;
}

/** The week's own note, when it has one. */
export function weekNote(shown: ProgramWeekPlan | null): string | null {
  const note = shown?.note ?? null;
  return note && note.length > 0 ? note : null;
}

/**
 * The kinds the runner runs (iOS `WorkoutRunnerEligibility.kinds`):
 * strength, cardio and mobility. A swim day is not here: whether a pool day
 * gets Start is the owner's call, on iOS too.
 */
const RUNNER_KINDS: readonly SessionKind[] = ['strength', 'cardio', 'mobility'];

/**
 * Start in the preview of a day row (iOS `canStartSession` with
 * `WorkoutRunnerEligibility.canStartToday`): today's planned session, for a
 * member who may write, on a plan that is not paused, a kind the runner
 * runs, and not already saved on this phone waiting to sync.
 */
export function canStartFromOverview(
  session: Pick<SessionView, 'kind' | 'scheduledFor' | 'status'>,
  context: { readonly readOnly: boolean; readonly programPaused: boolean; readonly today: string; readonly hasPending: boolean },
): boolean {
  return (
    !context.readOnly &&
    !context.programPaused &&
    RUNNER_KINDS.includes(session.kind ?? 'rest') &&
    session.scheduledFor === context.today &&
    (session.status ?? 'planned') === 'planned' &&
    !context.hasPending
  );
}
