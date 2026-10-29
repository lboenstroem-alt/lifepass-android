/**
 * Who Home offers "Get offers by email" (the server decides; the phone only
 * ever takes the card away), how a failed tap ends, and the No thanks this
 * phone keeps per member.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { NotAuthenticatedError, ProblemError, TransportError } from '../../../../api';
import type { OffersCardState } from '../../../../api/profile';
import { offersCardOffered, optInFailure, type OffersCardInputs } from '../rules';
import { keepNoThanksOnPhone, offersCardDismissedKey, readNoThanksOnPhone } from '../storage';

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3f1a7c5e-9b2d-4e8f-a6c4-1d3b5f7a9c2e';

const OFFERED: OffersCardState = { show: true, dismissed: false };

function inputs(overrides: Partial<OffersCardInputs> = {}, card: OffersCardState | null = OFFERED, marketingConsent = false): OffersCardInputs {
  return {
    signedIn: true,
    profile: { marketingConsent, offersCard: card },
    noThanksOnPhone: false,
    answeredHere: false,
    ...overrides,
  };
}

describe('who is offered the card', () => {
  it('a signed-in member the server offers it to, who has not answered it here', () => {
    expect(offersCardOffered(inputs())).toBe(true);
  });

  it('never signed out, or before the profile is read', () => {
    expect(offersCardOffered(inputs({ signedIn: false }))).toBe(false);
    expect(offersCardOffered(inputs({ profile: null }))).toBe(false);
  });

  it('never when the server says not to: opted in, dismissed, on its way out, a no of their own', () => {
    // `show: false` covers every reason the server has; the app never works them out.
    expect(offersCardOffered(inputs({}, { show: false, dismissed: false }))).toBe(false);
    expect(offersCardOffered(inputs({}, { show: false, dismissed: true }))).toBe(false);
  });

  it('never without the block: a server older than 0.51.0, or one that could not read it', () => {
    expect(offersCardOffered(inputs({}, null))).toBe(false);
  });

  it('never to a member opted in, or one who said No thanks on the account, whatever show says', () => {
    expect(offersCardOffered(inputs({}, OFFERED, true))).toBe(false);
    expect(offersCardOffered(inputs({}, { show: true, dismissed: true }))).toBe(false);
  });

  it('never after a No thanks on this phone, and not while that is still being read', () => {
    expect(offersCardOffered(inputs({ noThanksOnPhone: true }))).toBe(false);
    expect(offersCardOffered(inputs({ noThanksOnPhone: null }))).toBe(false);
  });

  it('never once answered here this session, before the profile says so too', () => {
    expect(offersCardOffered(inputs({ answeredHere: true }))).toBe(false);
  });
});

describe('how a failed Email me offers ends', () => {
  const problem = (slug: string, status: number) =>
    new ProblemError({ type: `https://lifepass.is/problems/${slug}`, title: slug, status }, status);

  it('an account on its way out: the card closes', () => {
    expect(optInFailure(problem('account_pending_deletion', 409))).toBe('gone');
    expect(optInFailure(problem('account_deletion_scheduled', 409))).toBe('gone');
  });

  it('a session the client has ended: the app is on its way to sign-in', () => {
    expect(optInFailure(new NotAuthenticatedError())).toBe('signedOut');
  });

  it('anything else: the card stays and says it could not save', () => {
    expect(optInFailure(new TransportError('offline'))).toBe('failed');
    expect(optInFailure(new TransportError('timeout'))).toBe('failed');
    expect(optInFailure(problem('internal_error', 500))).toBe('failed');
    expect(optInFailure(problem('rate-limited', 429))).toBe('failed');
    expect(optInFailure(problem('unauthorized', 401))).toBe('failed');
    expect(optInFailure(new Error('anything'))).toBe('failed');
  });
});

describe('the No thanks this phone keeps', () => {
  it('is one key per member, as iOS names it', () => {
    expect(offersCardDismissedKey(MEMBER)).toBe(`offers.card.${MEMBER}.dismissed`);
  });

  it('is kept for the member who said it, and only for them', async () => {
    expect(await readNoThanksOnPhone(MEMBER)).toBe(false);
    await keepNoThanksOnPhone(MEMBER);
    expect(await AsyncStorage.getItem(`offers.card.${MEMBER}.dismissed`)).toBe('true');
    expect(await readNoThanksOnPhone(MEMBER)).toBe(true);
    expect(await readNoThanksOnPhone(OTHER)).toBe(false);
  });

  it('never throws: storage that fails reads as no No thanks, and a write that fails is dropped', async () => {
    const read = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(readNoThanksOnPhone(MEMBER)).resolves.toBe(false);
    read.mockRestore();
    const write = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    await expect(keepNoThanksOnPhone(MEMBER)).resolves.toBeUndefined();
    write.mockRestore();
  });
});
