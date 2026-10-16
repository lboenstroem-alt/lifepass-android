/**
 * What NetInfo's answers mean (../connectivity): before a call only a missing
 * connection blocks it; after a failure either signal picks "offline".
 */
import NetInfo from '@react-native-community/netinfo';

import {
  deviceDisconnected,
  deviceOffline,
  knownDisconnected,
  noteConnectivity,
} from '../connectivity';

function netInfo(state: { isConnected: boolean | null; isInternetReachable: boolean | null }): void {
  jest.mocked(NetInfo.fetch).mockResolvedValueOnce({ type: 'wifi', details: null, ...state } as never);
}

afterEach(() => noteConnectivity({ isConnected: true }));

it('before a call, only a missing connection counts', async () => {
  netInfo({ isConnected: false, isInternetReachable: false });
  expect(await deviceDisconnected()).toBe(true);
  // Android answers `isInternetReachable: false` on working Wi-Fi sometimes.
  netInfo({ isConnected: true, isInternetReachable: false });
  expect(await deviceDisconnected()).toBe(false);
  netInfo({ isConnected: null, isInternetReachable: null });
  expect(await deviceDisconnected()).toBe(false);
});

it('after a failure, either signal reads as offline', async () => {
  netInfo({ isConnected: true, isInternetReachable: false });
  expect(await deviceOffline()).toBe(true);
  netInfo({ isConnected: true, isInternetReachable: true });
  expect(await deviceOffline()).toBe(false);
});

it('a NetInfo that fails is not offline', async () => {
  jest.mocked(NetInfo.fetch).mockRejectedValueOnce(new Error('native module missing'));
  expect(await deviceDisconnected()).toBe(false);
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
