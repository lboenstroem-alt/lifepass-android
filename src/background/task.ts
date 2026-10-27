/**
 * The one background task's definition. IT MUST LOAD WITH THE APP'S ENTRY
 * (index.ts), before `registerRootComponent`.
 *
 * WHY THERE. WorkManager starts the app's JavaScript without any screen (a
 * headless run): only what the entry file imports at load is evaluated, and
 * a task defined later, inside a component or a hook, is not there to run.
 * Nor can it be registered: `registerTaskAsync` refuses a task that is not
 * defined. iOS has the same rule for Background App Refresh (the handler is
 * registered in `application(_:didFinishLaunchingWithOptions:)`).
 *
 * index.ts imports this file directly, right after the font defaults and
 * before `registerRootComponent`, so every run defines the task whatever the
 * screens import (src/background/__tests__/entry.test.ts holds that line).
 * src/services/notifications.ts still imports it too until QA-1 deletes that
 * shim; defining twice is harmless (`isTaskDefined` below).
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
