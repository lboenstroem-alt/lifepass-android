/**
 * The cancel-subscription conversation (iOS AccountView's
 * `showCancelConfirm` alert, `cancelSubscription()`, and the
 * `cancelConfirmation` / `cancelError` alerts):
 *
 *   "Cancel subscription" ............ the confirm: Keep subscription | Cancel
 *   Cancel ........................... POST /subscriptions/cancel (a fresh key),
 *                                      then the membership is read again
 *   "Cancellation registered" ........ committed-term or scheduled copy, with the end date
 *   "Something went wrong" ........... the error in the member's words
 *
 * Once the cancellation is scheduled the membership reads
 * `cancelAtPeriodEnd`, and the row is gone (there is no un-cancel).
 */
import { errorMessage, isCancellation, newIdempotencyKey } from '../../../api';
import { isSubscriptionActive, type Subscription } from '../../../api/subscriptions';
import { showDialog } from '../../../components/ui/Dialog';
import { currentLanguage, t } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';

import { cancelConfirmationBody, cancelSubscription } from './cancelSubscription';

/** The row's rule (iOS): a plan the member holds (active or past due) that is not already ending. */
export function canCancelSubscription(subscription: Subscription | null): boolean {
  return subscription !== null && isSubscriptionActive(subscription) && subscription.cancelAtPeriodEnd !== true;
}

/** A cancel on its way: a second confirm while it runs sends nothing. */
let cancelling = false;

function signedInMember(): string | null {
  const { isAuthenticated, userId, profile } = useAppStore.getState();
  if (!isAuthenticated) return null;
  const id = userId ?? profile?.id ?? null;
  return id ? id.toLowerCase() : null;
}

/** Asks first (iOS `.alert(account.cancel_sub_title)`): "Keep subscription" is the cancel role, "Cancel" the destructive one. */
export function confirmCancelSubscription(): void {
  if (!canCancelSubscription(useAppStore.getState().subscription)) return;
  showDialog({
    title: t('account.cancel_sub_title'),
    message: t('account.cancel_sub_body'),
    buttons: [
      { label: t('account.cancel_sub_keep_b'), role: 'cancel', testID: 'cancelSub.keep' },
      { label: t('common.cancel'), role: 'destructive', onPress: () => void cancelMembership(), testID: 'cancelSub.confirm' },
    ],
    testID: 'cancelSub.confirmDialog',
  });
}

/**
 * Sends the cancel for the plan the phone holds now, reads the membership
 * again, and says which cancellation it was. Nothing is said to a member who
 * signed out (or was signed out) while it ran.
 */
export async function cancelMembership(): Promise<void> {
  const subscription = useAppStore.getState().subscription;
  const memberId = signedInMember();
  if (!subscription || !memberId || cancelling) return;
  cancelling = true;
  try {
    const result = await cancelSubscription(subscription.id, newIdempotencyKey());
    await useAppStore.getState().loadSubscription();
    if (signedInMember() !== memberId) return;
    showDialog({
      title: t('account.cancel_done_title'),
      message: cancelConfirmationBody(result, subscription.currentPeriodEndsAt, currentLanguage()),
      buttons: [{ label: t('common.ok') }],
      testID: 'cancelSub.done',
    });
  } catch (error) {
    if (isCancellation(error) || signedInMember() !== memberId) return;
    showDialog({
      title: t('account.cancel_failed_title'),
      message: errorMessage(error),
      buttons: [{ label: t('common.ok') }],
      testID: 'cancelSub.failed',
    });
  } finally {
    cancelling = false;
  }
}
