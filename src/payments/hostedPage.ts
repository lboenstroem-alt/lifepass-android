/**
 * Opens one of Kling's hosted pages (a checkout, the pay-and-save-card page,
 * the card setup page) and says how the member came back: the Android form
 * of iOS `SafariCheckoutView` (a full-screen Safari cover) and the
 * `lifepass://` return handling in `LifePassApp`.
 *
 * THE PAGE. A Chrome Custom Tab through `WebBrowser.openAuthSessionAsync`,
 * waiting on the family's return PREFIX so both the success and the cancel
 * link come back here (./returnUrls). It opens in the app's own task
 * (`createTask: false`), which is what makes it behave like iOS's cover:
 *   - the tab sits on top of the app: leaving for a bank's app to approve
 *     the card (3-D Secure) and coming back, through Recents or the launcher
 *     icon, lands on the tab again, not on the app underneath it (which would
 *     read as "the member closed the page" while they are still paying);
 *   - a return link reaches the app's single-task activity, which closes the
 *     tab above it, as the iOS link closes the cover;
 *   - in its own task (the default), the tab would also be excluded from
 *     Recents and dropped from history as soon as the member switched to
 *     their bank's app, so a 3-D Secure approval would close the payment.
 *
 * HOW THE MEMBER CAME BACK (plan F8, iOS `handleBookingPayReturn`):
 *   - the cancel link (`lifepass://payment-canceled`, `card-setup-canceled`):
 *     the `cancel` leg;
 *   - the success link, or the tab closed with no link at all (Android's
 *     close button and back, the only ways back from a declined card, as
 *     iOS's Done is): the `done` leg;
 *   - the page never opened (no browser, another page already open, the call
 *     threw): `neverOpened`. Nobody can have paid on a page that never
 *     opened, so the rail ends the attempt as an unpaid one without asking
 *     the server (iOS `bookingPayPageNeverOpened`).
 * Neither leg is proof of anything; the rail ALWAYS asks the server after a
 * page that opened. The leg only says how many times to ask.
 *
 * Only one hosted page is open at a time (the polyfill allows one, and iOS
 * shows one cover). While one is open, `isHostedPageOpen()` is true and a
 * return link routed through the app (F4's deep-link router, or the
 * in-flight recovery's dispatcher) is handed to it by `noteReturnUrl`.
 */
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { parseReturnUrl, RETURN_PREFIX, type HostedPageFamily, type ParsedReturn } from './returnUrls';
import { paymentTiming, sleep } from './timing';

/** How the member came back from a page that opened. */
export type HostedPageLeg = 'done' | 'cancel';

export type HostedPageResult =
  /** The page opened and closed. `returnUrl` is the link that closed it, when one did. */
  | { readonly kind: 'returned'; readonly leg: HostedPageLeg; readonly returnUrl: string | null }
  /** The page never came up. Nothing can have been paid on it. */
  | { readonly kind: 'neverOpened'; readonly error: unknown };

/**
 * The Custom Tab's options (see the file comment for why the tab stays in the
 * app's task). `showInRecents` only applies to a tab in its own task. The
 * toolbar keeps showing the address rather than the page title, so the
 * member can see they are paying on Kling's own domain, as Safari's cover
 * shows it on iOS.
 */
export const HOSTED_PAGE_OPTIONS: WebBrowser.AuthSessionOpenOptions = Object.freeze({
  createTask: false,
});

/** A page was asked for while another one is open (a second tap, the Kenni page). */
export class HostedPageBusyError extends Error {
  constructor() {
    super('a hosted page is already open');
    this.name = 'HostedPageBusyError';
  }
}

interface OpenPage {
  readonly family: HostedPageFamily;
  returnUrl: string | null;
  arrived: (() => void) | null;
}

let openPage: OpenPage | null = null;

/** True while a hosted page (of `family`, when given) is open in this process. */
export function isHostedPageOpen(family?: HostedPageFamily): boolean {
  return openPage !== null && (family === undefined || openPage.family === family);
}

/**
 * A return link that reached the app while a page of its family is open:
 * the page takes it. Returns false when no such page is open (the link is
 * then the in-flight recovery's: ./coldStartRecovery).
 */
export function noteReturnUrl(link: ParsedReturn): boolean {
  const page = openPage;
  if (!page || page.family !== link.family) return false;
  // The first link wins: the page closes on it, and only one ever fires.
  if (page.returnUrl === null) {
    page.returnUrl = link.url;
    page.arrived?.();
  }
  return true;
}

/** Waits up to `ms` for a return link to reach `page`. */
async function awaitLateLink(page: OpenPage, ms: number): Promise<void> {
  if (page.returnUrl !== null || ms <= 0) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      page.arrived = resolve;
    }),
    sleep(ms),
  ]);
  page.arrived = null;
}

/**
 * Opens `url` and resolves when the member is back in the app. Never throws:
 * a page that could not open is `neverOpened`.
 */
export async function openHostedPage(url: string, family: HostedPageFamily): Promise<HostedPageResult> {
  if (openPage) return { kind: 'neverOpened', error: new HostedPageBusyError() };
  const page: OpenPage = { family, returnUrl: null, arrived: null };
  openPage = page;
  // The polyfill listens for the link itself, but it also resolves when the
  // app comes back to the foreground, which can beat the link's own event:
  // listen here too, so a cancel link that lost that race still counts.
  const subscription = Linking.addEventListener('url', (event: { url: string }) => {
    const link = parseReturnUrl(event.url);
    if (link) noteReturnUrl(link);
  });
  try {
    let result: WebBrowser.WebBrowserAuthSessionResult;
    try {
      result = await WebBrowser.openAuthSessionAsync(url, RETURN_PREFIX[family], HOSTED_PAGE_OPTIONS);
    } catch (error) {
      return { kind: 'neverOpened', error };
    }
    if (result.type === 'success' && typeof result.url === 'string') {
      const link = parseReturnUrl(result.url);
      if (link && page.returnUrl === null) page.returnUrl = link.url;
    } else {
      await awaitLateLink(page, paymentTiming().lateReturnGraceMs);
    }
    const leg: HostedPageLeg = parseReturnUrl(page.returnUrl)?.leg === 'canceled' ? 'cancel' : 'done';
    return { kind: 'returned', leg, returnUrl: page.returnUrl };
  } finally {
    subscription.remove();
    if (openPage === page) openPage = null;
  }
}

/** Tests only: forget an open page (a test that never let one close). */
export function resetHostedPageForTests(): void {
  openPage = null;
}
