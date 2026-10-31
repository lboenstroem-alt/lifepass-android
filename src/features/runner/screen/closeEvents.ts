/**
 * How the runner closed, for the screen under it (iOS passes the runner an
 * `onClose(RunnerCloseResult)`, and PlanView's `runnerClosed` applies it:
 * a Save's or a Skip's response replaces day, week and upcoming; `queued`
 * refreshes the outbox; `later` shows Resume).
 *
 * An Android route cannot carry a callback, so the runner screen tells
 * every subscriber here just before it leaves:
 *
 *   useEffect(() => onRunnerClosed((result, sessionId) => apply(result)), []);
 *
 * RUN-3's sheets close through `controller.close(result)`, which lands here;
 * PLAN-2 subscribes (contract note in RUN-2's result).
 */
import type { RunnerCloseResult } from './controller';

export type RunnerClosedListener = (result: RunnerCloseResult, sessionId: string) => void;

const listeners = new Set<RunnerClosedListener>();

/** Subscribe to every close; returns the unsubscribe. */
export function onRunnerClosed(listener: RunnerClosedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber; one that throws does not stop the others or the close. */
export function notifyRunnerClosed(result: RunnerCloseResult, sessionId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(result, sessionId);
    } catch {
      // The runner still closes.
    }
  }
}
