/**
 * The two native modules background work needs, reached lazily.
 *
 * expo-task-manager and expo-background-task throw at import when their
 * native half is missing (Expo Go, Jest, a build without the module), and
 * the registry is imported by the health wipe, which every sign-out runs. A
 * top-level import would take the sign-out down with it. So they are
 * required on first use, inside a try, and a missing module means background
 * work does not run on this build, nothing else.
 *
 * Tests install their own fakes with `setBackgroundModulesForTests`.
 */
export interface BackgroundTaskModule {
  registerTaskAsync(taskName: string, options?: { minimumInterval?: number }): Promise<void>;
  unregisterTaskAsync(taskName: string): Promise<void>;
  readonly BackgroundTaskResult: { readonly Success: number; readonly Failed: number };
}

export interface TaskManagerModule {
  defineTask(taskName: string, executor: (body: unknown) => Promise<unknown>): void;
  isTaskDefined(taskName: string): boolean;
}

type Override<T> = { readonly module: T | null } | null;

let backgroundTaskOverride: Override<BackgroundTaskModule> = null;
let taskManagerOverride: Override<TaskManagerModule> = null;
let backgroundTaskCache: BackgroundTaskModule | null | undefined;
let taskManagerCache: TaskManagerModule | null | undefined;

/* eslint-disable @typescript-eslint/no-require-imports */

export function loadBackgroundTaskModule(): BackgroundTaskModule | null {
  if (backgroundTaskOverride) return backgroundTaskOverride.module;
  if (backgroundTaskCache !== undefined) return backgroundTaskCache;
  try {
    backgroundTaskCache = require('expo-background-task') as BackgroundTaskModule;
  } catch {
    backgroundTaskCache = null;
  }
  return backgroundTaskCache;
}

export function loadTaskManagerModule(): TaskManagerModule | null {
  if (taskManagerOverride) return taskManagerOverride.module;
  if (taskManagerCache !== undefined) return taskManagerCache;
  try {
    taskManagerCache = require('expo-task-manager') as TaskManagerModule;
  } catch {
    taskManagerCache = null;
  }
  return taskManagerCache;
}

/* eslint-enable @typescript-eslint/no-require-imports */

/** Tests: fakes in place of the native modules (`null` for "not in this build"); no arguments restores. */
export function setBackgroundModulesForTests(modules?: {
  backgroundTask?: BackgroundTaskModule | null;
  taskManager?: TaskManagerModule | null;
}): void {
  if (!modules) {
    backgroundTaskOverride = null;
    taskManagerOverride = null;
    return;
  }
  if (modules.backgroundTask !== undefined) backgroundTaskOverride = { module: modules.backgroundTask };
  if (modules.taskManager !== undefined) taskManagerOverride = { module: modules.taskManager };
}
