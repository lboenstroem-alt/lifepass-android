/**
 * The session the runner opens on.
 *
 * iOS hands the runner the session itself (`WorkoutRunnerLaunch`); an
 * Android route carries only its id (`WorkoutRunner: { sessionId, entry }`,
 * plan 3.0.2), so the screen finds it again, in this order:
 *
 *   1. the session handed over by whoever opened the runner
 *      (`handRunnerSession`, called by `openRunner` before it navigates: the
 *      exact row the member tapped, a past date's included);
 *   2. the saved workout, when it is this session's (`runner.json` carries
 *      the session as it was, so a Resume works offline and for yesterday);
 *   3. the health store's Today read and every other date it holds.
 *
 * None of them: the runner has nothing to run, and closes.
 *
 * THE HAND-OVER IS FOR ONE OPEN. The screen takes it (and forgets it) as it
 * looks, so a later open of the same id without a new hand-over reads the
 * health store's current session (moved, lighter, new blocks), as iOS uses
 * the session Plan holds at that moment. A local wipe (a sign-out, a
 * withdrawal) before the screen took it drops it too: it is the member's
 * plan.
 */
import { useHealthStore } from '../../../health/store';
import type { SessionView } from '../../../health/models';
import type { RunnerState } from '../model/types';
import { onRunnerWiped } from '../persistence/wiped';

let handed: SessionView | null = null;
let stopHearingWipe: (() => void) | null = null;

/** Hands the runner the session it is about to open (the opener calls it just before navigating). */
export function handRunnerSession(session: SessionView): void {
  forgetHandedSession();
  handed = session;
  stopHearingWipe = onRunnerWiped(() => {
    stopHearingWipe = null;
    handed = null;
  });
}

/** The session handed over, once: it is forgotten as it is taken. */
function takeHandedSession(): SessionView | null {
  const session = handed;
  forgetHandedSession();
  return session;
}

function forgetHandedSession(): void {
  handed = null;
  stopHearingWipe?.();
  stopHearingWipe = null;
}

/** The session with this id in the health store's reads, or null. */
export function sessionFromHealthStore(sessionId: string): SessionView | null {
  const health = useHealthStore.getState();
  for (const day of [health.today, ...Object.values(health.days)]) {
    const session = day?.day?.session;
    if (session && session.id === sessionId) return session;
  }
  return null;
}

/** The session the runner should open for `sessionId` (see the order above). */
export function findRunnerSession(sessionId: string, restored: RunnerState | null): SessionView | null {
  const fromOpener = takeHandedSession();
  if (fromOpener && fromOpener.id === sessionId) return fromOpener;
  if (restored && restored.sessionId === sessionId) return restored.session;
  return sessionFromHealthStore(sessionId);
}

/** Tests: nothing handed over. */
export function resetRunnerSessionHandoffForTests(): void {
  forgetHandedSession();
}
