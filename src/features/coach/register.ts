// Session hooks for the Coach: its saved chats are this member's typed words,
// and they must never reach the next account on the phone.
//
// Pre-created by F3 (plan 3.0, rule 7) with the claim and forget iOS runs at
// sign-in and sign-out (CoachViewModel `claimSavedSessions` and
// `forgetSavedSessions`), over the keys the Coach saves its chats under today
// (src/coach/chatSessions.ts). COACH-1 takes this file over, and adds the
// "an open Coach screen drops its recents" half through `onSignedOut`.
//
// Before this, the chats sat in one device-wide key: the next account on the
// phone saw them in the drawer and could send them to the Coach under its own
// name.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { registerSignInHook, registerSignOutCleaner } from '../../app/signOut';

/** Where the Coach keeps its saved chats (iOS uses the same key). */
export const COACH_SESSIONS_KEY = 'coach.sessions.v1';
/** Whose chats they are: the member id, lower case. */
export const COACH_SESSIONS_OWNER_KEY = 'coach.sessions.owner';

/**
 * At sign-in and session restore: the saved chats stay only when they are
 * this member's. Someone else's are deleted. Chats saved before chats had an
 * owner (iOS 2.4.0, and every Android build before this one) go only to a
 * RESTORED session, the member who was signed in when the update arrived; a
 * fresh sign-in never inherits them.
 */
export async function claimSavedCoachSessions(userId: string, restoredSession: boolean): Promise<void> {
  const id = userId.toLowerCase();
  const owner = await AsyncStorage.getItem(COACH_SESSIONS_OWNER_KEY);
  if (owner === id) return;
  if (owner !== null || !restoredSession) {
    await AsyncStorage.removeItem(COACH_SESSIONS_KEY);
  }
  await AsyncStorage.setItem(COACH_SESSIONS_OWNER_KEY, id);
}

/** Sign-out and an account deletion: the saved chats go, and so does their owner. */
export async function forgetSavedCoachSessions(): Promise<void> {
  await AsyncStorage.multiRemove([COACH_SESSIONS_KEY, COACH_SESSIONS_OWNER_KEY]);
}

registerSignInHook('coach.sessions', ({ userId, restoredSession }) =>
  claimSavedCoachSessions(userId, restoredSession),
);
registerSignOutCleaner('coach.sessions', () => forgetSavedCoachSessions());
