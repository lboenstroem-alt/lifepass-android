/**
 * The keep-awake (iOS RunnerIdleTimer): one tag, and a native call only when
 * the answer changes (the runner asks twice a second).
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { keepRunnerAwake, resetRunnerKeepAwakeForTests, RUNNER_KEEP_AWAKE_TAG } from '../keepAwake';

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

beforeEach(() => resetRunnerKeepAwakeForTests());

it('asks the system only when the answer changes, under the runner tag', () => {
  keepRunnerAwake(false);
  expect(deactivateKeepAwake).not.toHaveBeenCalled();
  keepRunnerAwake(true);
  keepRunnerAwake(true);
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
  expect(activateKeepAwakeAsync).toHaveBeenCalledWith(RUNNER_KEEP_AWAKE_TAG);
  keepRunnerAwake(false);
  keepRunnerAwake(false);
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
  expect(deactivateKeepAwake).toHaveBeenCalledWith(RUNNER_KEEP_AWAKE_TAG);
});

it('a failing native call is silent', () => {
  (activateKeepAwakeAsync as jest.Mock).mockRejectedValueOnce(new Error('no window'));
  expect(() => keepRunnerAwake(true)).not.toThrow();
  (deactivateKeepAwake as jest.Mock).mockImplementationOnce(() => {
    throw new Error('no module');
  });
  expect(() => keepRunnerAwake(false)).not.toThrow();
});

it('a call that fails is tried again on the next ask, not taken as done', async () => {
  (activateKeepAwakeAsync as jest.Mock).mockClear();
  (activateKeepAwakeAsync as jest.Mock).mockRejectedValueOnce(new Error('current activity is no longer available'));
  keepRunnerAwake(true);
  // Let the rejection land.
  await Promise.resolve();
  await Promise.resolve();
  keepRunnerAwake(true);
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
  // Once it went through, the next ask is a no-op again.
  await Promise.resolve();
  keepRunnerAwake(true);
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
});
