/**
 * The set-new-password state after a reset link (iOS
 * `AppState.pendingPasswordRecovery`, presented by ContentView over
 * whatever shows). The flag lives in the app store; this file is how AUTH-1
 * raises and lowers it, and keeps the Kenni nudge off it.
 *
 * THE NUDGE NEVER COVERS IT. iOS keeps the post-sign-up Kenni sheet off a
 * recovery sign-in by passing `suppressKennitalaPrompt`. Android does that
 * too (./authCallback.ts), and holds the nudge back for as long as the
 * screen is up: a cold start from a reset link runs the launch's own
 * sign-in beside the link's, and that one does not know it is a recovery.
 * A nudge already armed is retracted without counting as dismissed, so it
 * can still come at a later launch (the way a check-in link retracts it).
 *
 * IT OUTLIVES THE PROCESS (Android). iOS keeps the flag in memory only. On
 * Android the process is often dropped while the member is in another app
 * (fetching a password from a manager, say), and the recovery session is
 * stored, so the next launch would sign them in on the OLD password with no
 * screen, and the reset link cannot raise it again (it is spent,
 * ./spentLinks.ts). So the screen being up is also written down
 * (`RECOVERY_PENDING_KEY`: whose recovery, and when), and when launch
 * restores that same member's session within the hour, the screen comes
 * back (`resumePasswordRecovery`, a sign-in hook from ./register.ts). "Later",
 * a changed password and sign-out forget it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SignInContext } from '../../app/signOut';
import { registerKennitalaPromptBlocker, useAppStore } from '../../stores/appStore';

/** The set-new-password screen is up: `{ userId, at }` (epoch ms), as JSON. */
export const RECOVERY_PENDING_KEY = 'auth.recoveryPending';

/** How long a screen left up comes back after a restart (the reset marker's hour). */
export const RECOVERY_PENDING_TTL_MS = 60 * 60 * 1000;

interface RecoveryPendingMark {
  readonly userId: string;
  readonly at: number;
}

async function readMark(): Promise<RecoveryPendingMark | null> {
  try {
    const raw = await AsyncStorage.getItem(RECOVERY_PENDING_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { userId, at } = parsed as { userId?: unknown; at?: unknown };
    if (typeof userId !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null;
    return { userId, at };
  } catch {
    return null;
  }
}

async function writeMark(mark: RecoveryPendingMark): Promise<void> {
  try {
    await AsyncStorage.setItem(RECOVERY_PENDING_KEY, JSON.stringify(mark));
  } catch {
    // Not written: a restart while the screen is up loses it, as on iOS.
  }
}

/** Forgets that the screen was up (it is closed, or the member signed out). */
export async function forgetPendingRecovery(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECOVERY_PENDING_KEY);
  } catch {
    // A mark that stays is dropped at the next sign-in that is not its own, or after the hour.
  }
}

/** Holds the Kenni nudge back while the set-new-password screen is up. */
export function recoveryBlocksKennitalaPrompt(): boolean {
  return useAppStore.getState().pendingPasswordRecovery;
}

/** Registers the nudge blocker (idempotent: the app store keeps a set). */
export function installRecoveryBlocker(): void {
  registerKennitalaPromptBlocker(recoveryBlocksKennitalaPrompt);
}

function raise(): void {
  // Again here: a test (or a launch) that reset the app store cleared its blockers.
  installRecoveryBlocker();
  const store = useAppStore.getState();
  store.setPendingPasswordRecovery(true);
  if (store.pendingKennitalaPrompt) useAppStore.setState({ pendingKennitalaPrompt: false });
}

/**
 * A reset link signed `userId` in: show the set-new-password screen over
 * everything, and write it down so a restart brings it back.
 */
export function beginPasswordRecovery(userId: string, now: () => number = Date.now): void {
  raise();
  void writeMark({ userId: userId.toLowerCase(), at: now() });
}

/** "Later", or the new password is set: the screen goes. */
export function endPasswordRecovery(): void {
  useAppStore.getState().setPendingPasswordRecovery(false);
  void forgetPendingRecovery();
}

/**
 * Sign-in hook: brings the screen back when launch restores the session of
 * the member whose screen was up when the process went, within the hour.
 * Any other sign-in drops the mark, except the reset link's own (its screen
 * is already up).
 */
export async function resumePasswordRecovery(context: SignInContext, now: () => number = Date.now): Promise<void> {
  const mark = await readMark();
  if (!mark) return;
  const age = now() - mark.at;
  const sameMember = mark.userId === context.userId.toLowerCase();
  if (!sameMember || age < 0 || age >= RECOVERY_PENDING_TTL_MS) {
    await forgetPendingRecovery();
    return;
  }
  // The reset link raised it before this sign-in ran.
  if (useAppStore.getState().pendingPasswordRecovery) return;
  // A restored session: the one the reset link opened. The mark keeps its
  // time, so the screen comes back for an hour from the link at most.
  if (context.restoredSession) raise();
  else await forgetPendingRecovery();
}
