// Global test setup, run after the framework loads and before each test file.
//
// 1. Native modules a JS test cannot reach are replaced by faithful fakes
//    (stateful where the app's behaviour depends on what they hold:
//    SecureStore, the file system, notifications, AsyncStorage).
// 2. The network is the stub server (test/server): the LifePass API and
//    Supabase are recorded and answered in-process, and any other host is
//    refused and fails the test. No test can reach production.
// 3. After every test the fakes and the stub server are reset, so a test
//    seeds what it needs in `beforeEach`, never `beforeAll`.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { restoreTestGlobals } from './test/harness';
import { stubNetwork } from './test/server';
import { fileSystemState } from './test/mocks/expoFileSystem';
import { notificationsState } from './test/mocks/expoNotifications';
import { secureStoreState } from './test/mocks/expoSecureStore';

/* eslint-disable @typescript-eslint/no-require-imports */

// AsyncStorage: the library's own in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// SecureStore: an in-memory Keystore behind the real JS checks.
jest.mock('expo-secure-store/build/ExpoSecureStore', () => require('./test/mocks/expoSecureStore'));

// Files: an in-memory app sandbox behind both expo-file-system APIs. jest-expo
// stubs the whole package with an SDK 49-era legacy shape; the real JS runs
// here instead, over in-memory native modules.
jest.mock('expo-file-system', () => jest.requireActual('expo-file-system'));
jest.mock('expo-file-system/src/ExpoFileSystem', () => ({
  __esModule: true,
  default: require('./test/mocks/expoFileSystem').objectApiNativeModule,
}));
jest.mock('expo-file-system/src/legacy/ExponentFileSystem', () => ({
  __esModule: true,
  default: require('./test/mocks/expoFileSystem').legacyNativeModule,
}));

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

// Safe-area insets: the library's mock (zero insets on a 320x640 frame), so a
// screen that reads insets renders without a provider.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

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
  fileSystemState.reset();
  await AsyncStorage.clear();
  if (strayError) throw strayError;
});

afterAll(() => {
  stubNetwork.stop();
});
