// Session hooks for the food log: what this phone must forget when the
// member's health data is wiped or they sign out, and when the meal outbox
// flushes. Imported once at startup by src/app/registrations.ts, so each
// hook is in place before any sign-in or sign-out can happen.
//
// - HEALTH WIPE (sign-out, withdrawal here or elsewhere, a verified minor, an
//   account deletion): the health store deletes the member's whole profile
//   folder, which holds meal-outbox.json, tray.json and foods.json; here the
//   copies in memory go too (iOS: the outbox and the foods cache observe
//   `.healthLocalDataWiped`).
// - SIGN-OUT: the same three files and the memory, by name, for the member
//   who left. The health store's own wipe already covers the files when its
//   sign-out cleaner is registered (src/health/register.ts); this makes the
//   food log's part independent of that, and both are idempotent.
// - ACTIVATION (the first profile read of a sign-in, every return to the
//   foreground): the outbox loads this member's queue and sends what waits,
//   in the background (iOS MainTabView's `.task(id: profile.id)` and
//   ContentView's activation flush). Never a sheet.
//
// Plan's failed-item banner takes `mealOutboxPlanSource` through PLAN-1's
// `installPlanOutbox('meal', ...)` (src/features/plan/shell/bridges.ts),
// installed here once that contract is on the branch.
import { registerActivationHook, registerSignOutCleaner } from '../../app/signOut';
import * as localStore from '../../health/localStore';
import { registerHealthWipeHook } from '../../health/wipe';

import { foodsCacheProfileId, resetFoodsCacheMemory } from './foodsCache/foodsCache';
import { activateMealOutbox, mealOutboxProfileId, resetMealOutboxMemory } from './outbox/mealOutbox';

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

registerHealthWipeHook('meals.memory', () => forgetMealMemory());

registerSignOutCleaner('meals.local', ({ memberId }) => wipeMealLocal(memberId));

registerActivationHook('meals.outbox', ({ memberId }) => activateMealOutbox({ profileId: memberId, flushNow: true }));
