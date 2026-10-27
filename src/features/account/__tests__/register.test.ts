/**
 * Account's register file (loaded once at startup by src/app/registrations.ts)
 * puts the co-pay hooks in place itself: sign-out forgetting the employer
 * context and the dunning key, the co-pay payment outcome presenter, and the
 * dunning-episode subscription. Before, only the Account screen's slots
 * imported them, so they depended on that route being in the navigator's
 * static import graph.
 *
 * It loads them without loading a screen (register files load before any
 * UI, src/app/registrations.ts), and a co-pay module that fails to load costs
 * the co-pay hooks only, never the company-context cleaner, and is reported.
 * Like src/features/coach/program/__tests__/loadsNoUi.test.ts, the no-screen
 * case asserts what is LOADED: each screen module is replaced by a stand-in
 * that notes its own evaluation.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each case loads the file afresh, in an isolated registry */
import type * as Analytics from '../../../lib/analytics';
import type * as SignOut from '../../../app/signOut';

const loaded: string[] = [];

/** A stand-in module that notes its own evaluation. */
function noted(name: string): () => Record<string, unknown> {
  return () => {
    loaded.push(name);
    return { __esModule: true, default: () => null };
  };
}

/** Everything that is UI, or brings UI with it, by the path this file resolves it from. */
const SCREENS: readonly (readonly [path: string, name: string])[] = [
  ['@expo/vector-icons', 'icons'],
  ['../../kenni/KenniSheet', 'Kenni sheet'],
  ['../../kenni/KenniNudgeHost', 'Kenni host'],
  ['../slots/CompanyPlanBanner', 'company plan banner'],
  ['../slots/PastDueFix', 'past-due fix'],
  ['../copay/CompanyPlanCard', 'company plan card'],
];

beforeEach(() => {
  loaded.length = 0;
});

afterEach(() => {
  jest.dontMock('../copay/register');
  for (const [path] of SCREENS) jest.dontMock(path);
  jest.resetModules();
});

it('loads the co-pay hooks as it loads', () => {
  const copayLoaded = jest.fn();
  jest.isolateModules(() => {
    jest.doMock('../copay/register', () => {
      copayLoaded();
      return { installCopayHooks: jest.fn() };
    });
    require('../register');
  });
  expect(copayLoaded).toHaveBeenCalledTimes(1);
});

it('loads them without loading a screen', () => {
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    require('../register');
    expect(loaded).toEqual([]);
  });
});

it('would notice a screen loaded at import', () => {
  // The premise of the test above: the Kenni barrel (what the co-pay flows
  // used to import) is seen, through the sheet host it carries.
  jest.isolateModules(() => {
    for (const [path, name] of SCREENS) jest.doMock(path, noted(name));
    require('../../kenni');
    expect(loaded).toContain('Kenni host');
  });
});

it("registers both of Account's sign-out cleaners at startup", () => {
  jest.isolateModules(() => {
    const { registeredHookIds } = require('../../../app/signOut') as typeof SignOut;
    expect(registeredHookIds().signOut).toEqual(expect.arrayContaining(['account.companyContext', 'account.copay']));
  });
});

it('a co-pay module that fails to load costs the co-pay hooks only, and is reported', () => {
  const events: [string, unknown][] = [];
  jest.isolateModules(() => {
    jest.doMock('../copay/register', () => {
      throw new Error('payments layer missing');
    });
    const { setAnalyticsObserver } = require('../../../lib/analytics') as typeof Analytics;
    setAnalyticsObserver((event, params) => events.push([event, params]));
    try {
      expect(() => require('../register')).not.toThrow();
      const { registeredHookIds } = require('../../../app/signOut') as typeof SignOut;
      const signOut = registeredHookIds().signOut;
      expect(signOut).toContain('account.companyContext');
      expect(signOut).not.toContain('account.copay');
    } finally {
      setAnalyticsObserver(null);
    }
  });
  expect(events).toContainEqual([
    'service_error',
    expect.objectContaining({ op: 'register_account_copay', error: expect.stringContaining('payments layer missing') }),
  ]);
});
