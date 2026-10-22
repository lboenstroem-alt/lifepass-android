/**
 * The runner's sheets, mounted by the runner screen (./WorkoutRunnerView.tsx)
 * over the page (RUN-3; iOS `.sheet(isPresented:)` on `WorkoutRunnerView`):
 *
 *   'finish'       FinishWorkoutSheet: from "Finish workout" (the big button
 *                  or the quiet one) and the Leave dialog's "Save and
 *                  finish". As it opens the Save key is minted (once) and
 *                  the minutes are prefilled (iOS `prepareFinish`).
 *   'swap'         SwapExerciseSheet: from "Swap" (shown only when
 *                  `controller.swapOptions()` is not empty). A row swaps and
 *                  closes the sheet.
 *   'skipWorkout'  SkipWorkoutSheet: from the Leave dialog's "Skip this
 *                  workout" (offered only when `controller.canSkipWorkout`
 *                  and online).
 *
 * The sheets stay mounted and are driven by `sheet`, so each slides in and
 * out as a sheet does. Their work is in ../finish, ../skip and ../swap; a
 * Save or a Skip that goes through closes the runner itself
 * (`controller.close`). The sheets are drawn in the UI kit's portal, above
 * every screen, and the closing runner stays mounted until its transition
 * ends, so every sheet is hidden the moment the runner closes (a Save, a
 * Skip, "Finish later today", a wipe) and slides out with it, as on iOS.
 *
 * Only the runner's state is read here, not its clock: the page publishes
 * `now` every second, and the sheets need not draw again for it.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import FinishWorkoutSheet from '../finish/FinishWorkoutSheet';
import { finishFlowFor } from '../finish/finishFlow';
import { currentExercise } from '../model/state';
import SkipWorkoutSheet from '../skip/SkipWorkoutSheet';
import { skipWorkoutFlowFor } from '../skip/skipWorkoutFlow';
import SwapExerciseSheet from '../swap/SwapExerciseSheet';
import { swapExercise } from '../swap/swapFlow';

import type { RunnerController } from './controller';

export type RunnerSheet = 'finish' | 'swap' | 'skipWorkout';

export interface RunnerSheetsProps {
  readonly controller: RunnerController;
  /** The sheet to show, or null. */
  readonly sheet: RunnerSheet | null;
  /** The sheet closed itself (Cancel, back, Keep going, a swap chosen). */
  readonly onClose: () => void;
  /** The health store's last error was a lost connection (iOS `isOffline`). */
  readonly isOffline: boolean;
}

export default function RunnerSheets({ controller, sheet, onClose, isOffline }: RunnerSheetsProps) {
  const readState = () => controller.state;
  const readClosed = () => controller.isClosed;
  const state = useSyncExternalStore(controller.subscribe, readState, readState);
  const closed = useSyncExternalStore(controller.subscribe, readClosed, readClosed);
  const finish = finishFlowFor(controller);
  const skipWorkout = skipWorkoutFlowFor(controller);
  const shown = useRef<RunnerSheet | null>(null);

  // The finish sheet opens: key and minutes, before it is drawn.
  useLayoutEffect(() => {
    if (sheet === 'finish' && shown.current !== 'finish') finish.prepare();
    shown.current = sheet;
  }, [sheet, finish]);

  const current = currentExercise(state);

  return (
    <>
      <FinishWorkoutSheet
        visible={sheet === 'finish' && !closed}
        flow={finish}
        state={state}
        isOffline={isOffline}
        onClose={onClose}
      />
      <SwapExerciseSheet
        visible={sheet === 'swap' && !closed}
        onClose={onClose}
        currentName={current?.name ?? ''}
        setCount={current?.sets.length ?? 1}
        options={controller.swapOptions()}
        canUseForRestOfPlan={!isOffline}
        onSelect={(option, forRestOfPlan) => {
          swapExercise(controller, option, forRestOfPlan);
          onClose();
        }}
      />
      <SkipWorkoutSheet visible={sheet === 'skipWorkout' && !closed} flow={skipWorkout} onClose={onClose} />
    </>
  );
}
