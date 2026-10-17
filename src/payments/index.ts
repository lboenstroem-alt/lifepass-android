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
 *   `checkPaymentAgain` / `leaveAttempt` for "Confirming your payment";
 *   `payOutcomeTitle` / `payOutcomeMessage` / `confirmedBody` for the words;
 *   `registerPaymentOutcomePresenter('booking' | 'walk_in', ...)` for the
 *   outcome after process death (BOOK-1 schedules the check-in reminders
 *   there; CHECKIN-2 shows the proof).
 * - PLANS-2: src/api/planCheckout.ts for the checkout, `checkoutOnHostedPage`
 *   for the page and its verification, `registerPaymentOutcomePresenter('plan', ...)`.
 * - ACCT-2: `cardSetupOnHostedPage`; ACCT-3: `copayOnHostedPage`.
 * - F4's deep-link router: `handlePaymentReturnUrl(url)` for every link
 *   (`isPaymentReturnUrl` says which are ours). A payment or card return is
 *   not a launch onto Explore (iOS clears `exploreLaunchPresentation`).
 * - Every rail: call `settleUnresolvedPayments(memberId)` before a charged
 *   attempt's first create, so an old payment is known before a new key.
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
  checkoutOnHostedPage,
  checkPaymentAgain,
  copayOnHostedPage,
  leaveAttempt,
  payOnHostedPage,
  recheckPlanPurchase,
  settleUnresolvedPayments,
  type AttemptRef,
  type CardSetupResult,
  type CheckoutOnHostedPageInput,
  type CheckoutResult,
  type CopayResult,
  type HostedPayResult,
  type PayOnHostedPageInput,
  type PayOnHostedPageRequest,
} from './attempts';
export { confirmCardSetup, startCardSetup, type ConfirmedCard } from './cardSetup';
export {
  profileConfirmsPurchase,
  settleCopayCheckout,
  verifyPlanCheckout,
  type PlanVerification,
} from './planVerification';
export {
  defaultPresenter,
  registerPaymentOutcomePresenter,
  type PaymentOutcomePresenter,
  type PaymentResolution,
  type PresenterActions,
} from './presenters';
export { handlePaymentReturnUrl, recoverPayments, type RecoveryReport, type RecoveryTrigger } from './coldStartRecovery';
