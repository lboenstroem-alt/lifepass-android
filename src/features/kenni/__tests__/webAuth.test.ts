/**
 * The eID browser step on Android: a Custom Tab in the app's own task, the
 * redirect it ends on, and every other ending as the failure the sheet says.
 */
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import {
  authenticateWithCustomTab,
  isKenniWebAuthInFlight,
  KENNI_CALLBACK_PREFIX,
  KENNI_LATE_REDIRECT_GRACE_MS,
  KenniWebAuthError,
  resetKenniWebAuthForTests,
  setKenniLateRedirectGraceForTests,
  wasKenniCallbackConsumed,
} from '../webAuth';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const open = WebBrowser.openAuthSessionAsync as jest.MockedFunction<typeof WebBrowser.openAuthSessionAsync>;
const URL = 'https://idp.kenni.is/sporta/oidc/auth?client_id=x';
const CALLBACK = 'lifepass://kenni-callback?code=c&state=s';
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

/** The app's own link events, as the step listens for them. */
type UrlHandler = (event: { url: string }) => void;
let urlHandlers: UrlHandler[] = [];
const sendLink = (url: string) => {
  for (const handler of [...urlHandlers]) handler({ url });
};

beforeEach(() => {
  open.mockReset();
  resetKenniWebAuthForTests();
  urlHandlers = [];
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((type: string, handler: UrlHandler) => {
    urlHandlers.push(handler);
    return {
      remove: () => {
        urlHandlers = urlHandlers.filter((h) => h !== handler);
      },
    };
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KenniWebAuthError) return error.reason;
    throw error;
  }
  throw new Error('resolved');
}

it('opens the authorization URL in the app task and waits for the kenni-callback redirect', async () => {
  open.mockResolvedValue({ type: 'success', url: 'lifepass://kenni-callback?code=c&state=s' });
  await expect(authenticateWithCustomTab(URL)).resolves.toBe('lifepass://kenni-callback?code=c&state=s');
  expect(open).toHaveBeenCalledWith(URL, KENNI_CALLBACK_PREFIX, { createTask: false });
  expect(KENNI_CALLBACK_PREFIX).toBe('lifepass://kenni-callback');
});

it('a tab closed without a redirect is a cancel', async () => {
  setKenniLateRedirectGraceForTests(0);
  open.mockResolvedValue({ type: 'dismiss' } as never);
  expect(await reason(authenticateWithCustomTab(URL))).toBe('cancelled');
  open.mockResolvedValue({ type: 'cancel' } as never);
  expect(await reason(authenticateWithCustomTab(URL))).toBe('cancelled');
});

it('a tab that cannot open could not start', async () => {
  open.mockRejectedValue(new Error('No matching browser activity found'));
  expect(await reason(authenticateWithCustomTab(URL))).toBe('couldNotStart');
  open.mockResolvedValue({ type: 'locked' } as never);
  expect(await reason(authenticateWithCustomTab(URL))).toBe('couldNotStart');
});

it('one tab at a time: a second call while one is open could not start, and opens nothing', async () => {
  let finish: (value: WebBrowser.WebBrowserAuthSessionResult) => void = () => undefined;
  open.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const first = authenticateWithCustomTab(URL);
  expect(isKenniWebAuthInFlight()).toBe(true);
  expect(await reason(authenticateWithCustomTab(URL))).toBe('couldNotStart');
  expect(open).toHaveBeenCalledTimes(1);
  finish({ type: 'success', url: 'lifepass://kenni-callback?code=c&state=s' });
  await expect(first).resolves.toContain('code=c');
  expect(isKenniWebAuthInFlight()).toBe(false);
});

describe('a redirect that loses the race to the return to the app', () => {
  it('waits a moment after a dismiss, and a redirect that arrives then is the answer', async () => {
    jest.useFakeTimers();
    open.mockResolvedValue(DISMISSED);
    let settled = false;
    const answer = authenticateWithCustomTab(URL).finally(() => {
      settled = true;
    });
    // The polyfill has said `dismiss`; the step is still waiting, and still
    // owns any Kenni link, when the link event comes just after.
    await jest.advanceTimersByTimeAsync(KENNI_LATE_REDIRECT_GRACE_MS - 50);
    expect(settled).toBe(false);
    expect(isKenniWebAuthInFlight()).toBe(true);
    sendLink('lifepass://scan?v=x');
    sendLink(CALLBACK);
    await expect(answer).resolves.toBe(CALLBACK);
    expect(isKenniWebAuthInFlight()).toBe(false);
    expect(urlHandlers).toHaveLength(0);
  });

  it('a redirect heard while the tab was still open wins over the dismiss that followed', async () => {
    open.mockImplementation(async () => {
      sendLink(CALLBACK);
      return DISMISSED;
    });
    await expect(authenticateWithCustomTab(URL)).resolves.toBe(CALLBACK);
  });

  it('with no redirect by the end of the wait, it was a cancel; another app link changes nothing', async () => {
    jest.useFakeTimers();
    open.mockResolvedValue(DISMISSED);
    const answer = reason(authenticateWithCustomTab(URL));
    await Promise.resolve();
    sendLink('lifepass://auth/callback?code=x');
    await jest.advanceTimersByTimeAsync(KENNI_LATE_REDIRECT_GRACE_MS);
    expect(await answer).toBe('cancelled');
    expect(isKenniWebAuthInFlight()).toBe(false);
  });

  it('the wait is short: the one F8 gives a hosted page', () => {
    expect(KENNI_LATE_REDIRECT_GRACE_MS).toBe(300);
  });
});

describe('a redirect handed to the sheet', () => {
  it('is remembered, so the router never completes the same state again', async () => {
    open.mockResolvedValue({ type: 'success', url: CALLBACK });
    expect(wasKenniCallbackConsumed(CALLBACK)).toBe(false);
    await authenticateWithCustomTab(URL);
    expect(wasKenniCallbackConsumed(CALLBACK)).toBe(true);
    expect(wasKenniCallbackConsumed('lifepass://kenni-callback?code=other&state=s')).toBe(false);
  });

  it('a late one too; a cancel remembers nothing', async () => {
    setKenniLateRedirectGraceForTests(0);
    open.mockResolvedValue(DISMISSED);
    expect(await reason(authenticateWithCustomTab(URL))).toBe('cancelled');
    expect(wasKenniCallbackConsumed(CALLBACK)).toBe(false);
    open.mockImplementation(async () => {
      sendLink(CALLBACK);
      return DISMISSED;
    });
    await authenticateWithCustomTab(URL);
    expect(wasKenniCallbackConsumed(CALLBACK)).toBe(true);
  });
});
