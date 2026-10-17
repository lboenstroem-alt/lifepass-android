/**
 * Background work (one WorkManager task, jobs registered per feature). See
 * ./registry.ts; the task's definition (./task.ts) is imported by the app's
 * entry file, not from here.
 */
export {
  BACKGROUND_TASK_NAME,
  DEFAULT_JOB_BUDGET_MS,
  DEFAULT_JOB_INTERVAL_MINUTES,
  MIN_JOB_INTERVAL_MINUTES,
  cancelBackgroundTask,
  registerBackgroundJob,
  registeredBackgroundJobIds,
  runBackgroundJobs,
  syncBackgroundTask,
  type BackgroundJobEligibility,
  type BackgroundJobOptions,
  type BackgroundJobResult,
  type BackgroundJobRun,
} from './registry';
