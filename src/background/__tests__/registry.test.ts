/**
 * Background work: one WorkManager task, jobs registered per feature (the
 * Android form of iOS `FeedbackBackgroundRefresh`). The task is registered
 * exactly while a job could do something, at the shortest interval an
 * eligible job asks for; a run calls every eligible job and survives one that
 * fails; the wipe cancels it; a build without the native modules runs nothing
 * and breaks nothing.
 */
import { setBackgroundModulesForTests, type BackgroundTaskModule, type TaskManagerModule } from '../native';
import {
  BACKGROUND_TASK_NAME,
  cancelBackgroundTask,
  registerBackgroundJob,
  registeredBackgroundJobIds,
  resetBackgroundJobsForTests,
  runBackgroundJobs,
  syncBackgroundTask,
} from '../registry';
import { defineBackgroundTask, runBackgroundTask } from '../task';

/**
 * The two modules as the real ones behave (expo-background-task 1.0,
 * build/BackgroundTask.js): registering a task that is already registered
 * does NOTHING, whatever the new options, and unregistering one that is not
 * registered is fine. Both share TaskManager's persistent registrations.
 */
type Registrations = Map<string, { minimumInterval?: number }>;

function fakeBackgroundTask(registered: Registrations) {
  const module: BackgroundTaskModule = {
    registerTaskAsync: jest.fn(async (name: string, options?: { minimumInterval?: number }) => {
      if (registered.has(name)) return;
      registered.set(name, options ?? {});
    }),
    unregisterTaskAsync: jest.fn(async (name: string) => {
      registered.delete(name);
    }),
    BackgroundTaskResult: { Success: 1, Failed: 2 },
  };
  return { module, registered };
}

function fakeTaskManager(registered: Registrations = new Map()) {
  const defined = new Map<string, (body: unknown) => Promise<unknown>>();
  const module: TaskManagerModule = {
    defineTask: jest.fn((name: string, executor: (body: unknown) => Promise<unknown>) => void defined.set(name, executor)),
    isTaskDefined: jest.fn((name: string) => defined.has(name)),
    isTaskRegisteredAsync: jest.fn(async (name: string) => registered.has(name)),
    getTaskOptionsAsync: jest.fn(async (name: string) => registered.get(name) ?? null),
  };
  return { module, defined };
}

let background: ReturnType<typeof fakeBackgroundTask>;

beforeEach(() => {
  resetBackgroundJobsForTests();
  const registered: Registrations = new Map();
  background = fakeBackgroundTask(registered);
  setBackgroundModulesForTests({ backgroundTask: background.module, taskManager: fakeTaskManager(registered).module });
});

afterEach(() => {
  setBackgroundModulesForTests();
  resetBackgroundJobsForTests();
});

describe('the task follows eligibility', () => {
  it('is registered while a job is eligible, at the shortest interval, and cancelled when none is', async () => {
    let feedbackEligible = true;
    registerBackgroundJob('feedback.refresh', async () => 'no-data', () => feedbackEligible);
    registerBackgroundJob('other.job', async () => 'no-data', async () => true, { minimumIntervalMinutes: 120 });
    await syncBackgroundTask();
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 120 });

    resetBackgroundJobsForTests();
    registerBackgroundJob('feedback.refresh', async () => 'no-data', () => feedbackEligible);
    await syncBackgroundTask();
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 360 });

    feedbackEligible = false;
    await syncBackgroundTask();
    expect(background.registered.has(BACKGROUND_TASK_NAME)).toBe(false);
  });

  it('a shorter interval that becomes eligible later replaces the registration; the same one is left alone', async () => {
    let coachEligible = false;
    registerBackgroundJob('feedback.refresh', async () => 'no-data', () => true);
    registerBackgroundJob('coach.sync', async () => 'no-data', () => coachEligible, { minimumIntervalMinutes: 60 });
    await syncBackgroundTask();
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 360 });

    coachEligible = true;
    await syncBackgroundTask();
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 60 });

    const calls = (background.module.registerTaskAsync as jest.Mock).mock.calls.length;
    await syncBackgroundTask();
    expect(background.module.registerTaskAsync).toHaveBeenCalledTimes(calls);
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 60 });
  });

  it('a registration an earlier launch left at another interval is read back and replaced', async () => {
    background.registered.set(BACKGROUND_TASK_NAME, { minimumInterval: 15 });
    registerBackgroundJob('feedback.refresh', async () => 'no-data', () => true);
    await syncBackgroundTask();
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 360 });
    expect(background.module.unregisterTaskAsync).toHaveBeenCalledTimes(1);
  });

  it("never asks below WorkManager's fifteen minutes", async () => {
    registerBackgroundJob('eager', async () => 'no-data', () => true, { minimumIntervalMinutes: 1 });
    await syncBackgroundTask();
    expect(background.registered.get(BACKGROUND_TASK_NAME)).toEqual({ minimumInterval: 15 });
  });

  it('an eligibility check that throws is not eligible', async () => {
    registerBackgroundJob('broken', async () => 'new-data', () => {
      throw new Error('no profile');
    });
    await syncBackgroundTask();
    expect(background.registered.size).toBe(0);
  });

  it('the wipe cancels it, and cancelling nothing is fine', async () => {
    registerBackgroundJob('feedback.refresh', async () => 'no-data', () => true);
    await syncBackgroundTask();
    await cancelBackgroundTask();
    expect(background.registered.size).toBe(0);
    await expect(cancelBackgroundTask()).resolves.toBeUndefined();
  });
});

describe('a run', () => {
  it('runs every eligible job and survives one that fails', async () => {
    const ran: string[] = [];
    registerBackgroundJob('a', async () => {
      ran.push('a');
      throw new Error('offline');
    }, () => true);
    registerBackgroundJob('b', async () => {
      ran.push('b');
      return 'new-data';
    }, () => true);
    registerBackgroundJob('c', async () => {
      ran.push('c');
      return 'no-data';
    }, () => false);
    await expect(runBackgroundJobs()).resolves.toBe('new-data');
    expect(ran).toEqual(['a', 'b']);
  });

  it('a job past its budget counts as failed and the next one still runs', async () => {
    jest.useFakeTimers();
    try {
      registerBackgroundJob('slow', () => new Promise(() => undefined), () => true, { budgetMs: 1000 });
      registerBackgroundJob('fast', async () => 'no-data', () => true);
      const run = runBackgroundJobs();
      await jest.advanceTimersByTimeAsync(1000);
      await expect(run).resolves.toBe('no-data');
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers failed only when everything that ran failed, and no-data when nothing could run', async () => {
    await expect(runBackgroundJobs()).resolves.toBe('no-data');
    registerBackgroundJob('a', async () => 'failed', () => true);
    await expect(runBackgroundJobs()).resolves.toBe('failed');
  });

  it("the task's executor loads the session hooks and reports to WorkManager", async () => {
    registerBackgroundJob('a', async () => 'new-data', () => true);
    await expect(runBackgroundTask()).resolves.toBe(1);
    resetBackgroundJobsForTests();
    registerBackgroundJob('a', async () => 'failed', () => true);
    await expect(runBackgroundTask()).resolves.toBe(2);
  });
});

describe('the definition', () => {
  it('is defined once, at load, under the one name', () => {
    const taskManager = fakeTaskManager();
    setBackgroundModulesForTests({ taskManager: taskManager.module });
    expect(defineBackgroundTask()).toBe(true);
    expect(defineBackgroundTask()).toBe(true);
    expect(taskManager.module.defineTask).toHaveBeenCalledTimes(1);
    expect([...taskManager.defined.keys()]).toEqual([BACKGROUND_TASK_NAME]);
  });

  it('a build without the native modules runs nothing and breaks nothing', async () => {
    setBackgroundModulesForTests({ backgroundTask: null, taskManager: null });
    expect(defineBackgroundTask()).toBe(false);
    registerBackgroundJob('a', async () => 'no-data', () => true);
    await expect(syncBackgroundTask()).resolves.toBeUndefined();
    await expect(cancelBackgroundTask()).resolves.toBeUndefined();
    expect(registeredBackgroundJobIds()).toEqual(['a']);
  });

  it('in this test build the real modules are missing, and loading the task file still works', () => {
    setBackgroundModulesForTests();
    expect(() => defineBackgroundTask()).not.toThrow();
  });
});
