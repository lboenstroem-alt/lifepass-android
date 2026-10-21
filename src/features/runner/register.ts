// Session hooks for the workout runner: the outbox and the Resume row on
// every activation, and what the local wipe and a sign-out take. Pre-created
// by F3 (plan 3.0, rule 7); loaded once at startup by src/app/registrations.ts.
//
// - ACTIVATION (the first profile read of a sign-in, every return to the
//   foreground with a member signed in): a workout saved offline is sent
//   whichever tab is open, so a member who never opens Plan again still has
//   it delivered before it expires (iOS MainTabView's `.task(id: profile)`
//   and ContentView's scene-phase flush). Background semantics: a withdrawn
//   consent reconciles, never a sheet. Without a profile there is nothing to
//   flush for (iOS guards the same way).
// - THE LOCAL WIPE (a withdrawal here or elsewhere, a verified minor, an
//   account deletion, and a sign-out once the health layer runs its wipe
//   then): the health store has deleted the member's folder, runner.json and
//   outbox.json with it, and every health.* notification (the rest-over one
//   included). ./outbox/localWipe.ts raises the wipe fence, forgets the queue
//   and the Resume row, tells an open runner to close as discarded, and
//   deletes the folder again behind any write that slipped in meanwhile.
// - SIGN-OUT, on its own: iOS's `handleSignOut` wipes health data by name, so
//   it cannot be skipped. Here the health layer's sign-out wipe is registered
//   by src/health/register.ts, which src/app/registrations.ts does not load
//   yet (contract request to F3: a `health` SHARED_LAYERS line). And a wipe
//   that fails before its hooks would skip this one. So the runner clears its
//   own memory and its own two files at every sign-out too; when the health
//   wipe also runs, the second pass finds nothing.
//
// PLAN'S OUTBOX BRIDGE: the workout half of iOS PlanOutboxBridge is
// installed below, so Plan's load flushes the queue with foreground semantics
// and shows the failed-item banner (./outbox/__tests__/planBridgeInstall.test.ts).
import { registerActivationHook, registerSignOutCleaner } from '../../app/signOut';
import { registerHealthWipeHook } from '../../health/wipe';
import { useAppStore } from '../../stores/appStore';
import { installPlanOutbox } from '../plan';

import { wipeRunnerLocal } from './outbox/localWipe';
import { workoutPlanOutboxSource } from './outbox/planSource';
import { activateWorkoutRunnerSupport } from './outbox/support';
import { activateWorkoutOutbox, useWorkoutOutbox } from './outbox/workoutOutbox';
import { useRunnerProgress } from './persistence/progressIndex';

installPlanOutbox('workout', workoutPlanOutboxSource);

registerActivationHook('runner.outbox', async ({ memberId, trigger }) => {
  if (!useAppStore.getState().profile) return;
  if (trigger === 'profile') {
    await activateWorkoutRunnerSupport(memberId, { flushNow: true });
  } else {
    await activateWorkoutOutbox(memberId, { flushNow: true });
  }
});

registerHealthWipeHook('runner.local', (context) => wipeRunnerLocal(context, 'folder'));

registerSignOutCleaner('runner.local', ({ memberId }) => {
  // The member who left: the sign-out names them, else whoever the queue or
  // the Resume row was last read for.
  const outbox = useWorkoutOutbox.getState();
  const profileId =
    memberId ?? outbox.profileId ?? outbox.unadoptedProfileId ?? useRunnerProgress.getState().profileId ?? null;
  return wipeRunnerLocal({ profileId, reason: 'signout' }, 'files');
});
