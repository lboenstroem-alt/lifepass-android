/**
 * The runner's bottom bar (iOS `bottomBar`, 7.3 and 7.4).
 *
 * WHILE RESTING it is the rest bar: the ring, "Rest" and the countdown, "-15"
 * and "+15", and "Skip rest". One line where it fits; on a narrow phone the
 * countdown sits over the buttons, so "Skip rest" is never cut short. There is
 * no primary button while resting: a set cannot be completed from it until
 * the rest is over or skipped.
 *
 * OTHERWISE: "Finish workout" as a quiet text button (unless the big button
 * already says it), the set about to be done in words ("Set 2 of 3: 10 reps,
 * 12.5 kg") and the big button: "Start set 2" for a timed set, "Complete set
 * 2", "Next exercise" or "Finish workout".
 *
 * TALKBACK follows the bar: onto the countdown when a rest starts, back onto
 * the big button when it ends (the control it was on has gone).
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Pressable, StyleSheet, View, type Text } from 'react-native';

import { LPText } from '../../../components/ui';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';
import { nextOpenSet, tracksLoad } from '../model/exercise';
import { currentExercise, primaryAction } from '../model/state';
import { REST_STEP_SECONDS, type RunnerPrimaryAction, type RunnerState } from '../model/types';
import RestRing, { REST_RING_SIZE } from '../timer/RestRing';

import type { RunnerController } from './controller';
import { fitsInRow, useFit } from './fit';

export interface RunnerBottomBarProps {
  readonly controller: RunnerController;
  readonly state: RunnerState;
  readonly isResting: boolean;
  readonly bottomInset: number;
  /** The finish sheet (RUN-3). */
  readonly onFinish: () => void;
}

type Translate = (key: string, params?: Readonly<Record<string, string>>) => string;

/** "Set 2 of 3: 10 reps, 12.5 kg" over the button that logs it, or null when no set is open. */
export function nextSetLine(state: RunnerState, t: Translate, language: Parameters<typeof RunnerFormat.dose>[3]): string | null {
  const exercise = currentExercise(state);
  const open = exercise ? nextOpenSet(exercise) : null;
  if (!exercise || open === null) return null;
  const set = exercise.sets[open]!;
  let dose = RunnerFormat.dose(exercise.unit, set.value, exercise.perSide, language);
  if (tracksLoad(exercise) && set.kg !== null) {
    dose = t('runner.dose.with_kg', { dose, kg: RunnerFormat.kg(set.kg, language) });
  }
  return t('runner.next_set_line', { n: String(open + 1), total: String(exercise.sets.length), dose });
}

/** The big button's words. */
export function primaryTitle(action: RunnerPrimaryAction, t: Translate): string {
  switch (action.kind) {
    case 'startTimer':
      return t('runner.start_set', { n: String(action.number) });
    case 'completeSet':
      return t('runner.complete_set', { n: String(action.number) });
    case 'next':
      return t('runner.next');
    case 'finish':
      return t('runner.finish');
  }
}

function focus(target: { current: View | Text | null }): void {
  const node = target.current ? findNodeHandle(target.current) : null;
  if (node) AccessibilityInfo.setAccessibilityFocus(node);
}

export default function RunnerBottomBar({ controller, state, isResting, bottomInset, onFinish }: RunnerBottomBarProps) {
  const { t, language } = useT();
  const countdown = useRef<View>(null);
  const primary = useRef<View>(null);
  const wasResting = useRef(isResting);

  useEffect(() => {
    if (wasResting.current === isResting) return;
    wasResting.current = isResting;
    // After the bar has been drawn with its new controls.
    const frame = requestAnimationFrame(() => focus(isResting ? countdown : primary));
    return () => cancelAnimationFrame(frame);
  }, [isResting]);

  const action = primaryAction(state);
  const line = nextSetLine(state, t, language);

  return (
    <View style={[styles.bar, { paddingBottom: 10 + bottomInset }]} testID="runner.bottomBar">
      <View style={styles.rule} />
      {isResting ? (
        <RestBar controller={controller} countdownRef={countdown} />
      ) : (
        <View style={styles.idle}>
          {action.kind !== 'finish' ? (
            <Pressable
              testID="runner.finishSecondary"
              onPress={() => {
                Keyboard.dismiss();
                onFinish();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('runner.finish')}
              style={styles.secondary}
            >
              <LPText size={14} weight="semibold" color={colors.paper2}>
                {t('runner.finish')}
              </LPText>
            </Pressable>
          ) : null}
          {line !== null ? (
            <LPText size={16} weight="semibold" color={colors.paper} align="center" testID="runner.nextSetLine">
              {line}
            </LPText>
          ) : null}
          <Pressable
            ref={primary}
            testID="runner.primary"
            onPress={() => {
              Keyboard.dismiss();
              controller.performPrimary(onFinish);
            }}
            accessibilityRole="button"
            accessibilityLabel={primaryTitle(action, t)}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <LPText size={17} weight="semibold" color={colors.onAccent} align="center">
              {primaryTitle(action, t)}
            </LPText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** The rest bar: one line where it fits, the countdown over the buttons where it does not. */
function RestBar({ controller, countdownRef }: { controller: RunnerController; countdownRef: { current: View | null } }) {
  const { t } = useT();
  const fit = useFit();
  const inner = Math.max(0, fit.width - 32);
  // Until measured, the narrow layout: it never cuts "Skip rest" short.
  // The countdown, a spacer of at least 4 and the buttons, 10 apart (iOS HStack(spacing: 10)).
  const oneLine = fitsInRow(fit, inner, ['countdown', 'buttons'], { gap: 10, fixed: 4, fixedCount: 1, fallback: false });

  const countdown = (
    <View onLayout={fit.onPartLayout('countdown')} style={styles.countdown} testID="runner.restBar.countdownPart">
      <RestRing fraction={controller.restFraction} />
      <View
        ref={countdownRef}
        testID="runner.restCountdown"
        accessible
        accessibilityLabel={t('runner.resting')}
        accessibilityValue={{ text: controller.restAccessibilityValue }}
      >
        <LPText size={12} weight="semibold" color={colors.paper2}>
          {t('runner.resting')}
        </LPText>
        <LPText
          size={30}
          weight="semibold"
          color={colors.paper}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={styles.digits}
          testID="runner.restClock"
        >
          {RunnerFormat.clock(controller.restRemaining)}
        </LPText>
      </View>
    </View>
  );

  const buttons = (
    <View onLayout={fit.onPartLayout('buttons')} style={styles.restButtons} testID="runner.restBar.buttons">
      <RestIconButton
        icon="rewind-15"
        label={t('runner.rest_minus')}
        testID="runner.rest.minus"
        onPress={() => controller.adjustRest(-REST_STEP_SECONDS)}
      />
      <RestIconButton
        icon="fast-forward-15"
        label={t('runner.rest_plus')}
        testID="runner.rest.plus"
        onPress={() => controller.adjustRest(REST_STEP_SECONDS)}
      />
      <Pressable
        testID="runner.rest.skip"
        onPress={() => controller.skipRest()}
        accessibilityRole="button"
        accessibilityLabel={t('runner.rest_skip')}
        style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
      >
        <LPText size={15} weight="semibold" color={colors.onAccent} numberOfLines={1}>
          {t('runner.rest_skip')}
        </LPText>
      </Pressable>
    </View>
  );

  return (
    <View onLayout={fit.onContainerLayout} style={oneLine ? styles.restLine : styles.restStack} testID="runner.restBar">
      {countdown}
      {oneLine ? <View style={styles.spacer} /> : null}
      {oneLine ? buttons : <View style={styles.restButtonsTrailing}>{buttons}</View>}
    </View>
  );
}

function RestIconButton({
  icon,
  label,
  testID,
  onPress,
}: {
  icon: 'rewind-15' | 'fast-forward-15';
  label: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.restIcon, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={colors.paper} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.ink,
    gap: 10,
  },
  rule: {
    height: hairline,
    backgroundColor: colors.line,
  },
  idle: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: 'stretch',
  },
  secondary: {
    minHeight: 44,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  primary: {
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  restLine: {
    minHeight: 72,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  restStack: {
    paddingHorizontal: 16,
    gap: 8,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 10,
    minHeight: REST_RING_SIZE,
  },
  spacer: {
    flex: 1,
    minWidth: 4,
  },
  restButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  restButtonsTrailing: {
    alignItems: 'flex-end',
  },
  restIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.ink2,
    borderWidth: hairline,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skip: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 26,
    backgroundColor: colors.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digits: {
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.75,
  },
});
