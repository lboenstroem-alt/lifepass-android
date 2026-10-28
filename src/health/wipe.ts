/**
 * What else goes when the health data on this phone is wiped: the hooks the
 * health store's `wipeLocal` runs after it has deleted what it owns.
 *
 * iOS calls each of these by name (`onLocalWipe` hands the feedback store's
 * wipe in, the Coach observes `.healthLocalDataWiped` and drops its health
 * messages, the runner closes its workout, the meal outbox forgets its queue
 * in memory). Here each package registers its own, from its register file:
 *
 *   registerHealthWipeHook('coach.health-messages', () => dropHealthMessages());
 *
 * A hook receives the member (null when a sign-out could name nobody) and
 * why. It runs after the files, the keys and the notifications are gone and
 * the store's memory is reset, so it must not write any of them back. One
 * that fails does not stop the others: a wipe that stops halfway is the leak
 * it exists to prevent.
 */
import type { HealthWipeReason } from './models';

export interface HealthWipeContext {
  /** Whose data was wiped; null when a sign-out could name nobody (the health files were not touched). */
  readonly profileId: string | null;
  readonly reason: HealthWipeReason;
}

export type HealthWipeHook = (context: HealthWipeContext) => void | Promise<void>;

const hooks = new Map<string, HealthWipeHook>();

/** Registers (or replaces) a hook under a stable id. Returns an unregister. */
export function registerHealthWipeHook(id: string, hook: HealthWipeHook): () => void {
  hooks.set(id, hook);
  return () => {
    if (hooks.get(id) === hook) hooks.delete(id);
  };
}

/** The ids registered, for tests and REL-1's checks. */
export function registeredHealthWipeHookIds(): string[] {
  return [...hooks.keys()].sort();
}

/** Every hook, together; one that throws or rejects does not stop the others. */
export async function runHealthWipeHooks(context: HealthWipeContext): Promise<void> {
  await Promise.all(
    [...hooks.values()].map((hook) => {
      try {
        return Promise.resolve(hook(context)).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    }),
  );
}
