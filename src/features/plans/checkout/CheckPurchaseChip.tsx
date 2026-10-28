/**
 * "Completed your purchase? Tap to check": iOS PlansView's quiet re-check
 * affordance above Continue, after the web-first return could not confirm a
 * purchase (the member may only have looked at the prices). A tap reads the
 * profile twice more; a purchase found there is welcomed, otherwise the chip
 * stays. Styled as the Plans screen's Kenni chip beside it.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { hiddenFromAccessibility, LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';

export interface CheckPurchaseChipProps {
  readonly onPress: () => void;
}

export default function CheckPurchaseChip({ onPress }: CheckPurchaseChipProps) {
  const { t } = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The words alone: the glyph is decoration.
      accessibilityLabel={t('plans.check_purchase')}
      testID="plans.check_purchase"
      // iOS's 36-tall chip; the slop makes the target Android's 48.
      hitSlop={{ top: 6, bottom: 6 }}
      style={styles.chip}
    >
      <Ionicons name="refresh" size={12} color={colors.paper} {...hiddenFromAccessibility} />
      <LPText size={12} weight="semibold" style={styles.shrink}>
        {t('plans.check_purchase')}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.ink2,
  },
  shrink: { flexShrink: 1 },
});
