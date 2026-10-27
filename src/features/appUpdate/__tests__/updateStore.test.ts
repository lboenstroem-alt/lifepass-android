/**
 * The update check over the stub server: the answer decides the prompt, a
 * failed check changes nothing (fail open), the soft prompt's answer is kept
 * on the phone for that version, and a return to the foreground asks again
 * only once the last answer is stale.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import {
  checkForUpdate,
  checkForUpdateIfStale,
  DISMISSED_LATEST_VERSION_KEY,
  dismissUpdateAvailable,
  RECHECK_AFTER_MS,
  resetAppUpdateForTests,
  setAppUpdateDepsForTests,
  useAppUpdate,
} from '../updateStore';

stubApiClientPerTest();

const PLAY = 'https://play.google.com/store/apps/details?id=is.lifepass.android';

function answer(minimumVersion: string | null, latestVersion: string | null) {
  return Reply.ok({ platform: 'android', minimumVersion, latestVersion, storeUrl: PLAY });
}

let now = 1_000_000;

beforeEach(() => {
  resetAppUpdateForTests();
  now = 1_000_000;
  setAppUpdateDepsForTests({ currentVersion: () => '2.5.6', now: () => now });
});

afterEach(() => resetAppUpdateForTests());

const checks = () => api.requests.filter((r) => r.path === '/app-version').length;

it('blocks below the minimum', async () => {
  api.on('GET', '/app-version', answer('2.6.0', '2.6.0'));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'required' });
  expect(useAppUpdate.getState().storeUrl).toBe(PLAY);
});

it('offers a newer version once: Not now (or Update) keeps it away for that version', async () => {
  api.on('GET', '/app-version', answer(null, '2.6.0'));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'available', latestVersion: '2.6.0' });

  dismissUpdateAvailable();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await AsyncStorage.getItem(DISMISSED_LATEST_VERSION_KEY)).toBe('2.6.0');

  // The next launch, same version on the store: nothing.
  resetAppUpdateForTests();
  setAppUpdateDepsForTests({ currentVersion: () => '2.5.6', now: () => now });
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });

  // A newer one: asked again.
  api.reset();
  api.on('GET', '/app-version', answer(null, '2.7.0'));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'available', latestVersion: '2.7.0' });
});

it('says nothing when the app is current', async () => {
  api.on('GET', '/app-version', answer('2.5.0', '2.5.6'));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });
});

it('fails open: an error, an outage or a body it cannot read never blocks', async () => {
  for (const reply of [
    Reply.problem(500, 'internal_error'),
    Reply.problem(429, 'rate_limited'),
    Reply.raw(502, '<html>Bad gateway</html>'),
    { kind: 'network-error' as const },
    Reply.ok({ platform: 'ios', minimumVersion: '99.0.0', latestVersion: '99.0.0', storeUrl: PLAY }),
  ]) {
    api.reset();
    api.on('GET', '/app-version', reply);
    await checkForUpdate();
    expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });
    expect(useAppUpdate.getState().checkedAt).toBeNull();
  }
});

it('a block needs a fresh answer: a failed re-check lifts it; a soft prompt stays', async () => {
  api.on('GET', '/app-version', answer('2.6.0', null));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'required' });
  api.reset();
  api.on('GET', '/app-version', { kind: 'network-error' });
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });

  api.reset();
  api.on('GET', '/app-version', answer(null, '2.6.0'));
  await checkForUpdate();
  api.reset();
  api.on('GET', '/app-version', Reply.problem(429, 'rate_limited'));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'available', latestVersion: '2.6.0' });
});

it('a block a failed re-check lifted is asked about again at the very next return (iOS 3.1.0 follow-up 1)', async () => {
  api.on('GET', '/app-version', answer('2.6.0', null));
  await checkForUpdateIfStale();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'required' });

  // A moment offline on a return: the block lifts (fail open)...
  api.reset();
  api.on('GET', '/app-version', { kind: 'network-error' });
  now += 60_000;
  await checkForUpdateIfStale();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });
  expect(useAppUpdate.getState().checkedAt).toBeNull();

  // ...and the next return, well inside half an hour, asks again and blocks.
  api.reset();
  api.on('GET', '/app-version', answer('2.6.0', null));
  now += 60_000;
  await checkForUpdateIfStale();
  expect(checks()).toBe(1);
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'required' });
});

it('a failed re-check under a soft prompt keeps the last answer and its clock', async () => {
  api.on('GET', '/app-version', answer(null, '2.6.0'));
  await checkForUpdate();
  const answeredAt = useAppUpdate.getState().checkedAt;
  api.reset();
  api.on('GET', '/app-version', { kind: 'network-error' });
  now += RECHECK_AFTER_MS;
  await checkForUpdateIfStale();
  expect(useAppUpdate.getState()).toMatchObject({ prompt: { kind: 'available', latestVersion: '2.6.0' }, checkedAt: answeredAt });
});

it('a build that cannot say its version is never blocked', async () => {
  setAppUpdateDepsForTests({ currentVersion: () => null, now: () => now });
  api.on('GET', '/app-version', answer('9.0.0', '9.0.0'));
  await checkForUpdate();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });
});

it('two checks at once send one request', async () => {
  api.on('GET', '/app-version', answer(null, null));
  await Promise.all([checkForUpdate(), checkForUpdate()]);
  expect(checks()).toBe(1);
});

it('back in the foreground: asks again once the answer is stale, and every time while blocked', async () => {
  api.on('GET', '/app-version', answer(null, null));
  await checkForUpdateIfStale();
  expect(checks()).toBe(1);
  now += RECHECK_AFTER_MS - 1;
  await checkForUpdateIfStale();
  expect(checks()).toBe(1);
  now += 1;
  await checkForUpdateIfStale();
  expect(checks()).toBe(2);

  // The owner raises the minimum: blocked...
  api.reset();
  api.on('GET', '/app-version', answer('2.6.0', null));
  now += RECHECK_AFTER_MS;
  await checkForUpdateIfStale();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'required' });
  // ...asked again on every return while blocked...
  await checkForUpdateIfStale();
  expect(checks()).toBe(2);
  // ...and lowers it again: the block lifts on the next return, a second later.
  api.reset();
  api.on('GET', '/app-version', answer(null, null));
  now += 1_000;
  await checkForUpdateIfStale();
  expect(useAppUpdate.getState().prompt).toEqual({ kind: 'none' });
});
