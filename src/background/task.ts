/**
 * The one background task's definition. IMPORT THIS FILE AT THE TOP OF THE
 * APP'S ENTRY (index.ts), before `registerRootComponent`.
 *
 * WHY THERE. WorkManager starts the app's JavaScript without any screen (a
 * headless run): only what the entry file imports at load is evaluated, and
 * a task defined later, inside a component or a hook, is not there to run.
 * iOS has the same rule for Background App Refresh (the handler is registered
 * in `application(_:didFinishLaunchingWithOptions:)`).
 *
 * A run loads the session hooks (src/app/signOut.ts `loadRegistrations`,
 * which loads every feature's register file, where the jobs are registered)
 * and runs every eligible job (./registry.ts). Defining the task touches no
 * store and asks for nothing.
 */
import { loadRegistrations } from '../app/signOut';

import { loadBackgroundTaskModule, loadTaskManagerModule } from './native';
import { BACKGROUND_TASK_NAME, runBackgroundJobs } from './registry';

/** The executor WorkManager calls. Exported for tests. */
export async function runBackgroundTask(): Promise<number> {
  const results = loadBackgroundTaskModule()?.BackgroundTaskResult ?? { Success: 1, Failed: 2 };
  try {
    loadRegistrations();
    const outcome = await runBackgroundJobs();
    return outcome === 'failed' ? results.Failed : results.Success;
  } catch {
    return results.Failed;
  }
}

/** Defines the task once; answers whether it is defined. Never throws. */
export function defineBackgroundTask(): boolean {
  const taskManager = loadTaskManagerModule();
  if (!taskManager) return false;
  try {
    if (!taskManager.isTaskDefined(BACKGROUND_TASK_NAME)) {
      taskManager.defineTask(BACKGROUND_TASK_NAME, () => runBackgroundTask());
    }
    return true;
  } catch {
    return false;
  }
}

defineBackgroundTask();
