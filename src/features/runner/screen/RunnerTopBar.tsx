/**
 * The runner's top bar (iOS `topBar`, 7.3): the close cross ("Leave
 * workout", which opens the Leave dialog), "Exercise 2 of 5" in the middle,
 * and the active clock on the right ("12:04", "1:02:10" past an hour), spoken
 * in whole minutes ("Time so far, 12 minutes"). Under it, a 3 dp progress
 * line: sets done of the sets of every exercise not skipped.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { RunnerFormat } from '../../../i18n/runnerFormat';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { doneCount } from '../model/exercise';
import type { RunnerState } from '../model/types';

/** Done sets over the sets of every exercise not skipped (an exercise cut short still counts its sets). */
export function progressFraction(state: Pick<RunnerState, 'exercises'>): number {
  let total = 0;
  let done = 0;
  for (const exercise of state.exercises) {
    if (exercise.skipped) continue;
    total += exercise.sets.length;
    done += doneCount(exercise);
  }
  return total > 0 ? Math.min(1, done / total) : 0;
}

export interface RunnerTopBarProps {
  readonly state: RunnerState;
  readonly elapsedSeconds: number;
  readonly onClose: () => void;
}

export default function RunnerTopBar({ state, elapsedSeconds, onClose }: RunnerTopBarProps) {
  const { t, language } = useT();
  const total = Math.max(1, state.exercises.length);
  const n = Math.min(state.index + 1, total);
  const fraction = progressFraction(state);
  return (
    <View style={styles.bar}>
      <View style={styles.line}>
        <Pressable
          testID="runner.close"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.runner.close')}
          style={styles.close}
        >
          <Ionicons name="close" size={24} color={colors.paper} />
        </Pressable>
        <View style={styles.middle}>
          <LPText size={13} weight="semibold" color={colors.paper} accessibilityRole="header" testID="runner.progress">
            {t('runner.progress', { n: String(n), total: String(total) })}
          </LPText>
        </View>
        <LPText
          size={13}
          color={colors.paper2}
          style={styles.clock}
          testID="runner.clock"
          accessibilityLabel={t('a11y.runner.elapsed', {
            time: RunnerFormat.spokenDuration(Math.trunc(elapsedSeconds / 60) * 60, language),
          })}
        >
          {RunnerFormat.clock(elapsedSeconds)}
        </LPText>
      </View>
      <View style={styles.track} accessible={false} importantForAccessibility="no-hide-descendants" testID="runner.progressBar">
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.ink,
  },
  line: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    gap: 8,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    alignItems: 'center',
  },
  clock: {
    minWidth: 44,
    paddingRight: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 3,
    backgroundColor: colors.ink3,
  },
  fill: {
    height: 3,
    backgroundColor: colors.rust,
  },
});
