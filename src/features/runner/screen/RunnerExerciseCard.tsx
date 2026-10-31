/**
 * The exercise on screen (iOS `exerciseCard`, 7.3): "Block 1 · Squat", the
 * name, the chips (Swapped, Lighter version, skipped, Cut short), the target
 * line ("3 × 10 · Moderate · Rest 90 s", or "20 min · Easy" for one cardio
 * row), up to three cues (none after a swap: they are the planned
 * exercise's), the sets, Swap and Skip, and what comes next.
 *
 * A session with no blocks shows only its title: the runner is then a clock
 * and a Save.
 */
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { Card, Kicker, LPText } from '../../../components/ui';
import { loadWord } from '../../../health/doseCopy';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { roundHalfAwayFromZero } from '../../../i18n/format';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';
import { cuesOf, doneCount, isClosed, isSwapped, nextOpenSet } from '../model/exercise';
import { nextExercise } from '../model/state';
import { DEFAULT_REST_SECONDS, type RunnerExercise, type RunnerState } from '../model/types';

import type { RunnerController } from './controller';
import RunnerSetRow from './RunnerSetRow';

export interface RunnerExerciseCardProps {
  readonly controller: RunnerController;
  readonly state: RunnerState;
  readonly accessibilityLayout: boolean;
  /** "Swap" (RUN-3's sheet), shown only when the block has something to swap to. */
  readonly onSwap: () => void;
}

type Translate = (key: string, params?: Readonly<Record<string, string>>) => string;

/** The line under the name (iOS `targetLine`). */
export function targetLine(exercise: RunnerExercise, state: RunnerState, t: Translate): string {
  if (exercise.unit === 'minutes') {
    // One stopwatch row: "20 min · Easy".
    const intensity = t(`plan.intensity.${state.session.intensity ?? 'moderate'}`);
    return t('runner.cardio_line', {
      minutes: String(Math.max(1, roundHalfAwayFromZero(exercise.target / 60))),
      intensity,
    });
  }
  const rest = t('runner.rest_line', { seconds: String(exercise.restSec > 0 ? exercise.restSec : DEFAULT_REST_SECONDS) });
  // The load word is the planned exercise's; a swap does not inherit it.
  const load = exercise.unit === 'reps' && !isSwapped(exercise) ? loadWord(exercise.loadHint, t) : '';
  const dose = RunnerFormat.planLine(exercise.unit, exercise.target, exercise.sets.length, exercise.perSide, (key, params) => t(key, params), load);
  return `${dose} · ${rest}`;
}

export default function RunnerExerciseCard({ controller, state, accessibilityLayout, onSwap }: RunnerExerciseCardProps) {
  const { t } = useT();
  const exercise = state.exercises[state.index] ?? null;

  if (!exercise) {
    return (
      <View style={styles.card}>
        <LPText size={28} serif color={colors.paper} accessibilityRole="header" testID="runner.exerciseName">
          {state.session.title ?? ''}
        </LPText>
      </View>
    );
  }

  const index = state.index;
  const lighter = state.session.lighter === true;
  const swapped = isSwapped(exercise);
  const chips = [
    swapped ? t('runner.swapped_chip') : null,
    lighter ? t('plan.lighter_chip') : null,
    exercise.skipped ? t('a11y.status.skipped') : null,
    exercise.endedEarly ? t('runner.ended_early_chip') : null,
  ].filter((chip): chip is string => chip !== null);
  const cues = cuesOf(exercise);
  const open = nextOpenSet(exercise);
  const next = nextExercise(state);
  const canSwap = controller.swapOptions().length > 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Kicker
          text={t('runner.block_kicker', { n: String(exercise.blockNo), pattern: exercise.patternLabel })}
          color={colors.signal}
          testID="runner.kicker"
        />
        <LPText size={28} serif color={colors.paper} accessibilityRole="header" testID="runner.exerciseName">
          {exercise.name}
        </LPText>
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((chip) => (
              <View key={chip} style={styles.chip}>
                <LPText size={11} weight="semibold" color={colors.signal}>
                  {chip}
                </LPText>
              </View>
            ))}
          </View>
        ) : null}
        <LPText size={15} color={colors.paper2} testID="runner.targetLine">
          {targetLine(exercise, state, t)}
        </LPText>
      </View>

      {cues.length > 0 ? (
        <View style={styles.cues}>
          {cues.map((cue, position) => (
            <View key={`${position}-${cue}`} style={styles.cue}>
              <View style={styles.bullet} />
              <LPText size={14} color={colors.paper} style={styles.cueText}>
                {cue}
              </LPText>
            </View>
          ))}
        </View>
      ) : null}

      <Card testID="runner.sets">
        {exercise.sets.map((set, setIndex) => (
          // Keyed by the exercise (and what it is now, after a swap) as well as
          // the set: each exercise's rows measure afresh (./fit.ts), as iOS's
          // ViewThatFits decides anew, instead of keeping a wider row's widths.
          <View key={`${index}.${exercise.exerciseId}.${setIndex}`}>
            {setIndex > 0 ? <View style={styles.divider} /> : null}
            <RunnerSetRow
              controller={controller}
              exercise={exercise}
              exerciseIndex={index}
              setIndex={setIndex}
              set={set}
              isNext={open === setIndex}
              accessibilityLayout={accessibilityLayout}
            />
          </View>
        ))}
      </Card>

      <View style={styles.actions}>
        {canSwap ? (
          <TextButton
            label={t('runner.swap')}
            testID="runner.swap"
            onPress={() => {
              Keyboard.dismiss();
              onSwap();
            }}
          />
        ) : null}
        {!isClosed(exercise) ? (
          // With a set done, only what is left is skipped.
          <TextButton
            label={t(doneCount(exercise) > 0 ? 'runner.skip_rest_of_exercise' : 'runner.skip_exercise')}
            testID="runner.skipExercise"
            onPress={() => {
              Keyboard.dismiss();
              controller.skipExercise();
            }}
          />
        ) : null}
      </View>

      <LPText size={13} color={colors.paper2} testID="runner.upNext">
        {next ? t('runner.up_next', { name: next.name }) : t('runner.last_exercise')}
      </LPText>
    </View>
  );
}

function TextButton({ label, testID, onPress }: { label: string; testID: string; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
    >
      <LPText size={14} weight="semibold" color={colors.paper2}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  header: {
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.rust3,
  },
  cues: {
    gap: 8,
  },
  cue: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.rust,
    marginTop: 8,
  },
  cueText: {
    flex: 1,
  },
  divider: {
    height: hairline,
    backgroundColor: colors.line,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 18,
  },
  textButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
