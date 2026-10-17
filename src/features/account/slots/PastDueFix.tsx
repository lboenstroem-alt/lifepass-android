/**
 * Account slot (plan 3.0.3, mounted by ACCT-1 on the member card under the
 * past-due body): "Fix payment", the co-pay self-cure (iOS AccountView's
 * past-due button). Nothing unless the plan is past due.
 *
 * The button only: the card above it says why access is paused
 * (`account.past_due_body`, ACCT-1's). A tap pays the overdue share on the
 * hosted page under the dunning episode's key (copay/copayFlows); it reads
 * "Processing…" until the payment is confirmed.
 */
import { Pressable, StyleSheet } from 'react-native';

import { isSubscriptionPastDue } from '../../../api/subscriptions';
import { LPText } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';
import { colors, radius } from '../../../theme';
import { fixPastDuePayment, useCopayBusy } from '../copay/copayFlows';
import '../copay/register';

const WHITE = '#FFFFFF';

export default function PastDueFix() {
  const { t } = useT();
  const pastDue = useAppStore((state) => isSubscriptionPastDue(state.subscription));
  const retrying = useCopayBusy((state) => state.retrying);
  if (!pastDue) return null;

  const label = retrying ? t('common.processing') : t('account.past_due_cta');
  return (
    <Pressable
      onPress={() => void fixPastDuePayment()}
      disabled={retrying}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: retrying, busy: retrying }}
      hitSlop={8}
      style={({ pressed }) => [styles.button, (pressed || retrying) && styles.dimmed]}
      testID="account.pastDue.fix"
    >
      <LPText size={12} weight="semibold" color={WHITE}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // iOS: 12 pt semibold white on the signal blue, padding 12 by 7, a capsule, 2 pt below the body.
  button: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.signal,
  },
  dimmed: { opacity: 0.6 },
});
