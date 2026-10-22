// @f4-stub (plan 3.0 rule 5; RUN-2 → RUN-3): the runner's finish, swap and skip-workout sheets, filled by RUN-3.
/**
 * The runner's sheets, mounted by the runner screen (./WorkoutRunnerView.tsx)
 * over the page. Marked as a stub so REL-1's "no stub ships" check holds the
 * release until RUN-3 has filled it: without it "Finish workout", "Save and
 * finish", "Swap" and "Skip this workout" open nothing, and a workout could
 * never be saved.
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
 * rule 2). Until then a development build says "Not in this build yet"
 * (as F4's stub screens do) and its Close resets the screen's `sheet`; a
 * release build opens nothing.
 */
import { Dialog } from '../../../components/ui';
import { useT } from '../../../i18n';

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

/** The package that fills this slot, shown to the developer. */
const OWNER = 'RUN-3';

export default function RunnerSheets({ sheet, onClose }: RunnerSheetsProps) {
  const { t } = useT();
  if (!__DEV__ || sheet === null) return null;
  return (
    <Dialog
      visible
      onClose={onClose}
      title={t('nav.stub.not_in_build')}
      message={`${sheet} · ${OWNER}`}
      buttons={[{ label: t('common.close'), role: 'cancel', testID: 'runner.sheetStub.close' }]}
      testID={`stub.runner.${sheet}`}
    />
  );
}
