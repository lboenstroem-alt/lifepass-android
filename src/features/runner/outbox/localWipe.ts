/**
 * The runner's part of the local wipe (iOS: `.healthLocalDataWiped`, observed
 * by `WorkoutOutbox.forget()` and `WorkoutRunnerModel.wiped()`), run from
 * ../register.ts on two paths:
 *
 * - THE HEALTH WIPE'S HOOK (sign-out, a withdrawal here or elsewhere, a
 *   verified minor, an account deletion): the health store has deleted the
 *   member's folder. `scope: 'folder'` deletes it AGAIN, queued behind any
 *   write a continuation slipped in while the wipe awaited its other cleanup
 *   (../persistence/fence.ts says why that window exists). The whole folder,
 *   not only runner.json and outbox.json: a folder such a write recreated
 *   would otherwise stay behind empty, and the next profile read's reconcile
 *   would take it for health data still on the phone, wipe again and tell a
 *   member who withdrew here that tracking was "turned off elsewhere".
 * - THE RUNNER'S OWN SIGN-OUT CLEANER, so nothing of the member who left
 *   stays in memory or in the runner's two files even when the health layer
 *   did not run its wipe. `scope: 'files'`: the folder is the health
 *   layer's; only the runner's own files go.
 *
 * Both raise the wipe fence first, so work begun before it stops at its next
 * await; then memory goes (the queue, Plan's Resume row), an open runner is
 * told to close as discarded, and the removal is queued last. Resolves once
 * the removal has run.
 */
import * as localStore from '../../../health/localStore';
import type { HealthWipeContext } from '../../../health/wipe';
import { raiseRunnerWipeFence } from '../persistence/fence';
import { RunnerProgressIndex } from '../persistence/progressIndex';
import { notifyRunnerWiped } from '../persistence/wiped';

import { forgetWorkoutOutbox } from './workoutOutbox';

export async function wipeRunnerLocal(context: HealthWipeContext, scope: 'folder' | 'files'): Promise<void> {
  raiseRunnerWipeFence();
  forgetWorkoutOutbox();
  RunnerProgressIndex.reset();
  notifyRunnerWiped(context);
  const { profileId } = context;
  if (!profileId) return;
  if (scope === 'folder') {
    await localStore.deleteProfileFolder(profileId);
  } else {
    await Promise.all([localStore.remove('workoutOutbox', profileId), localStore.remove('runner', profileId)]);
  }
}
