/**
 * `offersCard=<variant>` (iOS -LPScreenshotOffersCard): the fixture member's
 * profile offers the card as the variant says, the card's calls answer from
 * the phone and send nothing, and a release build knows none of it.
 */
import { setDev, setEnv } from '@test/harness';
import { api } from '@test/server';

import { TransportError } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { fixtureProfile } from '../../../../dev/fixtureSession';
import { dismissOffersCard, optInToOffersByEmail } from '../api';
import { offersCardFixture, resetOffersCardFixtureForTests } from '../fixtures';

stubApiClientPerTest();

const KEY = '7d2e4f6a-8b0c-4d1e-9f2a-3b4c5d6e7f80';

beforeEach(() => {
  resetOffersCardFixtureForTests();
});

describe('the variant', () => {
  it('reads the four variants, and nothing else', () => {
    expect(offersCardFixture('open')).toBe('open');
    expect(offersCardFixture('fails-once')).toBe('fails-once');
    expect(offersCardFixture('opted-in')).toBe('opted-in');
    expect(offersCardFixture('dismissed')).toBe('dismissed');
    expect(offersCardFixture('pending-deletion')).toBeNull();
    expect(offersCardFixture(null)).toBeNull();
  });

  it('is never there in a release build', () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan,offersCard=open' });
    setDev(false);
    expect(offersCardFixture()).toBeNull();
  });
});

describe('the fixture member’s profile', () => {
  it.each([
    ['open', { show: true, dismissed: false }, false],
    ['fails-once', { show: true, dismissed: false }, false],
    ['opted-in', { show: false, dismissed: false }, true],
    ['dismissed', { show: false, dismissed: true }, false],
  ] as const)('%s: offersCard %j, marketingConsent %s', (variant, offersCard, marketingConsent) => {
    setEnv({ EXPO_PUBLIC_FIXTURE: `state=active-plan,offersCard=${variant}` });
    const profile = fixtureProfile('active-plan');
    expect(profile.offersCard).toEqual(offersCard);
    expect(profile.marketingConsent).toBe(marketingConsent);
  });

  it('without the switch: no block, as from an older server', () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan' });
    expect(fixtureProfile('active-plan').offersCard).toBeNull();
    expect(fixtureProfile('active-plan').marketingConsent).toBe(false);
  });
});

describe('the calls in a fixture run', () => {
  it('open: the opt-in and the No thanks answer from the phone, and nothing is sent', async () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan,offersCard=open' });
    await expect(optInToOffersByEmail(KEY)).resolves.toBe(true);
    await expect(dismissOffersCard(KEY)).resolves.toBe(true);
    expect(api.requests).toHaveLength(0);
  });

  it('fails-once: the first tap fails as if offline, the next works', async () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan,offersCard=fails-once' });
    await expect(optInToOffersByEmail(KEY)).rejects.toBeInstanceOf(TransportError);
    await expect(optInToOffersByEmail(KEY)).resolves.toBe(true);
    expect(api.requests).toHaveLength(0);
  });
});
