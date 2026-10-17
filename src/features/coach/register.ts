// Session hooks for the Coach: its saved chats and the chat on screen are
// this member's typed words, and they must never reach the next account on
// the phone.
//
// - SIGN-IN (and a session restored at launch): the saved chats are claimed
//   (iOS `CoachViewModel.claimSavedSessions`): someone else's are deleted,
//   chats from before chats had an owner go to a restored session only. A
//   chat still in memory from another member is dropped.
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

registerSignInHook('coach.sessions', async ({ userId, restoredSession }) => {
  await claimSavedCoachSessions(userId, restoredSession);
  useCoachStore.getState().signedIn(userId);
});

registerSignOutCleaner('coach.sessions', async () => {
  useCoachStore.getState().resetForSignOut();
  await forgetSavedCoachSessions();
});

registerHealthWipeHook('coach.health-messages', () => useCoachStore.getState().dropHealthMessages());
