// Session hooks for the workout runner: the outbox and the Resume row on
// every activation, and what the local wipe takes from memory. Pre-created by
// F3 (plan 3.0, rule 7); loaded once at startup by src/app/registrations.ts.
//
// - ACTIVATION (the first profile read of a sign-in, every return to the
//   foreground with a member signed in): a workout saved offline is sent
//   whichever tab is open, so a member who never opens Plan again still has
//   it delivered before it expires (iOS MainTabView's `.task(id: profile)`
//   and ContentView's scene-phase flush). Background semantics: a withdrawn
//   consent reconciles, never a sheet. Without a profile there is nothing to
//   flush for (iOS guards the same way).
// - THE LOCAL WIPE (sign-out, a withdrawal here or elsewhere, a verified
//   minor, an account deletion): the health store has already deleted the
//   member's folder, runner.json and outbox.json with it, and every health.*
//   notification (the rest-over one included). Memory follows: the outbox
//   forgets its queue, Plan's Resume row empties, and an open runner is told
//   to close as discarded without writing anything back.
//
// Nothing else is stored per member outside the health folder, so no
// sign-out cleaner of its own is needed: the health wipe runs at every
// sign-out (src/health/register.ts).
import { registerActivationHook } from '../../app/signOut';
import { registerHealthWipeHook } from '../../health/wipe';
import { useAppStore } from '../../stores/appStore';

import { activateWorkoutRunnerSupport } from './outbox/support';
import { activateWorkoutOutbox, forgetWorkoutOutbox } from './outbox/workoutOutbox';
import { RunnerProgressIndex } from './persistence/progressIndex';
import { notifyRunnerWiped } from './persistence/wiped';

registerActivationHook('runner.outbox', async ({ memberId, trigger }) => {
  if (!useAppStore.getState().profile) return;
  if (trigger === 'profile') {
    await activateWorkoutRunnerSupport(memberId, { flushNow: true });
  } else {
    await activateWorkoutOutbox(memberId, { flushNow: true });
  }
});

registerHealthWipeHook('runner.local', (context) => {
  forgetWorkoutOutbox();
  RunnerProgressIndex.reset();
  notifyRunnerWiped(context);
});
