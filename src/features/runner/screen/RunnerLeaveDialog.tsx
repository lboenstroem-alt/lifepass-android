/**
 * "Leave this workout?" (iOS `.alert` on the runner, 7.8), from the close
 * cross and from Android's back:
 *
 *   Save and finish        the finish sheet (RUN-3)
 *   Finish later today     the clock stops, the workout is kept; Plan shows Resume
 *   Skip this workout      only when the session can be skipped, no set is
 *                          done and the app is online (RUN-3's sheet)
 *   Discard workout        red: deleted, closed
 *   Cancel
 *
 * An ALERT, not an action sheet, so Cancel is always in sight (iOS chose the
 * alert for that). Five answers is more than Android's own alert holds, so
 * it is the UI kit's Dialog, which scrolls at large text.
 */
import { Dialog, type DialogButton } from '../../../components/ui';
import { useT } from '../../../i18n';

export interface RunnerLeaveDialogProps {
  readonly visible: boolean;
  readonly canSkipWorkout: boolean;
  readonly onClose: () => void;
  readonly onSaveAndFinish: () => void;
  readonly onLater: () => void;
  readonly onSkipWorkout: () => void;
  readonly onDiscard: () => void;
}

/** The answers, in iOS's order. */
export function leaveButtons(
  t: (key: string) => string,
  options: Omit<RunnerLeaveDialogProps, 'visible' | 'onClose'>,
): DialogButton[] {
  return [
    { label: t('runner.leave_save'), onPress: options.onSaveAndFinish, testID: 'runner.leave.save' },
    { label: t('runner.leave_later'), onPress: options.onLater, testID: 'runner.leave.later' },
    ...(options.canSkipWorkout
      ? [{ label: t('runner.skip_workout'), onPress: options.onSkipWorkout, testID: 'runner.leave.skipWorkout' }]
      : []),
    { label: t('runner.leave_discard'), role: 'destructive', onPress: options.onDiscard, testID: 'runner.leave.discard' },
    { label: t('common.cancel'), role: 'cancel', testID: 'runner.leave.cancel' },
  ];
}

export default function RunnerLeaveDialog({ visible, onClose, ...options }: RunnerLeaveDialogProps) {
  const { t } = useT();
  if (!visible) return null;
  return (
    <Dialog
      visible
      onClose={onClose}
      title={t('runner.leave_title')}
      buttons={leaveButtons(t, options)}
      testID="runner.leave"
    />
  );
}
