// Global test setup, run after the framework loads and before each test file.
//
// 1. Native modules a JS test cannot reach are replaced by faithful fakes
//    (stateful where the app's behaviour depends on what they hold).
// 2. The network is the stub server (test/server): the LifePass API and
//    Supabase are recorded and answered in-process, and any other host is
//    refused and fails the test. No test can reach production.
// 3. After every test the fakes and the stub server are reset, so a test
//    seeds what it needs in `beforeEach`, never `beforeAll`.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { restoreTestGlobals } from './test/harness';
import { stubNetwork } from './test/server';
import { notificationsState } from './test/mocks/expoNotifications';
import { secureStoreState } from './test/mocks/expoSecureStore';

/* eslint-disable @typescript-eslint/no-require-imports */

// AsyncStorage: the library's own in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// SecureStore: an in-memory Keystore behind the real JS checks.
jest.mock('expo-secure-store/build/ExpoSecureStore', () => require('./test/mocks/expoSecureStore'));

// Local notifications: scheduled, presented, tapped (test/mocks/expoNotifications).
jest.mock('expo-notifications', () => require('./test/mocks/expoNotifications'));

// NetInfo: the library's mock (online, wifi).
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Reanimated 4 and worklets: the library's mock runs animations synchronously.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Bottom sheets: the library's mock renders the sheet content inline, so a
// test can query it; `present`/`dismiss` are no-ops.
jest.mock('@gorhom/bottom-sheet', () => require('@gorhom/bottom-sheet/mock'));

/* eslint-enable @typescript-eslint/no-require-imports */

beforeAll(() => {
  stubNetwork.start();
});

afterEach(async () => {
  // Read before the reset: a stray request fails the test that made it.
  const strayError = (() => {
    try {
      stubNetwork.assertNoStrayRequests();
      return null;
    } catch (error) {
      return error;
    }
  })();
  restoreTestGlobals();
  stubNetwork.reset();
  notificationsState.reset();
  secureStoreState.reset();
  await AsyncStorage.clear();
  if (strayError) throw strayError;
});

afterAll(() => {
  stubNetwork.stop();
});
