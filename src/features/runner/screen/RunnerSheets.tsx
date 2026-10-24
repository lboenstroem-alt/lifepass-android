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
 *                  closes the sheet. "Use this swap for the rest of the
 *                  plan" is not offered on a custom plan (the server
 *                  refuses it there), and while the server changes plans by
 *                  chat "I don't have this" (COACH-6) leaves the workout
 *                  for later (Plan shows Resume) and opens the Coach with
 *                  "I don't have the equipment for {exercise}" in its input,
 *                  for the member to send.
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

import { useHealthStore } from '../../../health';
import { currentLanguage, translate } from '../../../i18n';
import { useIntentStore } from '../../../stores/intentStore';
import { usePlanEditReady } from '../../coach/planEdit';

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
  const planEditReady = usePlanEditReady();
  const programId = state.session.programId;
  const customPlan = useHealthStore((s) => {
    const program = s.today?.program;
    return !!program && program.id === programId && program.custom === true;
  });

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
        canUseForRestOfPlan={!isOffline && !customPlan}
        onSelect={(option, forRestOfPlan) => {
          swapExercise(controller, option, forRestOfPlan);
          onClose();
        }}
        onNotHaveThis={
          planEditReady && !isOffline && current
            ? () => {
                onClose();
                notHaveThis(controller, {
                  sessionId: state.sessionId,
                  sessionTitle: state.session.title,
                  exerciseId: current.plannedExerciseId,
                  name: current.plannedName,
                });
              }
            : undefined
        }
      />
      <SkipWorkoutSheet visible={sheet === 'skipWorkout' && !closed} flow={skipWorkout} onClose={onClose} />
    </>
  );
}

/**
 * "I don't have this": the workout is left for later (kept, so Plan shows
 * Resume and Apply waits for it), and the Coach opens with the words in its
 * input and the exercise as context. The member sends them; nothing is sent
 * for them.
 */
export function notHaveThis(
  controller: Pick<RunnerController, 'leaveLater'>,
  exercise: { readonly sessionId: string; readonly sessionTitle: string | null; readonly exerciseId: string; readonly name: string },
): void {
  const intents = useIntentStore.getState();
  intents.parkCoachPlanEdit({
    sessionId: exercise.sessionId,
    sessionTitle: exercise.sessionTitle,
    exerciseId: exercise.exerciseId || null,
    prefill: translate('coach.planEdit.notHavePrefill', currentLanguage(), { exercise: exercise.name }),
  });
  controller.leaveLater();
  intents.requestTab('Coach');
}
