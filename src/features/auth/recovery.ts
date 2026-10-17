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
 */
import { registerKennitalaPromptBlocker, useAppStore } from '../../stores/appStore';

/** Holds the Kenni nudge back while the set-new-password screen is up. */
export function recoveryBlocksKennitalaPrompt(): boolean {
  return useAppStore.getState().pendingPasswordRecovery;
}

/** Registers the nudge blocker (idempotent: the app store keeps a set). */
export function installRecoveryBlocker(): void {
  registerKennitalaPromptBlocker(recoveryBlocksKennitalaPrompt);
}

/** A reset link signed the member in: show the set-new-password screen over everything. */
export function beginPasswordRecovery(): void {
  // Again here: a test (or a launch) that reset the app store cleared its blockers.
  installRecoveryBlocker();
  const store = useAppStore.getState();
  store.setPendingPasswordRecovery(true);
  if (store.pendingKennitalaPrompt) useAppStore.setState({ pendingKennitalaPrompt: false });
}

/** "Later", or the new password is set: the screen goes. */
export function endPasswordRecovery(): void {
  useAppStore.getState().setPendingPasswordRecovery(false);
}
