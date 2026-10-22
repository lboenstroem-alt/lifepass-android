/**
 * What to do when a runner is asked for: the Android port of iOS
 * `RunnerLaunchDecision` and the entry rule of PlanView's `launchRunner`
 * (Views/Workout/WorkoutRunnerView.swift, Views/Plan/PlanView.swift).
 *
 * ONE FILE, SO NEVER A SILENT OVERWRITE. `runner.json` holds one workout. A
 * runner asked for while it holds ANOTHER session's workout with a set
 * logged asks the member first ("Another workout is in progress"); one with
 * nothing logged has nothing to lose and is replaced. A file that outlived
 * its day is gone anyway.
 *
 * Pure: the caller reads the file and the day, and carries the decision out
 * (./launchRunner.ts).
 */
import type { SessionView } from '../../../health/models';
import { anySetDone, isExpired } from '../model/state';
import type { RunnerEntry, RunnerState } from '../model/types';

export type RunnerLaunchDecision =
  /** Nothing is in the way: open the session (restored when the file is its). */
  | { readonly kind: 'open'; readonly restore: boolean }
  /** Another session's workout has sets logged: ask the member. */
  | { readonly kind: 'askAboutOther'; readonly saved: RunnerState }
  /** Another session's file with nothing logged: it is replaced. */
  | { readonly kind: 'replaceOther' };

/** iOS `RunnerLaunchDecision.decide(saved:for:today:)`. `today` is the server's day. */
export function decideRunnerLaunch(saved: RunnerState | null, sessionId: string, today: string): RunnerLaunchDecision {
  if (!saved || isExpired(saved, today)) return { kind: 'open', restore: false };
  if (saved.sessionId === sessionId) return { kind: 'open', restore: true };
  return anySetDone(saved) ? { kind: 'askAboutOther', saved } : { kind: 'replaceOther' };
}

/**
 * Where a runner opens from (iOS `launchRunner`): `resume` for a saved
 * workout, `missed` for a session that was missed or is dated before today
 * ("Do it now"), else `today`. The entry is `workout_started.entry`, and
 * `missed` keeps the file until the day after TODAY rather than the day
 * after the session.
 */
export function runnerEntryFor(
  session: Pick<SessionView, 'status' | 'scheduledFor'>,
  options: { readonly restored: boolean; readonly today: string },
): RunnerEntry {
  if (options.restored) return 'resume';
  const missed =
    (session.status ?? 'planned') === 'missed' || (session.scheduledFor !== null && session.scheduledFor < options.today);
  return missed ? 'missed' : 'today';
}

/** iOS `RunnerLaunchDecision`, under its own name so a port of the Swift reads like the Swift. */
export const RunnerLaunchDecisions = {
  decide: decideRunnerLaunch,
  entry: runnerEntryFor,
} as const;
