/**
 * The links Kling's hosted pages send the member back to the app with.
 *
 * Two families share the `lifepass://` scheme (iOS `LifePassApp.handleIncomingURL`):
 *
 * - payment: `lifepass://payment-success` and `lifepass://payment-canceled`,
 *   for plan and pass checkout, the co-pay checkouts and the booking and
 *   walk-in pay-and-save-card rail alike. The link carries no session
 *   identity and no status: which attempt it belongs to is known on the
 *   phone (the open page, or the in-flight record after process death), and
 *   what happened to the money only the server's confirm can say. The
 *   return page fires the cancel link for a refunded, expired or parked
 *   payment too, so "canceled" is a hint about how many times to ask, never
 *   proof that nothing was paid.
 * - card setup: `lifepass://card-setup-success` and
 *   `lifepass://card-setup-canceled`, for Account's add or replace card page.
 *   Whichever fires, the verified confirm decides.
 */

export const PAYMENT_SUCCESS_URL = 'lifepass://payment-success';
export const PAYMENT_CANCEL_URL = 'lifepass://payment-canceled';
export const CARD_SETUP_SUCCESS_URL = 'lifepass://card-setup-success';
export const CARD_SETUP_CANCEL_URL = 'lifepass://card-setup-canceled';

/** Which kind of hosted page a return belongs to. */
export type HostedPageFamily = 'payment' | 'cardSetup';

/**
 * The prefix `openAuthSessionAsync` waits for. A prefix, not the success
 * link: Android's auth-session polyfill resolves on any incoming URL that
 * starts with it, so both the success and the cancel link come back to the
 * call that opened the page (a success-only redirect left the cancel link to
 * fall through to the app, where nothing took it).
 */
export const RETURN_PREFIX: Readonly<Record<HostedPageFamily, string>> = {
  payment: 'lifepass://payment-',
  cardSetup: 'lifepass://card-setup-',
};

/** A return link, read. */
export interface ParsedReturn {
  readonly family: HostedPageFamily;
  /** Which link fired. `canceled` is a hint only (see the file comment). */
  readonly leg: 'success' | 'canceled';
  readonly url: string;
}

const RETURN_LINK = /^lifepass:\/\/(payment|card-setup)-(success|canceled)(?=$|[/?#])/i;

/** The return link `url` is, or null for any other URL (an auth callback, a scan link, a web page). */
export function parseReturnUrl(url: string | null | undefined): ParsedReturn | null {
  if (typeof url !== 'string') return null;
  const match = RETURN_LINK.exec(url.trim());
  if (!match) return null;
  return {
    family: match[1].toLowerCase() === 'payment' ? 'payment' : 'cardSetup',
    leg: match[2].toLowerCase() === 'success' ? 'success' : 'canceled',
    url,
  };
}

/** True for a payment or card-setup return link (F4's deep-link router asks before dispatching). */
export function isPaymentReturnUrl(url: string | null | undefined): boolean {
  return parseReturnUrl(url) !== null;
}
