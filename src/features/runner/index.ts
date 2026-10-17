// @f4-stub (plan 3.0.3): the workout runner's public contract.
//
// Filled by RUN-1 (the data functions: `hasPendingWorkout`, `resumableWorkout`);
// ownership passes to RUN-3 after RUN-1 merges (RUN-3 owns `openRunner`).
// Used by PLAN-2 (the Resume row, "Start") and by F4's launch rule
// (src/app/launchTab.ts: a workout in progress keeps the tab it was left on).
//
// Keep these exported names and signatures; replace the bodies. Until RUN-1
// lands nothing is ever resumable, so a cold launch always opens on Explore.
import { openRootModal } from '../../navigation/navigationRef';
import type { RunnerEntry } from '../../navigation/types';

export type { RunnerEntry } from '../../navigation/types';

/** A workout saved on this phone that can be picked up again (iOS `runner.json`). */
export interface ResumableWorkout {
  /**
   * The session it is for. Null when a runner file exists but could not be
   * read (a locked phone, a background start): the launch rule counts that as
   * resumable, so the stored tab is kept when in doubt (iOS `.unreadable`).
   */
  readonly sessionId: string | null;
}

/** What `openRunner` needs of a session (a full session object satisfies it). */
export interface RunnerSessionRef {
  readonly id: string;
}

/**
 * The workout this member can resume: a runner file of the current version
 * that has not outlived its day. `profileId` defaults to the signed-in
 * member; the launch rule passes the id of the session stored on the phone,
 * because it runs before the app store has restored anyone. Null when there
 * is none, or no member.
 */
export async function resumableWorkout(profileId?: string): Promise<ResumableWorkout | null> {
  void profileId;
  return null;
}

/** True when a finished workout for `sessionId` is still queued to be sent (the outbox). */
export async function hasPendingWorkout(sessionId: string): Promise<boolean> {
  void sessionId;
  return false;
}

/** Opens the full-screen runner on `session` (RUN-3 owns the body; this one only routes). */
export function openRunner(session: RunnerSessionRef, entry: RunnerEntry): void {
  openRootModal('WorkoutRunner', { sessionId: session.id, entry });
}
