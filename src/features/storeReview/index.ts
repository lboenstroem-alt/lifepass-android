/**
 * The Google Play rating (B2, API 0.46.0): asked rarely, after a happy
 * moment, through Google Play's own card (./storeReview.ts). Account's
 * "Rate LifePass" row is Account's own (src/features/account/links.ts): it
 * is always there and is not an ask.
 */
export {
  addMonths,
  askForStoreReview,
  isHappyMoment,
  lastAskedKey,
  setStoreReviewDepsForTests,
  STORE_REVIEW_CHECK_INS,
  STORE_REVIEW_FLOW_WAIT_MS,
  STORE_REVIEW_INTERVAL_MONTHS,
  STORE_REVIEW_MIN_ACCOUNT_AGE_MS,
  storeReviewRefusal,
  type StoreReviewDeps,
  type StoreReviewGateInput,
  type StoreReviewMoment,
  type StoreReviewRefusal,
} from './storeReview';
