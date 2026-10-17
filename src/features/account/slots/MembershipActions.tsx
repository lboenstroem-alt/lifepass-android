/**
 * Account slot (plan 3.0.3, mounted by ACCT-1 in the Membership card under
 * "Change plan"): the membership actions iOS offers there. On iOS 2.5.6 that
 * is one row, "Cancel subscription", shown while the member holds a plan
 * (active or past due) that is not already ending. There is no resume or
 * un-cancel on iOS, so none here.
 */
import { useAppStore } from '../../../stores/appStore';
import CancelSubscriptionRow from '../membership/CancelSubscriptionRow';
import { canCancelSubscription, confirmCancelSubscription } from '../membership/cancelFlow';

export default function MembershipActions() {
  const cancellable = useAppStore((state) => canCancelSubscription(state.subscription));
  if (!cancellable) return null;
  return <CancelSubscriptionRow onPress={confirmCancelSubscription} />;
}
