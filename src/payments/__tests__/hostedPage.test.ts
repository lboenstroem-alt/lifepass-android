/**
 * The hosted page and its return links: how each way back from Kling's page
 * maps to a leg (plan F8: success with the cancel link is the cancel leg;
 * success, dismiss or cancel otherwise is Done; a throw is a page that never
 * opened), and which links are the app's.
 */
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import {
  HOSTED_PAGE_OPTIONS,
  HostedPageBusyError,
  isHostedPageOpen,
  noteReturnUrl,
  openHostedPage,
  resetHostedPageForTests,
} from '../hostedPage';
import { isPaymentReturnUrl, parseReturnUrl } from '../returnUrls';
import { NO_WAITS, setPaymentTimingForTests } from '../timing';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const PAGE = 'https://pay.kling.is/c/kling_cs_1';
/** The tab closed with no link (the mock module has no enum to name it with). */
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

type UrlHandler = (event: { url: string }) => void;
let urlHandlers: UrlHandler[] = [];

beforeEach(() => {
  resetHostedPageForTests();
  setPaymentTimingForTests(NO_WAITS);
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
  setPaymentTimingForTests(null);
  jest.restoreAllMocks();
});

describe('the return links', () => {
  it('reads the four links and nothing else', () => {
    expect(parseReturnUrl('lifepass://payment-success')).toMatchObject({ family: 'payment', leg: 'success' });
    expect(parseReturnUrl('lifepass://payment-canceled')).toMatchObject({ family: 'payment', leg: 'canceled' });
    expect(parseReturnUrl('lifepass://card-setup-success')).toMatchObject({ family: 'cardSetup', leg: 'success' });
    expect(parseReturnUrl('lifepass://card-setup-canceled?session=x')).toMatchObject({
      family: 'cardSetup',
      leg: 'canceled',
    });
    expect(parseReturnUrl('LIFEPASS://Payment-Success/')).toMatchObject({ family: 'payment', leg: 'success' });
    for (const other of [
      'lifepass://auth/callback#access_token=x',
      'lifepass://scan?v=3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f',
      'https://www.lifepass.is/payment-success',
      'lifepass://payment-successful',
      'lifepass://payment',
      '',
      null,
      undefined,
    ]) {
      expect(isPaymentReturnUrl(other)).toBe(false);
    }
  });
});

describe('opening a page', () => {
  it('waits on the family prefix, in the app task, so both links come back to it', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-success' });
    await openHostedPage(PAGE, 'payment');
    expect(openAuthSession).toHaveBeenCalledWith(PAGE, 'lifepass://payment-', HOSTED_PAGE_OPTIONS);
    expect(HOSTED_PAGE_OPTIONS.createTask).toBe(false);

    openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://card-setup-canceled' });
    await openHostedPage('https://pay.kling.is/setup/s_1', 'cardSetup');
    expect(openAuthSession).toHaveBeenLastCalledWith('https://pay.kling.is/setup/s_1', 'lifepass://card-setup-', HOSTED_PAGE_OPTIONS);
  });

  it('the success link is the Done leg', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-success' });
    await expect(openHostedPage(PAGE, 'payment')).resolves.toEqual({
      kind: 'returned',
      leg: 'done',
      returnUrl: 'lifepass://payment-success',
    });
  });

  it('the cancel link is the cancel leg', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: 'lifepass://payment-canceled' });
    await expect(openHostedPage(PAGE, 'payment')).resolves.toMatchObject({ kind: 'returned', leg: 'cancel' });
  });

  it.each(['dismiss', 'cancel'])('a tab closed with no link (%s) is the Done leg, as iOS Done is', async (type) => {
    openAuthSession.mockResolvedValue({ type } as WebBrowser.WebBrowserAuthSessionResult);
    await expect(openHostedPage(PAGE, 'payment')).resolves.toEqual({ kind: 'returned', leg: 'done', returnUrl: null });
  });

  it('a cancel link that lost the race to the foreground still makes the cancel leg', async () => {
    setPaymentTimingForTests({ ...NO_WAITS, lateReturnGraceMs: 200 });
    openAuthSession.mockImplementation(async () => {
      // The app came back first; the link's own event lands a moment later.
      setTimeout(() => urlHandlers.forEach((handler) => handler({ url: 'lifepass://payment-canceled' })), 10);
      return DISMISSED;
    });
    await expect(openHostedPage(PAGE, 'payment')).resolves.toMatchObject({ leg: 'cancel' });
  });

  it('a link routed through the app while the page is open is the page’s', async () => {
    let close!: (value: WebBrowser.WebBrowserAuthSessionResult) => void;
    openAuthSession.mockImplementation(() => new Promise((resolve) => (close = resolve)));
    const result = openHostedPage(PAGE, 'payment');
    await Promise.resolve();
    expect(isHostedPageOpen()).toBe(true);
    expect(isHostedPageOpen('payment')).toBe(true);
    expect(isHostedPageOpen('cardSetup')).toBe(false);
    // A card-setup link is not this page's.
    expect(noteReturnUrl(parseReturnUrl('lifepass://card-setup-success')!)).toBe(false);
    expect(noteReturnUrl(parseReturnUrl('lifepass://payment-canceled')!)).toBe(true);
    close(DISMISSED);
    await expect(result).resolves.toMatchObject({ leg: 'cancel', returnUrl: 'lifepass://payment-canceled' });
    expect(isHostedPageOpen()).toBe(false);
  });

  it('a page that could not open is neverOpened, and the next one can open', async () => {
    openAuthSession.mockRejectedValueOnce(new Error('No matching browser activity found'));
    const failed = await openHostedPage(PAGE, 'payment');
    expect(failed.kind).toBe('neverOpened');
    expect(isHostedPageOpen()).toBe(false);
    openAuthSession.mockResolvedValue(DISMISSED);
    await expect(openHostedPage(PAGE, 'payment')).resolves.toMatchObject({ kind: 'returned' });
  });

  it('only one page at a time: a second never opens', async () => {
    let close!: (value: WebBrowser.WebBrowserAuthSessionResult) => void;
    openAuthSession.mockImplementation(() => new Promise((resolve) => (close = resolve)));
    const first = openHostedPage(PAGE, 'payment');
    const second = await openHostedPage(PAGE, 'payment');
    expect(second.kind).toBe('neverOpened');
    expect((second as { error: unknown }).error).toBeInstanceOf(HostedPageBusyError);
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    close(DISMISSED);
    await first;
  });

  it('stops listening for links once the page has closed', async () => {
    openAuthSession.mockResolvedValue(DISMISSED);
    await openHostedPage(PAGE, 'payment');
    expect(urlHandlers).toHaveLength(0);
  });
});
