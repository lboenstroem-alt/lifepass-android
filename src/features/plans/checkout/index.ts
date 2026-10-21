/**
 * The Plans checkout (PLANS-2): what follows "buy this plan" on the Plans
 * screen (src/features/plans/PlansView.tsx, PLANS-1), whose eID gate runs
 * first. The seam is ./contract.ts; `usePlanCheckout` keeps its signature.
 *
 * - ./usePlanCheckout.tsx: the order of things on screen (the payment sheet,
 *   the hosted page, "Confirming your payment…", the welcome, the payment
 *   alert with its next step, the "check again" chip).
 * - ./checkoutModel.ts: the rules (iOS `PlansViewModel`'s checkout half).
 * - ./discountCode.ts: the partner discount code (iOS `DiscountCode`).
 * - The wire calls are src/api/planCheckout.ts; the page, its verification
 *   and its recovery after Android closed the app behind it are src/payments.
 */
export { usePlanCheckout } from './usePlanCheckout';
export type { PlanCheckout, PlanCheckoutEvents } from './contract';
export {
  DISCOUNT_CODE_MAX_LENGTH,
  discountCodeMessageKey,
  discountCodeProblemFrom,
  isWellFormedDiscountCode,
  normaliseDiscountCode,
  type DiscountCodeProblem,
} from './discountCode';
export { plansOffersRefusalStep } from './refusalSteps';
