/**
 * Analytics values for counts (iOS `MealAnalytics`). A number never travels
 * as itself, and the app's own guard refuses a bare "0" or "1" as a value,
 * so those two bands are words.
 */
import { countBand } from '../../../lib/analytics';

export function mealCountBand(count: number): string {
  if (count < 1) return 'none';
  if (count === 1) return 'one';
  return countBand(count);
}
