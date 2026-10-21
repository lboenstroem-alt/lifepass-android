/**
 * One set: "Set 1 · [-] 10 reps [+] · [-] 12.5 kg [+] · (check)" (iOS
 * `RunnerSetRow`, 7.3, R9).
 *
 * THE DOSE CONTROL follows the unit: a typeable stepper for reps and metres;
 * for a timed set, `-` / "Start 45 s" / `+`, which counts down in place
 * ("25 s left", "Side 1: 25 s left", "Switch sides: 4 s") and shows the time
 * held, greyed, once done; for a cardio block, one stopwatch capsule. The kg
 * stepper (placeholder "kg") shows only where the block tracks load.
 *
 * LAYOUT (iOS `ViewThatFits`): everything on one line where it fits; else the
 * label and the check on top and the controls under them, side by side where
 * they fit, else one under the other. At the accessibility text sizes the
 * controls always stack, and the fields take the row's width.
 *
 * TALKBACK (7.12): the set's label reads the whole row, "Set 1, 10 reps, 12.5
 * kilograms, not done"; every stepper button says what it changes and on
 * which set; the check is its own "Mark set 1 done". (iOS makes the row one
 * container with that label; on Android the label is the first stop of the
 * row, which TalkBack reads before the controls.)
 */
import { Ionicons } from '@expo/vector-icons';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { parseDecimal, parseInteger } from '../../../i18n/format';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { tracksLoad } from '../model/exercise';
import type { RunnerExercise, RunnerSet } from '../model/types';

import type { RunnerController } from './controller';
import { fitsInRow, useFit } from './fit';
import RunnerNumberField from './RunnerNumberField';

export interface RunnerSetRowProps {
  readonly controller: RunnerController;
  readonly exercise: RunnerExercise;
  readonly exerciseIndex: number;
  readonly setIndex: number;
  readonly set: RunnerSet;
  /** The next open set: outlined. */
  readonly isNext: boolean;
  /** An accessibility text size: the controls stack and the fields widen. */
  readonly accessibilityLayout: boolean;
}

/** The label column's width in the one-line layout (iOS `minWidth: 48`). */
const LABEL_WIDTH = 48;
const CHECK_SIZE = 52;
const ROW_PADDING = 12;
const WIDE_GAP = 8;
const STACKED_GAP = 10;

export default function RunnerSetRow({
  controller,
  exercise,
  exerciseIndex,
  setIndex,
  set,
  isNext,
  accessibilityLayout,
}: RunnerSetRowProps) {
  const { t, language } = useT();
  const fit = useFit();
  const loads = tracksLoad(exercise);
  const number = String(setIndex + 1);
  const setName = t('runner.set_n', { n: number });
  // This set will not be logged as done: its exercise was skipped, or its last sets were.
  const isSkippedSet = exercise.skipped || (exercise.endedEarly && !set.done);
  const testID = `runner.set.${exerciseIndex}.${setIndex}`;

  const rowLabel = (() => {
    const parts = [setName, RunnerFormat.dose(exercise.unit, set.value, exercise.perSide, language)];
    if (loads) {
      parts.push(
        set.kg !== null ? t('a11y.runner.kg', { kg: RunnerFormat.kg(set.kg, language) }) : t('a11y.runner.no_kg'),
      );
    }
    if (isSkippedSet) parts.push(t('a11y.status.skipped'));
    else parts.push(set.done ? t('a11y.status.done') : t('a11y.runner.not_done'));
    return parts.join(', ');
  })();

  // ---------------------------------------------------------------------------
  // Pieces

  const roundButton = (icon: 'remove' | 'add', labelKey: string, onPress: () => void, id: string) => (
    <Pressable
      testID={id}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t(labelKey)}, ${setName}`}
      hitSlop={2}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.paper} />
    </Pressable>
  );

  const capsule = (
    title: string,
    filled: boolean,
    id: string,
    onPress: () => void,
    a11y: { label: string; hint?: string; value?: string; disabled?: boolean },
  ) => (
    <Pressable
      testID={id}
      onPress={onPress}
      disabled={a11y.disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y.label}
      accessibilityHint={a11y.hint}
      accessibilityValue={a11y.value ? { text: a11y.value } : undefined}
      accessibilityState={{ disabled: a11y.disabled === true }}
      style={({ pressed }) => [styles.capsule, filled ? styles.capsuleFilled : styles.capsuleSoft, pressed && styles.pressed]}
    >
      <LPText
        size={15}
        weight="semibold"
        color={filled ? colors.onAccent : colors.rust}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={styles.digits}
      >
        {title}
      </LPText>
    </Pressable>
  );

  const stepper = (options: {
    value: string;
    unit: string;
    field: 'value' | 'kg';
    minusKey: string;
    plusKey: string;
    onStep: (direction: number) => void;
    onCommit: (text: string) => void;
  }) => (
    <View style={[styles.stepper, accessibilityLayout && styles.stepperWide]}>
      {roundButton('remove', options.minusKey, () => options.onStep(-1), `${testID}.${options.field}.minus`)}
      <RunnerNumberField
        value={options.value}
        unit={options.unit}
        placeholder={options.field === 'kg' ? t('runner.kg_optional') : '0'}
        keyboardType={options.field === 'kg' ? 'decimal-pad' : 'number-pad'}
        wide={accessibilityLayout}
        onCommit={options.onCommit}
        testID={`${testID}.${options.field}`}
      />
      {roundButton('add', options.plusKey, () => options.onStep(1), `${testID}.${options.field}.plus`)}
    </View>
  );

  const timedControl = () => {
    const phase = controller.timerPhase(exerciseIndex, setIndex);
    if (phase) {
      // "44 seconds left", never "0:44" read as a time of day.
      return capsule(
        RunnerFormat.timerTitle(phase, (key, params) => t(key, params)),
        true,
        `runner.timer.${exerciseIndex}.${setIndex}`,
        () => controller.toggleTimer(exerciseIndex, setIndex),
        { label: RunnerFormat.timerSpoken(phase, language, (key, params) => t(key, params)), hint: t('runner.stopwatch_stop') },
      );
    }
    if (set.done) {
      return (
        <LPText
          size={17}
          weight="semibold"
          color={colors.paper2}
          style={styles.digits}
          accessible={false}
          importantForAccessibility="no"
          testID={`runner.timer.${exerciseIndex}.${setIndex}.done`}
        >
          {RunnerFormat.timerAmount(set.value) ?? `${set.value} ${t('runner.unit.seconds')}`}
        </LPText>
      );
    }
    const amount = RunnerFormat.timerAmount(set.value);
    return (
      <View style={styles.timed}>
        {roundButton('remove', 'a11y.decrease_seconds', () => controller.stepValue(exerciseIndex, setIndex, -1), `${testID}.value.minus`)}
        {capsule(
          amount !== null ? t('runner.start_timer_clock', { time: amount }) : t('runner.start_timer', { seconds: String(set.value) }),
          false,
          `runner.timer.${exerciseIndex}.${setIndex}`,
          () => controller.toggleTimer(exerciseIndex, setIndex),
          {
            // "Start 30 seconds each side, Set 1" for a hold done each side.
            label: `${t('runner.start_timer_clock', {
              time: RunnerFormat.dose('seconds', set.value, exercise.perSide, language),
            })}, ${setName}`,
          },
        )}
        {roundButton('add', 'a11y.increase_seconds', () => controller.stepValue(exerciseIndex, setIndex, 1), `${testID}.value.plus`)}
      </View>
    );
  };

  const stopwatchControl = () => {
    const running = controller.stopwatchSeconds(exerciseIndex);
    return capsule(
      running !== null ? RunnerFormat.clock(running) : t('runner.stopwatch_start'),
      running !== null,
      `runner.stopwatch.${exerciseIndex}`,
      () => controller.toggleStopwatch(exerciseIndex),
      {
        label: running === null ? t('runner.stopwatch_start') : t('runner.stopwatch_stop'),
        // Spoken in 15 second steps (7.12), rounded UP so the first seconds
        // never read "0 seconds" while the stopwatch is plainly running.
        value:
          running !== null ? RunnerFormat.spokenDuration(Math.max(15, Math.ceil(running / 15) * 15), language) : undefined,
        disabled: set.done,
      },
    );
  };

  const doseControl = () => {
    switch (exercise.unit) {
      case 'reps':
      case 'meters':
        return stepper({
          value: String(set.value),
          unit:
            exercise.unit === 'reps'
              ? t(exercise.perSide ? 'runner.unit.reps_side' : 'runner.unit.reps')
              : t('runner.unit.meters'),
          field: 'value',
          minusKey: exercise.unit === 'reps' ? 'a11y.decrease_reps' : 'a11y.decrease_meters',
          plusKey: exercise.unit === 'reps' ? 'a11y.increase_reps' : 'a11y.increase_meters',
          onStep: (direction) => controller.stepValue(exerciseIndex, setIndex, direction),
          onCommit: (text) => {
            const value = parseInteger(text);
            if (value !== null) controller.setValue(exerciseIndex, setIndex, value);
          },
        });
      case 'seconds':
        return timedControl();
      case 'minutes':
        return stopwatchControl();
    }
  };

  const kgControl = () =>
    stepper({
      value: set.kg !== null ? RunnerFormat.kg(set.kg, language) : '',
      unit: t('runner.unit.kg'),
      field: 'kg',
      minusKey: 'a11y.decrease_kg',
      plusKey: 'a11y.increase_kg',
      onStep: (direction) => controller.stepKg(exerciseIndex, setIndex, direction),
      onCommit: (text) => {
        const trimmed = text.trim();
        if (trimmed === '') {
          controller.setKg(exerciseIndex, setIndex, null);
          return;
        }
        const kg = parseDecimal(trimmed);
        if (kg !== null) controller.setKg(exerciseIndex, setIndex, kg);
      },
    });

  const setLabel = (
    <LPText
      size={14}
      weight="semibold"
      color={set.done ? colors.paper2 : colors.paper}
      accessibilityLabel={rowLabel}
      testID={`${testID}.label`}
    >
      {setName}
    </LPText>
  );

  const checkButton = (
    <Pressable
      testID={`${testID}.check`}
      onPress={() => {
        Keyboard.dismiss();
        controller.toggleSet(exerciseIndex, setIndex);
      }}
      accessibilityRole="button"
      accessibilityLabel={t(set.done ? 'a11y.mark_set_not_done' : 'a11y.mark_set_done', { n: number })}
      style={styles.check}
    >
      <Ionicons
        name={set.done ? 'checkmark-circle' : 'ellipse-outline'}
        size={34}
        color={set.done ? colors.rust : colors.paper3}
      />
    </Pressable>
  );

  // The controls, each measured where it is drawn.
  const dose = (
    <View onLayout={fit.onPartLayout('dose')} style={accessibilityLayout ? styles.partStretched : styles.part}>
      {doseControl()}
    </View>
  );
  const kg = loads ? (
    <View onLayout={fit.onPartLayout('kg')} style={accessibilityLayout ? styles.partStretched : styles.part}>
      {kgControl()}
    </View>
  ) : null;

  const inner = Math.max(0, fit.width - ROW_PADDING * 2);
  const controlKeys = loads ? ['dose', 'kg'] : ['dose'];
  // Until measured: one line without a kg column, the stacked rows with one.
  const wide =
    !accessibilityLayout &&
    fitsInRow(fit, inner, controlKeys, {
      gap: WIDE_GAP,
      fixed: LABEL_WIDTH + CHECK_SIZE,
      fixedCount: 2,
      fallback: !loads,
    });
  const sideBySide =
    !accessibilityLayout && fitsInRow(fit, inner, controlKeys, { gap: STACKED_GAP, fallback: true });

  return (
    <View
      testID={testID}
      onLayout={fit.onContainerLayout}
      style={[styles.row, isNext && styles.next, isSkippedSet && styles.dimmed]}
    >
      {wide ? (
        <View style={styles.wideLine}>
          <View style={styles.labelColumn}>{setLabel}</View>
          <View style={styles.spacer} />
          {dose}
          {kg}
          {checkButton}
        </View>
      ) : (
        <View style={styles.stacked}>
          <View style={styles.topLine}>
            {setLabel}
            <View style={styles.spacer} />
            {checkButton}
          </View>
          <View style={sideBySide ? styles.controlsRow : styles.controlsColumn}>
            {dose}
            {kg}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: ROW_PADDING,
    paddingVertical: 8,
    minHeight: 64,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    margin: 3,
  },
  next: {
    borderColor: colors.rust,
  },
  dimmed: {
    opacity: 0.55,
  },
  wideLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: WIDE_GAP,
  },
  labelColumn: {
    minWidth: LABEL_WIDTH,
  },
  spacer: {
    flex: 1,
  },
  stacked: {
    gap: 6,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: STACKED_GAP,
  },
  controlsColumn: {
    gap: 8,
  },
  part: {
    alignSelf: 'flex-start',
  },
  partStretched: {
    alignSelf: 'stretch',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  stepperWide: {
    alignSelf: 'stretch',
  },
  timed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsuleFilled: {
    backgroundColor: colors.rust,
  },
  capsuleSoft: {
    backgroundColor: colors.rust3,
  },
  check: {
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digits: {
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.7,
  },
});
