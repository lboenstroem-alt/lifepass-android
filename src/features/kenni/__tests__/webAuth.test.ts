/**
 * The eID browser step on Android: a Custom Tab in the app's own task, the
 * redirect it ends on, and every other ending as the failure the sheet says.
 */
import * as WebBrowser from 'expo-web-browser';

import {
  authenticateWithCustomTab,
  isKenniWebAuthInFlight,
  KENNI_CALLBACK_PREFIX,
  KenniWebAuthError,
  resetKenniWebAuthForTests,
} from '../webAuth';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const open = WebBrowser.openAuthSessionAsync as jest.MockedFunction<typeof WebBrowser.openAuthSessionAsync>;
const URL = 'https://idp.kenni.is/sporta/oidc/auth?client_id=x';

beforeEach(() => {
  open.mockReset();
  resetKenniWebAuthForTests();
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
