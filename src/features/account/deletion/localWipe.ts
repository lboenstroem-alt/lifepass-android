/**
 * The phone's half of an account deletion, run once the deletion sheet has
 * gone (iOS `AccountDeletionSheet.finishDeletionIfNeeded`), in iOS's order:
 *
 * 1. The health store's `wipeLocal` with the reason `account_deletion`: the
 *    health files, outboxes, reminders and notifications, then every
 *    package's health-wipe hook (the Coach drops the health turns of a chat
 *    still on screen).
 * 2. The Coach's saved chats, and their owner: iOS calls
 *    `CoachViewModel.forgetSavedSessions()` here by name. They are the
 *    member's typed words, often about their health, and the sheet has just
 *    said the health data is deleted at once. A sign-out would take them
 *    too, but deletion does not sign out. Called whatever the wipe did, and
 *    even when the wipe could name nobody, as iOS calls it unconditionally.
 * 3. The profile, read again, so every screen shows the account as the
 *    server now has it.
 *
 * The server deleted every health row in the same transaction as the
 * request; what is left here is a cache.
 *
 * WHY AFTER THE SHEET, NOT AT THE ANSWER. The wipe resets what screens show
 * and can take the presenting screen with it; run first, the member who
 * confirmed would land back with no erasure date, no obligation lines and no
 * acknowledgement, which also invites a second request from someone who
 * thinks the first failed. What the phone SHOWS goes at the answer, though
 * (`applyHealthDataDeleted`, called by the sheet). If the app dies before
 * the sheet closes, the next profile read reconciles the cache away
 * (the health store's `reconcile`: consent is gone).
 */
import { useHealthStore } from '../../../health';
import { useAppStore } from '../../../stores/appStore';
import { forgetSavedCoachSessions } from '../../coach';

/**
 * Whose data the wipe is for: the profile's id when it loaded, else the
 * session's user id (the same id: `profiles.id` is the auth user id), else
 * null, and the health store falls back to the member it last loaded for.
 */
export function memberForDeletionWipe(): string | null {
  const app = useAppStore.getState();
  return app.profile?.id ?? app.userId ?? null;
}

/** Wipes this phone's copy of the member's health data and saved Coach chats, then re-reads the profile. Never throws. */
export async function finishAccountDeletionOnPhone(profileId: string | null): Promise<void> {
  try {
    await useHealthStore.getState().wipeLocal({ profileId, reason: 'account_deletion' });
  } catch {
    // A wipe that fails part-way still lets the steps below run; the next
    // reconcile takes what is left.
  }
  try {
    await forgetSavedCoachSessions();
  } catch {
    // Storage that refuses the delete must not keep the profile read below
    // from putting the screens right; the next sign-out deletes them again.
  }
  await useAppStore.getState().loadProfile();
}
