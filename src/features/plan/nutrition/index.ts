/**
 * Plan's food card (PLAN-5), for the packages that plug into it: the meal
 * outbox (MEAL-1) installs its queued meals so the card draws them with
 * "Waiting to sync" (./queuedMeals.ts explains the install).
 */
export {
  installPlanQueuedMeals,
  usePlanQueuedMeals,
  type PlanQueuedMeal,
  type PlanQueuedMealsSource,
} from './queuedMeals';
