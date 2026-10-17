/**
 * Background work: one WorkManager task, many jobs. The Android stand-in for
 * iOS BGTaskScheduler (the monthly feedback's Background App Refresh,
 * `FeedbackBackgroundRefresh`) and, if Health Connect ever ships, its
 * background sync.
 *
 * WHY ONE TASK. expo-background-task runs every registered task in one
 * WorkManager worker at an interval the system chooses (15 minutes at the
 * very least, usually far longer, never exactly). So the app registers ONE
 * task (./task.ts) and each feature registers a JOB here: what to run, and
 * whether the member could get anything from it right now. A run calls every
 * eligible job; `syncBackgroundTask()` keeps the WorkManager task registered
 * exactly while at least one job is eligible, as iOS asks for a refresh only
 * "when the member could get something from it, cancelled otherwise".
 *
 *   registerBackgroundJob('feedback.refresh', runFeedbackCheck, isEligibleForFeedback, { minimumIntervalMinutes: 360 });
 *   await syncBackgroundTask();      // after anything that changes eligibility
 *
 * A job never presents anything and never asks for a permission: there is no
 * member watching. It reads, and schedules a LOCAL notification at most.
 *
 * The native modules are reached lazily (`require` inside a try), so a build
 * or a test without them (Expo Go, Jest) still loads every screen; the work
 * simply never runs there.
 */
import { loadBackgroundTaskModule } from './native';

/** The WorkManager task's name. One task for every job (see the file comment). */
export const BACKGROUND_TASK_NAME = 'is.lifepass.android.background-refresh';

/** iOS asks for the feedback refresh "earliest 6 hours later"; the default for a job that names none. */
export const DEFAULT_JOB_INTERVAL_MINUTES = 360;
/** WorkManager's own floor. */
export const MIN_JOB_INTERVAL_MINUTES = 15;

/** What a run of a job found. */
export type BackgroundJobResult = 'new-data' | 'no-data' | 'failed';

export type BackgroundJobRun = () => Promise<BackgroundJobResult>;
export type BackgroundJobEligibility = () => boolean | Promise<boolean>;

export interface BackgroundJobOptions {
  /** How often, at most, the job wants a run (default 360 minutes, never below 15). */
  readonly minimumIntervalMinutes?: number;
  /** The most one run may take before the next job goes (default 25 seconds). */
  readonly budgetMs?: number;
}

interface Job {
  readonly id: string;
  readonly run: BackgroundJobRun;
  readonly isEligible: BackgroundJobEligibility;
  readonly intervalMinutes: number;
  readonly budgetMs: number;
}

const jobs = new Map<string, Job>();

/** The default most a single job's run may take: WorkManager stops a worker after ten minutes, and other jobs are waiting. */
export const DEFAULT_JOB_BUDGET_MS = 25_000;

/**
 * Registers (or replaces) a job. Returns an unregister. Registering does not
 * schedule anything: call `syncBackgroundTask()` when eligibility may have
 * changed.
 */
export function registerBackgroundJob(
  id: string,
  run: BackgroundJobRun,
  isEligible: BackgroundJobEligibility,
  options: BackgroundJobOptions = {},
): () => void {
  const job: Job = {
    id,
    run,
    isEligible,
    intervalMinutes: Math.max(MIN_JOB_INTERVAL_MINUTES, Math.round(options.minimumIntervalMinutes ?? DEFAULT_JOB_INTERVAL_MINUTES)),
    budgetMs: options.budgetMs ?? DEFAULT_JOB_BUDGET_MS,
  };
  jobs.set(id, job);
  return () => {
    if (jobs.get(id) === job) jobs.delete(id);
  };
}

/** The ids registered, for tests and REL-1's checks. */
export function registeredBackgroundJobIds(): string[] {
  return [...jobs.keys()].sort();
}

async function eligible(job: Job): Promise<boolean> {
  try {
    return (await job.isEligible()) === true;
  } catch {
    return false;
  }
}

/** The jobs that could do something now. */
async function eligibleJobs(): Promise<Job[]> {
  const all = [...jobs.values()];
  const flags = await Promise.all(all.map(eligible));
  return all.filter((_, index) => flags[index]);
}

function withinBudget(job: Job): Promise<BackgroundJobResult> {
  return new Promise<BackgroundJobResult>((resolve) => {
    const timer = setTimeout(() => resolve('failed'), job.budgetMs);
    job.run().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        clearTimeout(timer);
        resolve('failed');
      },
    );
  });
}

/**
 * One background run: every eligible job, one after another (a phone woken in
 * the background has little to spare). A job that throws or runs past its
 * budget counts as failed and the next one still runs. Answers failed only
 * when every job that ran failed.
 */
export async function runBackgroundJobs(): Promise<BackgroundJobResult> {
  const due = await eligibleJobs();
  if (due.length === 0) return 'no-data';
  const results: BackgroundJobResult[] = [];
  for (const job of due) results.push(await withinBudget(job));
  if (results.includes('new-data')) return 'new-data';
  if (results.every((result) => result === 'failed')) return 'failed';
  return 'no-data';
}

/**
 * Registers the WorkManager task while any job is eligible, at the shortest
 * interval an eligible job asks for; unregisters it when none is. Never
 * throws.
 */
export async function syncBackgroundTask(): Promise<void> {
  const module = loadBackgroundTaskModule();
  if (!module) return;
  try {
    const due = await eligibleJobs();
    if (due.length === 0) {
      await cancelBackgroundTask();
      return;
    }
    const interval = Math.min(...due.map((job) => job.intervalMinutes));
    await module.registerTaskAsync(BACKGROUND_TASK_NAME, { minimumInterval: interval });
  } catch {
    // The next sync tries again.
  }
}

/**
 * Unregisters the WorkManager task (iOS `FeedbackBackgroundRefresh.cancel()`):
 * the local wipe runs it, so no background read is ever made for a member
 * who has signed out or withdrawn. A later `syncBackgroundTask()` brings it
 * back when someone is eligible again. Never throws.
 */
export async function cancelBackgroundTask(): Promise<void> {
  const module = loadBackgroundTaskModule();
  if (!module) return;
  try {
    await module.unregisterTaskAsync(BACKGROUND_TASK_NAME);
  } catch {
    // Not registered: nothing to cancel.
  }
}

/** Tests: no jobs. */
export function resetBackgroundJobsForTests(): void {
  jobs.clear();
}
