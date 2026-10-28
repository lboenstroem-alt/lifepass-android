/**
 * The card setup page's two calls (iOS `SubscriptionService.startCardSetup`
 * and `confirmCardSetup`), here so the page, its confirm and its recovery
 * after process death are one rail. ACCT-2 builds Account's card row on
 * `cardSetupOnHostedPage` (./attempts); removing a card is ACCT-2's own call.
 */
import { apiPost, newIdempotencyKey, TransportError } from '../api';

import { CARD_SETUP_CANCEL_URL, CARD_SETUP_SUCCESS_URL } from './returnUrls';

/** The card the verified pull found: `{ brand, last4 }`, either possibly null. */
export interface ConfirmedCard {
  readonly brand: string | null;
  readonly last4: string | null;
}

/**
 * `POST /billing/payment-methods/setup-session` → Kling's hosted page that
 * vaults a card without charging it, returning to the app's card-setup links
 * (without them the page landed on the website's /profile, a sign-in page for
 * an app-only member). A fresh Idempotency-Key per tap.
 */
export async function startCardSetup(): Promise<string> {
  const session = await apiPost<{ url?: unknown }>(
    '/billing/payment-methods/setup-session',
    { successUrl: CARD_SETUP_SUCCESS_URL, cancelUrl: CARD_SETUP_CANCEL_URL },
    { idempotencyKey: newIdempotencyKey(), decode: (data) => (typeof data === 'object' && data ? data : {}) },
  );
  if (typeof session.url !== 'string' || !/^https?:\/\//i.test(session.url)) throw new TransportError('network');
  return session.url;
}

function decodeCard(data: unknown): ConfirmedCard | null {
  const card = typeof data === 'object' && data !== null ? (data as { card?: unknown }).card : null;
  if (typeof card !== 'object' || card === null) return null;
  const { brand, last4 } = card as { brand?: unknown; last4?: unknown };
  return {
    brand: typeof brand === 'string' ? brand : null,
    last4: typeof last4 === 'string' ? last4 : null,
  };
}

/**
 * `POST /billing/payment-methods/confirm`: the verified pull after the page.
 * The server asks Kling which cards exist and mirrors the newest; which link
 * closed the page proves nothing. Null when no card was added (a cancel, an
 * abandoned page): a valid outcome, not an error. Callers re-read the billing
 * summary for the full card state.
 */
export function confirmCardSetup(): Promise<ConfirmedCard | null> {
  return apiPost('/billing/payment-methods/confirm', undefined, { decode: decodeCard });
}
