/**
 * The runner's side of the app outside the runner: the Resume row and the
 * outbox, set up when a member's profile loads (any tab) and again on Plan's
 * load. The Android port of iOS `WorkoutRunnerSupport`
 * (Views/Workout/FinishWorkoutSheet.swift).
 */
import { refreshRunnerProgress } from '../persistence/runnerStore';

import { activateWorkoutOutbox } from './workoutOutbox';

/**
 * Read `runner.json` into Plan's Resume row (deleting one past its day) and
 * load the member's outbox. `flushNow`: the activation flush, for the
 * profile load that opens the app (background semantics).
 */
export async function activateWorkoutRunnerSupport(
  profileId: string,
  options: { readonly flushNow?: boolean } = {},
): Promise<void> {
  await refreshRunnerProgress(profileId);
  await activateWorkoutOutbox(profileId, { flushNow: options.flushNow });
}
