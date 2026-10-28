// "Estimate" (iOS EstimateChip): every number that came from a model or a
// formula wears one. A calorie target or a photo estimate is a guess about a
// body, and a guess printed like a measurement is the most misleading thing
// the health features could do, so the chip is small, permanent and never
// suppressed.
import { StyleSheet, View } from 'react-native';

import { useT } from '../../i18n';
import { colors, radius } from '../../theme';
import LPText from './LPText';

export default function EstimateChip({ testID }: { testID?: string }) {
  const { t } = useT();
  return (
    <View style={styles.chip} testID={testID}>
      <LPText size={10} weight="semibold" tracking={0.4} color={colors.signal}>
        {t('health.estimate')}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: colors.rust3,
    borderRadius: radius.pill,
  },
});
