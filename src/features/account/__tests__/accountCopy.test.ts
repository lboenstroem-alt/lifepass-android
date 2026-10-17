/**
 * The Account screen's lines (iOS `AccountView`'s computed copy): the caps
 * priority, the kicker, the renewal or valid-until line, the Change plan
 * allowance, the referral subtitle and the Language row, in both languages.
 */
import { decodeUsage, type ActivePass, type Usage } from '../../../api/profile';
import { decodeSubscription, type Subscription } from '../../../api/subscriptions';
import {
  avatarInitial,
  capsSummary,
  isPastDue,
  languageRowSubtitle,
  memberCardFootnote,
  memberCardKicker,
  planAllowanceDescription,
  planRow,
  plansButtonTitle,
  referralShareMessage,
  referralSubtitle,
  type MembershipFacts,
} from '../accountCopy';

function usage(extra: Record<string, unknown> = {}): Usage {
  return decodeUsage({
    tier: null,
    network: null,
    pools: null,
    daily: null,
    concurrent: { open: 0, cap: null },
    topup: { available: false, prices: { gym: null, studio: null, pool: null } },
    passes: [],
    block: { until: null },
    strikes: { active: 0, threshold: 3 },
    ...extra,
  });
}

const lanes = {
  tier: 'plus',
  network: { used: 3, cap: 8, resetsAt: '2026-11-01T00:00:00.000Z' },
  pools: { used: 2, cap: 4, resetsAt: '2026-11-01T00:00:00.000Z' },
};

const adventurer = { id: '0b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'adventurer', visitsLeft: 5, expiresAt: '2026-12-07T23:35:00.000Z' };
const explorer = { id: '1b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d', type: 'explorer', visitsLeft: 1, expiresAt: '2027-01-31T12:00:00.000Z' };

function plan(status = 'active', extra: Record<string, unknown> = {}): Subscription {
  return decodeSubscription({
    id: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
    productSlug: 'plan-plus',
    productName: 'Plus',
    status,
    currentPeriodStartsAt: '2026-09-01T10:14:03.512Z',
    currentPeriodEndsAt: '2026-10-01T10:14:03.512Z',
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    ...extra,
  })!;
}

function facts(subscription: Subscription | null, u: Usage | null): MembershipFacts {
  return { subscription, usage: u, passes: u?.passes ?? ([] as readonly ActivePass[]) };
}

const subscriber = facts(plan(), usage(lanes));
const passHolder = facts(null, usage({ passes: [adventurer] }));
const twoPasses = facts(null, usage({ passes: [explorer, adventurer] }));
const neither = facts(null, usage());
const notLoaded = facts(null, null);
const dunning = facts(plan('past_due'), usage());

describe('the member card kicker', () => {
  it('names the plan, the pass, or neither', () => {
    expect(memberCardKicker(subscriber, 'en')).toBe('Plan · Plus');
    expect(memberCardKicker(subscriber, 'is')).toBe('Áskrift · Plus');
    expect(memberCardKicker(passHolder, 'en')).toBe('Adventurer pass');
    expect(memberCardKicker(passHolder, 'is')).toBe('Adventurer-passi');
    expect(memberCardKicker(twoPasses, 'en')).toBe('Explorer pass');
    expect(memberCardKicker(neither, 'en')).toBe('Plan · None');
    expect(memberCardKicker(neither, 'is')).toBe('Áskrift · Engin');
    expect(memberCardKicker(notLoaded, 'en')).toBe('Plan · None');
  });

  it('keeps the plan in dunning (the plan still exists)', () => {
    expect(memberCardKicker(dunning, 'en')).toBe('Plan · Plus');
    expect(isPastDue(dunning)).toBe(true);
    expect(isPastDue(subscriber)).toBe(false);
  });

  it('a subscriber who also holds a pass keeps the plan', () => {
    expect(memberCardKicker(facts(plan(), usage({ ...lanes, passes: [adventurer] })), 'en')).toBe('Plan · Plus');
  });
});

describe('the caps line (iOS capsSummary), in priority order', () => {
  it('1. a pass holder without a plan reads what the headline pass has left', () => {
    expect(capsSummary(passHolder, 'en')).toBe('5 visits left');
    expect(capsSummary(passHolder, 'is')).toBe('5 heimsóknir eftir');
    // Never the sum over both passes ("6 pass visits left").
    expect(capsSummary(twoPasses, 'en')).toBe('1 visit left');
    expect(capsSummary(twoPasses, 'is')).toBe('1 heimsókn eftir');
  });

  it('1 beats 2: a pass line wins over lanes for someone with no plan', () => {
    expect(capsSummary(facts(null, usage({ ...lanes, passes: [adventurer] })), 'en')).toBe('5 visits left');
  });

  it('2. a tier reads its lanes', () => {
    expect(capsSummary(subscriber, 'en')).toBe('Gym & studio 3 of 8 · Pool 2 of 4');
    expect(capsSummary(subscriber, 'is')).toBe('Rækt og stúdíó 3 af 8 · Sund 2 af 4');
    expect(capsSummary(facts(plan(), usage({ tier: 'base', network: lanes.network })), 'en')).toBe('Gym & studio 3 of 8');
  });

  it('3. a subscriber with a pass and no lanes reads the summed pass visits (English rule in both languages)', () => {
    const subWithPasses = facts(plan(), usage({ passes: [explorer, adventurer] }));
    expect(capsSummary(subWithPasses, 'en')).toBe('6 pass visits left');
    const one = facts(plan(), usage({ passes: [explorer] }));
    expect(capsSummary(one, 'en')).toBe('1 pass visit left');
    // 21 is "many" on iOS, never the Icelandic singular.
    const many = facts(plan(), usage({ passes: [{ ...adventurer, visitsLeft: 21 }] }));
    expect(capsSummary(many, 'is')).toBe('21 passaheimsóknir eftir');
    expect(capsSummary(one, 'is')).toBe('1 passaheimsókn eftir');
  });

  it('a tier with no lanes falls through to the passes, then to no membership', () => {
    expect(capsSummary(facts(plan(), usage({ tier: 'plus' })), 'en')).toBe('No active membership');
  });

  it('4. neither reads no membership', () => {
    expect(capsSummary(neither, 'en')).toBe('No active membership');
    expect(capsSummary(neither, 'is')).toBe('Engin virk áskrift');
    expect(capsSummary(notLoaded, 'en')).toBe('No active membership');
  });
});

describe('the line under the caps', () => {
  it('a plan holder reads the renewal date on the Reykjavík calendar', () => {
    expect(memberCardFootnote(subscriber, 'en')).toBe('Renews 1 Oct 2026');
    expect(memberCardFootnote(subscriber, 'is')).toBe('Endurnýjast 1. okt. 2026');
  });

  it('a pass holder reads the headline pass’s valid-until', () => {
    expect(memberCardFootnote(passHolder, 'en')).toBe('Valid until 7 Dec 2026');
    expect(memberCardFootnote(passHolder, 'is')).toBe('Gildir til 7. des. 2026');
    expect(memberCardFootnote(twoPasses, 'en')).toBe('Valid until 31 Jan 2027');
  });

  it('neither reads nothing', () => {
    expect(memberCardFootnote(neither, 'en')).toBeNull();
  });

  it('a cancelled-at-period-end plan still says Renews, as iOS does', () => {
    expect(memberCardFootnote(facts(plan('active', { cancelAtPeriodEnd: true }), usage(lanes)), 'en')).toBe(
      'Renews 1 Oct 2026',
    );
  });

  it('reads the day in Reykjavík whatever the phone’s zone (a late-evening renewal)', () => {
    const late = facts(plan('active', { currentPeriodEndsAt: '2026-10-31T23:30:00.000Z' }), usage(lanes));
    expect(memberCardFootnote(late, 'en')).toBe('Renews 31 Oct 2026');
  });
});

describe('the Membership card’s first row', () => {
  it('a plan holder: Change plan with the allowance', () => {
    expect(planRow(subscriber, 'en')).toEqual({
      kind: 'change',
      title: 'Change plan',
      subtitle: 'Plus · 8 gym & studio / mo · 4 pool / mo',
    });
    expect(planRow(subscriber, 'is').title).toBe('Skipta um áskrift');
  });

  it('a plan in dunning has no lanes: the plan name alone', () => {
    expect(planRow(dunning, 'en')).toEqual({ kind: 'change', title: 'Change plan', subtitle: 'Plus' });
  });

  it('a pass holder: View plans with the pass summary', () => {
    expect(planRow(passHolder, 'en')).toEqual({
      kind: 'view',
      title: 'View plans',
      subtitle: 'Adventurer pass · 5 visits left · valid until 7 Dec 2026',
    });
    expect(planRow(passHolder, 'is')).toEqual({
      kind: 'view',
      title: 'Skoða áskriftir',
      subtitle: 'Adventurer-passi · 5 heimsóknir eftir · gildir til 7. des. 2026',
    });
  });

  it('neither: View plans, no active membership', () => {
    expect(planRow(neither, 'en')).toEqual({ kind: 'view', title: 'View plans', subtitle: 'No active membership' });
  });

  it('the allowance names the plan by its slug when the server sent no name', () => {
    expect(planAllowanceDescription(plan('active', { productName: '' }), usage(lanes), 'en')).toBe(
      'LifePass Plus · 8 gym & studio / mo · 4 pool / mo',
    );
    expect(planAllowanceDescription(plan(), null, 'en')).toBe('Plus');
  });

  it('the capsule says Change plan for a plan holder, View plans otherwise', () => {
    expect(plansButtonTitle(subscriber, 'en')).toBe('Change plan');
    expect(plansButtonTitle(dunning, 'en')).toBe('Change plan');
    expect(plansButtonTitle(passHolder, 'en')).toBe('View plans');
    expect(plansButtonTitle(neither, 'is')).toBe('Skoða áskriftir');
  });
});

describe('the referral row', () => {
  it.each([
    [0, 'en', 'They buy their first package, you earn a free visit'],
    [1, 'en', '1 free visit earned — keep sharing'],
    [5, 'en', '5 free visits earned — keep sharing'],
  ] as const)('%i rewards in %s', (count, lang, text) => {
    expect(referralSubtitle(count, lang)).toBe(text);
  });

  it.each([
    [0, 'Vinur kaupir fyrsta pakkann, þú færð fría heimsókn'],
    [1, '1 frí heimsókn áunnin — haltu áfram að deila'],
    [5, '5 fríar heimsóknir áunnar — haltu áfram að deila'],
    // iOS compares with 1, so 21 is "many", never the Icelandic singular.
    [21, '21 fríar heimsóknir áunnar — haltu áfram að deila'],
  ] as const)('%i rewards in is', (count, text) => {
    expect(referralSubtitle(count, 'is')).toBe(text);
  });

  it('shares the message with the link at its end', () => {
    expect(referralShareMessage('https://www.lifepass.is/r/ANNA7K', 'en')).toBe(
      "I'm using LifePass — one membership for gyms, pools and studios across Iceland. Join through my link! https://www.lifepass.is/r/ANNA7K",
    );
    expect(referralShareMessage('https://x.is/r/1', 'is').endsWith(' https://x.is/r/1')).toBe(true);
  });
});

describe('the Language row', () => {
  it('names the language it speaks, or says it is saving', () => {
    expect(languageRowSubtitle('en', false, 'en')).toBe('English');
    expect(languageRowSubtitle('is', false, 'is')).toBe('Íslenska');
    expect(languageRowSubtitle('is', true, 'is')).toBe('Vista…');
    expect(languageRowSubtitle('en', true, 'en')).toBe('Saving…');
  });
});

describe('the avatar letter', () => {
  it('is the name’s first character, "L" with no name', () => {
    expect(avatarInitial('Anna Jónsdóttir')).toBe('A');
    expect(avatarInitial('Ásta')).toBe('Á');
    expect(avatarInitial(null)).toBe('L');
    expect(avatarInitial(undefined)).toBe('L');
    expect(avatarInitial('')).toBe('');
  });
});
