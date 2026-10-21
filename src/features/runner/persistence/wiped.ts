/**
 * The local wipe reached the runner (iOS `.healthLocalDataWiped`, observed by
 * `WorkoutRunnerModel.wiped`).
 *
 * On a sign-out, a consent withdrawal (here or elsewhere) and a verified
 * minor, the health store deletes the member's folder (`runner.json` and
 * `outbox.json` with it) and removes every `health.*` notification, the
 * rest-over one included (src/health/store.ts `wipeLocal`). Then the runner's
 * own step (../outbox/localWipe.ts, from ./register.ts) raises the wipe fence,
 * forgets the outbox and the Resume row in memory and tells a runner that is
 * open, which closes as discarded without writing anything back: nothing of
 * that workout may survive the wipe.
 *
 *   useEffect(() => onRunnerWiped(() => close('discarded')), []);
 *
 * EACH SUBSCRIPTION HEARS ONE WIPE. A sign-out can announce the same wipe
 * twice (the runner's own sign-out cleaner, then the health wipe's hook), and
 * a screen told twice to close would close twice (two pops of the
 * navigator). The screen it belongs to is closing after the first, so a
 * listener is removed before it is called; subscribe again to hear the next.
 */
import type { HealthWipeContext } from '../../../health/wipe';

type Listener = (context: HealthWipeContext) => void;

const listeners = new Set<Listener>();

/** Subscribe until the next wipe; returns the unsubscribe (harmless after it). */
export function onRunnerWiped(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber, once (see above); one that throws does not stop the others. */
export function notifyRunnerWiped(context: HealthWipeContext): void {
  const told = [...listeners];
  listeners.clear();
  for (const listener of told) {
    try {
      listener(context);
    } catch {
      // A screen that failed to close is still told nothing more.
    }
  }
}
