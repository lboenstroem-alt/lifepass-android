/**
 * "What got in the way?" for the whole session (iOS `SkipWorkoutSheet`,
 * Views/Workout/SwapExerciseSheet.swift, `OP-20`), from the Leave dialog's
 * "Skip this workout".
 *
 *   What got in the way?
 *   Your plan carries on as it is. Nothing else moves.
 *   No time / Tired / Sore / Something else      two columns
 *   the reason the skip did not go through
 *   Skip workout                                 off until a reason is chosen
 *   Cancel
 *
 * The reasons are the server's four member reasons in the No energy sheet's
 * words (`noenergy.reason.*`), so a skip reads the same wherever it was
 * made. While the skip is in flight the sheet cannot be closed.
 *
 * The flow (./skipWorkoutFlow.ts) does the work; this draws it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { LPText, Sheet } from '../../../components/ui';
import type { SkipReason } from '../../../health/models';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import ChoiceGrid from '../finish/ChoiceGrid';
import SheetActionButton from '../finish/SheetActionButton';

import { SKIP_WORKOUT_REASONS, type SkipWorkoutFlow } from './skipWorkoutFlow';

export interface SkipWorkoutSheetProps {
  readonly visible: boolean;
  readonly flow: SkipWorkoutFlow;
  /** Cancel, back, or a pan down. */
  readonly onClose: () => void;
  readonly onClosed?: () => void;
}

export default function SkipWorkoutSheet({ visible, flow, onClose, onClosed }: SkipWorkoutSheetProps) {
  const { t } = useT();
  const titleRef = useRef<Text>(null);
  const { isSkipping, errorKey } = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  // Each presentation starts with no reason chosen (iOS makes a new @State per sheet).
  const [reason, setReason] = useState<SkipReason | null>(null);

  useEffect(() => {
    if (visible) flow.reset();
  }, [visible, flow]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={() => {
        setReason(null);
        onClosed?.();
      }}
      busy={isSkipping}
      initialFocusRef={titleRef}
      testID="skip.sheet"
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <LPText ref={titleRef} serif size={24} color={colors.paper} accessibilityRole="header">
            {t('noenergy.skip_title')}
          </LPText>
          <LPText size={14} color={colors.paper2}>
            {t('runner.skip_workout_sub')}
          </LPText>
        </View>

        <ChoiceGrid
          options={SKIP_WORKOUT_REASONS.map((value) => ({
            value,
            label: t(`noenergy.reason.${value}`),
            testID: `skip.reason.${value}`,
          }))}
          selected={reason}
          onPress={setReason}
          disabled={isSkipping}
        />

        {errorKey ? (
          <View accessibilityLiveRegion="polite">
            <LPText size={13} color={colors.destructive} testID="skip.error">
              {t(errorKey)}
            </LPText>
          </View>
        ) : null}

        <SheetActionButton
          title={t('runner.skip_workout_confirm')}
          onPress={() => {
            if (reason) void flow.skip(reason);
          }}
          disabled={reason === null}
          busy={isSkipping}
          testID="skip.confirm"
        />

        <Pressable
          testID="skip.cancel"
          onPress={onClose}
          disabled={isSkipping}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          accessibilityState={{ disabled: isSkipping }}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <LPText size={14} weight="semibold" color={colors.paper2}>
            {t('common.cancel')}
          </LPText>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingTop: 8, paddingBottom: 8 },
  header: { gap: 6 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
