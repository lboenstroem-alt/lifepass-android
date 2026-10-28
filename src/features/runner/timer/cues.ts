/**
 * The runner's physical cues (iOS `.sensoryFeedback` on the runner view):
 *
 *   a set ticked                 light impact
 *   a rest over, on screen       success
 *   a hold's changeover          medium impact ("Switch sides")
 *
 * iOS fires them from counters the view model bumps (`tickCount`,
 * `restFinishedCount`, `switchSidesCount`); the Android runner keeps the same
 * counters (its tests read them) and calls these at the same moments. Every
 * cue is fire and forget, and follows the system's touch-feedback setting
 * (src/lib/haptics.ts).
 */
import { haptics } from '../../../lib/haptics';

export interface RunnerCues {
  setTicked(): void;
  restFinished(): void;
  switchSides(): void;
}

export const liveRunnerCues: RunnerCues = {
  setTicked: () => haptics.impact('light'),
  restFinished: () => haptics.notification('success'),
  switchSides: () => haptics.impact('medium'),
};
