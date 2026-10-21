/**
 * The runner screen's reads: the controller's snapshot through
 * `useSyncExternalStore`, so every piece of the page re-renders when the
 * workout or the displayed second changes, and never in between.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';

import type { RunnerController, RunnerSnapshot } from './controller';

export const RunnerControllerContext = createContext<RunnerController | null>(null);

/** The runner this page belongs to. */
export function useRunnerController(): RunnerController {
  const controller = useContext(RunnerControllerContext);
  if (!controller) throw new Error('useRunnerController outside the runner screen');
  return controller;
}

/** The runner and its current snapshot (the workout and the displayed clock); re-renders on every change. */
export function useRunner(): { readonly controller: RunnerController; readonly snapshot: RunnerSnapshot } {
  const controller = useRunnerController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, snapshot };
}
