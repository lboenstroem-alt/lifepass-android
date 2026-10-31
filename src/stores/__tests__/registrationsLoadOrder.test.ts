/**
 * The register files (src/features/<area>/register.ts) load after the app
 * store exists, never while it is loading. A register file, or anything it
 * imports (F7's src/health following the store, F4's intent store
 * registering a Kenni blocker), may use the store at load: when the store
 * itself imported the register files, such a file found it half-built and
 * the app crashed at startup ("Cannot read properties of undefined (reading
 * 'subscribe')").
 *
 * Each case loads the app in a fresh module registry, with one register
 * file replaced by one that uses the store while it loads.
 */
type AppStoreModule = typeof import('../appStore');
type SignOutModule = typeof import('../../app/signOut');

const HOME_REGISTER = '../../features/home/register';

/** A register file that, at load, follows the store and registers a Kenni blocker. */
function mockStoreUsingRegisterFile(seen: boolean[]): void {
  jest.doMock(HOME_REGISTER, () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerKennitalaPromptBlocker, useAppStore } = require('../appStore') as AppStoreModule;
    useAppStore.subscribe((state) => void seen.push(state.isAuthenticated));
    registerKennitalaPromptBlocker(() => false);
    return {};
  });
}

afterEach(() => {
  jest.dontMock(HOME_REGISTER);
});

it('a register file may use the app store while it loads', async () => {
  const seen: boolean[] = [];
  await jest.isolateModulesAsync(async () => {
    mockStoreUsingRegisterFile(seen);
    let store!: AppStoreModule;
    // The app reaching the store first, as every screen does.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      store = require('../appStore') as AppStoreModule;
    }).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hooks = require('../../app/signOut') as SignOutModule;

    // The register files load before the first hook runs ...
    expect(hooks.registeredHookIds().signOut).toContain('coach.sessions');
    // ... and the one that subscribed at load follows the store.
    store.useAppStore.setState({ isAuthenticated: true });
    expect(seen).toContain(true);
  });
});

it('the store loads whole when a register file is what reaches it first', async () => {
  const seen: boolean[] = [];
  await jest.isolateModulesAsync(async () => {
    mockStoreUsingRegisterFile(seen);
    // A screen importing a feature whose register file is loaded before the store.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(HOME_REGISTER);
    }).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('../appStore') as AppStoreModule;
    store.useAppStore.setState({ isAuthenticated: true });
    expect(seen).toContain(true);
    await store.useAppStore.getState().handleSignOut();
    expect(seen.at(-1)).toBe(false);
  });
});

/**
 * One register file that throws while it loads (a native module missing on
 * one phone, say) loses its own hooks and nothing else. With plain imports
 * the throw stopped every register file after it and the UI kit's cleaner,
 * and sign-out quietly kept the Coach's saved chats for the next account.
 */
describe('a register file that throws while it loads', () => {
  const BODY_REGISTER = '../../features/body/register';
  const UI_KIT_RESET = '../../components/ui/reset';

  afterEach(() => {
    jest.dontMock(BODY_REGISTER);
    jest.dontMock(UI_KIT_RESET);
  });

  it('costs only its own hooks: the Coach and the UI kit still wipe at sign-out, and the failure is reported', async () => {
    await jest.isolateModulesAsync(async () => {
      const resetUiKit = jest.fn();
      jest.doMock(BODY_REGISTER, () => {
        throw new Error('native module missing');
      });
      jest.doMock(UI_KIT_RESET, () => ({ resetUiKit }));
      /* eslint-disable @typescript-eslint/no-require-imports */
      // This registry's copy of the storage mock: the one the Coach's register file writes to.
      type Storage = typeof import('@react-native-async-storage/async-storage').default;
      const storage = require('@react-native-async-storage/async-storage') as Storage | { default: Storage };
      const AsyncStorage = 'default' in storage ? storage.default : storage;
      const analytics = require('../../lib/analytics') as typeof import('../../lib/analytics');
      const store = require('../appStore') as AppStoreModule;
      const hooks = require('../../app/signOut') as SignOutModule;
      const coach = require('../../features/coach/register') as typeof import('../../features/coach/register');
      /* eslint-enable @typescript-eslint/no-require-imports */

      const reported: string[] = [];
      analytics.setAnalyticsObserver((event, params) => {
        if (event === 'service_error') reported.push(String(params.op));
      });
      try {
        const ids = hooks.registeredHookIds();
        expect(reported).toEqual(['register_body']);
        expect(ids.signIn).toContain('coach.sessions');
        expect(ids.signOut).toEqual(expect.arrayContaining(['coach.sessions', 'ui-kit', 'venues.list']));

        const member = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
        await hooks.runSignInHooks({ userId: member, restoredSession: false });
        await AsyncStorage.setItem(coach.COACH_SESSIONS_KEY, JSON.stringify([{ id: 's-1', messages: [] }]));
        store.useAppStore.setState({ isAuthenticated: true, userId: member });
        await store.useAppStore.getState().handleSignOut();

        expect(await AsyncStorage.getItem(coach.COACH_SESSIONS_KEY)).toBeNull();
        expect(resetUiKit).toHaveBeenCalledTimes(1);
      } finally {
        analytics.setAnalyticsObserver(null);
      }
    });
  });

  it('every area in the list loads its own register file', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { REGISTERED_FEATURE_AREAS } = require('../../app/registrations') as typeof import('../../app/registrations');
    const loaded: string[] = [];
    await jest.isolateModulesAsync(async () => {
      for (const area of REGISTERED_FEATURE_AREAS) {
        jest.doMock(`../../features/${area}/register`, () => {
          loaded.push(area);
          return {};
        });
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../../app/signOut') as SignOutModule).registeredHookIds();
      } finally {
        for (const area of REGISTERED_FEATURE_AREAS) jest.dontMock(`../../features/${area}/register`);
      }
    });
    expect(loaded).toEqual([...REGISTERED_FEATURE_AREAS]);
  });
});
