/**
 * @runner-slot (RUN-2 → RUN-3): the runner's sheets, mounted by the runner
 * screen (./WorkoutRunnerView.tsx) over the page.
 *
 *   'finish'       FinishWorkoutSheet: from "Finish workout" (the big button
 *                  or the quiet one) and the Leave dialog's "Save and
 *                  finish". On open it mints the Save key (`ensureFinishKey`
 *                  through `controller.apply`) and prefills the minutes.
 *   'swap'         SwapExerciseSheet: from "Swap" (shown only when
 *                  `controller.swapOptions()` is not empty).
 *   'skipWorkout'  SkipWorkoutSheet: from the Leave dialog's "Skip this
 *                  workout" (offered only when `controller.canSkipWorkout`
 *                  and online).
 *
 * The sheets change the workout through `controller.apply(change)` (it
 * writes runner.json and keeps the keep-awake right), end it with
 * `controller.endRunner()` and leave with `controller.close(result)`.
 *
 * RUN-3 replaces this body (and the marker) and keeps the signature;
 * ownership of this file passes to RUN-3 once RUN-2 has merged (plan 3.0
 * rule 2). Until then nothing opens.
 */
import type { RunnerController } from './controller';

export type RunnerSheet = 'finish' | 'swap' | 'skipWorkout';

export interface RunnerSheetsProps {
  readonly controller: RunnerController;
  /** The sheet to show, or null. */
  readonly sheet: RunnerSheet | null;
  /** The sheet closed itself (Cancel, back, Keep going). */
  readonly onClose: () => void;
  /** The health store's last error was a lost connection (iOS `isOffline`). */
  readonly isOffline: boolean;
}

export default function RunnerSheets(_props: RunnerSheetsProps) {
  return null;
}
