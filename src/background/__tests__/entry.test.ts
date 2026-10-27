/**
 * The app's entry (index.ts) defines the background task itself, before the
 * app loads and before `registerRootComponent`: WorkManager starts the bundle
 * with no screen and runs only what the entry's imports evaluate, and
 * `registerTaskAsync` refuses a task that is not defined (../task.ts). With
 * App.tsx stubbed out here, nothing in the app's own import chain can be what
 * defines it.
 */
import { BACKGROUND_TASK_NAME } from '../registry';

const mockOrder: string[] = [];
const mockDefined = new Set<string>();

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((name: string) => {
    mockOrder.push(`define ${name}`);
    mockDefined.add(name);
  }),
  isTaskDefined: jest.fn((name: string) => mockDefined.has(name)),
  isTaskRegisteredAsync: jest.fn(async () => false),
  getTaskOptionsAsync: jest.fn(async () => null),
}));

jest.mock('expo', () => ({
  registerRootComponent: jest.fn(() => {
    mockOrder.push('registerRootComponent');
  }),
}));

jest.mock('../../../App', () => ({ __esModule: true, default: () => null }));

it('defines the task at the entry, before the root component is registered', () => {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the entry runs at load; it has no exports to import
    require('../../../index');
  });
  expect(mockOrder).toEqual([`define ${BACKGROUND_TASK_NAME}`, 'registerRootComponent']);
});
