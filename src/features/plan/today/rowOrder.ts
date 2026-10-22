/**
 * The Today card's state table (`ios-ux.md` 3.7) as pure functions, so every
 * branch is tested without rendering (iOS `PlanTodayCard.rowOrder`,
 * `sessionRows`, `plannedActions` and `missedRows`).
 *
 * The card follows the SELECTED date (R14): tapping Thursday on the week
 * strip changes this card and nothing else on the page, so there is never a
 * screen showing Thursday's workout under a "Today" heading. Rows that only
 * make sense today (the note, the check-in, a workout left for later, a
 * session moved away) are offered on today only.
 */
import type { SessionKind, SessionView } from '../../../health';

import { runnerRuns } from './rules';

/** The rows a date has, top to bottom. The card draws a hairline between each. */
export type TodayRow =
  /** The daily note, with "Why?". */
  | 'note'
  /** "Weekly check-in · Under a minute". */
  | 'checkIn'
  /** A workout in progress for THIS session (`runner.json`), with Resume. */
  | 'inProgress'
  /** A workout in progress for ANOTHER session (yesterday's left for later), with Resume. */
  | 'inProgressOther'
  /** "{title} moved to tomorrow." with Undo. */
  | 'movedAway'
  /** "Your plan is paused since {date}." with Resume plan. */
  | 'paused'
  /** "Week 4 done. Start the next block?" */
  | 'blockDone'
  /** The session, by its status. */
  | 'session';

export interface TodayRowInput {
  readonly isToday: boolean;
  /** Not entitled: the card reads and writes nothing (past due and lapsed alike). */
  readonly readOnly: boolean;
  readonly isPaused: boolean;
  /** The programme ran to its end and no proposal is waiting. */
  readonly isBlockFinished: boolean;
  /** Not now on the block-done row, for as long as the card is on screen. */
  readonly blockDoneDismissed: boolean;
  /** The day carries a note with a title or a body. */
  readonly hasNote: boolean;
  readonly checkInDue: boolean;
  /** `runner.json` holds a workout for the session on this card (already gated, see `todayRunnerProgress`). */
  readonly hasRunnerProgress: boolean;
  /** `runner.json` holds a workout for another session. */
  readonly hasOtherRunnerProgress: boolean;
  readonly hasMovedAway: boolean;
  readonly hasSession: boolean;
}

/** Which rows this date has, in the order of 3.7. */
export function todayRowOrder(input: TodayRowInput): TodayRow[] {
  const order: TodayRow[] = [];
  if (input.isToday && input.hasNote) order.push('note');
  // The check-in writes a weigh-in and a week rating, and 9.2 gives it to
  // entitled members only: offering it read-only would end in a 403 after
  // the member typed a weight.
  if (input.isToday && !input.readOnly && input.checkInDue) order.push('checkIn');
  if (input.hasRunnerProgress && !input.isPaused) order.push('inProgress');
  // Today names a workout left for later whichever session owns the file,
  // so yesterday's workout is not lost from view.
  if (input.isToday && input.hasOtherRunnerProgress && !input.isPaused) order.push('inProgressOther');
  if (input.isToday && input.hasMovedAway) order.push('movedAway');
  if (input.isPaused) {
    order.push('paused');
  } else if (input.isBlockFinished && !input.blockDoneDismissed) {
    order.push('blockDone');
  } else if (input.hasSession) {
    order.push('session');
  }
  return order;
}

/**
 * Whether the runner's progress counts for the card (iOS `runnerProgress`
 * and `otherRunnerProgress`): a read-only card offers no Resume, and this
 * session's progress counts only for a kind the runner runs.
 */
export function todayRunnerProgress<P extends { readonly sessionId: string }>(
  progress: P | null,
  context: { readonly readOnly: boolean; readonly session: Pick<SessionView, 'id' | 'kind'> | null },
): { readonly mine: P | null; readonly other: P | null } {
  if (context.readOnly || !progress) return { mine: null, other: null };
  const session = context.session;
  if (session && progress.sessionId === session.id) {
    return { mine: runnerRuns(session.kind) ? progress : null, other: null };
  }
  return { mine: null, other: progress };
}

/** How the session row reads, by its status (iOS `sessionRows`). */
export type SessionBody =
  /** Saved on this phone, not yet on the server: Done and "Waiting to sync", no action. */
  | 'waiting'
  | 'done'
  | 'skipped'
  | 'missed'
  | 'rest'
  /** A planned session on a later date: its lines and Preview. */
  | 'future'
  /** Today's (or a past day's still-planned) session with its actions. */
  | 'planned';

export function sessionBody(
  session: Pick<SessionView, 'status' | 'kind'>,
  context: { readonly isFuture: boolean; readonly outboxPending: boolean },
): SessionBody {
  const status = session.status ?? 'planned';
  // 3.7 "Waiting to sync": done as far as the member is concerned, with no
  // action that would race the queued Save.
  if (context.outboxPending && status !== 'done') return 'waiting';
  switch (status) {
    case 'done':
      return 'done';
    case 'skipped':
      return 'skipped';
    case 'missed':
      return 'missed';
    case 'rest':
      return 'rest';
    case 'planned':
    case 'unknown':
    default:
      if (context.isFuture) return 'future';
      if ((session.kind ?? 'rest') === 'rest') return 'rest';
      return 'planned';
  }
}

/** The lines a planned session shows above its actions (iOS `plannedRows`). */
export type PlannedLines = 'exercises' | 'class' | 'swim' | 'hike' | 'rest';

/** A planned row with no kind reads as strength, as on iOS (`session.kind ?? .strength`). */
export function plannedLines(kind: SessionKind | null | undefined): PlannedLines {
  switch (kind ?? 'strength') {
    case 'strength':
    case 'cardio':
    case 'mobility':
      return 'exercises';
    case 'class':
      return 'class';
    case 'swim':
      return 'swim';
    case 'hike':
    case 'walk':
      return 'hike';
    case 'rest':
    case 'unknown':
    default:
      return 'rest';
  }
}

/** A future row with no kind reads as rest, as on iOS (`session.kind ?? .rest`). */
export function futureLines(kind: SessionKind | null | undefined): PlannedLines {
  return kind ? plannedLines(kind) : 'rest';
}

/** An action on a planned row, in the order the row shows them. */
export type PlannedAction =
  /** The runner (capsule; works offline from the cached session). */
  | 'start'
  | 'viewBooking'
  | 'bookClass'
  | 'findPool'
  | 'markDone'
  /** "No energy today": today only, and not offline. */
  | 'noEnergy';

/**
 * The actions of a planned row, before the read-only check (the card draws
 * none read-only). Start gives way to the Resume row above while a workout
 * for this session is in progress. A pool day gets Start only once the
 * runner runs swims (`RUNNER_KINDS`).
 */
export function plannedActions(
  session: Pick<SessionView, 'kind'>,
  context: { readonly hasBooking: boolean; readonly hasRunnerProgress: boolean; readonly isToday: boolean; readonly isOffline: boolean },
): PlannedAction[] {
  const actions: PlannedAction[] = [];
  switch (session.kind ?? 'strength') {
    case 'strength':
    case 'cardio':
    case 'mobility':
      if (!context.hasRunnerProgress) actions.push('start');
      break;
    case 'class':
      if (context.hasBooking) {
        actions.push('viewBooking');
      } else {
        actions.push('bookClass', 'markDone');
      }
      break;
    case 'swim':
      if (runnerRuns('swim') && !context.hasRunnerProgress) actions.push('start');
      actions.push('findPool', 'markDone');
      break;
    case 'hike':
    case 'walk':
      actions.push('markDone');
      break;
    default:
      break;
  }
  if (context.isToday && !context.isOffline) actions.push('noEnergy');
  return actions;
}

/** What a missed row offers (iOS `missedRows`). */
export type MissedAction = 'doItNow' | 'logDone' | 'skipIt';

export function missedActions(
  session: Pick<SessionView, 'kind' | 'canLogDone' | 'canSkip'>,
  readOnly: boolean,
): { readonly canAct: boolean; readonly actions: MissedAction[] } {
  const canAct = (session.canLogDone === true || session.canSkip === true) && !readOnly;
  if (!canAct) return { canAct, actions: [] };
  const actions: MissedAction[] = [];
  // "Do it now" runs the session in the runner and files it on its own date (R21).
  if (session.canLogDone === true && runnerRuns(session.kind)) actions.push('doItNow');
  if (session.canLogDone === true) actions.push('logDone');
  if (session.canSkip === true) actions.push('skipIt');
  return { canAct, actions };
}

/**
 * Offline dims every capsule and text action, except the runner's own:
 * Start, Do it now and Resume run from the cached session, and their Save
 * goes to the outbox (7.2).
 */
export function worksOffline(action: PlannedAction | MissedAction | 'resume'): boolean {
  return action === 'start' || action === 'doItNow' || action === 'resume';
}
