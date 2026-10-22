// @f4-stub (plan 3.0 rule 5; RUN-2 → RUN-3): the finish sheet is still to come (RUN-3).
/**
 * The runner's sheets, mounted by the runner screen (./WorkoutRunnerView.tsx)
 * over the page (RUN-3; iOS `.sheet(isPresented:)` on `WorkoutRunnerView`):
 *
 *   'swap'         SwapExerciseSheet: from "Swap" (shown only when
 *                  `controller.swapOptions()` is not empty). A row swaps and
 *                  closes the sheet.
 *   'skipWorkout'  SkipWorkoutSheet: from the Leave dialog's "Skip this
 *                  workout" (offered only when `controller.canSkipWorkout`
 *                  and online).
 *   'finish'       not yet: a development build says so.
 */
import { useSyncExternalStore } from 'react';

import { Dialog } from '../../../components/ui';
import { useT } from '../../../i18n';
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
  const { t } = useT();
  const { state } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const current = currentExercise(state);
  const skipWorkout = skipWorkoutFlowFor(controller);
  return (
    <>
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
      {__DEV__ && sheet === 'finish' ? (
        <Dialog
          visible
          onClose={onClose}
          title={t('nav.stub.not_in_build')}
          message={`${sheet} · RUN-3`}
          buttons={[{ label: t('common.close'), role: 'cancel', testID: 'runner.sheetStub.close' }]}
          testID={`stub.runner.${sheet}`}
        />
      ) : null}
    </>
  );
}
