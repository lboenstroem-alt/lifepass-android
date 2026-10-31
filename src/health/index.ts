/**
 * The health platform (F7): what the Plan tab, Home, the Coach, the meal
 * log, the runner, Body and goals and the monthly feedback build on. Import
 * from here:
 *
 *   import { useHealthStore, fetchHealthDay, exerciseLine, openHealthConsent } from '../../health';
 *
 * - ./models: the Today read and every health answer, decoded fail-soft as
 *   iOS HealthModels.swift does.
 * - ./api: one function per health operation (no cache, the caller's
 *   Idempotency-Key, `?locale=` in the account language).
 * - ./store: `useHealthStore` (the Today read, its cache, the problem table,
 *   reconcile, `wipeLocal`).
 * - ./localStore: the per-member files (`health/<profileId>/...`), the
 *   read outcome that tells absent from unreadable, `mergeOutbox`.
 * - ./localKeys: every AsyncStorage key that says something about a
 *   member's health use. A new one is added THERE, or the wipe misses it.
 * - ./wipe: `registerHealthWipeHook`, for what else must go with a wipe.
 * - ./doseCopy: the block dose Plan and the runner say the same way.
 * - ./consent, ./gate: the consent rules and the presenters that open the
 *   consent sheet and the meal membership gate from anywhere.
 *
 * The SCREENS (the consent sheet, the meal gate, the under-18 card and the
 * app-wide host) are in ./ui.ts, apart, so a store, a register file or a
 * background job can import this barrel without loading any UI.
 */
export * from './models';
export * from './api';
export {
  CHANGED_ELSEWHERE_PROBLEMS,
  FRESHNESS_WINDOW_MS,
  MAX_REMEMBERED_DAYS,
  evictOldDays,
  livePlanGoal,
  mayTakeTarget,
  replacingInDay,
  selectHasActiveProgram,
  selectHasLiveProgram,
  selectProposal,
  useHealthStore,
  type HealthActionResult,
  type HealthLoadOptions,
  type HealthLoadState,
  type HealthProblemOutcome,
  type HealthStore,
  type HealthStoreState,
  type LivePlanGoal,
} from './store';
export * as healthLocalStore from './localStore';
export { HEALTH_FILES, mergeOutbox, type HealthFile, type ReadOutcome } from './localStore';
export { FeedbackKeys, ReminderKeys, WearableKeys, planIntroCollapsedKey, scanMealGateSeenKey } from './localKeys';
export { registerHealthWipeHook, type HealthWipeContext, type HealthWipeHook } from './wipe';
export { blockDose, exerciseLine, loadWord, RunnerFormat, type DoseTranslate, type RunnerDoseUnit } from './doseCopy';
export {
  consentFailure,
  consentGrantBody,
  consentSource,
  consentToApply,
  consentWithdrawalBody,
  HealthConsentVersion,
  needsAgeAttestation,
  PRIVACY_POLICY_URL,
  type ConsentFailure,
  type HealthConsentEntry,
} from './consent/consent';
export { closeHealthConsent, isHealthConsentHostMounted, openHealthConsent, type HealthConsentRequest } from './consent/presenter';
export { dismissMealGate, mealGateCopy, presentMealGate, useMealGatePresenter, type MealGateCopy } from './gate/mealGate';
