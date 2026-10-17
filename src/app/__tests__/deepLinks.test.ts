/**
 * The link router (iOS LifePassApp.handleIncomingURL / routeScanURL): what
 * each link is, and that a check-in link only ever parks its venue.
 */
import { Linking } from 'react-native';

import { api } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { runSignOutCleaners } from '../signOut';
import { resetIntentStoreForTests, useIntentStore } from '../../stores/intentStore';
import {
  handleDeepLink,
  parseDeepLink,
  registerReturnHandler,
  resetDeepLinksForTests,
  startDeepLinks,
  type HostedPageReturn,
} from '../deepLinks';

const mockHandleAuthCallback = jest.fn(async (_url: string) => undefined);
jest.mock('../../features/auth/authCallback', () => ({
  handleAuthCallback: (url: string) => mockHandleAuthCallback(url),
}));

stubApiClientPerTest();

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';

beforeEach(() => {
  resetIntentStoreForTests();
  resetDeepLinksForTests();
  mockHandleAuthCallback.mockClear();
});

afterEach(() => jest.restoreAllMocks());

describe('check-in links', () => {
  it('the printed App Link, on either host, and the custom scheme all park the venue', () => {
    for (const url of [
      `https://lifepass.is/scan?v=${VENUE}`,
      `https://www.lifepass.is/scan?v=${VENUE}`,
      `lifepass://scan?v=${VENUE}`,
      `LIFEPASS://scan?v=${VENUE.toUpperCase()}`,
    ]) {
      expect(parseDeepLink(url)).toEqual({ kind: 'scan', venueId: VENUE });
    }
  });

  it('a v that is not a venue UUID is ignored', () => {
    for (const url of [
      'lifepass://scan?v=laugar',
      'lifepass://scan',
      'https://lifepass.is/scan?v=not-a-uuid',
      `https://evil.example/scan?v=${VENUE}`,
      `https://lifepass.is/venues?v=${VENUE}`,
    ]) {
      expect(parseDeepLink(url)).toEqual({ kind: 'ignored' });
    }
  });

  it('only parks: nothing is posted, and the launch presentation is cancelled', () => {
    useIntentStore.getState().setExploreLaunchPresentation(true);
    handleDeepLink(`https://lifepass.is/scan?v=${VENUE}`);
    expect(useIntentStore.getState().pendingScanVenueId).toBe(VENUE);
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(false);
    expect(api.sentAll('/check-ins/walk-in', 'POST')).toHaveLength(0);
  });
});

describe('auth links (D23: both forms)', () => {
  it('the App Link and the custom scheme go to the auth callback, query or fragment', () => {
    const urls = [
      'https://www.lifepass.is/app/auth-callback?code=abc&type=recovery',
      'https://www.lifepass.is/app/auth-callback#access_token=a&refresh_token=b',
      'lifepass://auth/callback#access_token=a&refresh_token=b',
      'lifepass://auth/callback?code=abc',
    ];
    for (const url of urls) {
      expect(parseDeepLink(url)).toEqual({ kind: 'auth', url });
      handleDeepLink(url);
    }
    expect(mockHandleAuthCallback.mock.calls.map(([url]) => url)).toEqual(urls);
  });

  it('another path on the website is not an auth link', () => {
    expect(parseDeepLink('https://www.lifepass.is/auth-callback?code=abc')).toEqual({ kind: 'ignored' });
  });
});

describe('hosted-page returns', () => {
  it('each return is recognised with its outcome', () => {
    const cases: [string, Omit<HostedPageReturn, 'url'>][] = [
      ['lifepass://payment-success', { kind: 'payment', outcome: 'success' }],
      ['lifepass://payment-canceled', { kind: 'payment', outcome: 'canceled' }],
      ['lifepass://card-setup-success', { kind: 'cardSetup', outcome: 'success' }],
      ['lifepass://card-setup-canceled?x=1', { kind: 'cardSetup', outcome: 'canceled' }],
    ];
    for (const [url, expected] of cases) {
      expect(parseDeepLink(url)).toEqual({ kind: 'return', hostedReturn: { ...expected, url } });
    }
  });

  it('go to the rail that registered, and are never a launch onto Explore', () => {
    const payments: HostedPageReturn[] = [];
    const unregister = registerReturnHandler('payment', (ret) => {
      payments.push(ret);
    });
    useIntentStore.getState().setExploreLaunchPresentation(true);

    handleDeepLink('lifepass://payment-canceled');
    expect(payments).toEqual([{ kind: 'payment', outcome: 'canceled', url: 'lifepass://payment-canceled' }]);
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(false);

    // A card return with no rail registered does not throw, and still cancels the presentation.
    useIntentStore.getState().setExploreLaunchPresentation(true);
    expect(() => handleDeepLink('lifepass://card-setup-success')).not.toThrow();
    expect(useIntentStore.getState().exploreLaunchPresentation).toBe(false);

    unregister();
    handleDeepLink('lifepass://payment-success');
    expect(payments).toHaveLength(1);
  });

  it('one that arrives before its rail registers is handed to the rail when it does, once', async () => {
    handleDeepLink('lifepass://card-setup-canceled');
    handleDeepLink('lifepass://card-setup-success');
    const cards: HostedPageReturn[] = [];
    registerReturnHandler('cardSetup', (ret) => {
      cards.push(ret);
    });
    // Not inside the registration itself.
    expect(cards).toEqual([]);
    await Promise.resolve();
    // The last one of its kind.
    expect(cards).toEqual([{ kind: 'cardSetup', outcome: 'success', url: 'lifepass://card-setup-success' }]);

    // Taken: a rail that registers again is not handed it a second time.
    registerReturnHandler('cardSetup', (ret) => {
      cards.push(ret);
    });
    await Promise.resolve();
    expect(cards).toHaveLength(1);
  });

  it('one still waiting at sign-out is never handed to the next member', async () => {
    handleDeepLink('lifepass://payment-success');
    await runSignOutCleaners({ memberId: 'member-a' });
    const payments: HostedPageReturn[] = [];
    registerReturnHandler('payment', (ret) => {
      payments.push(ret);
    });
    await Promise.resolve();
    expect(payments).toEqual([]);
  });

  it('a failing rail does not take the router down', () => {
    registerReturnHandler('payment', () => {
      throw new Error('boom');
    });
    expect(() => handleDeepLink('lifepass://payment-success')).not.toThrow();
  });
});

describe('anything else', () => {
  it('is ignored', () => {
    for (const url of [null, undefined, '', 'not a url', 'lifepass://unknown', 'https://www.lifepass.is/', 'mailto:x@y.is']) {
      expect(parseDeepLink(url)).toEqual({ kind: 'ignored' });
    }
  });
});

describe('listening', () => {
  it('routes the link that started the app once, then each link that arrives', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`lifepass://scan?v=${VENUE}`);
    let listener: ((event: { url: string }) => void) | undefined;
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: (event: { url: string }) => void) => {
      listener = handler;
      return { remove: jest.fn() };
    }) as never);

    const stop = startDeepLinks();
    await Promise.resolve();
    await Promise.resolve();
    expect(useIntentStore.getState().takeScanVenue()).toBe(VENUE);

    // A remount with the same launch link (a relaunch from Recents) does not replay it.
    stop();
    startDeepLinks();
    await Promise.resolve();
    await Promise.resolve();
    expect(useIntentStore.getState().pendingScanVenueId).toBeNull();

    listener?.({ url: 'lifepass://auth/callback?code=1' });
    expect(mockHandleAuthCallback).toHaveBeenCalledWith('lifepass://auth/callback?code=1');
  });

  it('a remount whose Activity was started by another link routes that link', async () => {
    // Android destroyed the Activity and kept the process: the next link
    // starts a new Activity, reached only through getInitialURL.
    const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`lifepass://scan?v=${VENUE}`);
    jest.spyOn(Linking, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never);

    const stop = startDeepLinks();
    await Promise.resolve();
    await Promise.resolve();
    expect(useIntentStore.getState().takeScanVenue()).toBe(VENUE);
    stop();

    initial.mockResolvedValue(`https://lifepass.is/scan?v=${OTHER}`);
    startDeepLinks();
    await Promise.resolve();
    await Promise.resolve();
    expect(useIntentStore.getState().takeScanVenue()).toBe(OTHER);
  });

  it('no launch link is nothing to route', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    jest.spyOn(Linking, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never);
    startDeepLinks();
    await Promise.resolve();
    await Promise.resolve();
    expect(useIntentStore.getState().pendingScanVenueId).toBeNull();
  });
});
