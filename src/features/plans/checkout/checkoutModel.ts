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
 * NO SESSION THE RAILS WILL NOT OPEN (Android only). iOS opens every checkout
 * it creates. Here the money rails refuse a new page while an earlier
 * checkout of the same plan is still unverified (they verify that one
 * instead) or while a plan check is still running, so asking the server for
 * a session first would leave a Kling session and a pending order nobody
 * ever opens. `purchasePlan` therefore asks before it creates
 * (`earlierCheckoutOf`), and such a tap follows the earlier checkout
 * (`followEarlierCheckout`) instead of making a new one.
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
  isHostedPageOpen,
  readInflight,
  recheckPlanPurchase,
  recoverPayments,
  unresolvedPayments,
  type CheckoutResult,
  type InflightRecord,
  type PlanAttemptContext,
  type PlanInflight,
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
  /**
   * No new checkout was made: an earlier checkout of this plan (still
   * unverified, still being checked, or confirmed a moment ago) is followed
   * instead, once the payment sheet has gone (`followEarlierCheckout`).
   */
  readonly earlierPending: boolean;
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
  earlierPending: false,
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

/** What an earlier checkout of the same plan says before a new one is made (`earlierCheckoutOf`). */
type EarlierCheckout =
  /** A plan check is still running (this Plans screen's, or one a closed Plans left behind). */
  | { readonly kind: 'running' }
  /** An earlier checkout of this plan was never verified (its status check did not answer). */
  | { readonly kind: 'unresolved'; readonly memberId: string; readonly attemptId: string }
  /** It was confirmed while this tap waited; `presented`: the rails have said the welcome. */
  | { readonly kind: 'paid'; readonly presented: boolean }
  /** Another hosted page is open: no checkout can start. */
  | { readonly kind: 'busy' };

function isPassSlug(slug: string): boolean {
  return slug.startsWith('pass-');
}

/** The member the money rails save attempts under, or null when signed out. */
function currentMemberId(): string | null {
  const { userId, profile } = useAppStore.getState();
  return userId ?? profile?.id ?? null;
}

/** The member's saved checkouts of `slug` (the rails' in-flight records); none when they can't be read. */
async function planRecords(memberId: string, slug: string): Promise<PlanInflight[]> {
  let records: InflightRecord[];
  try {
    records = await readInflight(memberId);
  } catch {
    return [];
  }
  return records.filter((record): record is PlanInflight => record.rail === 'plan' && record.plan.productSlug === slug);
}

// ---- The plan checks running in this process ------------------------------
//
// A check (the page and its verification, or an earlier checkout verified
// again) outlives the Plans screen that started it: Cancel on "Confirming
// your payment…" lets it run on, and the member may then close Plans and open
// it again. The rails open no new page while it runs, so every Plans screen
// must know of it, not only the one that started it.

const runningChecks = new Map<string, Set<Promise<void>>>();

/** Notes `check` as running for `memberId` until it settles; returns it as is. */
function trackCheck<T>(memberId: string, check: Promise<T>): Promise<T> {
  const id = memberId.toLowerCase();
  let checks = runningChecks.get(id);
  if (!checks) {
    checks = new Set();
    runningChecks.set(id, checks);
  }
  const entry = check.then(
    () => undefined,
    () => undefined,
  );
  checks.add(entry);
  void entry.then(() => {
    checks.delete(entry);
    if (checks.size === 0 && runningChecks.get(id) === checks) runningChecks.delete(id);
  });
  return check;
}

/** Settles once every plan check running for `memberId` has ended; null when none runs. */
function runningCheck(memberId: string | null): Promise<void> | null {
  const checks = memberId ? runningChecks.get(memberId.toLowerCase()) : undefined;
  if (!checks || checks.size === 0) return null;
  return Promise.all([...checks]).then(() => undefined);
}

/** Tests only: forget the running checks (as a new process would). */
export function resetPlanChecksForTests(): void {
  runningChecks.clear();
}

export class PlanCheckoutModel {
  readonly store: StoreApi<PlanCheckoutState> = createStore<PlanCheckoutState>(() => INITIAL);
  readonly inAppCheckout: boolean;
  private readonly isScreenAlive: () => boolean;
  private purchase: Purchase | null = null;
  /** The earlier checkout this purchase follows instead of a new one (`earlierPending`). */
  private earlier: EarlierCheckout | null = null;
  /** The running check this screen's overlay is following (one a closed Plans left running). */
  private followed: Promise<void> | null = null;
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
      this.earlier = null;
      // A new attempt starts clean: no alert, no chip, no page from the last one.
      this.set({ isLoading: true, error: null, verificationPending: false, checkoutReady: false, earlierPending: false });
      track('begin_checkout', { plan_id: plan.id, mode: plan.mode });

      // Web-first fallback: the web plans page preselects this product (and
      // prefills its own code box from `?promo=`, for a pass as much as a
      // membership); its /payment-success page fulfils the purchase.
      if (!this.inAppCheckout) {
        this.purchase = { ...this.purchase, url: webCheckoutURL(plan.id, sentCode) };
        this.set({ isLoading: false, checkoutReady: true });
        return;
      }

      // Asked with the sheet's spinner still up, BEFORE a session is made
      // (see "NO SESSION THE RAILS WILL NOT OPEN").
      const memberId = currentMemberId();
      const earlier = memberId ? await this.earlierCheckoutOf(plan, memberId) : null;
      if (earlier?.kind === 'busy') {
        this.set({ error: { message: t('payment.err.checkout'), cta: null } });
      } else if (earlier) {
        this.earlier = earlier;
        this.set({ earlierPending: true });
      } else {
        try {
          const session = await createCheckout(plan.id, { saveCard: options.saveCard ?? null, promotionCode: sentCode });
          this.purchase = { ...this.purchase, url: session.url, externalSessionId: session.externalSessionId };
          this.set({ checkoutReady: true });
        } catch (error) {
          this.refused(plan, error, sentCode);
        }
      }
      this.set({ isLoading: false });
    } finally {
      this.set({ checkoutInFlight: false });
    }
  }

  /**
   * What the rails would do with a new checkout of `plan` before its page
   * opens (src/payments attempts `begin`), asked before the session exists so
   * none is made in vain. Null: make the checkout.
   *
   * - A plan check still running: the rails open no page meanwhile.
   * - Another hosted page open: likewise.
   * - A saved checkout of this plan: first wait for whatever the rails'
   *   recovery is settling for the member (it may be this very one). Then it
   *   is either confirmed (the member just paid: no second purchase), still
   *   unverified (the rails allow no new session while it is unknown, so it is
   *   verified again instead), or gone for another reason (a timeout, a page
   *   never paid): a new checkout is then the member's choice.
   */
  private async earlierCheckoutOf(plan: Plan, memberId: string): Promise<EarlierCheckout | null> {
    if (runningCheck(memberId)) return { kind: 'running' };
    if (isHostedPageOpen()) return { kind: 'busy' };
    const before = await planRecords(memberId, plan.id);
    if (before.length === 0) return null;
    let found: Awaited<ReturnType<typeof unresolvedPayments>>;
    try {
      found = await unresolvedPayments(memberId);
    } catch {
      // The rails' own check still runs before the page; nothing is claimed here.
      return null;
    }
    const paid = found.resolved.find(
      (entry) =>
        entry.resolution.rail === 'plan' && before.some((record) => record.attemptId === entry.resolution.record.attemptId),
    );
    if (paid) return { kind: 'paid', presented: paid.presented };
    const unknown = found.unresolved.find((record) => record.rail === 'plan' && record.plan.productSlug === plan.id);
    if (unknown) return { kind: 'unresolved', memberId, attemptId: unknown.attemptId };
    if (runningCheck(memberId)) return { kind: 'running' };
    return null;
  }

  /**
   * After the payment sheet has gone, when `purchasePlan` made no checkout
   * because an earlier one decides this tap (`earlierPending`). Never throws.
   */
  async followEarlierCheckout(): Promise<void> {
    const earlier = this.earlier;
    const purchase = this.purchase;
    this.earlier = null;
    if (!this.state.earlierPending) return;
    this.set({ earlierPending: false });
    if (!earlier || !purchase) return;
    switch (earlier.kind) {
      case 'running':
        this.showOverlay();
        return;
      case 'paid':
        // Confirmed a moment ago, while the tap waited: the welcome (once).
        if (!earlier.presented) this.set({ verificationPending: false, welcome: welcomeFor(purchase) });
        return;
      case 'unresolved':
        await this.verifyEarlier(earlier.memberId, earlier.attemptId);
        return;
      case 'busy':
        return;
    }
  }

  /**
   * Verifies again the earlier checkout of this plan that was never verified,
   * under "Confirming your payment…". The rails' recovery settles it (it is
   * the attempt's owner while no screen holds it). It runs as a quiet check,
   * so the rails draw no second "Confirming" over this one; a confirmed
   * purchase or the timeout is still said, by the rails' plan presenter in
   * the Plans screen's words. A check that still does not answer is said here,
   * and the attempt stays saved for the next try.
   */
  private async verifyEarlier(memberId: string, attemptId: string): Promise<void> {
    this.startVerifying();
    await trackCheck(
      memberId,
      recoverPayments(memberId, 'foreground').then(
        () => undefined,
        () => undefined,
      ),
    );
    let stillUnknown: boolean;
    try {
      stillUnknown = (await readInflight(memberId)).some((record) => record.attemptId === attemptId);
    } catch {
      stillUnknown = false;
    }
    this.set({
      pageOpen: false,
      isVerifying: false,
      verificationRunning: false,
      ...(stillUnknown ? { error: { message: t('payment.err.checkout'), cta: null } } : {}),
    });
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
    const url = purchase?.url;
    if (!this.state.checkoutReady || !purchase || !url) return;
    this.set({ checkoutReady: false, pageOpen: true });
    const memberId = currentMemberId();
    if (!memberId) {
      this.finish({ kind: 'neverOpened' }, purchase);
      return;
    }
    const run = async (): Promise<CheckoutResult> => {
      try {
        const opened = await checkoutOnHostedPage({
          memberId,
          url,
          externalSessionId: purchase.externalSessionId,
          plan: purchase.context,
          isScreenAlive: this.isScreenAlive,
          onVerifying: () => this.startVerifying(),
        });
        if (opened.kind !== 'unresolved') return opened;
        // An earlier checkout of this same plan or pass was never verified
        // (its status check did not answer) and no second page opened. Asked
        // before the create (`earlierCheckoutOf`), so this is the web-first
        // fallback or a record saved in between. Verify that one now, on
        // screen, under its own session.
        this.startVerifying();
        return await checkCheckoutAgain(opened.attempt, this.isScreenAlive);
      } catch (error) {
        // The rails are written never to throw; should they, nothing is claimed.
        return { kind: 'verified', verification: { kind: 'failed', error }, presented: false };
      }
    };
    this.finish(await trackCheck(memberId, run()), purchase);
  }

  private startVerifying(): void {
    // This screen's own check from here on: a check it was following no longer clears the overlay.
    this.followed = null;
    this.set({ pageOpen: false, isVerifying: true, verificationRunning: true, error: null });
  }

  /** What the member is told once the return has been verified. */
  private finish(result: CheckoutResult, purchase: Purchase): void {
    const done: Partial<PlanCheckoutState> = { pageOpen: false, isVerifying: false, verificationRunning: false };
    switch (result.kind) {
      case 'busy':
      case 'unresolved':
      case 'neverOpened':
        // No page came up: no browser could show it, or (Android only, and
        // not while Plans is on top) another kind of payment, a booking's or
        // a walk-in's, was being settled at that moment (a plan's own earlier
        // checkout is asked about before the create). Nothing can have been
        // paid on this checkout; the member can try again.
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

  /**
   * A plan check is still running: this screen's (behind a cancelled
   * overlay), or one a Plans screen that has since closed left running. The
   * rails open no new page until it ends.
   */
  get isCheckRunning(): boolean {
    return this.state.verificationRunning || runningCheck(currentMemberId()) !== null;
  }

  /**
   * Brings "Confirming your payment…" back while a check is still running (a
   * tap on Continue meanwhile), rather than a second checkout over a payment
   * that may just have gone through. A check another Plans screen left
   * running is followed until it ends; the rails tell its outcome themselves,
   * that screen being gone.
   */
  showOverlay(): void {
    if (this.state.verificationRunning) {
      this.set({ isVerifying: true });
      return;
    }
    const running = runningCheck(currentMemberId());
    if (!running) return;
    this.followed = running;
    this.set({ isVerifying: true, verificationRunning: true });
    void running.then(() => {
      if (this.followed !== running) return;
      this.followed = null;
      this.set({ isVerifying: false, verificationRunning: false });
    });
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
