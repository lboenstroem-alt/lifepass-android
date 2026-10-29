/**
 * `EXPO_PUBLIC_FIXTURE="state=…,offersCard=<variant>"` (iOS
 * `-LPScreenshotOffersCard <variant>`, lifepass-ios feat/offers-opt-in-card):
 * Home's "Get offers by email" card in a known state, for device checks and
 * screenshots of a development build (src/dev/fixtures.ts). The fixture
 * profile carries the variant's `offersCard` and `marketingConsent`
 * (src/dev/fixtureSession.ts), and the card's two calls answer from here.
 *
 *   open        offered; Email me offers succeeds
 *   fails-once  offered; the first tap fails (offline), the next works
 *   opted-in    `marketingConsent: true`: not offered
 *   dismissed   "No thanks" on the account: not offered
 *
 * SAFETY, as on iOS: development builds only (`fixtureArg` is null in a
 * release bundle), and NOTHING is sent: a fixture member has no session, and
 * the opt-in and the No thanks never leave the phone.
 */
import { TransportError } from '../../../api';
import { fixtureArg } from '../../../dev/fixtures';

export const OFFERS_CARD_FIXTURES = ['open', 'fails-once', 'opted-in', 'dismissed'] as const;

export type OffersCardFixture = (typeof OFFERS_CARD_FIXTURES)[number];

/** The variant this development build was started with, or null (always null in release). */
export function offersCardFixture(value: string | null = fixtureArg('offersCard')): OffersCardFixture | null {
  if (!__DEV__) return null;
  return (OFFERS_CARD_FIXTURES as readonly string[]).includes(value ?? '') ? (value as OffersCardFixture) : null;
}

/** A beat of network before a canned answer, so the spinner shows. */
export const FIXTURE_ANSWER_MS = 400;

let optInTaps = 0;

/** The canned "Email me offers": `fails-once` fails the first tap of the run, as if offline. */
export async function fixtureOptIn(variant: OffersCardFixture): Promise<true> {
  optInTaps += 1;
  const tap = optInTaps;
  await new Promise<void>((resolve) => setTimeout(resolve, FIXTURE_ANSWER_MS));
  if (variant === 'fails-once' && tap === 1) throw new TransportError('offline');
  return true;
}

/** Tests: the next tap is the run's first again. */
export function resetOffersCardFixtureForTests(): void {
  optInTaps = 0;
}
