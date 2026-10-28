/* eslint lifepass/no-literal-copy: "error" */
/**
 * An exercise's name as the plan shows it, with "Your exercise" beside it
 * when the member added it themselves (`ExerciseBlockView.own`, API 0.41.0):
 * its name and notes are theirs, and LifePass gives it no cues. The Today
 * card's lines and the session preview draw it the same way.
 */
import { StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { isOwnExercise, type ExerciseBlockView } from '../../../health';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

export default function ExerciseName({
  block,
  size,
  weight = 'regular',
}: {
  block: Pick<ExerciseBlockView, 'name' | 'own'>;
  size: number;
  weight?: 'regular' | 'semibold';
}) {
  const { t } = useT();
  const name = (
    <LPText size={size} weight={weight} color={colors.paper} style={styles.name}>
      {block.name ?? ''}
    </LPText>
  );
  if (!isOwnExercise(block)) return name;
  return (
    <View style={styles.row}>
      {name}
      <View style={styles.tag} testID="plan.exercise.ownTag">
        <LPText size={11} weight="semibold" color={colors.signal}>
          {t('coach.planEdit.ownTag')}
        </LPText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  name: { flexShrink: 1 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.rust3 },
});
