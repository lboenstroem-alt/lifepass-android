/**
 * Open Food Facts from the phone (MEAL-3): the lookup and its lenient parse.
 *
 *   const outcome = await foodFacts().lookup(code, language);
 */
export {
  clearFoodFactsCache,
  foodFacts,
  FoodFactsService,
  OFF_CACHE_LIMIT,
  OFF_FIELDS,
  OFF_TIMEOUT_MS,
  offProductUrl,
  offUserAgent,
  setFoodFacts,
  type FoodFactsLookup,
} from './client';
export {
  cleanedOffText,
  isLiquidQuantity,
  OFF_FAILED,
  OFF_NOT_FOUND,
  offNumber,
  parseOffProduct,
  sameOutcome,
  type OFFLookupOutcome,
} from './parse';
