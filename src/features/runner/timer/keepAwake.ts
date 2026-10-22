/**
 * The screen stays on only while something counts: a rest, a timed set or a
 * cardio stopwatch (iOS `RunnerIdleTimer`, `ios-ux.md` 7.4). A phone put down
 * between exercises can lock and save its battery; a phone on the floor next
 * to a plank does not go dark mid-hold.
 *
 * One tag for the runner, and a native call only when the answer changes:
 * the runner asks twice a second.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export const RUNNER_KEEP_AWAKE_TAG = 'lifepass.runner';

/** What the runner asks of the screen (a seam, so the runner's tests can watch it). */
export type RunnerKeepAwake = (awake: boolean) => void;

let awakeNow = false;

/**
 * Keeps the screen on (`true`) or lets it lock again. Never throws. A native
 * call that fails (no current activity during a transition) is forgotten, so
 * the next ask, half a second later, tries again instead of being taken as
 * already done for a whole rest or hold.
 */
export const keepRunnerAwake: RunnerKeepAwake = (awake) => {
  if (awake === awakeNow) return;
  awakeNow = awake;
  try {
    const call = awake ? activateKeepAwakeAsync(RUNNER_KEEP_AWAKE_TAG) : deactivateKeepAwake(RUNNER_KEEP_AWAKE_TAG);
    call.catch(() => {
      if (awakeNow === awake) awakeNow = !awake;
    });
  } catch {
    // No native module (a test): the screen simply follows the system timeout.
  }
};

/** Tests: forget what was last asked. */
export function resetRunnerKeepAwakeForTests(): void {
  awakeNow = false;
}
