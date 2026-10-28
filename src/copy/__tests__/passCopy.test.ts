/**
 * The words for a member's pass: the port of iOS AccountPassRowTests and of
 * the PassCopy word cases in WalkInCoverageTests, same vectors.
 *
 * Before iOS 2.5.3 the member card read "Plan · None" and the Membership row
 * "View plans: No active membership" for every member without a
 * subscription, whatever pass they held. Now the card names the pass, and the
 * row says what it has left and until when, in the web dashboard's words.
 */
import { decodeUsage, type ActivePass } from '../../api/profile';
import { lookup } from '../../i18n';
import {
  accountCardLine,
  accountKicker,
  accountPass,
  balanceAfter,
  coverageLine,
  membershipRowSubtitle,
  passName,
  validUntilLine,
  visitsLeft,
  type CoverageForCopy,
} from '../passCopy';

/** Usage as `GET /profile` sends it for a pass holder: no tier, no lanes. */
function passes(json: unknown[]): readonly ActivePass[] {
  return decodeUsage({
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: json,
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
  }).passes;
}

const adventurer = [
  { id: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'adventurer', visitsLeft: 5, expiresAt: '2026-12-07T23:35:00.000Z' },
];

describe('the Account screen (iOS AccountPassRowTests)', () => {
  it('a pass holder sees the pass, not "no membership"', () => {
    const held = passes(adventurer);
    expect(accountKicker(null, held, 'en')).toBe('Adventurer pass');
    expect(accountKicker(null, held, 'is')).toBe('Adventurer-passi');
    expect(membershipRowSubtitle(held, 'en')).toBe('Adventurer pass · 5 visits left · valid until 7 Dec 2026');
    expect(membershipRowSubtitle(held, 'is')).toBe('Adventurer-passi · 5 heimsóknir eftir · gildir til 7. des. 2026');
    const pass = accountPass(false, held)!;
    expect(validUntilLine(pass, 'en')).toBe('Valid until 7 Dec 2026');
    expect(validUntilLine(pass, 'is')).toBe('Gildir til 7. des. 2026');

    for (const lang of ['en', 'is'] as const) {
      expect(membershipRowSubtitle(held, lang)).not.toBe(lookup('account.no_membership', lang));
      expect(accountKicker(null, held, lang)).not.toContain(lookup('account.none', lang));
    }
  });

  it('someone with neither still reads no membership', () => {
    const none = passes([]);
    expect(accountKicker(null, none, 'en')).toBe('Plan · None');
    expect(accountKicker(null, none, 'is')).toBe('Áskrift · Engin');
    expect(membershipRowSubtitle(none, 'en')).toBe('No active membership');
    expect(membershipRowSubtitle(none, 'is')).toBe('Engin virk áskrift');
    expect(accountPass(false, none)).toBeNull();
  });

  it("a subscriber's card is about the plan, pass or no pass", () => {
    const held = passes(adventurer);
    expect(accountKicker('Plus', held, 'en')).toBe('Plan · Plus');
    expect(accountPass(true, held)).toBeNull();
  });

  it('two passes lead with the one the next visit uses', () => {
    const held = passes([
      { id: '1b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'explorer', visitsLeft: 1, expiresAt: '2027-01-31T12:00:00.000Z' },
      ...adventurer,
    ]);
    expect(accountKicker(null, held, 'en')).toBe('Explorer pass');
    expect(membershipRowSubtitle(held, 'en')).toBe('Explorer pass · 1 visit left · valid until 31 Jan 2027');
    expect(membershipRowSubtitle(held, 'is')).toBe('Explorer-passi · 1 heimsókn eftir · gildir til 31. jan. 2027');
    // The card under that kicker: the Explorer pass's one visit, never the sum.
    expect(accountCardLine(false, held, 'en')).toBe('1 visit left');
    expect(accountCardLine(false, held, 'is')).toBe('1 heimsókn eftir');
    expect(validUntilLine(accountPass(false, held)!, 'en')).toBe('Valid until 31 Jan 2027');
  });

  it("the card line is the pass's only for a pass holder", () => {
    expect(accountCardLine(false, passes(adventurer), 'en')).toBe('5 visits left');
    expect(accountCardLine(true, passes(adventurer), 'en')).toBeNull();
    expect(accountCardLine(false, passes([]), 'en')).toBeNull();
  });

  it('visits left agree in Icelandic: the singular for 1, 21, 31, not 11', () => {
    expect(visitsLeft(21, 'is')).toBe('21 heimsókn eftir');
    expect(visitsLeft(31, 'is')).toBe('31 heimsókn eftir');
    expect(visitsLeft(11, 'is')).toBe('11 heimsóknir eftir');
    expect(visitsLeft(1, 'en')).toBe('1 visit left');
    expect(visitsLeft(0, 'en')).toBe('0 visits left');
  });

  it('a date reads on the Reykjavík calendar whatever the phone zone', () => {
    // 23:35 UTC on 7 December is still 7 December in Reykjavík (UTC, no DST).
    expect(validUntilLine(passes(adventurer)[0]!, 'en')).toBe('Valid until 7 Dec 2026');
  });
});

describe('the walk-in words (iOS WalkInCoverageTests)', () => {
  function pass(type: string, total = 6, used = 0): CoverageForCopy {
    return { kind: 'pass', passType: type, visitsTotal: total, visitsLeftAfter: total - used - 1 };
  }
  function sub(tier: string | null, lane: string, left: number | null): CoverageForCopy {
    return { kind: 'subscription', tierName: tier, lane, visitsLeftAfter: left };
  }

  it('the 10 October case: the pass named with its balance, and the balance after', () => {
    const coverage: CoverageForCopy = { kind: 'pass', passType: 'adventurer', visitsTotal: 6, visitsLeftAfter: 5 };
    expect(coverageLine(coverage, 'en')).toBe('Covered by your Adventurer pass: uses 1 of 6 visits (5 left after)');
    expect(coverageLine(coverage, 'is')).toBe('Innifalið í Adventurer-passanum þínum: notar 1 af 6 heimsóknum (5 eftir)');
    expect(balanceAfter(coverage, 'en')).toBe('5 of 6 visits left on your Adventurer pass');
    expect(balanceAfter(coverage, 'is')).toBe('5 af 6 heimsóknum eftir á Adventurer-passanum þínum');
  });

  it('a member covered by their membership sees it the same way', () => {
    expect(coverageLine(sub('Plus', 'network', 7), 'en')).toBe(
      'Included in your Plus membership: uses 1 of your monthly visits (7 left after)',
    );
    expect(balanceAfter(sub('Plus', 'network', 7), 'en')).toBe('7 gym & studio visits left this period');
  });

  it('an older server with no coverage says nothing', () => {
    expect(coverageLine(null, 'en')).toBeNull();
    expect(balanceAfter(null, 'en')).toBeNull();
    expect(lookup('checkin.cover.free', 'en')).toBe('Your visit has no charge.');
  });

  it('every pass type is named in both languages', () => {
    const expected: [string, string, string][] = [
      ['day', 'Covered by your day pass', 'Innifalið í dagspassanum þínum'],
      ['explorer', 'Covered by your Explorer pass', 'Innifalið í Explorer-passanum þínum'],
      ['adventurer', 'Covered by your Adventurer pass', 'Innifalið í Adventurer-passanum þínum'],
      ['local', 'Covered by your Local pass', 'Innifalið í Local-passanum þínum'],
      ['lagoon_duo', 'Covered by your Lagoon Duo pass', 'Innifalið í Lagoon Duo-passanum þínum'],
      ['a_future_type', 'Covered by your pass', 'Innifalið í passanum þínum'],
    ];
    for (const [type, english, icelandic] of expected) {
      const en = coverageLine(pass(type), 'en') ?? '';
      const is = coverageLine(pass(type), 'is') ?? '';
      expect(en.startsWith(`${english}:`)).toBe(true);
      expect(is.startsWith(`${icelandic}:`)).toBe(true);
      expect(en.includes('{') || is.includes('{')).toBe(false);
    }
    expect(passName('adventurer', 'en')).toBe('Adventurer pass');
    expect(passName('adventurer', 'is')).toBe('Adventurer-passi');
    expect(passName('lagoon_duo', 'en')).toBe('Lagoon Duo');
    expect(passName('a_future_type', 'is')).toBe('Passi');
  });

  it('counts read right at the edges', () => {
    expect(coverageLine(pass('day', 1), 'en')).toBe('Covered by your day pass: uses 1 of 1 visit (none left after)');
    expect(coverageLine(pass('day', 1), 'is')).toBe('Innifalið í dagspassanum þínum: notar 1 af 1 heimsókn (engin eftir)');
    expect(coverageLine(pass('explorer', 21, 3), 'is')).toBe(
      'Innifalið í Explorer-passanum þínum: notar 1 af 21 heimsókn (17 eftir)',
    );
    expect(coverageLine(pass('explorer', 11, 0), 'is')).toBe(
      'Innifalið í Explorer-passanum þínum: notar 1 af 11 heimsóknum (10 eftir)',
    );
    expect(balanceAfter(pass('adventurer', 6, 5), 'en')).toBe('No visits left on your Adventurer pass');
    expect(balanceAfter(pass('adventurer', 6, 5), 'is')).toBe('Engar heimsóknir eftir á Adventurer-passanum þínum');
    expect(balanceAfter(pass('explorer', 21, 0), 'is')).toBe('20 af 21 heimsókn eftir á Explorer-passanum þínum');
  });

  it('membership lines and balances', () => {
    expect(coverageLine(sub('Plus', 'network', 7), 'is')).toBe(
      'Innifalið í Plus-áskriftinni þinni: notar 1 af mánaðarheimsóknunum þínum (7 eftir)',
    );
    expect(coverageLine(sub('Max', 'pool', 0), 'en')).toBe(
      'Included in your Max membership: uses 1 of your monthly visits (none left after)',
    );
    expect(coverageLine(sub(null, 'network', null), 'en')).toBe(
      'Included in your LifePass membership: no charge for this visit',
    );
    expect(coverageLine(sub('  ', 'network', null), 'is')).toBe(
      'Innifalið í LifePass-áskriftinni þinni: ekkert gjald fyrir þessa heimsókn',
    );
    expect(coverageLine({ kind: 'money' }, 'en')).toBeNull();

    expect(balanceAfter(sub('Plus', 'network', 1), 'en')).toBe('1 gym & studio visit left this period');
    expect(balanceAfter(sub('Plus', 'network', 21), 'is')).toBe('21 ræktar- og stúdíóheimsókn eftir á tímabilinu');
    expect(balanceAfter(sub('Plus', 'pool', 3), 'is')).toBe('3 sundheimsóknir eftir á tímabilinu');
    expect(balanceAfter(sub('Plus', 'pool', 0), 'en')).toBe('No pool visits left this period');
    expect(balanceAfter(sub('Plus', 'network', null), 'en')).toBeNull();
    expect(balanceAfter({ kind: 'money' }, 'en')).toBeNull();
  });

  it('member copy carries no em or en dashes', () => {
    const lines = [
      membershipRowSubtitle(passes(adventurer), 'en'),
      membershipRowSubtitle(passes(adventurer), 'is'),
      coverageLine(pass('adventurer'), 'en'),
      coverageLine(pass('adventurer'), 'is'),
    ];
    for (const line of lines) expect(line).not.toMatch(/[–—]/);
  });
});
