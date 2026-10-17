/**
 * The company co-pay actions on the Account screen: accepting a pending plan,
 * claiming an invitation through Kenni, and paying an overdue share. The
 * Android port of iOS `AccountView.activateCompanyPlan`,
 * `settleActivationReturn`, `retryCopayPayment` and `settleRetryReturn`.
 *
 * The flows live outside the components on purpose: the hosted page covers
 * the app, Android may drop the screen behind it, and what must happen after
 * the page (the verified pull, the membership re-read, the context re-read,
 * ending the dunning episode) must not depend on a screen still being there.
 * The page itself, its saved attempt and its settle are F8's
 * (`copayOnHostedPage`): the confirm runs after ANY close, three tries, then
 * the membership is re-read until it shows the result, then the profile.
 *
 * Every alert here uses iOS's one error alert, "Something went wrong"
 * (`account.cancel_failed_title`), with the message iOS shows under it.
 */
import { create } from 'zustand';

import { errorMessage, isCancellation, isProblem } from '../../../api';
import { isSubscriptionPastDue } from '../../../api/subscriptions';
import { showDialog } from '../../../components/ui/Dialog';
import { currentLanguage, iskPrefix, t, translate, type Lang } from '../../../i18n';
import { copayOnHostedPage } from '../../../payments';
import { useAppStore } from '../../../stores/appStore';
import {
  activateCompanyPlan,
  endRetryEpisode,
  retryCopayPayment,
  retryEpisodeKey,
  type CopayActivation,
  type CopayRetry,
  type PendingActivation,
} from '../../../supabase/services/companyPlans';
import { openKenniSheet } from '../../kenni';

import { copayContext, reloadCopayContext } from './contextSource';

// MARK: - Busy state

export interface CopayBusyState {
  /** An activation is running (iOS `isActivating`): the CTA reads "Processing…". */
  readonly activating: boolean;
  /** A past-due payment is running (iOS `isRetryingPayment`): "Fix payment" reads "Processing…". */
  readonly retrying: boolean;
}

const idle: CopayBusyState = { activating: false, retrying: false };

/**
 * In a store, not the button: a second tap (or the slot drawn again) while a
 * flow runs must find it running. Unlike iOS, the flag stays up until the
 * page has closed and the payment is confirmed, not only for the request:
 * Android cannot open a second page while F8 settles the first, so the
 * button says what is happening instead of answering a tap with nothing.
 */
export const useCopayBusy = create<CopayBusyState>()(() => idle);

function setBusy(patch: Partial<CopayBusyState>): void {
  useCopayBusy.setState(patch);
}

// MARK: - Who is signed in

/** The signed-in member's id (lower case), or null. */
function signedInMember(): string | null {
  const { isAuthenticated, userId, profile } = useAppStore.getState();
  if (!isAuthenticated) return null;
  const id = userId ?? profile?.id ?? null;
  return id ? id.toLowerCase() : null;
}

/** True while `memberId` is still the member signed in: nothing is said to the next one. */
function stillSignedIn(memberId: string): boolean {
  return signedInMember() === memberId;
}

/** iOS's one error alert: "Something went wrong", the message, OK. */
function showCopayProblem(message: string): void {
  showDialog({
    title: t('account.cancel_failed_title'),
    message,
    buttons: [{ label: t('common.ok') }],
    testID: 'copay.problem',
  });
}

// MARK: - Copy

/** The activation CTA: "Activate · ISK 4,900/mo", or "Activate · included" for a zero share. */
export function activationCta(activation: PendingActivation, lang: Lang): string {
  return activation.shareIsk > 0
    ? translate('account.copay_cta_share', lang, { price: iskPrefix(activation.shareIsk) })
    : translate('account.copay_cta_free', lang);
}

/** The confirm's message: the member's monthly share and who pays the rest, or "covers it in full". */
export function activationConfirmMessage(activation: PendingActivation, lang: Lang): string {
  return activation.shareIsk > 0
    ? translate('account.copay_confirm_share', lang, {
        plan: activation.productName,
        company: activation.companyName,
        price: iskPrefix(activation.shareIsk),
      })
    : translate('account.copay_confirm_free', lang, {
        plan: activation.productName,
        company: activation.companyName,
      });
}

// MARK: - Kenni (claim an invitation, or verify before activating)

/**
 * The identity sheet (iOS `KenniVerificationView`, membership body). An
 * invitation is claimed inside the Kenni callback, so when the sheet closes,
 * verified or not, the profile and the context are read again: the invite
 * may have just become a pending activation.
 */
export function openCopayKenniSheet(): void {
  openKenniSheet({
    bodyKey: 'kenni.body',
    onClose: () => {
      void (async () => {
        await useAppStore.getState().loadProfile();
        await reloadCopayContext();
      })();
    },
  });
}

// MARK: - Activation

/** Asks before accepting (iOS `.alert(account.copay_confirm_title)`): the share, then the CTA or Cancel. */
export function confirmCopayActivation(activation: PendingActivation): void {
  if (useCopayBusy.getState().activating) return;
  const lang = currentLanguage();
  showDialog({
    title: t('account.copay_confirm_title'),
    message: activationConfirmMessage(activation, lang),
    buttons: [
      { label: activationCta(activation, lang), onPress: () => void activateCopayPlan(), testID: 'copay.confirm.activate' },
      { label: t('common.cancel'), role: 'cancel', testID: 'copay.confirm.cancel' },
    ],
    testID: 'copay.confirm',
  });
}

/** What the activation refusal means for the member (iOS's three named codes, then the message). */
async function activationRefused(error: unknown, memberId: string): Promise<void> {
  if (isCancellation(error) || !stillSignedIn(memberId)) return;
  if (isProblem(error, 'kennitala_verification_required')) {
    openCopayKenniSheet();
  } else if (isProblem(error, 'subscription_already_exists_for_profile')) {
    showCopayProblem(t('account.copay_blocked_sub'));
  } else if (isProblem(error, 'copay_membership_not_eligible')) {
    // The membership ended under the member: re-read and let the banner follow.
    await reloadCopayContext();
  } else {
    showCopayProblem(errorMessage(error));
  }
}

/**
 * Accepts the pending co-pay plan the context holds now (iOS re-reads it at
 * the tap too). `provisioned`: the plan is live, so the membership, the
 * credits and the context are read again. `checkout`: the hosted page for
 * the first share; after it, however it closed, F8's pull and re-reads, then
 * the context again (the banner goes once the plan exists).
 */
export async function activateCopayPlan(): Promise<void> {
  const activation = copayContext()?.pendingActivation;
  const memberId = signedInMember();
  if (!activation || !memberId || useCopayBusy.getState().activating) return;
  setBusy({ activating: true });
  try {
    let result: CopayActivation;
    try {
      result = await activateCompanyPlan(activation.membershipId);
    } catch (error) {
      await activationRefused(error, memberId);
      return;
    }
    if (!stillSignedIn(memberId)) return;
    if (result.kind === 'provisioned') {
      await useAppStore.getState().loadSubscription();
      await useAppStore.getState().refreshCredits();
      await reloadCopayContext();
      return;
    }
    const page = await copayOnHostedPage({
      memberId,
      purpose: 'activate',
      url: result.checkoutUrl,
      externalSessionId: result.externalSessionId ?? null,
    });
    if (!stillSignedIn(memberId)) return;
    // A page that never opened took nothing: say so, the plan is still waiting.
    if (page.kind === 'neverOpened') showCopayProblem(t('error.generic'));
    await reloadCopayContext();
  } finally {
    setBusy({ activating: false });
  }
}

// MARK: - Past due (dunning self-cure)

/** What the retry refusal means for the member. */
async function retryRefused(error: unknown, memberId: string): Promise<void> {
  if (isCancellation(error) || !stillSignedIn(memberId)) return;
  if (isProblem(error, 'copay_subscription_not_found')) {
    // Not a co-pay plan: a personal plan's dunning is Kling's, and automatic.
    showCopayProblem(t('account.past_due_auto_retry'));
  } else if (isProblem(error, 'copay_subscription_not_past_due', 'copay_membership_not_eligible', 'copay_share_zero')) {
    // The state moved under the member (cured by the daily retry, the plan
    // ended): re-read, and the card re-renders from what is true now.
    await useAppStore.getState().loadSubscription();
    await useAppStore.getState().refreshCredits();
  } else {
    showCopayProblem(errorMessage(error));
  }
}

/**
 * "Fix payment": the hosted page for the overdue share, under the dunning
 * episode's key (a re-tap replays the same Kling session, never a second
 * payable one). After the page, however it closed: F8's pull, then the
 * membership re-read until it is no longer past due; once it is, the episode
 * ends and the next dunning gets a new key.
 */
export async function fixPastDuePayment(): Promise<void> {
  const subscription = useAppStore.getState().subscription;
  const memberId = signedInMember();
  if (!subscription || !isSubscriptionPastDue(subscription) || !memberId) return;
  if (useCopayBusy.getState().retrying) return;
  setBusy({ retrying: true });
  try {
    let checkout: CopayRetry;
    try {
      checkout = await retryCopayPayment(subscription.id, retryEpisodeKey(subscription.id));
    } catch (error) {
      await retryRefused(error, memberId);
      return;
    }
    if (!stillSignedIn(memberId)) return;
    const page = await copayOnHostedPage({
      memberId,
      purpose: 'retry',
      url: checkout.checkoutUrl,
      externalSessionId: checkout.externalSessionId ?? null,
    });
    if (page.kind === 'returned' && page.settled) endRetryEpisode(subscription.id);
    if (page.kind === 'neverOpened' && stillSignedIn(memberId)) showCopayProblem(t('error.generic'));
  } finally {
    setBusy({ retrying: false });
  }
}

/** Tests only. */
export function resetCopayBusyForTests(): void {
  useCopayBusy.setState(idle, true);
}
