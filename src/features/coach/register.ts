// Session hooks for the Coach: its saved chats and the chat on screen are
// this member's typed words, and they must never reach the next account on
// the phone.
//
// - SIGN-IN (and a session restored at launch): the saved chats are claimed
//   (iOS `CoachViewModel.claimSavedSessions`): someone else's are deleted,
//   chats from before chats had an owner go to a restored session only. A
//   chat still in memory from another member is dropped.
//
//   THE CLAIM IS THE ONLY GATE. iOS claims before the tabs (and the view
//   model) exist, synchronously, so its Coach never sees another owner's
//   chats. Here the tabs can stay mounted through a sign-in (an auth link for
//   a second account) and the claim is two storage round trips. So the store
//   is closed SYNCHRONOUSLY as the hook starts (before any await: the
//   previous member's chat, counts and locks go, and nothing reads or writes
//   the saved chats), and opened only once the claim has run
//   (`sessionsClaimed`), which throws away anything read before it. A claim
//   that fails deletes the chats rather than guess whose they are; one that
//   cannot even do that leaves the store closed (no recents, no saves).
// - SIGN-OUT (and an account deletion, which signs out): the saved chats and
//   their owner are deleted, and the store is reset: messages, counts, locks
//   and every flow. iOS gets the second half for free (the view model goes
//   with the tabs); a zustand store outlives them, so it is reset here.
// - THE LOCAL HEALTH WIPE (tracking switched off, here or on the web): every
//   health turn leaves the chat on screen (iOS `.healthLocalDataWiped`).
//
// Before this, the first build kept the chats in one device-wide key: the
// next account on the phone saw them in the drawer and could send them to the
// Coach under its own name.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { registerSignInHook, registerSignOutCleaner } from '../../app/signOut';
import { registerHealthWipeHook } from '../../health';
import {
  claimSavedCoachSessions,
  COACH_SESSIONS_KEY,
  COACH_SESSIONS_OWNER_KEY,
  forgetSavedCoachSessions,
} from './persistence/sessions';
import { useCoachStore } from './store/coachStore';

export { claimSavedCoachSessions, COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY, forgetSavedCoachSessions };

/** Claims run one after another: the last sign-in's claim is the last to touch the owner key. */
let claiming: Promise<void> = Promise.resolve();

/**
 * The Coach's half of a sign-in (the hook below; exported for tests). The
 * store is closed before this returns its promise; it opens when the claim
 * has run.
 */
export function claimCoachForMember(userId: string, restoredSession: boolean): Promise<void> {
  // Synchronous, before anything awaits (see the file comment).
  useCoachStore.getState().signedIn(userId);
  const run = claiming.then(async () => {
    try {
      await claimSavedCoachSessions(userId, restoredSession);
    } catch {
      // Could not tell whose the chats are: they go, with their owner.
      try {
        await AsyncStorage.multiRemove([COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY]);
      } catch {
        return; // Still closed: better no recents than someone else's.
      }
      try {
        await AsyncStorage.setItem(COACH_SESSIONS_OWNER_KEY, userId.toLowerCase());
      } catch {
        // No owner: the next fresh sign-in deletes whatever is saved.
      }
    }
    useCoachStore.getState().sessionsClaimed(userId);
  });
  claiming = run.catch(() => undefined);
  return run;
}

registerSignInHook('coach.sessions', ({ userId, restoredSession }) => claimCoachForMember(userId, restoredSession));

registerSignOutCleaner('coach.sessions', async () => {
  useCoachStore.getState().resetForSignOut();
  await forgetSavedCoachSessions();
});

registerHealthWipeHook('coach.health-messages', () => useCoachStore.getState().dropHealthMessages());
