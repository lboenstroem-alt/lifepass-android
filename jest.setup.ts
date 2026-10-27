// Global test setup, run after the framework loads and before each test file.
//
// 1. Native modules a JS test cannot reach are replaced by faithful fakes
//    (stateful where the app's behaviour depends on what they hold:
//    SecureStore, the file system, notifications, AsyncStorage).
// 2. The network is the stub server (test/server): the LifePass API and
//    Supabase are recorded and answered in-process, and any other host is
//    refused and fails the test. No test can reach production.
// 3. After every test the rendered tree is unmounted, and only then are the
//    fakes, AsyncStorage, the stub server and the language reset, so a test
//    seeds what it needs in `beforeEach`, never `beforeAll`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup } from '@testing-library/react-native/pure';

import { setCurrentLanguage } from './src/i18n';
import { restoreTestGlobals } from './test/harness';
import { stubNetwork } from './test/server';
import { fileSystemState } from './test/mocks/expoFileSystem';
import { notificationsState } from './test/mocks/expoNotifications';
import { secureStoreState } from './test/mocks/expoSecureStore';
import { storeReviewState } from './test/mocks/expoStoreReview';

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

// Google Play's in-app review card: available, and every ask counted
// (test/mocks/expoStoreReview).
jest.mock('expo-store-review', () => require('./test/mocks/expoStoreReview'));

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

// The real setImmediate, taken before any test can install fake timers.
const realSetImmediate = globalThis.setImmediate;

/** Lets pending promise chains and msw's request handling run to the end. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  }
}

beforeAll(() => {
  stubNetwork.start();
});

afterEach(async () => {
  // Unmount FIRST. RNTL's own cleanup registers when the test file imports
  // it, after this file, so Jest would run it after the resets below: what a
  // component does while unmounting (persist a draft, send a request, cancel
  // a notification) would land in the next test and a stray request would be
  // blamed on it. Unmount here, let that work land, then check and reset.
  await settle();
  await cleanup();
  await settle();

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
  // The language is module state (src/i18n); a test that switched to
  // Icelandic and failed before switching back must not leak it.
  setCurrentLanguage('en');
  stubNetwork.reset();
  notificationsState.reset();
  storeReviewState.reset();
  secureStoreState.reset();
  fileSystemState.reset();
  await AsyncStorage.clear();
  if (strayError) throw strayError;
});

afterAll(() => {
  stubNetwork.stop();
});
