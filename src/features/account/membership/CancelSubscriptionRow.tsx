/**
 * The "Cancel subscription" row of Account's Membership card (iOS
 * `rowLink(account.cancel_sub, subtitle: account.cancel_sub_keep)`).
 *
 * Drawn the way the Account rows are (iOS `AccountRowButton`): a hairline
 * above the row (rows draw their own, so a slot that renders nothing leaves
 * no line behind), 14 pt medium title, 11 pt subtitle, a chevron, padding 16
 * by 14, the whole row the target. ACCT-1's src/features/account/rows.tsx is
 * the shared port of the same primitive; once both have merged this row
 * should draw through its `AccountRowButton` (contract request) instead of
 * this copy of its look.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors, hairline } from '../../../theme';

export interface CancelSubscriptionRowProps {
  readonly onPress: () => void;
}

export default function CancelSubscriptionRow({ onPress }: CancelSubscriptionRowProps) {
  const { t } = useT();
  const title = t('account.cancel_sub');
  const subtitle = t('account.cancel_sub_keep');
  return (
    <View>
      <View style={styles.divider} importantForAccessibility="no" accessibilityElementsHidden />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        testID="account.row.cancelSubscription"
      >
        <View style={styles.words}>
          <LPText size={14} weight="medium" color={colors.paper}>
            {title}
          </LPText>
          <LPText size={11} color={colors.paper3}>
            {subtitle}
          </LPText>
        </View>
        <View style={styles.spacer} />
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Ionicons name="chevron-forward" size={13} color={colors.paper3} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: hairline, backgroundColor: colors.line, marginHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  words: { flex: 1, gap: 2 },
  spacer: { width: 8 },
  pressed: { opacity: 0.6 },
});
