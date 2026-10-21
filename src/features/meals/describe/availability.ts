/**
 * When "Describe a meal" is offered at all (iOS FoodSearchMode `describeOn`):
 *
 * - only while the server advertises `meal_describe` (its health features,
 *   from the profile or the Today read). The server advertises it only once
 *   FOOD_AI_ENABLED is on and a consent text that covers a description is
 *   published, so nothing is ever sent before the owner says so; a 404 from
 *   the route drops it again at once (`dropServerFeature`);
 * - only for the last 30 days: OP-56 takes the same window as a photo scan
 *   (`MEAL_SCAN_PAST_DAYS`), so an older day offers no Describe rather than
 *   a refusal after typing (iOS `MealCaptureModel.describeAvailable`).
 */
import { addServerDays, dateFromServerDay, todayServerDay } from '../../../i18n/format';
import { selectSupportsMealDescribe, useAppStore } from '../../../stores/appStore';

/** OP-56 takes the last 30 days (`MEAL_SCAN_PAST_DAYS`), today included. */
export const DESCRIBE_PAST_DAYS = 30;

/** Whether a description may be filed on `date` (`YYYY-MM-DD`). A day this build cannot read is left to the server. */
export function isDescribeAvailableOn(date: string, today: string = todayServerDay()): boolean {
  if (!dateFromServerDay(date)) return true;
  const limit = addServerDays(today, -DESCRIBE_PAST_DAYS);
  if (!limit) return true;
  return date >= limit;
}

/** The server advertises the route, and the day is within its window. */
export function isDescribeOffered(date: string, serverFeatures: readonly string[] = useAppStore.getState().serverFeatures): boolean {
  return serverFeatures.includes('meal_describe') && isDescribeAvailableOn(date);
}

/** `isDescribeOffered` as a hook, for the search's entries (MEAL-2). */
export function useDescribeOffered(date: string): boolean {
  const supports = useAppStore(selectSupportsMealDescribe);
  return supports && isDescribeAvailableOn(date);
}
