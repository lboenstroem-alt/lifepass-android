// The workout runner's public contract (plan 3.0.3).
//
// RUN-1 owns the data functions and everything they re-export: the pure
// model (./model), runner.json and Plan's Resume row (./persistence), the
// save rules (./saveRules) and the workout outbox (./outbox). Ownership of
// `openRunner` passes to RUN-3 after RUN-1 merges.
//
// Used by PLAN-2 (the Today card: Start, Resume, "Waiting to sync"), Home's
// Today row, PLAN-1 (the failed-outbox banner and the outbox flush before
// Plan's read), F4's launch rule (src/app/launchTab.ts: a workout in
// progress keeps the tab it was left on), and the runner screen and sheets
// (RUN-2, RUN-3).
import { openRootModal } from '../../navigation/navigationRef';
import type { RunnerEntry } from '../../navigation/types';
import { useAppStore } from '../../stores/appStore';

import { activateWorkoutOutbox, hasPendingWorkoutNow, useWorkoutOutbox } from './outbox/workoutOutbox';
import { resumableWorkoutFor } from './persistence/runnerStore';

// `RunnerEntry` (navigation's route param) comes through ./model.
export * from './model';
export {
  CLOCK_WRITE_INTERVAL_MS,
  clockWriteDue,
  deleteRunner,
  loadRunner,
  persistRunner,
  readRunnerOutcome,
  refreshRunnerProgress,
  saveRunner,
} from './persistence/runnerStore';
export {
  progressSummaryOf,
  RunnerProgressIndex,
  selectRunnerProgressFor,
  selectRunnerProgressOtherThan,
  useRunnerProgress,
  type RunnerProgressState,
  type RunnerProgressSummary,
} from './persistence/progressIndex';
export { onRunnerWiped } from './persistence/wiped';
export {
  MOVED_REASONS,
  readRunnerFailure,
  runnerSaveOutcome,
  RunnerSaveRules,
  type RunnerCallFailure,
  type RunnerFailureKind,
  type RunnerSaveOutcome,
} from './saveRules';
export {
  convertedItem,
  isTooOld,
  outboxStep,
  WORKOUT_OUTBOX_CAPACITY,
  WORKOUT_OUTBOX_MAX_AGE_MS,
  WorkoutOutboxRules,
  type WorkoutOutboxItem,
  type WorkoutOutboxItemState,
  type WorkoutOutboxStep,
} from './outbox/rules';
export {
  liveWorkoutSessionPosting,
  setWorkoutSessionPosting,
  workoutSessionPosting,
  type WorkoutSessionPosting,
} from './outbox/posting';
export {
  activateWorkoutOutbox,
  discardWorkoutItem,
  enqueueWorkout,
  failedWorkoutItems,
  flushWorkoutOutbox,
  hasPendingWorkoutNow,
  saveFailedWorkoutAsExtra,
  selectHasPendingWorkout,
  useWorkoutOutbox,
  WorkoutOutbox,
  type FailedOutboxItem,
  type WorkoutOutboxState,
} from './outbox/workoutOutbox';
export { activateWorkoutRunnerSupport } from './outbox/support';
export {
  workoutPlanOutboxSource,
  type WorkoutPlanOutboxItem,
  type WorkoutPlanOutboxSource,
} from './outbox/planSource';

/** A workout saved on this phone that can be picked up again (iOS `runner.json`). */
export interface ResumableWorkout {
  /**
   * The session it is for. Null when a runner file exists but could not be
   * read (a storage error): the launch rule counts that as resumable, so the
   * stored tab is kept when in doubt (iOS `.unreadable`).
   */
  readonly sessionId: string | null;
}

/** What `openRunner` needs of a session (a full session object satisfies it). */
export interface RunnerSessionRef {
  readonly id: string;
}

/** The signed-in member's id, as their health folder is named. */
function signedInMemberId(): string | null {
  const app = useAppStore.getState();
  return app.profile?.id ?? app.userId ?? null;
}

/**
 * The workout this member can resume: a runner file of the current version
 * that has not outlived its day (`today`, the server's day, defaults to
 * now). `profileId` defaults to the signed-in member; the launch rule passes
 * the id of the session stored on the phone, because it runs before the app
 * store has restored anyone. Null when there is none, or no member.
 */
export async function resumableWorkout(profileId?: string, today?: string): Promise<ResumableWorkout | null> {
  const id = profileId ?? signedInMemberId();
  if (!id) return null;
  return resumableWorkoutFor(id, today);
}

/**
 * True when a finished workout for `sessionId` is still queued to be sent
 * (the outbox): the session is done as far as the member is concerned, and
 * no door may start it again. Loads the signed-in member's queue first when
 * it is not loaded yet. A screen re-renders on it through
 * `useWorkoutOutbox(selectHasPendingWorkout(sessionId))`.
 */
export async function hasPendingWorkout(sessionId: string): Promise<boolean> {
  const id = signedInMemberId()?.toLowerCase();
  if (id && useWorkoutOutbox.getState().loadedProfileId !== id) await activateWorkoutOutbox(id);
  return hasPendingWorkoutNow(sessionId);
}

/** Opens the full-screen runner on `session` (RUN-3 owns the body; this one only routes). */
export function openRunner(session: RunnerSessionRef, entry: RunnerEntry): void {
  openRootModal('WorkoutRunner', { sessionId: session.id, entry });
}
