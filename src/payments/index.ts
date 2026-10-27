/**
 * The money rails core (package F8): hosted payment pages, the
 * pay-and-save-card session, and the in-flight records that let a payment
 * survive Android closing the app behind the page. Feature code imports from
 * here.
 *
 * WHO USES WHAT
 * - BOOK-1, CLASS-2 (bookings, classes) and CHECKIN-2 (walk-ins):
 *   `createPaymentSession` + `classifySessionCreateError` on the 402
 *   `no_payment_method_on_file`, then `payOnHostedPage` for the redirect;
 *   `checkPaymentAgain` / `leaveAttempt` for "Confirming your payment"
 *   (also for an `unresolved` result: an earlier attempt at the same action
 *   still unknown, shown under its own key instead of a new page; and a
 *   `settled` result with `page: 'earlier'`: it was paid a moment ago);
 *   `payOutcomeTitle` / `payOutcomeMessage` / `confirmedBody` for the words;
 *   `registerPaymentOutcomePresenter('booking' | 'walk_in', ...)` for the
 *   outcome after process death (BOOK-1 schedules the check-in reminders
 *   there, as the default presenter does until then once F7's reminders are
 *   in; CHECKIN-2 shows the proof).
 * - PLANS-2: src/api/planCheckout.ts for the checkout, `checkoutOnHostedPage`
 *   for the page and its verification (`checkCheckoutAgain` for an
 *   `unresolved` result), `registerPaymentOutcomePresenter('plan', ...)`.
 * - ACCT-2: `cardSetupOnHostedPage`; ACCT-3: `copayOnHostedPage`.
 * - F4's deep-link router: `handlePaymentReturnUrl(url)` for every link
 *   (`isPaymentReturnUrl` says which are ours). A payment or card return is
 *   not a launch onto Explore (iOS clears `exploreLaunchPresentation`).
 * - F4's app shell: `RecoveryProgressHost`, mounted once in App.tsx inside
 *   the UI kit's provider ("Confirming your payment…" while a payment the
 *   app lost is confirmed after a cold start).
 * - Any rail may call `unresolvedPayments(memberId)` before its first create
 *   to see an earlier payment before it makes a session; the page openers
 *   apply the same rules themselves.
 */
export {
  CONFIRM_ATTEMPTS,
  classifySessionCreateError,
  confirmPaymentSession,
  createPaymentSession,
  decodePaymentConfirmation,
  keyDisposition,
  PAGE_NEVER_OPENED,
  paymentSessionBody,
  settlePaymentSession,
  type BookingPayOutcome,
  type ClassPaymentSession,
  type GuestAgeBand,
  type PaymentConfirmation,
  type PaymentSessionBody,
  type PaymentSessionCreation,
  type PaymentSessionInput,
  type PaymentSessionStatus,
  type PaySettlement,
  type SessionCreateRefusal,
  type SettleOptions,
  type SlotPaymentSession,
  type WalkInPaymentSession,
} from './bookingPaymentSession';
export {
  confirmedBody,
  payOutcomeMessage,
  payOutcomeMessageKeys,
  payOutcomeTitle,
  payOutcomeTitleKey,
  REFUND_SLOT_KEYS,
  refundBodyKey,
  refundBodyKeys,
  walkInConfirmRefusalMessage,
  type PayCopyContext,
} from './payOutcomeCopy';
export {
  HOSTED_PAGE_OPTIONS,
  HostedPageBusyError,
  isHostedPageOpen,
  openHostedPage,
  type HostedPageLeg,
  type HostedPageResult,
} from './hostedPage';
export {
  CARD_SETUP_CANCEL_URL,
  CARD_SETUP_SUCCESS_URL,
  isPaymentReturnUrl,
  parseReturnUrl,
  PAYMENT_CANCEL_URL,
  PAYMENT_SUCCESS_URL,
  RETURN_PREFIX,
  type HostedPageFamily,
  type ParsedReturn,
} from './returnUrls';
export {
  INFLIGHT_KEY_PREFIX,
  INFLIGHT_MAX_AGE_MS,
  readInflight,
  type BookingAttemptContext,
  type BookingInflight,
  type CardSetupInflight,
  type CopayInflight,
  type InflightRail,
  type InflightRecord,
  type PlanAttemptContext,
  type PlanInflight,
  type WalkInAttemptContext,
  type WalkInInflight,
  type WalkInParty,
} from './inflight';
export {
  cardSetupOnHostedPage,
  checkCheckoutAgain,
  checkoutOnHostedPage,
  checkPaymentAgain,
  copayOnHostedPage,
  EARLIER_STILL_CONFIRMING,
  leaveAttempt,
  payOnHostedPage,
  recheckPlanPurchase,
  unresolvedPayments,
  type AttemptRef,
  type CardSetupResult,
  type CheckoutOnHostedPageInput,
  type CheckoutResult,
  type CopayResult,
  type HostedPayResult,
  type PayOnHostedPageInput,
  type PayOnHostedPageRequest,
  type UnresolvedPayments,
} from './attempts';
export { RECENT_RESOLUTION_MS, type RecentResolution } from './earlier';
export { confirmCardSetup, startCardSetup, type ConfirmedCard } from './cardSetup';
export {
  profileConfirmsPurchase,
  settleCopayCheckout,
  verifyPlanCheckout,
  type PlanVerification,
} from './planVerification';
export {
  defaultPresenter,
  presentPlanOutcome,
  registerPaymentOutcomePresenter,
  type PaymentOutcomePresenter,
  type PaymentResolution,
  type PresenterActions,
} from './presenters';
export {
  dismissRecoveryProgress,
  useRecoveryProgress,
  type RecoveryProgress,
} from './recoveryProgress';
export { default as RecoveryProgressHost } from './RecoveryProgressHost';
export { handlePaymentReturnUrl, recoverPayments, type RecoveryReport, type RecoveryTrigger } from './coldStartRecovery';
