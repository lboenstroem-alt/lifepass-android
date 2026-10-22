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
 * (`controller.close`), which takes the sheets with it.
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
  const { state } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
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
        visible={sheet === 'finish'}
        flow={finish}
        state={state}
        isOffline={isOffline}
        onClose={onClose}
      />
      <SwapExerciseSheet
        visible={sheet === 'swap'}
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
      <SkipWorkoutSheet visible={sheet === 'skipWorkout'} flow={skipWorkout} onClose={onClose} />
    </>
  );
}
