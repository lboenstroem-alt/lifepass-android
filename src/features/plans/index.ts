/**
 * Plans and passes (PLANS-1): the public surface for other features and for
 * the checkout (PLANS-2, src/features/plans/checkout).
 *
 * The screen itself is the root modal `Plans`: open it with
 * `navigation.navigate('Plans')` (optionally `{ segment: 'passes' }` or
 * `{ slug }` to open on a card), never by importing it.
 *
 * - The plans and passes, and their copy: ./plans.ts.
 * - The priced catalogue (`GET /catalog/plans`) and how it joins the cards:
 *   ./catalog.ts, ./pricing.ts.
 * - The catalogue the screen is showing: ./catalogStore.ts. A checkout that
 *   is refused `product_not_on_sale` calls `loadPlanCatalog()` so the card
 *   goes (iOS `catalogRefresh`).
 */
export {
  decodePlanCatalog,
  fetchPlanCatalog,
  passSlugs,
  priceIskForSlug,
  tierForSlug,
  type CatalogPassSku,
  type CatalogTier,
  type PlanCatalog,
} from './catalog';
export { currentPlanCatalog, loadPlanCatalog, resetPlanCatalog, usePlanCatalog } from './catalogStore';
export {
  ALL_PLANS,
  continueName,
  copyKeys,
  displayName,
  fallbackVisitorPasses,
  featureLines,
  featureText,
  isDayPass,
  isSubscription,
  OFF_SALE_SLUGS,
  planForSlug,
  SUBSCRIPTION_PLANS,
  subtitle,
  VISITOR_PACKAGES,
  visitorPasses,
  type Plan,
  type PlanFeature,
  type PlanMode,
} from './plans';
export { cardFeatureLines, finePrintTermsKey, priceLabel, tierFacts } from './pricing';
