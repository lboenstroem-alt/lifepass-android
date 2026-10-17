/**
 * @deprecated The plan catalogue moved to src/features/plans (PLANS-1):
 * `fetchPlanCatalog`, `priceIskForSlug` and the types from
 * `src/features/plans` (its index), the catalogue on screen from its store.
 * Kept as a re-export so nothing written against the first build's path
 * breaks; QA-1 deletes it once nothing imports it.
 */
export {
  fetchPlanCatalog,
  priceIskForSlug,
  type CatalogPassSku,
  type CatalogTier,
  type PlanCatalog,
} from '../../features/plans';
