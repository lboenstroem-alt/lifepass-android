/**
 * Swapping the exercise on screen: the Android port of iOS
 * `WorkoutRunnerModel.swap(to:forRestOfPlan:)` (Views/Workout/WorkoutRunnerView.swift,
 * `ios-ux.md` 7.5).
 *
 * SWAP IS LIMITED TO WHAT THE SERVER PRECOMPUTED. The options are the
 * block's `alternatives` (and, once a swap is on, the planned exercise to go
 * back to), never a search: the server refuses a `performed` exercise
 * outside the block, and no model is asked for anything. The pure rule
 * (`swap` in ../model/state.ts) refuses anything `swapOptions` would not
 * offer, so a stale option changes nothing.
 *
 * FOR THE REST OF THE PLAN. With the toggle on (shown only online), the
 * server is told in the background (`action: swap`, `scope: future`, the
 * PLANNED exercise and the new one, a fresh key). A failure shows nothing:
 * the swap still applies to this session, which is what the member asked
 * for in front of them. Going back to the planned exercise never posts.
 */
import { newIdempotencyKey } from '../../../api/idempotency';
import { RunnerAnalytics } from '../model/analytics';
import { currentExercise, swap } from '../model/state';
import type { RunnerSwapOption } from '../model/types';
import { workoutSessionPosting, type WorkoutSessionPosting } from '../outbox/posting';
import type { RunnerController } from '../screen/controller';

export interface SwapDependencies {
  /** The session calls (the live one by default; tests and fixtures stand in). */
  readonly posting?: WorkoutSessionPosting;
  readonly mintKey?: () => string;
}

/**
 * Swap the exercise on screen for `option`. `forRestOfPlan` also asks the
 * server to use it for the rest of the plan (never for the way back).
 * Returns false when the swap is not on offer (nothing changed).
 */
export function swapExercise(
  controller: RunnerController,
  option: RunnerSwapOption,
  forRestOfPlan: boolean,
  dependencies: SwapDependencies = {},
): boolean {
  if (controller.isClosed) return false;
  const before = currentExercise(controller.state);
  if (!before) return false;
  const exercise = controller.state.index;
  const result = swap(controller.state, exercise, option.exerciseId);
  if (!result.swapped) return false;
  // Written down, and the keep-awake follows a stopwatch the swap stopped.
  controller.apply(() => result.state);
  const future = forRestOfPlan && !option.isPlanned;
  RunnerAnalytics.exerciseSwapped(future);
  if (!future) return true;
  const posting = dependencies.posting ?? workoutSessionPosting();
  const key = (dependencies.mintKey ?? newIdempotencyKey)();
  try {
    void posting
      .swapForRestOfPlan(controller.state.sessionId, before.plannedExerciseId, option.exerciseId, key)
      .catch(() => undefined);
  } catch {
    // Silent, as a failed answer is.
  }
  return true;
}
