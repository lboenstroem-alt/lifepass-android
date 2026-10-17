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
