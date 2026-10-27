/**
 * The app's entry (index.ts) defines the background task itself, before
 * `registerRootComponent`. WorkManager starts the bundle headless: only what
 * the entry imports at load is evaluated, and `registerTaskAsync` refuses a
 * task that is not defined. iOS registers its refresh handler at launch
 * (AppDelegate `FeedbackBackgroundRefresh.register()`), never through an
 * unrelated screen's imports.
 *
 * App is replaced by an empty component here, so the only way the task gets
 * defined is index.ts's own import. If that import goes, or moves below
 * `registerRootComponent`, this fails.
 */
import { BACKGROUND_TASK_NAME } from '../registry';

/* eslint-disable @typescript-eslint/no-require-imports */

it('index.ts defines the background task before it registers the root component, without App', () => {
  const order: string[] = [];
  const defineTask = jest.fn((name: string) => void order.push(`defineTask:${name}`));

  jest.isolateModules(() => {
    jest.doMock('expo-task-manager', () => ({
      defineTask,
      isTaskDefined: () => false,
      isTaskRegisteredAsync: async () => false,
      getTaskOptionsAsync: async () => null,
    }));
    jest.doMock('expo', () => ({
      registerRootComponent: jest.fn(() => void order.push('registerRootComponent')),
    }));
    jest.doMock('../../../App', () => ({ __esModule: true, default: () => null }));

    require('../../../index');
  });

  expect(defineTask).toHaveBeenCalledTimes(1);
  expect(defineTask).toHaveBeenCalledWith(BACKGROUND_TASK_NAME, expect.any(Function));
  expect(BACKGROUND_TASK_NAME).toBe('is.lifepass.android.background-refresh');
  expect(order).toEqual([`defineTask:${BACKGROUND_TASK_NAME}`, 'registerRootComponent']);
});

/* eslint-enable @typescript-eslint/no-require-imports */
