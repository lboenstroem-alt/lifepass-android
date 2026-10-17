/**
 * What NetInfo's answers mean (../connectivity): before a call only a missing
 * connection blocks it, and only when a fresh read agrees with the cache;
 * after a failure either signal of a fresh read picks "offline".
 */
import NetInfo from '@react-native-community/netinfo';

import {
  deviceDisconnected,
  deviceOffline,
  FRESH_READ_WAIT_MS,
  knownDisconnected,
  noteConnectivity,
} from '../connectivity';

type State = { isConnected: boolean | null; isInternetReachable: boolean | null };

const state = (value: State) => ({ type: 'wifi', details: null, ...value }) as never;

/** NetInfo's cached answer (`fetch`). */
function cached(value: State): void {
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce(state(value));
}

/** A fresh native read (`refresh`). */
function fresh(value: State): void {
  jest.mocked(NetInfo.refresh).mockResolvedValueOnce(state(value));
}

const OFF = { isConnected: false, isInternetReachable: false };
const ON = { isConnected: true, isInternetReachable: true };

afterEach(() => noteConnectivity({ isConnected: true }));

describe('before a call', () => {
  it('only a missing connection counts, confirmed by a fresh read', async () => {
    cached(OFF);
    fresh(OFF);
    expect(await deviceDisconnected()).toBe(true);
    // Android answers `isInternetReachable: false` on working Wi-Fi sometimes.
    cached({ isConnected: true, isInternetReachable: false });
    expect(await deviceDisconnected()).toBe(false);
    cached({ isConnected: null, isInternetReachable: null });
    expect(await deviceDisconnected()).toBe(false);
  });

  it('a cache that says connected is trusted without a native read (the common path)', async () => {
    cached(ON);
    expect(await deviceDisconnected()).toBe(false);
    expect(NetInfo.refresh).not.toHaveBeenCalled();
  });

  it('a stale "disconnected" in the cache does not stop a call', async () => {
    // A NetInfo event missed across background and resume.
    cached(OFF);
    fresh(ON);
    expect(await deviceDisconnected()).toBe(false);
    expect(NetInfo.refresh).toHaveBeenCalledTimes(1);
  });

  it('a fresh read that fails or never answers lets the call be tried', async () => {
    cached(OFF);
    jest.mocked(NetInfo.refresh).mockRejectedValueOnce(new Error('native module missing'));
    expect(await deviceDisconnected()).toBe(false);

    jest.useFakeTimers();
    try {
      cached(OFF);
      jest.mocked(NetInfo.refresh).mockReturnValueOnce(new Promise(() => undefined));
      const pending = deviceDisconnected();
      await jest.advanceTimersByTimeAsync(FRESH_READ_WAIT_MS);
      expect(await pending).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('after a failure', () => {
  it('either signal of a fresh read reads as offline', async () => {
    fresh({ isConnected: true, isInternetReachable: false });
    expect(await deviceOffline()).toBe(true);
    fresh(OFF);
    expect(await deviceOffline()).toBe(true);
    fresh(ON);
    expect(await deviceOffline()).toBe(false);
  });

  it('a drop the cache has not caught up with still reads as offline', async () => {
    // The cache (the library mock's default) still says connected.
    fresh(OFF);
    expect(await deviceOffline()).toBe(true);
    expect(NetInfo.fetch).not.toHaveBeenCalled();
  });

  it('without a fresh read, the cache answers', async () => {
    jest.mocked(NetInfo.refresh).mockRejectedValueOnce(new Error('native module missing'));
    cached(OFF);
    expect(await deviceOffline()).toBe(true);
  });
});

it('a NetInfo that fails is not offline', async () => {
  jest.mocked(NetInfo.fetch).mockRejectedValueOnce(new Error('native module missing'));
  expect(await deviceDisconnected()).toBe(false);
  jest.mocked(NetInfo.refresh).mockRejectedValueOnce(new Error('native module missing'));
  jest.mocked(NetInfo.fetch).mockRejectedValueOnce(new Error('native module missing'));
  expect(await deviceOffline()).toBe(false);
});

it("keeps NetInfo's last word for code that cannot wait", () => {
  noteConnectivity({ isConnected: false });
  expect(knownDisconnected()).toBe(true);
  noteConnectivity({ isConnected: null });
  expect(knownDisconnected()).toBe(false);
  noteConnectivity({ isConnected: true });
  expect(knownDisconnected()).toBe(false);
});

it('follows NetInfo from the moment it loads', () => {
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const freshNetInfo = require('@react-native-community/netinfo') as typeof NetInfo;
    const fresh = require('../connectivity') as typeof import('../connectivity');
    /* eslint-enable @typescript-eslint/no-require-imports */
    expect(freshNetInfo.addEventListener).toHaveBeenCalledWith(fresh.noteConnectivity);
  });
});
