// @plans-1-stub (plan 3.0 rule 5): the Plans checkout, filled by PLANS-2.
//
// The Plans screen (src/features/plans/PlansView.tsx, PLANS-1) owns
// everything up to "buy this plan": the cards, the eID gate, and parking the
// plan across the Kenni sheet. It calls `usePlanCheckout` from here for what
// follows: iOS's payment sheet (the card-on-file mandate, the save-card
// switch for a pass, the partner discount code), the hosted Kling page, its
// return and verification, the welcome, and the purchase refusals with their
// next steps.
//
// PLANS-2 owns this folder: keep these exports and signatures (./contract.ts),
// replace the interim body (./interimCheckout.ts) and this marker. Until then
// the interim checkout runs the purchase on the first build's rail; what it
// does and does not do yet is in its file comment.
export { usePlanCheckout } from './interimCheckout';
export type { PlanCheckout, PlanCheckoutEvents } from './contract';
