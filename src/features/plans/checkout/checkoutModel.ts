/**
 * The plan and pass checkout's state and rules: the Android port of the
 * checkout half of iOS `PlansViewModel` (ViewModels/PlansViewModel.swift).
 * The catalogue half is PLANS-1's (../catalogStore.ts); the screen around
 * this is ./usePlanCheckout.tsx, the payment sheet ./PaymentSheet.tsx.
 *
 * THE PURCHASE, START TO END.
 * 1. The payment sheet's Continue claims the checkout in the tap itself
 *    (`claimCheckout`), so a second quick tap is turned away before the first
 *    request has started: one checkout session, not two under their own
 *    idempotency keys.
 * 2. `purchasePlan` normalises the discount code the server's way and refuses
 *    a code that cannot be well formed without a request, snapshots what the
 *    member holds (the pass ids, the active membership), and creates the
 *    checkout (src/api/planCheckout.ts). Its answer is one of: a page to open
 *    (`checkoutReady`), the Kenni gate, a refused code (kept in the box, never
 *    retried without it), or a payment alert in the member's words with its
 *    next step.
 * 3. `openCheckout` opens the hosted page and verifies the purchase on return
 *    through the money rails (src/payments `checkoutOnHostedPage`), which save
 *    the attempt before the page opens so it is still verified if Android
 *    closes the app behind the page. The verification is iOS
 *    `handleCheckoutReturn`: nothing after the cancel link; otherwise the
 *    verified pull three times, then a PASS from the profile (a new pass id;
 *    the status endpoint can never confirm one) and a MEMBERSHIP by the pull,
 *    the status poll, then the profile. It ends in the welcome, the timeout
 *    copy naming the support address, the status check's refusal in the
 *    member's words, or (web-first fallback) the quiet "check again" chip.
 *
 * Nothing here is stored: the attempt itself is saved by src/payments, which
 * wipes it on sign-out.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  errorMessage,
  isCancellation,
  isProblem,
  refusalFor,
  refusalMessage,
  type RefusalCta,
} from '../../../api';
import { createCheckout } from '../../../api/planCheckout';
import { activePasses } from '../../../api/profile';
import { isSubscriptionActive } from '../../../api/subscriptions';
import { MerchantInfo, webCheckoutURL } from '../../../config/merchantInfo';
import { currentLanguage, t } from '../../../i18n';
import { track } from '../../../lib/analytics';
import {
  checkCheckoutAgain,
  checkoutOnHostedPage,
  recheckPlanPurchase,
  type CheckoutResult,
  type PlanAttemptContext,
} from '../../../payments';
import { useAppStore } from '../../../stores/appStore';

import { loadPlanCatalog } from '../catalogStore';
import { displayName, type Plan } from '../plans';
import {
  discountCodeProblemFrom,
  isWellFormedDiscountCode,
  normaliseDiscountCode,
  type DiscountCodeProblem,
} from './discountCode';

/** iOS PlansView's "Payment issue" alert: the sentence, and the refusal's next step when it has one. */
export interface CheckoutIssue {
  readonly message: string;
  readonly cta: RefusalCta | null;
}

/** A purchase confirmed: the welcome ("Welcome to LifePass"). */
export interface CheckoutWelcome {
  /** The plan's name as the member saw it at checkout; null reads "Your plan is now active." */
  readonly name: string | null;
  /** A pass reads "Your {name} is now active", a membership "Your {name} plan is now active". */
  readonly isPass: boolean;
}

export interface PlanCheckoutState {
  /** The discount code as typed in the payment sheet's box (kept through a refusal and across Kenni). */
  readonly discountCode: string;
  /** Why the typed code can't be used, shown under the box. Editing the code withdraws it. */
  readonly discountCodeProblem: DiscountCodeProblem | null;
  /** Bumped by Clear code: TalkBack's focus moves to the (now empty) box. */
  readonly codeFieldFocusRequest: number;
  /** A tap on Continue has claimed a checkout that hasn't finished (iOS `checkoutInFlight`). */
  readonly checkoutInFlight: boolean;
  /** The checkout is being created (iOS `isLoading`). */
  readonly isLoading: boolean;
  /** A page is ready to open (iOS `checkoutURL`), once the payment sheet has gone. */
  readonly checkoutReady: boolean;
  /** The hosted page is opening or open. */
  readonly pageOpen: boolean;
  /** "Confirming your payment…" is on screen (iOS `isVerifying`). Its Cancel hides it; the check goes on. */
  readonly isVerifying: boolean;
  /** A verification is running, on screen or behind a cancelled overlay. */
  readonly verificationRunning: boolean;
  /** The payment alert to show (a new object per alert). */
  readonly error: CheckoutIssue | null;
  /** The welcome to show (iOS `purchaseComplete`; a new object per purchase). */
  readonly welcome: CheckoutWelcome | null;
  /** The web-first return could not confirm a purchase: the quiet "Completed your purchase? Tap to check". */
  readonly verificationPending: boolean;
  /** The server wants Kenni first (`kennitala_verification_required`): the screen opens the sheet. */
  readonly needsKennitalaVerification: boolean;
  /** The plan that was SUBMITTED when Kenni was asked for (the selection may have moved since). */
  readonly kennitalaBlockedPlan: Plan | null;
}

const INITIAL: PlanCheckoutState = Object.freeze({
  discountCode: '',
  discountCodeProblem: null,
  codeFieldFocusRequest: 0,
  checkoutInFlight: false,
  isLoading: false,
  checkoutReady: false,
  pageOpen: false,
  isVerifying: false,
  verificationRunning: false,
  error: null,
  welcome: null,
  verificationPending: false,
  needsKennitalaVerification: false,
  kennitalaBlockedPlan: null,
});

export interface PurchaseOptions {
  /**
   * The card-on-file consent, for a PASS only (the member can decline
   * vaulting their card). Null or omitted for a membership: it always
   * vaults, the renewal needs a card.
   */
  readonly saveCard?: boolean | null;
  /** The discount code as typed, for a membership or a pass alike. */
  readonly promotionCode?: string | null;
}

export interface PlanCheckoutModelOptions {
  /** `MerchantInfo.inAppKlingCheckout`, injectable so a test can drive the web-first fallback too. */
  readonly inAppCheckout?: boolean;
  /**
   * False once the screen that started the purchase is gone: the rails then
   * tell the member how it ended themselves (src/payments presenters).
   */
  readonly isScreenAlive?: () => boolean;
}

/** One purchase: the plan, what the member held before it, and its page once made. */
interface Purchase {
  readonly plan: Plan;
  readonly context: PlanAttemptContext;
  readonly url: string | null;
  readonly externalSessionId: string | null;
}

function isPassSlug(slug: string): boolean {
  return slug.startsWith('pass-');
}

export class PlanCheckoutModel {
  readonly store: StoreApi<PlanCheckoutState> = createStore<PlanCheckoutState>(() => INITIAL);
  readonly inAppCheckout: boolean;
  private readonly isScreenAlive: () => boolean;
  private purchase: Purchase | null = null;
  /** The catalogue re-read after a `product_not_on_sale` refusal (kept so a test can wait for it). */
  catalogRefresh: Promise<void> | null = null;

  constructor(options: PlanCheckoutModelOptions = {}) {
    this.inAppCheckout = options.inAppCheckout ?? MerchantInfo.inAppKlingCheckout;
    this.isScreenAlive = options.isScreenAlive ?? (() => true);
  }

  get state(): PlanCheckoutState {
    return this.store.getState();
  }

  /** The page the last purchase made (iOS `checkoutURL`): the hosted checkout, or the web plans page. */
  get checkoutUrl(): string | null {
    return this.purchase?.url ?? null;
  }

  private set(patch: Partial<PlanCheckoutState>): void {
    this.store.setState(patch);
  }

  // ---- The code box --------------------------------------------------------

  /** The box changed. A changed code withdraws the refusal: that was about the old code. */
  setDiscountCode(code: string): void {
    const { discountCode, discountCodeProblem } = this.state;
    if (code === discountCode) return;
    this.set(discountCodeProblem !== null ? { discountCode: code, discountCodeProblem: null } : { discountCode: code });
  }

  /** No code, no refusal: the member then continues at the full price by their own choice. */
  clearDiscountCode(): void {
    this.set({ discountCode: '', discountCodeProblem: null });
  }

  /**
   * The Clear code button: as `clearDiscountCode`, and TalkBack's focus moves
   * to the empty box (the button and the refusal it answered have gone from
   * the screen). Only this tap asks; a fresh sheet or a code edited by hand
   * leaves the focus where it is.
   */
  clearCodeTapped(): void {
    this.set({ discountCode: '', discountCodeProblem: null, codeFieldFocusRequest: this.state.codeFieldFocusRequest + 1 });
  }

  // ---- Continue ------------------------------------------------------------

  /** Continue's spinner, the disabled box and the sheet that can't be closed: from the tap until an answer. */
  get isCreatingCheckout(): boolean {
    return this.state.isLoading || this.state.checkoutInFlight;
  }

  /**
   * Whether this tap may start a checkout; takes the slot when it may. Taken
   * in the tap handler itself, before any await, so a quick second tap is
   * turned away. `purchasePlan` hands it back on every way out.
   */
  claimCheckout(): boolean {
    if (this.isCreatingCheckout) return false;
    this.set({ checkoutInFlight: true });
    return true;
  }

  /**
   * Creates the checkout for `plan` (iOS `purchasePlan`). The hosted page
   * shows the price and takes the payment: the app never shows an ISK figure
   * here. Never throws; how it ended is in the state (see the file comment).
   */
  async purchasePlan(plan: Plan, options: PurchaseOptions = {}): Promise<void> {
    try {
      const code = normaliseDiscountCode(options.promotionCode ?? '');
      this.set({ discountCodeProblem: null });
      if (code !== '' && !isWellFormedDiscountCode(code)) {
        this.set({ discountCodeProblem: 'format' });
        return;
      }
      const sentCode = code === '' ? null : code;
      // Snapshot what the member holds, so the purchase is confirmed by the
      // profile actually changing after checkout: a NEW pass id, or the
      // active membership switching to this plan.
      const { profile, subscription } = useAppStore.getState();
      const context: PlanAttemptContext = {
        productSlug: plan.id,
        planName: displayName(plan, currentLanguage()),
        prePurchasePassIds: activePasses(profile).map((pass) => pass.id),
        prePurchaseSubSlug: subscription && isSubscriptionActive(subscription) ? subscription.productSlug : null,
      };
      this.purchase = { plan, context, url: null, externalSessionId: null };
      // A new attempt starts clean: no alert, no chip, no page from the last one.
      this.set({ isLoading: true, error: null, verificationPending: false, checkoutReady: false });
      track('begin_checkout', { plan_id: plan.id, mode: plan.mode });

      // Web-first fallback: the web plans page preselects this product (and
      // prefills its own code box from `?promo=`, for a pass as much as a
      // membership); its /payment-success page fulfils the purchase.
      if (!this.inAppCheckout) {
        this.purchase = { ...this.purchase, url: webCheckoutURL(plan.id, sentCode) };
        this.set({ isLoading: false, checkoutReady: true });
        return;
      }

      try {
        const session = await createCheckout(plan.id, { saveCard: options.saveCard ?? null, promotionCode: sentCode });
        this.purchase = { ...this.purchase, url: session.url, externalSessionId: session.externalSessionId };
        this.set({ checkoutReady: true });
      } catch (error) {
        this.refused(plan, error, sentCode);
      }
      this.set({ isLoading: false });
    } finally {
      this.set({ checkoutInFlight: false });
    }
  }

  /** How a refused checkout is said (iOS `purchasePlan`'s catches, in order). */
  private refused(plan: Plan, error: unknown, sentCode: string | null): void {
    if (isProblem(error, 'kennitala_verification_required')) {
      // The local verified flag can be stale: the Kenni sheet, never a dead-end alert.
      this.set({ kennitalaBlockedPlan: plan, needsKennitalaVerification: true });
      return;
    }
    if (isProblem(error, 'product_not_on_sale')) {
      // The pass was taken off sale after the cards were drawn (the catalogue
      // caches for up to five minutes, or this screen was left open): say so
      // in the member's language, and re-read the catalogue so its card goes.
      // A code typed for it is not at fault.
      this.set({ error: { message: errorMessage(error), cta: null } });
      this.catalogRefresh = loadPlanCatalog();
      return;
    }
    // A request the screen walked away from: nothing to say.
    if (isCancellation(error)) return;
    // A refused code is answered under the code box, not in the payment
    // alert; a code refusal with no code sent is not pinned on an empty box.
    const problem = sentCode !== null ? discountCodeProblemFrom(error) : null;
    if (problem) {
      this.set({ discountCodeProblem: problem });
      return;
    }
    // A purchase gate (a trial that is gone, a membership the profile already
    // has, an account set to be deleted) in the member's words; any other
    // refusal is the plain fallback, never the server's English (2.5.5),
    // with its next step.
    this.set({ error: { message: refusalMessage(error), cta: refusalFor(error)?.cta ?? null } });
  }

  // ---- The page and its return ---------------------------------------------

  /**
   * Opens the page `purchasePlan` made ready and verifies the purchase when
   * the member is back (iOS: the Safari cover, then `handleCheckoutReturn`).
   * Never throws.
   */
  async openCheckout(): Promise<void> {
    const purchase = this.purchase;
    if (!this.state.checkoutReady || !purchase?.url) return;
    this.set({ checkoutReady: false, pageOpen: true });
    const { userId, profile } = useAppStore.getState();
    const memberId = userId ?? profile?.id ?? null;
    if (!memberId) {
      this.finish({ kind: 'neverOpened' }, purchase);
      return;
    }
    let result: CheckoutResult;
    try {
      result = await checkoutOnHostedPage({
        memberId,
        url: purchase.url,
        externalSessionId: purchase.externalSessionId,
        plan: purchase.context,
        isScreenAlive: this.isScreenAlive,
        onVerifying: () => this.startVerifying(),
      });
      if (result.kind === 'unresolved') {
        // An earlier checkout of this same plan or pass was never verified (its
        // status check did not answer): no second page opened. Verify that
        // one now, on screen, under its own session.
        this.startVerifying();
        result = await checkCheckoutAgain(result.attempt, this.isScreenAlive);
      }
    } catch (error) {
      // The rails are written never to throw; should they, nothing is claimed.
      result = { kind: 'verified', verification: { kind: 'failed', error }, presented: false };
    }
    this.finish(result, purchase);
  }

  private startVerifying(): void {
    this.set({ pageOpen: false, isVerifying: true, verificationRunning: true, error: null });
  }

  /** What the member is told once the return has been verified. */
  private finish(result: CheckoutResult, purchase: Purchase): void {
    const done: Partial<PlanCheckoutState> = { pageOpen: false, isVerifying: false, verificationRunning: false };
    switch (result.kind) {
      case 'busy':
      case 'unresolved':
        // Another page or payment held the rail (never with Plans on screen):
        // nothing opened and nothing was paid; Continue is free again.
        this.set(done);
        return;
      case 'neverOpened':
        // No browser could show the page: nothing can have been paid on it.
        this.set({ ...done, error: { message: t('payment.err.checkout'), cta: null } });
        return;
      case 'verified':
        break;
    }
    // The rails already told the member (the screen was gone, or a recovery
    // after Android closed the app confirmed it a moment ago).
    if (result.presented) {
      this.set(done);
      return;
    }
    const verification = result.verification;
    switch (verification.kind) {
      case 'confirmed':
        this.set({ ...done, verificationPending: false, welcome: welcomeFor(purchase) });
        return;
      case 'timeout':
        // Never claimed to resolve itself: the confirm, the status poll and
        // the profile all failed to show it, and only support can say whether
        // the payment went through.
        this.set({ ...done, error: { message: t('plans.confirm_timeout', { email: MerchantInfo.email }), cta: null } });
        return;
      case 'failed':
        // The status check's refusal in the member's words: a gateway's page
        // reads as our side's failure, never "HTTP 504". No next step: the
        // payment may have gone through, and a second checkout is not the
        // answer to that.
        this.set({ ...done, error: { message: refusalMessage(verification.error), cta: null } });
        return;
      case 'cancelled':
        // The cancel link: a deliberate back-out is not an error.
        this.set(done);
        return;
      case 'unverified':
        // Web-first: closing the page is usually a price check, not a
        // purchase. The quiet chip, never a false alert.
        this.set({ ...done, verificationPending: true });
        return;
    }
  }

  /** The "Completed your purchase? Tap to check" chip (iOS `recheckPurchase`): two profile reads. */
  async recheckPurchase(): Promise<void> {
    const purchase = this.purchase;
    if (!purchase || this.state.verificationRunning) return;
    this.set({ isVerifying: true, verificationRunning: true });
    let confirmed = false;
    try {
      confirmed = (await recheckPlanPurchase(purchase.context)).kind === 'confirmed';
    } catch {
      confirmed = false;
    }
    this.set({
      isVerifying: false,
      verificationRunning: false,
      ...(confirmed ? { verificationPending: false, welcome: welcomeFor(purchase) } : {}),
    });
  }

  // ---- What the screen hands back ------------------------------------------

  /** The overlay's Cancel: the check goes on behind it and still lands its answer. */
  dismissOverlay(): void {
    this.set({ isVerifying: false });
  }

  /** Brings the overlay back while a check is still running (a tap on Continue meanwhile). */
  showOverlay(): void {
    if (this.state.verificationRunning) this.set({ isVerifying: true });
  }

  /** The payment alert was answered; its next step goes with it. */
  dismissError(): void {
    this.set({ error: null });
  }

  /** The welcome was answered. */
  dismissWelcome(): void {
    this.set({ welcome: null });
  }

  /** The screen takes the Kenni gate: the plan that was submitted, once. */
  takeKennitalaRefusal(): Plan | null {
    if (!this.state.needsKennitalaVerification) return null;
    const plan = this.state.kennitalaBlockedPlan;
    this.set({ needsKennitalaVerification: false });
    return plan;
  }
}

function welcomeFor(purchase: Purchase): CheckoutWelcome {
  const name = purchase.context.planName?.trim();
  return { name: name ? name : null, isPass: isPassSlug(purchase.context.productSlug) };
}
