/**
 * "Get offers by email" on Home: the card's two calls. The owner's "Card in
 * the apps" (29 Oct 2026): the website dashboard's one-tap card
 * (lifepass-monorepo apps/web/src/components/offers-opt-in), in the app, on
 * the routes the website card uses.
 *
 *   POST /profile/marketing-consent    { optedIn: true, source: "app_card" }   200 { optedIn: true }
 *   POST /profile/offers-card/dismiss  no body                                 200 { dismissed: true }
 *
 * THE OPT-IN is recorded by the server exactly as the website card's is: a
 * consent-ledger row (channel email, opted in, source `app_card`, the consent
 * version and the words the member said yes to, which are the website card's
 * own, `offers-card-2026-10-28`) and the profile's `marketingConsent`. Safe
 * to repeat: a member already opted in gets no second row and still a 200.
 * Refused `409 account_pending_deletion` or `409 account_deletion_scheduled`
 * for an account on its way out; the card is never offered to one, so that
 * refusal only meets a deletion asked for elsewhere since the last profile
 * read. The `app_card` source is API 0.51.0, as is the profile's `offersCard`
 * that offers the card, so no server that would refuse the source ever has
 * the card offered from it.
 *
 * "NO THANKS" is kept on the member's account, shared with the website card,
 * so neither asks again on any device. It changes no consent. Best effort: the
 * card has already closed when it is sent, whatever the answer.
 *
 * THE KEY. Each tap sends a new Idempotency-Key. These routes read none (both
 * are safe to repeat as they are), but the client resends a keyed request
 * once after refreshing a session the server refused (../../../api/client.ts),
 * so a tap that meets an expired session still lands. Like every member call
 * they go out `no-store`, with the profile rail's patience.
 *
 * The `app_card` source and the dismissal are newer than the vendored 0.34.0
 * contract, so the tests read what was sent from the stub server rather than
 * the contract (as ../../coach/report/api.ts does).
 *
 * A development build started with `offersCard=<variant>` answers both from
 * ./fixtures.ts and sends nothing (never in a release build).
 */
import { API_TIMEOUTS, apiPost } from '../../../api';
import { fixtureOptIn, offersCardFixture } from './fixtures';

/** The opt-in route, relative to `/api/v1`: the profile's own marketing setting. */
export const MARKETING_CONSENT_PATH = '/profile/marketing-consent';

/** "No thanks", relative to `/api/v1`. */
export const OFFERS_CARD_DISMISS_PATH = '/profile/offers-card/dismiss';

/** The opt-in body: only ever a yes, named as the apps' card. */
export const APP_CARD_OPT_IN_BODY = Object.freeze({ optedIn: true, source: 'app_card' } as const);

/**
 * The opt-in's answer. Read strictly: a 2xx that does not say `optedIn: true`
 * is not taken as done (the member can tap again; a repeat is harmless).
 */
export function decodeOptInAnswer(data: unknown): true {
  if (typeof data === 'object' && data !== null && (data as Record<string, unknown>).optedIn === true) return true;
  throw new Error('the opt-in answer does not say optedIn: true');
}

/** The dismissal's answer, read softly: the card is closed whatever it says. */
export function decodeDismissAnswer(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>).dismissed === true;
}

/** `POST /profile/marketing-consent` from the card. Throws the client's typed errors. */
export function optInToOffersByEmail(idempotencyKey: string): Promise<true> {
  const fixture = offersCardFixture();
  if (fixture) return fixtureOptIn(fixture);
  return apiPost<true>(MARKETING_CONSENT_PATH, APP_CARD_OPT_IN_BODY, {
    timeoutMs: API_TIMEOUTS.profile,
    idempotencyKey,
    decode: decodeOptInAnswer,
  });
}

/** `POST /profile/offers-card/dismiss`. Throws the client's typed errors; the card ignores them. */
export function dismissOffersCard(idempotencyKey: string): Promise<boolean> {
  if (offersCardFixture()) return Promise.resolve(true);
  return apiPost<boolean>(OFFERS_CARD_DISMISS_PATH, undefined, {
    timeoutMs: API_TIMEOUTS.profile,
    idempotencyKey,
    decode: decodeDismissAnswer,
  });
}
