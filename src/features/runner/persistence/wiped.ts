/**
 * The local wipe reached the runner (iOS `.healthLocalDataWiped`, observed by
 * `WorkoutRunnerModel.wiped`).
 *
 * On a sign-out, a consent withdrawal (here or elsewhere) and a verified
 * minor, the health store deletes the member's folder (`runner.json` and
 * `outbox.json` with it) and removes every `health.*` notification, the
 * rest-over one included (src/health/store.ts `wipeLocal`). Then ./register.ts
 * forgets the outbox and the Resume row in memory and tells a runner that is
 * open, which closes as discarded without writing anything back: nothing of
 * that workout may survive the wipe.
 *
 *   useEffect(() => onRunnerWiped(() => close('discarded')), []);
 */
import type { HealthWipeContext } from '../../../health/wipe';

type Listener = (context: HealthWipeContext) => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function onRunnerWiped(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber; one that throws does not stop the others. */
export function notifyRunnerWiped(context: HealthWipeContext): void {
  for (const listener of [...listeners]) {
    try {
      listener(context);
    } catch {
      // A screen that failed to close is still told nothing more.
    }
  }
}
