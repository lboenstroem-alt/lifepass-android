/**
 * One bullet of the gate and the intro card (iOS `PlanBulletRow`): a rule
 * above, an accent icon, and the line. The icon is decoration; the line says
 * everything.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { colors, hairline } from '../../../theme';

export type PlanBulletRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  testID?: string;
};

export default function PlanBulletRow({ icon, text, testID }: PlanBulletRowProps) {
  return (
    <View testID={testID}>
      <View style={styles.rule} />
      <View style={styles.row}>
        <View style={styles.icon} {...hiddenFromAccessibility}>
          <Ionicons name={icon} size={15} color={colors.rust} />
        </View>
        <LPText size={14} color={colors.paper2} style={styles.text}>
          {text}
        </LPText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { height: hairline, backgroundColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  icon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
});
