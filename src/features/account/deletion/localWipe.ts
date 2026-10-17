/**
 * The phone's half of an account deletion, run once the deletion sheet has
 * gone (iOS `AccountDeletionSheet.finishDeletionIfNeeded`).
 *
 * The server deleted every health row in the same transaction as the
 * request; what is left here is a cache, and it goes now: the health files,
 * outboxes, reminders and notifications (the health store's `wipeLocal`,
 * which also runs every package's health-wipe hook with the reason
 * `account_deletion`), then the profile is read again so every screen shows
 * the account as the server now has it.
 *
 * THE COACH'S SAVED CHATS go through that same hook. iOS calls
 * `CoachViewModel.forgetSavedSessions()` here by name; on Android the Coach
 * owns its chats and forgets them from its own health-wipe hook when the
 * reason is `account_deletion` (src/features/coach/register.ts, COACH-1),
 * so this file never reaches into the Coach's storage.
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

/**
 * Whose data the wipe is for: the profile's id when it loaded, else the
 * session's user id (the same id: `profiles.id` is the auth user id), else
 * null, and the health store falls back to the member it last loaded for.
 */
export function memberForDeletionWipe(): string | null {
  const app = useAppStore.getState();
  return app.profile?.id ?? app.userId ?? null;
}

/** Wipes this phone's copy of the member's health data, then re-reads the profile. Never throws. */
export async function finishAccountDeletionOnPhone(profileId: string | null): Promise<void> {
  try {
    await useHealthStore.getState().wipeLocal({ profileId, reason: 'account_deletion' });
  } catch {
    // A wipe that fails part-way still lets the profile read below put the
    // screens right; the next reconcile takes what is left.
  }
  await useAppStore.getState().loadProfile();
}
