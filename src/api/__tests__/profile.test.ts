/**
 * `GET /profile`: the port of iOS ProfileHealthBlockDecodeTests (the profile
 * half: the block's decode and the confirmed consent writes applied to the
 * profile in hand), plus the fail-soft rules of `Profile` itself and the two
 * calls, checked against the contract.
 *
 * A malformed `health` block must never cost the member their identity: a
 * required key that changed shape once failed the whole profile decode and
 * blanked the member's name, language and caps app-wide.
 */
import { api, Reply } from '@test/server';
import { sampleResponse, withValue } from '@test/contract';

import {
  checkInConfirmationCode,
  decodeProfile,
  fetchProfile,
  healthBlockWithConsent,
  isLiveProgramStatus,
  isWearableConnected,
  PROFILE_TIMEOUT_MS,
  replacingHealth,
  setProfileLocale,
  withHealthConsent,
  withHealthDataDeleted,
  type HealthConsent,
  type Profile,
} from '../profile';
import { DecodingError } from '../errors';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const identity = {
  id: '8C2C1B36-2A7E-4B1F-9E0E-2F1C4F0A9C11',
  email: 'member@example.com',
  fullName: 'Anna Jonsdottir',
  locale: 'is',
  kennitalaVerified: true,
  marketingConsent: false,
};

function decode(extra: Record<string, unknown> = {}): Profile {
  return decodeProfile({ ...identity, ...extra });
}

const fullHealth = {
  access: 'entitled',
  consent: { version: '2026-09-v1', consentedAt: '2026-09-01T10:00:00Z', ageSource: 'kennitala' },
  trialEligible: true,
  latest: { weightKg: 72.5, heightCm: 170, measuredAt: '2026-09-14T07:30:00Z' },
  weighInDue: true,
  program: { id: 'p1', status: 'active', weekNo: 2, weeks: 4, summaryTitle: 'Build muscle' },
  proposalId: 'p2',
  appleHealth: { connected: true, lastSyncedAt: '2026-09-15T06:00:00Z' },
};

describe('the health block (iOS ProfileHealthBlockDecodeTests)', () => {
  it('a garbage health block leaves the profile intact', () => {
    const profile = decode({ health: { access: 42, consent: 'yesterday' } });
    expect(profile.fullName).toBe('Anna Jonsdottir');
    expect(profile.locale).toBe('is');
    expect(profile.health).toBeNull();
  });

  it('a missing health block is fine', () => {
    const profile = decode();
    expect(profile.health).toBeNull();
    expect(profile.email).toBe('member@example.com');
  });

  it('a null health block is fine', () => {
    expect(decode({ health: null }).health).toBeNull();
  });

  it('a full block decodes', () => {
    const profile = decode({
      health: {
        ...fullHealth,
        trialEligible: false,
        proposalId: null,
        program: {
          id: 'p1',
          status: 'active',
          weekNo: 2,
          weeks: 4,
          summaryTitle: 'Build muscle, 3 days a week',
          today: {
            sessionId: 's1',
            kind: 'strength',
            title: 'Full body strength',
            minutes: 40,
            status: 'planned',
            bookingId: null,
            hasBooking: false,
            bookingTitle: null,
            bookingStartsAt: null,
            movedAway: false,
          },
        },
      },
    });
    expect(profile.health?.access).toBe('entitled');
    expect(profile.health?.program?.today?.kind).toBe('strength');
    expect(profile.health?.program?.weekNo).toBe(2);
    expect(profile.health?.latest?.weightKg).toBe(72.5);
    expect(profile.health?.appleHealth?.connected).toBe(true);
    expect(isWearableConnected(profile.health?.appleHealth)).toBe(true);
    expect(profile.health?.consent?.consentedAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('a block without access still decodes (the fallback decides)', () => {
    const profile = decode({
      health: {
        consent: { version: '2026-09-v1', consentedAt: '2026-09-01T10:00:00Z', ageSource: null },
        weighInDue: false,
        latest: null,
        program: null,
      },
    });
    expect(profile.health).not.toBeNull();
    expect(profile.health?.access).toBeNull();
    expect(profile.health?.consent).not.toBeNull();
  });

  it('unknown enum values decode as unknown', () => {
    const profile = decode({
      health: {
        access: 'trial_pending',
        consent: null,
        weighInDue: false,
        program: {
          id: 'p1',
          status: 'hibernating',
          weekNo: 1,
          weeks: 4,
          summaryTitle: 'x',
          today: {
            sessionId: 's1',
            kind: 'kayaking',
            title: 'Paddle',
            minutes: 30,
            status: 'pencilled_in',
            hasBooking: false,
            movedAway: false,
          },
        },
      },
    });
    expect(profile.health?.access).toBe('unknown');
    expect(profile.health?.program?.status).toBe('unknown');
    expect(profile.health?.program?.today?.kind).toBe('unknown');
    expect(profile.health?.program?.today?.status).toBe('unknown');
    expect(isLiveProgramStatus(profile.health?.program?.status)).toBe(false);
  });

  it('the feature list decodes, and the feedback flag rides on it', () => {
    const profile = decode({
      health: { access: 'entitled', consent: null, features: ['target_weight', 'plan_revision', 'health_feedback'] },
    });
    expect(profile.health?.features).toEqual(['target_weight', 'plan_revision', 'health_feedback']);
  });

  it('a missing feature list is null', () => {
    const profile = decode({ health: { access: 'entitled' } });
    expect(profile.health).not.toBeNull();
    expect(profile.health?.features).toBeNull();
  });

  it('a malformed feature list costs only the list', () => {
    const profile = decode({ health: { access: 'entitled', weighInDue: true, features: 'yes' } });
    expect(profile.health?.access).toBe('entitled');
    expect(profile.health?.weighInDue).toBe(true);
    expect(profile.health?.features).toBeNull();
    expect(decode({ health: { access: 'entitled', features: ['target_weight', 7] } }).health?.features).toBeNull();
  });

  it('an unreadable date inside the block costs the block, never the profile', () => {
    const profile = decode({ health: { ...fullHealth, latest: { weightKg: 72, heightCm: 170, measuredAt: 'monday' } } });
    expect(profile.health).toBeNull();
    expect(profile.kennitalaVerified).toBe(true);
  });
});

describe('what a confirmed consent write does to the profile in hand', () => {
  function fullProfile(): Profile {
    return decode({ health: { ...fullHealth, features: ['target_weight'] } });
  }

  it('the withdrawal leaves nothing readable, and nothing that is not health data taken away', () => {
    const before = fullProfile();
    const after = replacingHealth(before, withHealthDataDeleted(before.health!));
    expect(after.health?.consent).toBeNull();
    expect(after.health?.latest).toBeNull();
    expect(after.health?.program).toBeNull();
    expect(after.health?.proposalId).toBeNull();
    expect(after.health?.appleHealth).toBeNull();
    expect(after.health?.weighInDue).toBe(false);
    // Not health data: computed without consent, and still true.
    expect(after.health?.access).toBe('entitled');
    expect(after.health?.trialEligible).toBe(true);
    expect(after.health?.features).toEqual(['target_weight']);
    // And the member is still the member.
    expect(after.id).toBe(before.id);
    expect(after.fullName).toBe('Anna Jonsdottir');
    expect(after.locale).toBe('is');
    expect(after.kennitalaVerified).toBe(true);
  });

  it('a granted consent replaces only the consent', () => {
    const withdrawn = fullProfile();
    const empty = replacingHealth(withdrawn, withHealthDataDeleted(withdrawn.health!));
    const consent: HealthConsent = {
      version: '2026-09-v1',
      consentedAt: new Date(1_790_000_000_000),
      ageSource: 'attestation',
    };
    const granted = replacingHealth(empty, withHealthConsent(empty.health!, consent));
    expect(granted.health?.consent).toEqual(consent);
    expect(granted.health?.consent).not.toEqual(withdrawn.health?.consent);
    expect(granted.health?.latest).toBeNull();
    expect(granted.health?.access).toBe('entitled');
    expect(granted.health?.features).toEqual(['target_weight']);
  });

  it('a consent on a profile whose block failed to read is a block with only the consent', () => {
    const consent: HealthConsent = { version: '2026-09-v1', consentedAt: null, ageSource: null };
    expect(healthBlockWithConsent(consent)).toEqual({
      access: null,
      consent,
      trialEligible: null,
      latest: null,
      weighInDue: null,
      program: null,
      proposalId: null,
      appleHealth: null,
      features: null,
    });
  });
});

describe('the profile itself', () => {
  const passHolderUsage = {
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: [
      { id: '1B8E3C1A-2D4F-4A6B-8C9D-0E1F2A3B4C5D', type: 'explorer', visitsLeft: 1, expiresAt: '2027-01-31T12:00:00.000Z' },
      { id: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'adventurer', visitsLeft: 5, expiresAt: '2026-12-07T23:35:00.000Z' },
    ],
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
  };

  it('ids are kept lower case, so the profile and the session name one member one way', () => {
    expect(decode().id).toBe('8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11');
  });

  it('a pass holder: no tier, no lanes, the passes in the order the door redeems them', () => {
    const usage = decode({ usage: passHolderUsage }).usage!;
    expect(usage.tier).toBeNull();
    expect(usage.network).toBeNull();
    expect(usage.concurrent).toEqual({ open: 0, cap: null });
    expect(usage.passes.map((p) => p.type)).toEqual(['explorer', 'adventurer']);
    expect(usage.passes[0]!.id).toBe('1b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d');
    expect(usage.passes[1]!.expiresAt.toISOString()).toBe('2026-12-07T23:35:00.000Z');
  });

  it('a member with a tier reads every lane', () => {
    const usage = decode({
      usage: {
        ...passHolderUsage,
        tier: 'plus',
        network: { used: 4, cap: 12, resetsAt: '2026-10-01T00:00:00Z' },
        pools: { used: 2, cap: 8, resetsAt: '2026-10-01T00:00:00Z' },
        daily: { used: 0, cap: 1 },
        concurrent: { open: 1, cap: 2 },
        topup: { available: true, prices: { gym: 1900, studio: 2500, pool: null } },
        passes: [],
        block: { until: '2026-10-20T00:00:00Z' },
        strikes: { active: 1, threshold: 3 },
      },
    }).usage!;
    expect(usage.tier).toBe('plus');
    expect(usage.network).toEqual({ used: 4, cap: 12, resetsAt: new Date('2026-10-01T00:00:00Z') });
    expect(usage.daily).toEqual({ used: 0, cap: 1, resetsAt: null });
    expect(usage.topup.prices).toEqual({ gym: 1900, studio: 2500, pool: null });
    expect(usage.block.until?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('a profile with no usage block still reads; the caps UI degrades', () => {
    expect(decode().usage).toBeNull();
    expect(decode({ usage: null }).usage).toBeNull();
  });

  it('an identity or usage field of the wrong type fails the read (the store keeps the profile it had)', () => {
    expect(() => decode({ kennitalaVerified: 'yes' })).toThrow();
    expect(() => decode({ id: 'not-a-uuid' })).toThrow();
    expect(() => decode({ createdAt: 'last week' })).toThrow();
    expect(() => decode({ usage: { ...passHolderUsage, strikes: { active: 'one', threshold: 3 } } })).toThrow();
  });

  it('a malformed check-in or coach block is discarded and the rest survives', () => {
    const profile = decode({
      usage: passHolderUsage,
      recentCheckIn: { checkInId: 'x', checkedInAt: 'yesterday', venue: { id: 'v', name: 'Laugar' } },
      coach: 'free',
    });
    expect(profile.recentCheckIn).toBeNull();
    expect(profile.coach).toBeNull();
    expect(profile.usage?.passes).toHaveLength(2);
    expect(profile.fullName).toBe('Anna Jonsdottir');
  });

  describe('the recent check-in', () => {
    const proof = {
      checkInId: '7c1f2ab3-9d54-4e88-9a01-4f21a0c93b77',
      bookingId: 'b1',
      source: 'walk_in',
      checkedInAt: '2026-04-23T14:32:00Z',
      memberName: 'Anna Jonsdottir',
      memberShortName: 'Anna J.',
      venue: { id: 'v1', slug: 'laugar', name: 'Laugar Spa' },
      activity: null,
      party: { adults: 1, children: 1, infants: 0, guestChargeIsk: 2800 },
    };

    it('carries the short name and never the full one', () => {
      const checkIn = decode({ recentCheckIn: proof }).recentCheckIn!;
      expect(checkIn.memberShortName).toBe('Anna J.');
      expect(JSON.stringify(checkIn)).not.toContain('Jonsdottir');
      expect(checkIn.venue).toEqual({ id: 'v1', name: 'Laugar Spa' });
      expect(checkIn.party).toEqual({ adults: 1, children: 1, infants: 0, guestChargeIsk: 2800 });
      expect(checkInConfirmationCode(checkIn)).toBe('C93B77');
    });

    it('a blank, null or unreadable short name is no name, and the proof stays', () => {
      for (const shortName of ['  ', null, 42]) {
        const checkIn = decode({ recentCheckIn: { ...proof, memberShortName: shortName } }).recentCheckIn;
        expect(checkIn).not.toBeNull();
        expect(checkIn?.memberShortName).toBeNull();
      }
    });

    it('an unreadable party costs only the party', () => {
      const checkIn = decode({ recentCheckIn: { ...proof, party: { adults: 'two' } } }).recentCheckIn;
      expect(checkIn?.party).toBeNull();
      expect(checkIn?.checkInId).toBe(proof.checkInId);
    });
  });

  describe('the coach block', () => {
    it('a free account reads its allowance', () => {
      const coach = decode({
        coach: {
          tier: 'free',
          freeMessages: { limit: 3, remaining: -1, windowDays: 30, resetsAt: null },
          upgrade: { action: 'plans', url: 'https://www.lifepass.is/plans' },
        },
      }).coach!;
      expect(coach.tier).toBe('free');
      expect(coach.freeMessages).toEqual({ limit: 3, remaining: 0, windowDays: 30, resetsAt: undefined });
      expect(coach.upgrade).toEqual({ action: 'plans', url: 'https://www.lifepass.is/plans' });
    });

    it('each member of the block is fail-soft on its own', () => {
      const coach = decode({ coach: { tier: 'platinum', freeMessages: { limit: 'three' }, upgrade: 7 } }).coach!;
      expect(coach.tier).toBe('unknown');
      expect(coach.freeMessages).toBeNull();
      expect(coach.upgrade).toBeNull();
      expect(decode({ coach: { tier: 9 } }).coach?.tier).toBeNull();
    });
  });
});

describe('the calls', () => {
  it("decodes the contract's own full profile completely", async () => {
    api.on('GET', '/profile', replyFromContract('GET', '/profile', 200, 'full'));
    const profile = await fetchProfile();
    expect(profile.usage).not.toBeNull();
    expect(profile.recentCheckIn).not.toBeNull();
    expect(profile.health).not.toBeNull();
    expect(profile.coach).not.toBeNull();
    const sent = expectSentToMatchContract('GET', '/profile');
    expect(sent.headers['cache-control']).toBe('no-store');
  });

  it("survives the contract's minimal profile", async () => {
    api.on('GET', '/profile', replyFromContract('GET', '/profile', 200, 'minimal'));
    const profile = await fetchProfile();
    expect(profile.kennitalaVerified).toBe(false);
  });

  it('an unreadable identity is a decoding error, not a profile', async () => {
    const sample = sampleResponse('GET', '/profile', 200, 'full');
    api.on('GET', '/profile', Reply.ok(withValue(sample, 'marketingConsent', 'maybe')));
    await expect(fetchProfile()).rejects.toBeInstanceOf(DecodingError);
  });

  it('keeps the profile rail at 60 seconds', () => {
    expect(PROFILE_TIMEOUT_MS).toBe(60_000);
  });

  it('records the language with POST /profile/locale', async () => {
    api.on('POST', '/profile/locale', replyFromContract('POST', '/profile/locale', 200));
    await expect(setProfileLocale('is')).resolves.toBe('en');
    const sent = expectSentToMatchContract('POST', '/profile/locale');
    expect(sent.body).toEqual({ locale: 'is' });
  });
});
