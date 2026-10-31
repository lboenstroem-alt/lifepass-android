/**
 * "Nice work" (iOS `FinishWorkoutSheet`, Views/Workout/FinishWorkoutSheet.swift,
 * `ios-ux.md` 7.7): from the big "Finish workout", the quiet one, and the
 * Leave dialog's "Save and finish".
 *
 *   Nice work
 *   2 of 4 exercises · 5 sets
 *   Minutes            (-)  35 min  (+)      5 minute steps, 5 to 180
 *   How did it feel?   Easy / Just right / Hard / Too hard (optional)
 *   You're offline...                        offline, before a Save
 *   ---------------------------------------- pinned at the bottom
 *   the reason a Save did not go through, with "Finish later today"
 *   Save workout
 *   Keep going
 *
 * The status block is pinned with Save, so the reason is in sight however
 * far the page scrolls (iOS keeps it at the medium detent too). While a Save
 * is in flight the sheet cannot be closed and Keep going is off.
 *
 * "This workout was changed on another device. Save what you did as an extra
 * workout?" is an alert over the sheet (Save as extra / Cancel). When a Save
 * needs the member's consent, the consent sheet opens over this one and Save
 * runs again once it is granted.
 *
 * The flow (./finishFlow.ts) does the work; this draws it.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityActionEvent, type Text } from 'react-native';

import { Card, Dialog, hiddenFromAccessibility, LPText, Sheet } from '../../../components/ui';
import { HealthConsentSheet } from '../../../health/ui';
import { useA11ySize } from '../../../hooks/useA11ySize';
import { useT } from '../../../i18n';
import { duration } from '../../../i18n/format';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { colors } from '../../../theme';
import { summary } from '../model/state';
import type { RunnerState } from '../model/types';

import ChoiceGrid from './ChoiceGrid';
import { FINISH_FEELINGS, FINISH_MINUTES_MAX, FINISH_MINUTES_MIN, type FinishFlow } from './finishFlow';
import SheetActionButton from './SheetActionButton';

export interface FinishWorkoutSheetProps {
  readonly visible: boolean;
  readonly flow: FinishFlow;
  /** The workout, for the summary line. */
  readonly state: RunnerState;
  /** The health store's last error was a lost connection (iOS `isOffline`). */
  readonly isOffline: boolean;
  /** Keep going, back, or a pan down. */
  readonly onClose: () => void;
  readonly onClosed?: () => void;
}

export default function FinishWorkoutSheet({ visible, flow, state, isOffline, onClose, onClosed }: FinishWorkoutSheetProps) {
  const { t, language } = useT();
  const titleRef = useRef<Text>(null);
  const { status, minutes, feeling, needsConsent } = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const { isAccessibilitySize: stacked } = useA11ySize();
  const saving = status.kind === 'saving';
  const notActive = status.kind === 'notActive';

  const onMinutesAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') flow.stepMinutes(1);
    if (event.nativeEvent.actionName === 'decrement') flow.stepMinutes(-1);
  };

  const footer = (
    <View style={styles.footer}>
      <StatusBlock flow={flow} />
      <SheetActionButton
        title={t('runner.save')}
        onPress={() => void flow.save()}
        disabled={notActive}
        busy={saving}
        testID="finish.save"
      />
      <Pressable
        testID="finish.keepGoing"
        onPress={onClose}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel={t('runner.keep_going')}
        accessibilityState={{ disabled: saving }}
        style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
      >
        <LPText size={14} weight="semibold" color={colors.paper2}>
          {t('runner.keep_going')}
        </LPText>
      </Pressable>
    </View>
  );

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        onClosed={onClosed}
        busy={saving}
        footer={footer}
        initialFocusRef={titleRef}
        testID="finish.sheet"
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <LPText ref={titleRef} serif size={28} color={colors.paper} accessibilityRole="header">
              {t('runner.finish_title')}
            </LPText>
            <LPText size={15} color={colors.paper2} testID="finish.summary">
              {RunnerFormat.summary(summary(state), language)}
            </LPText>
          </View>

          <Card style={styles.minutesCard}>
            {/* At the accessibility text sizes the word goes over the stepper, so neither is cut short. */}
            <View
              style={stacked ? styles.minutesStacked : styles.minutesRow}
              testID={stacked ? 'finish.minutes.stacked' : 'finish.minutes.row'}
            >
              <View style={stacked ? undefined : styles.minutesLabel} {...hiddenFromAccessibility}>
                <LPText size={15} weight="semibold" color={colors.paper}>
                  {t('runner.minutes')}
                </LPText>
              </View>
              <View style={styles.stepper}>
                <StepButton
                  icon="remove"
                  label={t('a11y.runner.fewer_minutes')}
                  disabled={minutes <= FINISH_MINUTES_MIN}
                  onPress={() => flow.stepMinutes(-1)}
                  testID="finish.minutes.minus"
                />
                <View
                  testID="finish.minutes"
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('runner.minutes')}
                  accessibilityValue={{ text: RunnerFormat.counted('runner.dose.minutes', minutes, language) }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={onMinutesAction}
                  style={[styles.minutesValue, stacked && styles.minutesValueStacked]}
                >
                  <LPText size={20} weight="semibold" color={colors.paper} align="center" style={styles.digits}>
                    {duration(minutes, language)}
                  </LPText>
                </View>
                <StepButton
                  icon="add"
                  label={t('a11y.runner.more_minutes')}
                  disabled={minutes >= FINISH_MINUTES_MAX}
                  onPress={() => flow.stepMinutes(1)}
                  testID="finish.minutes.plus"
                />
              </View>
            </View>
          </Card>

          <View style={styles.feelingBlock}>
            <LPText size={15} weight="semibold" color={colors.paper} accessibilityRole="header">
              {t('plan.feeling.q')}
            </LPText>
            <ChoiceGrid
              options={FINISH_FEELINGS.map((value) => ({
                value,
                label: t(`plan.feeling.${value}`),
                testID: `finish.feeling.${value}`,
              }))}
              selected={feeling}
              onPress={(value) => flow.toggleFeeling(value)}
            />
          </View>

          {isOffline && status.kind === 'idle' ? (
            <LPText size={13} color={colors.paper2} testID="finish.offlineHint">
              {t('runner.offline_hint')}
            </LPText>
          ) : null}
        </View>
      </Sheet>

      <Dialog
        visible={visible && status.kind === 'askSaveAsExtra'}
        onClose={() => flow.dismissSaveAsExtra()}
        title={t('runner.err.changed')}
        testID="finish.askExtra"
        buttons={[
          { label: t('runner.save_anyway'), onPress: () => void flow.saveAsExtra(), testID: 'finish.saveExtra' },
          { label: t('common.cancel'), role: 'cancel', onPress: () => flow.dismissSaveAsExtra(), testID: 'finish.saveExtra.cancel' },
        ]}
      />

      <HealthConsentSheet
        visible={visible && needsConsent}
        entry="plan"
        onClose={() => flow.consentShown()}
        onGranted={() => flow.save()}
        testID="finish.consent"
      />
    </>
  );
}

/** Why the last Save did not go through, with the way out ("Finish later today"). */
function StatusBlock({ flow }: { flow: FinishFlow }) {
  const { t } = useT();
  const { status } = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  if (status.kind === 'notActive') {
    return (
      <Card style={styles.statusCard} testID="finish.notActive">
        <View accessibilityLiveRegion="polite">
          <LPText size={14} color={colors.paper}>
            {t('runner.err.not_active')}
          </LPText>
        </View>
        <LaterButton color={colors.rust} onPress={() => flow.leaveLater()} />
      </Card>
    );
  }
  if (status.kind === 'failed') {
    return (
      <View style={styles.failed} testID="finish.error">
        <View style={styles.failedLine} accessibilityLiveRegion="polite">
          <View {...hiddenFromAccessibility}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
          </View>
          <LPText size={14} color={colors.paper} style={styles.failedText} testID="finish.error.message">
            {t(status.messageKey)}
          </LPText>
        </View>
        <LaterButton color={colors.paper2} onPress={() => flow.leaveLater()} />
      </View>
    );
  }
  return null;
}

function LaterButton({ color, onPress }: { color: string; onPress: () => void }) {
  const { t } = useT();
  return (
    <Pressable
      testID="finish.later"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('runner.leave_later')}
      style={({ pressed }) => [styles.later, pressed && styles.pressed]}
    >
      <LPText size={14} weight="semibold" color={color}>
        {t('runner.leave_later')}
      </LPText>
    </Pressable>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.step, disabled && styles.stepDisabled, pressed && !disabled && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.paper} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 22, paddingTop: 8, paddingBottom: 16 },
  header: { gap: 6 },
  minutesCard: { padding: 14 },
  minutesRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  minutesStacked: { gap: 10 },
  minutesLabel: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  minutesValue: { minWidth: 84, alignItems: 'center', justifyContent: 'center' },
  minutesValueStacked: { flex: 1 },
  digits: { fontVariant: ['tabular-nums'] },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink3,
  },
  stepDisabled: { opacity: 0.4 },
  feelingBlock: { gap: 12 },
  // The Sheet's footer slot draws the hairline, the ink and the side padding.
  footer: { gap: 6 },
  statusCard: { paddingHorizontal: 14, paddingVertical: 10, gap: 10, marginBottom: 4 },
  failed: { gap: 10, marginBottom: 4 },
  failedLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  failedText: { flex: 1 },
  later: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  quiet: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
