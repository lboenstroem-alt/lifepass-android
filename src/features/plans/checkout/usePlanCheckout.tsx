/**
 * The checkout behind the Plans screen's Continue (the seam is ./contract.ts):
 * the Android form of what iOS PlansView does from `handlePurchase` on, with
 * the rules in ./checkoutModel.ts.
 *
 * THE ORDER OF THINGS (iOS PlansView, 2.5.2):
 * 1. Continue (its eID gate already clear) opens the payment sheet
 *    (./PaymentSheet.tsx): a fresh sheet has the save-card switch back ON and
 *    an empty code box, or the code the member typed before Kenni
 *    interrupted the purchase.
 * 2. The sheet's Continue creates the checkout WITH THE SHEET STILL UP, so a
 *    refused code is answered in it, under the box, with the sheet kept
 *    open. Every other answer closes the sheet first, and what follows waits
 *    until it has gone: the hosted page, the Kenni sheet (with the SUBMITTED
 *    plan and the typed code, for the Plans screen to park), or the "Payment
 *    issue" alert with the refusal's next step.
 * 3. The page, then "Confirming your payment…" while the return is
 *    verified, then the welcome (its button closes Plans), the timeout copy
 *    with the support address, or the quiet "check again" chip (web-first).
 *
 * One purchase at a time: Continue is held while a checkout is created, its
 * page is open or it is being verified, and Plans cannot be closed meanwhile
 * (`busy`). The overlay's Cancel lets the member go while the check runs on
 * behind it; a tap on Continue before it has finished brings the overlay
 * back rather than a second payment sheet (also after Plans was closed and
 * opened again), so a member who has just paid is never walked into paying
 * twice. If Plans has gone by the time the answer arrives, the money rails
 * tell the member themselves (src/payments). A Continue that finds an
 * earlier checkout of the same plan still unverified verifies that one
 * instead of making a new one (./checkoutModel.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { ctaLabelKey } from '../../../api';
import { announce, showDialog, type DialogButton } from '../../../components/ui';
import { t } from '../../../i18n';
import { useRefusalStep } from '../../../navigation/refusalSteps';
import { useAppStore } from '../../../stores/appStore';

import { isSubscription, type Plan } from '../plans';
import CheckPurchaseChip from './CheckPurchaseChip';
import { PlanCheckoutModel, type CheckoutIssue, type CheckoutWelcome, type PlanCheckoutState } from './checkoutModel';
import type { PlanCheckout, PlanCheckoutEvents } from './contract';
import { discountCodeMessageKey } from './discountCode';
import PaymentSheet from './PaymentSheet';
import { plansOffersRefusalStep } from './refusalSteps';
import VerificationOverlay from './VerificationOverlay';

/** The payment sheet on screen: the plan it is for, and whether it is up or sliding away. */
interface SheetState {
  readonly plan: Plan;
  readonly visible: boolean;
}

/** A checkout is being created, its page is open or about to open, or its return is on screen. */
function isBusy(state: PlanCheckoutState): boolean {
  return (
    state.isLoading ||
    state.checkoutInFlight ||
    state.checkoutReady ||
    state.earlierPending ||
    state.pageOpen ||
    state.isVerifying
  );
}

/** The welcome's words (iOS PlansView's `purchaseComplete` alert). */
function welcomeMessage(welcome: CheckoutWelcome): string {
  if (!welcome.name) return t('plans.success.generic');
  return t(welcome.isPass ? 'plans.success.pass' : 'plans.success.subscription', { name: welcome.name });
}

export function usePlanCheckout(events: PlanCheckoutEvents): PlanCheckout {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [model] = useState(() => new PlanCheckoutModel({ isScreenAlive: () => mounted.current }));
  const state = useStore(model.store);

  const latestEvents = useRef(events);
  useEffect(() => {
    latestEvents.current = events;
  });
  const refusalStep = useRefusalStep();
  const takeStep = useRef(refusalStep.take);
  useEffect(() => {
    takeStep.current = refusalStep.take;
  });

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [saveCard, setSaveCard] = useState(true);
  // Read synchronously by the taps (a state value lags a render behind).
  const sheetRef = useRef<SheetState | null>(null);
  const saveCardRef = useRef(true);
  const showSheet = useCallback((next: SheetState | null) => {
    sheetRef.current = next;
    setSheet(next);
  }, []);

  /**
   * After the checkout's create, with no sheet on screen: the page, the
   * earlier checkout of this plan that decides the tap instead of a new one,
   * or the Kenni gate.
   */
  const followCreate = useCallback(() => {
    if (model.state.checkoutReady) void model.openCheckout();
    else if (model.state.earlierPending) void model.followEarlierCheckout();
    const blocked = model.takeKennitalaRefusal();
    if (blocked && mounted.current) latestEvents.current.onKennitalaRequired(blocked, model.state.discountCode);
  }, [model]);

  const begin = useCallback(
    (plan: Plan, discountCode: string) => {
      // A payment is still being confirmed behind a cancelled overlay (this
      // screen's, or one a closed Plans left running): show that again, never
      // a second checkout over it. The money rails would open no page for it
      // anyway while that check runs.
      if (model.isCheckRunning) {
        model.showOverlay();
        return;
      }
      if (sheetRef.current || isBusy(model.state)) return;
      if (!model.inAppCheckout) {
        // Web-first: the web page shows the mandate, the save-card opt-out
        // and its own code box, so there is no sheet here.
        if (!model.claimCheckout()) return;
        void model.purchasePlan(plan).then(followCreate);
        return;
      }
      // A fresh sheet: the switch back ON, and an empty box or the code
      // typed before Kenni interrupted the purchase.
      saveCardRef.current = true;
      setSaveCard(true);
      model.clearDiscountCode();
      model.setDiscountCode(discountCode);
      showSheet({ plan, visible: true });
    },
    [model, followCreate, showSheet],
  );

  const closeSheet = useCallback(() => {
    const current = sheetRef.current;
    if (current?.visible) showSheet({ ...current, visible: false });
  }, [showSheet]);

  const continueToPayment = useCallback(() => {
    const plan = sheetRef.current?.plan;
    // Taken here, before any await: a quick second tap would otherwise
    // create a second checkout session.
    if (!plan || !model.claimCheckout()) return;
    const saveCardChoice = isSubscription(plan) ? null : saveCardRef.current;
    const code = model.state.discountCode;
    void model.purchasePlan(plan, { saveCard: saveCardChoice, promotionCode: code }).then(() => {
      const problem = model.state.discountCodeProblem;
      if (problem) {
        // TalkBack hears why on every refused attempt (the same refusal twice
        // is still news to the listener); the sheet stays, code and all.
        announce(t(discountCodeMessageKey(problem)));
        return;
      }
      if (mounted.current) closeSheet();
    });
  }, [model, closeSheet]);

  const onSheetClosed = useCallback(() => {
    showSheet(null);
    followCreate();
  }, [followCreate, showSheet]);

  const onSaveCardChange = useCallback((value: boolean) => {
    saveCardRef.current = value;
    setSaveCard(value);
  }, []);

  // ---- The alerts ----------------------------------------------------------

  const sheetOnScreen = sheet !== null;

  // "Payment issue", once nothing else is on screen (iOS: not while
  // verifying, nor while the payment sheet is up or still closing).
  const shownError = useRef<CheckoutIssue | null>(null);
  useEffect(() => {
    const error = state.error;
    if (!error || state.isVerifying || sheetOnScreen || shownError.current === error) return;
    shownError.current = error;
    const buttons: DialogButton[] = [];
    const cta = error.cta;
    if (cta && plansOffersRefusalStep(cta)) {
      buttons.push({
        label: t(ctaLabelKey(cta)),
        onPress: () => {
          model.dismissError();
          takeStep.current(cta);
        },
      });
    }
    buttons.push({ label: t('common.ok'), role: 'cancel', onPress: () => model.dismissError() });
    showDialog({
      title: t('plans.payment_issue'),
      message: error.message,
      buttons,
      onDismiss: () => model.dismissError(),
      testID: 'plans.payment_issue',
    });
  }, [state.error, state.isVerifying, sheetOnScreen, model]);

  // The welcome: its one button re-reads the membership and closes Plans.
  const shownWelcome = useRef<CheckoutWelcome | null>(null);
  useEffect(() => {
    const welcome = state.welcome;
    if (!welcome || shownWelcome.current === welcome) return;
    shownWelcome.current = welcome;
    showDialog({
      title: t('plans.welcome_title'),
      message: welcomeMessage(welcome),
      buttons: [
        {
          label: t('plans.welcome_cta'),
          onPress: () => {
            model.dismissWelcome();
            void useAppStore.getState().loadSubscription();
            latestEvents.current.onFinished();
          },
        },
      ],
      testID: 'plans.welcome',
    });
  }, [state.welcome, model]);

  // ---- What the Plans screen draws ------------------------------------------

  const chip = state.verificationPending ? <CheckPurchaseChip onPress={() => void model.recheckPurchase()} /> : null;

  const element = (
    <>
      {sheet ? (
        <PaymentSheet
          plan={sheet.plan}
          visible={sheet.visible}
          onClose={closeSheet}
          onClosed={onSheetClosed}
          saveCard={saveCard}
          onSaveCardChange={onSaveCardChange}
          discountCode={state.discountCode}
          onDiscountCodeChange={(code) => model.setDiscountCode(code)}
          problem={state.discountCodeProblem}
          codeFieldFocusRequest={state.codeFieldFocusRequest}
          onClearCode={() => model.clearCodeTapped()}
          creating={state.isLoading || state.checkoutInFlight}
          onContinue={continueToPayment}
        />
      ) : null}
      <VerificationOverlay visible={state.isVerifying} onCancel={() => model.dismissOverlay()} />
    </>
  );

  return { busy: isBusy(state), verifying: state.isVerifying, chip, element, begin };
}
