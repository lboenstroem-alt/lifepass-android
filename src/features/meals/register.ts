// Session hooks for the food log: what this phone must forget when the
// member's health data is wiped or they sign out, and when the meal outbox
// flushes. Imported once at startup by src/app/registrations.ts, so each
// hook is in place before any sign-in or sign-out can happen.
//
// - HEALTH WIPE (sign-out, withdrawal here or elsewhere, a verified minor, an
//   account deletion): the health store deletes the member's whole profile
//   folder, which holds meal-outbox.json, tray.json and foods.json; here the
//   copies in memory go, and the folder is deleted once more (see
//   `wipeMealAfterHealthWipe`). iOS: the outbox and the foods cache observe
//   `.healthLocalDataWiped`.
// - SIGN-OUT: the same three files and the memory, by name, for the member
//   who left. The health store's own wipe already covers the files when its
//   sign-out cleaner is registered (src/health/register.ts); this makes the
//   food log's part independent of that, and both are idempotent.
// - ACTIVATION (the first profile read of a sign-in, every return to the
//   foreground): the outbox loads this member's queue and sends what waits,
//   in the background (iOS MainTabView's `.task(id: profile.id)` and
//   ContentView's activation flush). Never a sheet.
//
// PLAN'S OUTBOX BRIDGE: the meal half of iOS `PlanOutboxBridge` (installed
// in `MealOutbox.activate` there) is installed below, at module load, so
// Plan's load and pull flush meals as the member's own action after the
// workout outbox, and a meal the server refuses shows in Plan's failed-item
// banner with Discard (../__tests__/register.test.ts).
import { registerActivationHook, registerSignOutCleaner } from '../../app/signOut';
import * as localStore from '../../health/localStore';
import { registerHealthWipeHook } from '../../health/wipe';
import { installPlanOutbox } from '../plan';

import { foodsCacheProfileId, resetFoodsCacheMemory } from './foodsCache/foodsCache';
import {
  activateMealOutbox,
  mealOutboxPlanSource,
  mealOutboxProfileId,
  resetMealOutboxMemory,
} from './outbox/mealOutbox';

installPlanOutbox('meal', mealOutboxPlanSource);

/** The meal files a member's folder can hold. */
export const MEAL_LOCAL_FILES = ['mealOutbox', 'tray', 'foods'] as const;

/** Forget the queue and the food lists in memory (nothing on disk). */
export function forgetMealMemory(): void {
  resetMealOutboxMemory();
  resetFoodsCacheMemory();
}

/** Remove the member's meal files and forget them in memory. */
export async function wipeMealLocal(memberId: string | null): Promise<void> {
  // Captured before the memory goes: a sign-out that could name nobody
  // still knows whose queue and lists were open.
  const id = memberId ?? mealOutboxProfileId() ?? foodsCacheProfileId();
  forgetMealMemory();
  if (!id) return;
  await Promise.all(MEAL_LOCAL_FILES.map((file) => localStore.remove(file, id)));
}

/**
 * The food log's part of a health wipe: forget the memory, then delete the
 * member's folder once more.
 *
 * WHY ONCE MORE: the health store queues the folder's deletion, waits on its
 * native cleanup (the background task, the notifications, the keys), and
 * only then runs this hook. iOS does all of it in one main-actor turn, so
 * nothing can write in between; here, a meal write that landed in that wait
 * (a send's answer marking a meal failed, a foods refresh, a Save, a tray
 * save) was queued after the deletion and made the file, and the folder,
 * again. This deletion is queued after every such write, and with the
 * memory gone nothing here writes after it. The whole folder rather than
 * the three files: an empty folder still counts as local health state, so
 * the next profile read would wipe again and say "turned off elsewhere" a
 * second time.
 *
 * A wipe that could name nobody (a sign-out with no member known) leaves the
 * health files alone; the food log still removes those of the queue or the
 * lists that were open.
 *
 * Contract request (F7): a synchronous wipe-start phase run before
 * `wipeLocal` queues the deletion would let the memory go before any write
 * could be queued at all, as on iOS; this deletion would then be a no-op.
 */
export async function wipeMealAfterHealthWipe(memberId: string | null): Promise<void> {
  if (!memberId) {
    await wipeMealLocal(null);
    return;
  }
  forgetMealMemory();
  await localStore.deleteProfileFolder(memberId);
}

registerHealthWipeHook('meals.memory', ({ profileId }) => wipeMealAfterHealthWipe(profileId));

registerSignOutCleaner('meals.local', ({ memberId }) => wipeMealLocal(memberId));

registerActivationHook('meals.outbox', ({ memberId }) => activateMealOutbox({ profileId: memberId, flushNow: true }));
